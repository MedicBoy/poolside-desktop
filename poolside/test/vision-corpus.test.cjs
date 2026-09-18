// The vision corpus: structure, coverage, coordinates, and the matching it drives.
//
// `test/fixtures/vision-corpus.json` is a structured fixture set, not a measurement — its own `disclaimer`
// says so, and this suite repeats the distinction because it is easy to lose: a frame passing here proves the
// matching logic and the coordinate rules are coherent. It proves nothing about OCR accuracy on the live site.
//
// The corpus is checked in both directions. Downward: every frame's stated state must be what the rule engine
// actually returns from that frame's text, through the pipeline. Upward: the corpus must cover every state the
// rule engine can produce, so adding a state fails this suite until a frame exercises it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classify, RULES } = require('../src/game-screen.cjs');
const { createVisionPipeline, handles, BOTTOM_BAND } = require('../src/vision-pipeline.cjs');
const { clampRect, toCaptureRect, toPageRect } = require('../src/vision-frame.cjs');
const { describeGrid, LOW_CONFIDENCE } = require('../src/vision-grid.cjs');

const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vision-corpus.json'), 'utf8'));
const VOCABULARY = [...RULES.map(rule => rule.state), 'unknown'];

/** The surface a frame is drawn on, with the corpus defaults filled in. */
function surfaceOf(frame) {
  const merged = { ...corpus.surfaceDefaults, ...(frame.surface || {}) };
  return merged;
}

/** A capture-stage pipeline. Asserted here so every caller needs no narrowing. */
/** @param {any} frame @returns {any} */
function pipelineFor(frame) {
  const surface = surfaceOf(frame);
  const pipeline = createVisionPipeline({
    pageRect: { x: 0, y: 0, width: surface.width, height: surface.height },
    zoom: surface.zoom,
    imageWidth: surface.width,
    imageHeight: surface.height,
    deviceScaleFactor: surface.deviceScaleFactor
  });
  assert.equal(pipeline.ok, true, `${frame.id}: ${pipeline.message}`);
  return pipeline;
}

/** Does this box need clipping to fit the surface at all? */
function overflows(box, surface) {
  return box.x < 0 || box.y < 0 || box.x + box.width > surface.width || box.y + box.height > surface.height;
}

// The coordinate functions return a discriminated union; property access on an unnarrowed union is a type
// error, so these assert the outcome and hand the value back.
/** @param {any} result @returns {any} */
const granted = result => {
  assert.equal(result.ok, true, result.message || `expected a usable result, got ${result.reason}`);
  return result;
};

test('the corpus is well formed', () => {
  assert.ok(corpus.version >= 1, 'the corpus carries a version');
  assert.match(corpus.disclaimer, /not measurements/i, 'the corpus must state what it is not');
  assert.ok(corpus.frames.length >= 12, 'a corpus that does not cover the failure modes is not a corpus');
  const ids = new Set();
  for (const frame of corpus.frames) {
    assert.ok(!ids.has(frame.id), `duplicate frame id ${frame.id}`);
    ids.add(frame.id);
    const surface = surfaceOf(frame);
    for (const key of ['width', 'height', 'zoom', 'deviceScaleFactor']) {
      assert.ok(Number.isFinite(surface[key]) && surface[key] > 0, `${frame.id}: surface.${key} must be a positive number`);
    }
    assert.ok(Array.isArray(frame.lines), `${frame.id}: lines must be an array`);
    assert.ok(VOCABULARY.includes(frame.state), `${frame.id}: '${frame.state}' is not a state the rule engine can produce`);
    assert.ok(frame.note && frame.note.length > 20, `${frame.id}: every frame says why it exists`);
  }
});

test('every state the rule engine can produce is covered, and the negatives are present', () => {
  const covered = new Set(corpus.frames.map(frame => frame.state));
  const missing = RULES.map(rule => rule.state).filter(state => !covered.has(state));
  assert.deepEqual(missing, [], `no frame exercises: ${missing.join(', ')} — a new rule needs a frame here`);
  const negatives = corpus.frames.filter(frame => frame.state === 'unknown');
  assert.ok(negatives.length >= 6, `only ${negatives.length} negative frame(s): the suite this replaces had none`);
  const sources = new Set(corpus.frames.map(frame => frame.source));
  for (const fixture of [
    'recorded-lobby.png',
    'recorded-table.png',
    'lobby.png',
    'table.png',
    'lucky.png',
    'connecting.png',
    'loading.png'
  ]) {
    assert.ok(sources.has(fixture), `${fixture} is a recorded fixture with no frame in the corpus`);
  }
});

test('every frame classifies as the state it claims, through the pipeline', () => {
  for (const frame of corpus.frames) {
    const pipeline = pipelineFor(frame);
    assert.equal(pipeline.ok, true, `${frame.id}: ${pipeline.message}`);
    const grid = pipeline.read(frame.lines);
    const result = classify(pipeline.text(grid));
    assert.equal(
      result.state,
      frame.state,
      `${frame.id}: expected ${frame.state}, the rule engine said ${result.state} (${describeGrid(grid)}) from "${pipeline.text(grid)}"`
    );
  }
});

test('the corpus is self-describing about clipping', () => {
  for (const frame of corpus.frames) {
    const surface = surfaceOf(frame);
    const needs = frame.lines.some(line => overflows(line.box, surface));
    assert.equal(
      needs,
      frame.clipped === true,
      `${frame.id}: a box runs past the surface but the frame does not declare "clipped", or the reverse`
    );
  }
});

test('every box maps inside its frame, and the mapping round-trips', () => {
  for (const frame of corpus.frames) {
    const surface = surfaceOf(frame);
    for (const line of frame.lines) {
      granted(clampRect(line.box, surface));
      // The capture rect is in DIPs; converting back must return the box in page coordinates.
      const capture = granted(toCaptureRect(line.box, surface.zoom));
      const back = toPageRect(capture.rect, surface.zoom);
      assert.ok(Math.abs(back.x - line.box.x) <= 1, `${frame.id}: "${line.text}" x drifted to ${back.x}`);
      assert.ok(Math.abs(back.width - line.box.width) <= 1, `${frame.id}: "${line.text}" width drifted to ${back.width}`);
      assert.ok(capture.rect.width >= 1 && capture.rect.height >= 1, `${frame.id}: "${line.text}" produced a zero-sized rect`);
    }
  }
});

test('the bottom band matches the ratio the recogniser depends on', () => {
  for (const frame of corpus.frames) {
    const surface = surfaceOf(frame);
    const { bottomBand, full } = handles(surface);
    assert.deepEqual(full.rect, { left: 0, top: 0, width: surface.width, height: surface.height });
    assert.equal(bottomBand.rect.top, Math.floor(surface.height * BOTTOM_BAND));
    assert.equal(bottomBand.rect.height, surface.height - Math.floor(surface.height * BOTTOM_BAND));
    assert.equal(bottomBand.resize.width, surface.width * 2, 'the second pass doubles the width');
  }
});

test('low-confidence telemetry survives into the grid', () => {
  const misread = corpus.frames.find(frame => frame.id === 'lobby-hint-misread');
  const grid = pipelineFor(misread).read(misread.lines);
  const flagged = grid.telemetry.lowConfidence.map(item => item.text);
  assert.ok(flagged.includes('PLAVERS'), `expected PLAVERS to be flagged, got ${flagged.join(', ')}`);
  assert.ok(flagged.includes('PLAVERS ONLINE') || flagged.includes('PLAVERS'), 'the line and its word are both candidates');
  for (const item of grid.telemetry.lowConfidence) {
    assert.ok(item.confidence < LOW_CONFIDENCE, `${item.text} was flagged at confidence ${item.confidence}`);
  }

  const scaled = corpus.frames.find(frame => frame.id === 'scaled-window');
  const scaledGrid = pipelineFor(scaled).read(scaled.lines);
  assert.ok(
    scaledGrid.telemetry.lowConfidence.length >= 3,
    'the half-density frame must show the confidence collapse, or it is not recording what it claims'
  );
});

test('the measured limitation this corpus exists to justify', () => {
  // scaled-window is one misread gate term away from the lobby. The gate fails, so the result is unknown —
  // the classifier scores the match but never recovers from a single bad term. That is the finding the
  // roadmap's "loosen the gates, justified by the corpus" step has to answer, and it is pinned here so the
  // day classifier v2 changes it, this test says so out loud.
  const frame = corpus.frames.find(entry => entry.id === 'scaled-window');
  const grid = pipelineFor(frame).read(frame.lines);
  const text = pipelineFor(frame).text(grid);
  assert.equal(classify(text).state, 'unknown', 'a single misread gate term currently loses the whole screen');
  assert.ok(text.includes('SPECIAI'), 'the misread term is the one the recogniser actually returned');
  assert.equal(/special/.test(text), false, 'and it is not the word the gate needs');

  // The same wording with the one term read correctly is the lobby: the difference is recognition, not logic.
  const corrected = corpus.frames
    .find(entry => entry.id === 'lobby-recorded')
    .lines.map(line => line.text)
    .join(' ');
  assert.equal(classify(corrected).state, 'lobby');
});

test('the corpus states its own limitations', () => {
  const words = JSON.stringify(corpus).toLowerCase();
  for (const claim of ['not measurements', 'not hand-measured ground truth', 'does not measure ocr accuracy']) {
    assert.ok(words.includes(claim), `the corpus must keep the disclaimer phrase "${claim}"`);
  }
});
