// The capture pipeline's rules, as arithmetic.
//
// Every test here is a number in and a rectangle out. That is the point of separating the pipeline from the
// window: a coordinate rule asserted through a running Electron app is a rule nobody can check in a review,
// and every failure mode in this area is silent — a crop that is one pixel late loses a term, and a term lost
// at an edge is an `unknown` that looks like a recognition failure.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toCaptureRect, toPageRect, clampRect, checkCapture, describeFrame } = require('../src/vision-frame.cjs');
const { createVisionPipeline, handles, BOTTOM_BAND, BAND_MAGNIFY } = require('../src/vision-pipeline.cjs');
const { parseTextGrid, gridText, describeGrid, overlapRatio, cleanText, LOW_CONFIDENCE } = require('../src/vision-grid.cjs');

const REGION = { x: 100, y: 50, width: 800, height: 450 };

// The coordinate functions return a discriminated union, and property access on an unnarrowed union is a type
// error. These two helpers assert the outcome and hand back the value, so each test states its expectation
// once instead of restating it for the type checker.
/** @param {any} result @returns {any} */
const granted = result => {
  assert.equal(result.ok, true, result.message || `expected a usable result, got ${result.reason}`);
  assert.equal(result.reason, undefined, 'a granted result carries no refusal reason');
  return result;
};
/** @param {any} result @returns {any} */
const refused = result => {
  assert.equal(result.ok, false, 'expected a refusal');
  assert.ok(result.reason && result.message, 'a refusal states a machine-readable reason and a message');
  return result;
};

test('a region converts to a capture rect, refusing rather than guessing', () => {
  assert.deepEqual(granted(toCaptureRect(REGION, 1)).rect, { x: 100, y: 50, width: 800, height: 450 });
  // Zoom scales the region: at 125 % zoom the captured rect is larger than the page's own pixels.
  assert.deepEqual(granted(toCaptureRect(REGION, 1.25)).rect, { x: 125, y: 62, width: 1000, height: 563 });
  assert.deepEqual(granted(toCaptureRect({ x: 10.7, y: 20.2, width: 300.4, height: 200.6 }, 1)).rect, {
    x: 10,
    y: 20,
    width: 300,
    height: 201
  });

  assert.equal(refused(toCaptureRect(/** @type {any} */ (null), 1)).reason, 'no-region');
  assert.equal(refused(toCaptureRect(/** @type {any} */ ({ x: 0, y: 0, width: 10 }), 1)).reason, 'malformed-region');
  assert.equal(refused(toCaptureRect({ x: 0, y: 0, width: 0, height: 10 }, 1)).reason, 'empty-region');
  assert.equal(refused(toCaptureRect(REGION, 0)).reason, 'bad-zoom');
  assert.equal(refused(toCaptureRect(REGION, Number.NaN)).reason, 'bad-zoom');
  assert.match(refused(toCaptureRect(REGION, 0)).message, /zoom factor/);
});

test('the origin is floored and an extent never rounds away to nothing', () => {
  // Flooring the origin means the crop starts at or before the region: late starts lose text at an edge.
  assert.equal(granted(toCaptureRect({ x: 99.9, y: 49.9, width: 10, height: 10 }, 1)).rect.x, 99);
  // A sub-pixel region still produces a one-pixel crop, because sharp refuses a zero-sized extract.
  assert.deepEqual(granted(toCaptureRect({ x: 10, y: 10, width: 0.2, height: 0.2 }, 1)).rect, { x: 10, y: 10, width: 1, height: 1 });
});

test('converting back returns page coordinates', () => {
  const back = toPageRect(granted(toCaptureRect(REGION, 1.25)).rect, 1.25);
  assert.ok(Math.abs(back.x - REGION.x) <= 1);
  assert.ok(Math.abs(back.y - REGION.y) <= 1);
  assert.ok(Math.abs(back.width - REGION.width) <= 2);
  assert.ok(Math.abs(back.height - REGION.height) <= 2);
});

test('clipping a rectangle to its bounds reports, and refuses only when nothing is left', () => {
  const bounds = { width: 1200, height: 675 };
  const inside = granted(clampRect({ x: 100, y: 100, width: 200, height: 100 }, bounds));
  assert.equal(inside.clipped, false);
  assert.deepEqual(inside.rect, { x: 100, y: 100, width: 200, height: 100 });

  const hanging = granted(clampRect({ x: 1140, y: 24, width: 120, height: 26 }, bounds));
  assert.equal(hanging.clipped, true);
  assert.deepEqual(hanging.rect, { x: 1140, y: 24, width: 60, height: 26 });

  const off = refused(clampRect({ x: 1300, y: 700, width: 100, height: 50 }, bounds));
  assert.equal(off.reason, 'outside-frame');
  assert.match(off.message, /entirely outside/);

  assert.equal(refused(clampRect({ x: 0, y: 0, width: 10, height: 10 }, /** @type {any} */ ({ width: 0, height: 0 }))).reason, 'no-bounds');
});

test('the achieved capture density is reported, not assumed', () => {
  const exact = granted(checkCapture({ pageRect: REGION, zoom: 1, imageWidth: 800, imageHeight: 450, deviceScaleFactor: 1 }));
  assert.equal(exact.frame.matched, true);
  assert.equal(exact.frame.scale, 1);
  assert.deepEqual(exact.notes, []);

  // A 125 % display: the image is larger than the page's own pixels, and that is expected once declared.
  const hiDpi = granted(checkCapture({ pageRect: REGION, zoom: 1, imageWidth: 1000, imageHeight: 563, deviceScaleFactor: 1.25 }));
  assert.equal(hiDpi.frame.matched, true, 'a declared display scale factor is not a mismatch');

  // The same image without the display factor being declared is a mismatch worth reporting.
  const undeclared = granted(checkCapture({ pageRect: REGION, zoom: 1, imageWidth: 1000, imageHeight: 563, deviceScaleFactor: 1 }));
  assert.equal(undeclared.frame.matched, false);
  assert.equal(undeclared.notes.length, 1);
  assert.match(undeclared.notes[0], /1\.250x the page where 1\.000x was expected/);

  const downsampled = granted(checkCapture({ pageRect: REGION, zoom: 1, imageWidth: 400, imageHeight: 225, deviceScaleFactor: 1 }));
  assert.ok(
    downsampled.notes.some(note => /below the page's own scale/.test(note)),
    'losing text to downsampling is reported'
  );

  assert.equal(refused(checkCapture({ pageRect: REGION, zoom: 1, imageWidth: 0, imageHeight: 0 })).reason, 'empty-image');
  assert.equal(
    refused(checkCapture({ pageRect: { x: 0, y: 0, width: 0, height: 10 }, zoom: 1, imageWidth: 10, imageHeight: 10 })).reason,
    'no-region'
  );
});

test('a frame describes itself in one line', () => {
  const { frame } = granted(checkCapture({ pageRect: REGION, zoom: 1, imageWidth: 800, imageHeight: 450, deviceScaleFactor: 1 }));
  const described = describeFrame(frame);
  assert.match(described, /800×450 px at 1\.000x the page/);
  assert.match(described, /800×450 region at zoom 1/);
  assert.equal(describeFrame(null), 'no capture frame');
});

test('the pipeline has a stage before the image exists and a stage after it', () => {
  const requested = granted(createVisionPipeline({ pageRect: REGION, zoom: 1 }));
  assert.equal(requested.stage, 'request');
  assert.deepEqual(requested.requested, { x: 100, y: 50, width: 800, height: 450 });
  assert.equal(requested.frame, null, 'no image has been taken, so there is no frame to describe');
  assert.equal(requested.read, undefined, 'and nothing to parse lines against');

  const captured = granted(createVisionPipeline({ pageRect: REGION, zoom: 1, imageWidth: 800, imageHeight: 450, deviceScaleFactor: 1 }));
  assert.equal(captured.stage, 'capture');
  assert.equal(captured.frame.matched, true);
  assert.equal(typeof captured.read, 'function');
  assert.match(captured.describe(), /800×450 px/);
});

test('a pipeline refuses the same inputs the frame rules refuse', () => {
  const bad = refused(createVisionPipeline({ pageRect: { x: 0, y: 0, width: 0, height: 0 }, zoom: 1, imageWidth: 10, imageHeight: 10 }));
  assert.equal(bad.stage, 'request');
  assert.equal(bad.reason, 'empty-region');

  const empty = refused(createVisionPipeline({ pageRect: REGION, zoom: 1, imageWidth: 0, imageHeight: 0 }));
  assert.equal(empty.stage, 'capture');
  assert.equal(empty.reason, 'empty-image');
  assert.deepEqual(empty.requested, { x: 100, y: 50, width: 800, height: 450 }, 'the rect it asked for is still reported, for the log');
});

test('handles derive the crops from the image, including the ratio the recogniser depends on', () => {
  const { full, bottomBand } = handles({ width: 1200, height: 675 });
  assert.deepEqual(full, { name: 'full', rect: { left: 0, top: 0, width: 1200, height: 675 }, resize: null });
  assert.equal(bottomBand.rect.top, Math.floor(675 * BOTTOM_BAND));
  assert.equal(bottomBand.rect.height, 675 - Math.floor(675 * BOTTOM_BAND));
  assert.deepEqual(bottomBand.resize, { width: 1200 * BAND_MAGNIFY });

  // A short image must still produce a usable band rather than a negative or zero height.
  assert.equal(handles({ width: 100, height: 1 }).bottomBand.rect.height, 1);
  assert.equal(handles({ width: 100, height: 4 }).bottomBand.rect.height, 1);
  assert.equal(handles({ width: 100, height: 5 }).bottomBand.rect.top, 4);
  // Overriding the ratio is allowed, and named so a caller cannot do it by accident.
  assert.equal(handles({ width: 100, height: 100 }, { band: 0.5 }).bottomBand.rect.top, 50);
});

test('lines become positioned cells, in reading order', () => {
  const bounds = { width: 1200, height: 675 };
  const grid = parseTextGrid(
    [
      { text: 'SECOND ROW', box: { x: 40, y: 300, width: 200, height: 30 }, confidence: 90 },
      { text: 'FIRST ROW', box: { x: 40, y: 100, width: 200, height: 30 }, confidence: 91 },
      { text: 'RIGHT CELL', box: { x: 400, y: 104, width: 180, height: 28 }, confidence: 88 },
      { text: '   ', box: { x: 40, y: 500, width: 10, height: 10 } },
      { text: 'OFF FRAME', box: { x: 2000, y: 2000, width: 100, height: 30 }, confidence: 80 }
    ],
    bounds
  );
  assert.deepEqual(
    grid.cells.map(cell => cell.text),
    ['FIRST ROW', 'RIGHT CELL', 'SECOND ROW'],
    'sorted top to bottom, then left to right'
  );
  assert.deepEqual(
    grid.rows.map(row => row.text),
    ['FIRST ROW RIGHT CELL', 'SECOND ROW'],
    'cells on one visual row group together'
  );
  assert.deepEqual(grid.dropped.map(item => item.reason).sort(), ['empty-text', 'outside-frame']);
  assert.equal(gridText(grid), 'FIRST ROW RIGHT CELL\nSECOND ROW');
});

test('a cell hanging past the edge is clipped and flagged', () => {
  const grid = parseTextGrid([{ text: 'Sign in', box: { x: 1140, y: 24, width: 120, height: 26 }, confidence: 89 }], {
    width: 1200,
    height: 675
  });
  assert.equal(grid.cells[0].clipped, true);
  assert.equal(grid.cells[0].box.width, 60, 'the cell keeps what was actually captured');
  assert.equal(grid.telemetry.clipped, 1);
});

test('telemetry counts what the recogniser reported', () => {
  const bounds = { width: 1200, height: 675 };
  const grid = parseTextGrid(
    [
      {
        text: 'PLAVERS ONLINE',
        box: { x: 10, y: 10, width: 200, height: 26 },
        confidence: 48,
        words: [
          { text: 'PLAVERS', confidence: 44 },
          { text: 'ONLINE', confidence: 91 }
        ]
      },
      { text: 'ENTRY FEE 100', box: { x: 10, y: 100, width: 200, height: 26 }, confidence: 90 },
      { text: 'NO CONFIDENCE', box: { x: 10, y: 200, width: 200, height: 26 } }
    ],
    bounds
  );
  assert.equal(grid.telemetry.cells, 3);
  assert.equal(grid.telemetry.rows, 3);
  assert.equal(grid.telemetry.words, 7, 'two words from the given list, five split from the other two lines');
  assert.equal(grid.telemetry.meanConfidence, 69, 'the cell without a confidence is not counted as a zero');
  assert.deepEqual(
    grid.telemetry.lowConfidence.map(item => item.text),
    ['PLAVERS ONLINE', 'PLAVERS'],
    'the line and its individual word are both reported'
  );
  for (const item of grid.telemetry.lowConfidence) assert.ok(item.confidence < LOW_CONFIDENCE);
  assert.match(describeGrid(grid), /3 cell\(s\) in 3 row\(s\), mean confidence 69, 2 low-confidence token\(s\)/);
});

test('row grouping is a stated ratio, not a coincidence of equal tops', () => {
  // The row's band is 100–130 and the box is 104–132, so the overlap is 26 of the shorter span's 28.
  assert.equal(overlapRatio({ top: 100, bottom: 130 }, { y: 104, height: 28 }), 26 / 28);
  assert.equal(overlapRatio({ top: 100, bottom: 130 }, { y: 130, height: 20 }), 0, 'touching is not overlapping');
  assert.equal(overlapRatio({ top: 100, bottom: 100 }, { y: 100, height: 0 }), 0, 'a zero-height band cannot divide by zero');
  // Just under half overlap stays a separate row; exactly half joins.
  const bounds = { width: 1200, height: 675 };
  const separate = parseTextGrid(
    [
      { text: 'A', box: { x: 0, y: 100, width: 10, height: 20 } },
      { text: 'B', box: { x: 20, y: 114, width: 10, height: 20 } }
    ],
    bounds
  );
  assert.equal(separate.rows.length, 2);
  const joined = parseTextGrid(
    [
      { text: 'A', box: { x: 0, y: 100, width: 10, height: 20 } },
      { text: 'B', box: { x: 20, y: 110, width: 10, height: 20 } }
    ],
    bounds
  );
  assert.equal(joined.rows.length, 1);
});

test('text is normalised the way the classifier expects to read it', () => {
  assert.equal(cleanText('  LOADING\n  SCREEN '), 'LOADING SCREEN');
  assert.equal(cleanText('ENTRY\tFEE'), 'ENTRY FEE');
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(undefined), '');
});

test('an empty grid is a valid grid', () => {
  const grid = parseTextGrid([], { width: 1200, height: 675 });
  assert.deepEqual(grid.cells, []);
  assert.deepEqual(grid.rows, []);
  assert.equal(gridText(grid), '');
  assert.equal(grid.telemetry.meanConfidence, null, 'no cells means no mean, not zero');
  assert.match(describeGrid(grid), /0 cell\(s\) in 0 row\(s\)/);
});

test('the grid survives whatever the recogniser hands it', () => {
  const bounds = { width: 100, height: 100 };
  const junk = [undefined, null, 'text', 5, [], [null], [{}], [{ text: 'x' }], [{ text: 'y', box: null }], [{ text: 'z', box: { x: 1 } }]];
  for (const value of junk) {
    assert.doesNotThrow(() => parseTextGrid(/** @type {any} */ (value), bounds));
  }
  assert.doesNotThrow(() => parseTextGrid([], /** @type {any} */ (null)));
  assert.doesNotThrow(() => describeGrid(/** @type {any} */ (null)));
});
