const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCaptureLab, SAMPLE_STATES } = require('../src/capture-lab.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-capture-lab-'));
  return { root, lab: createCaptureLab({ root }) };
}

test('capture lab keeps a private local manifest, image, and minimal recognition result', () => {
  const { root, lab } = fixture();
  const sample = lab.record({
    png: Buffer.from('png sample'),
    expectedState: 'lobby',
    observed: { state: 'lobby', score: 0.73, source: 'full-frame' },
    frame: { width: 1200, height: 675 }
  });
  const [listed] = lab.list();
  assert.equal(listed.id, sample.id);
  assert.equal(listed.expectedState, 'lobby');
  assert.equal(listed.observedState, 'lobby');
  assert.equal(listed.cohort, 'evidence');
  assert.equal(listed.imageAvailable, true);
  assert.equal(lab.image(sample.id).png, Buffer.from('png sample').toString('base64'));
  assert.ok(fs.existsSync(path.join(root, 'recognition-lab', 'manifest.json')));
});

test('capture lab preserves a user-selected benchmark set and can return it to evidence', () => {
  const { lab } = fixture();
  const sample = lab.record({
    png: Buffer.from('benchmark sample'),
    expectedState: 'shop',
    observed: { state: 'shop', score: 0.83 },
    frame: {},
    cohort: 'benchmark'
  });
  assert.equal(lab.list()[0].cohort, 'benchmark');
  assert.equal(lab.evaluation().benchmark.samples, 1);
  lab.setCohort(sample.id, 'evidence');
  assert.equal(lab.list()[0].cohort, 'evidence');
  assert.equal(lab.evaluation().benchmark.samples, 0);
  assert.throws(() => lab.setCohort(sample.id, 'unknown'), /supported capture set/);
});

test('capture lab rejects duplicate content across every label', () => {
  const { lab } = fixture();
  const first = { png: Buffer.from('same image'), expectedState: 'lobby', observed: {}, frame: {} };
  lab.record(first);
  assert.throws(() => lab.record(first), /already been recorded/);
  assert.throws(() => lab.record({ ...first, expectedState: 'shop' }), /already been recorded/);
});

test('capture lab rejects invented labels and permanently removes a user-selected sample', () => {
  const { lab } = fixture();
  assert.throws(
    () => lab.record({ png: Buffer.from('x'), expectedState: 'secret', observed: {}, frame: {} }),
    /supported expected screen state/
  );
  for (const label of ['blank', 'error', 'unknown'])
    assert.throws(
      () => lab.record({ png: Buffer.from(label), expectedState: label, observed: {}, frame: {} }),
      /supported expected screen state/
    );
  assert.equal(SAMPLE_STATES.includes('blank'), false);
  assert.equal(SAMPLE_STATES.includes('error'), false);
  assert.equal(SAMPLE_STATES.includes('unknown'), false);
  const sample = lab.record({ png: Buffer.from('removable'), expectedState: 'lobby', observed: {}, frame: {} });
  lab.remove(sample.id);
  assert.deepEqual(lab.list(), []);
  assert.throws(() => lab.image(sample.id), /no longer available/);
  assert.equal(SAMPLE_STATES.includes('table-selection'), true);
});

test('table-selection captures require a real table label and retain the visible table names', () => {
  const { lab } = fixture();
  assert.throws(
    () => lab.record({ png: Buffer.from('table without target'), expectedState: 'table-selection', observed: {}, frame: {} }),
    /Choose the table/
  );
  const sample = lab.record({
    png: Buffer.from('berlin table'),
    expectedState: 'table-selection',
    expectedTable: 'Berlin',
    observed: { state: 'table-selection', visibleTables: ['Rome', 'Berlin', 'Atlantis'] },
    frame: {}
  });
  const stored = lab.list().find(entry => entry.id === sample.id);
  assert.equal(stored.expectedTable, 'Berlin');
  assert.deepEqual(stored.observedTables, ['Rome', 'Berlin']);
  assert.equal(stored.matches, true);
  assert.ok(lab.tables.includes('Berlin'));
  const lobby = lab.record({
    png: Buffer.from('lobby with an irrelevant table input'),
    expectedState: 'lobby',
    expectedTable: 'Berlin',
    observed: { state: 'lobby' },
    frame: {}
  });
  assert.equal(lab.list().find(entry => entry.id === lobby.id).expectedTable, null);
  assert.deepEqual(
    lab.tableReferences().map(reference => reference.table),
    ['Berlin']
  );
});

test('only reviewed or detector-confirmed Evidence table images can teach the local visual matcher', () => {
  const { lab } = fixture();
  const input = {
    expectedState: 'table-selection',
    expectedTable: 'Cairo',
    observed: { state: 'table-selection', visibleTables: [] },
    frame: {}
  };
  const pending = lab.record({ ...input, png: Buffer.from('pending') });
  const reviewed = lab.record({ ...input, png: Buffer.from('reviewed') });
  const heldOut = lab.record({ ...input, png: Buffer.from('held out'), cohort: 'benchmark' });
  assert.deepEqual(lab.tableReferences(), []);
  lab.markReviewed(reviewed.id);
  assert.deepEqual(
    lab.tableReferences().map(reference => reference.id),
    [reviewed.id]
  );
  lab.markReviewed(heldOut.id);
  assert.deepEqual(
    lab.tableReferences().map(reference => reference.id),
    [reviewed.id],
    'held-out images never train the matcher'
  );
  lab.markReviewed(pending.id);
  assert.equal(lab.tableReferences().length, 2);
  lab.setCohort(pending.id, 'benchmark');
  assert.deepEqual(
    lab.tableReferences().map(reference => reference.id),
    [reviewed.id]
  );
});

test('capture lab keeps bounded local timing measurements without treating malformed values as data', () => {
  const { lab } = fixture();
  const sample = lab.record({
    png: Buffer.from('timed sample'),
    expectedState: 'shop',
    observed: { state: 'shop' },
    frame: {},
    timing: { surfaceMs: 24.6, recognitionMs: 148.4, totalMs: 180.1 }
  });
  assert.deepEqual(lab.list()[0].timing, { surfaceMs: 25, recognitionMs: 148, totalMs: 180 });
  assert.deepEqual(lab.image(sample.id).id, sample.id);
  lab.record({
    png: Buffer.from('untimed sample'),
    expectedState: 'lobby',
    observed: {},
    frame: {},
    timing: { surfaceMs: -1, recognitionMs: Infinity, totalMs: 300001 }
  });
  assert.equal(lab.list().find(entry => entry.expectedState === 'lobby').timing, null);
});

test('capture manifest allowlists only recognition metadata and removes injected browser or account fields on write', () => {
  const { root, lab } = fixture();
  const sample = lab.record({
    png: Buffer.from('private manifest fixture'),
    expectedState: 'lobby',
    observed: { state: 'lobby', score: 0.7, source: 'C:\\Users\\nicho\\secret-token' },
    frame: { width: 800, height: 450 }
  });
  const manifest = path.join(root, 'recognition-lab', 'manifest.json');
  const stored = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  stored.samples[0].accountName = 'Master';
  stored.samples[0].cookies = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
  stored.samples[0].pageText = 'This must never be retained.';
  fs.writeFileSync(manifest, JSON.stringify(stored));

  lab.setCohort(sample.id, 'benchmark');
  const rewritten = fs.readFileSync(manifest, 'utf8');
  const saved = JSON.parse(rewritten).samples[0];
  assert.deepEqual(Object.keys(saved).sort(), [
    'capturedAt',
    'cohort',
    'expectedState',
    'expectedTable',
    'height',
    'id',
    'imageHash',
    'observedState',
    'observedTables',
    'score',
    'source',
    'width'
  ]);
  assert.equal(saved.source, 'unavailable');
  assert.equal(rewritten.includes('Master'), false);
  assert.equal(rewritten.includes('pageText'), false);
  assert.equal(rewritten.includes('abcdefghijklmnopqrstuvwxyz'), false);
});

test('capture review is an explicit local decision that survives a manifest round trip', () => {
  const { lab } = fixture();
  const sample = lab.record({
    png: Buffer.from('reviewed-sample'),
    expectedState: 'lobby',
    observed: { state: 'unrecognized', score: 0, source: 'full-frame' },
    frame: { width: 1200, height: 675 }
  });
  lab.markReviewed(sample.id);
  const stored = lab.list().find(entry => entry.id === sample.id);
  assert.match(stored.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('the per-stage timings the reader measures are kept, and nothing else is', () => {
  const { timing } = require('../src/capture-manifest.cjs');
  const kept = /** @type {any} */ (
    timing({
      surfaceMs: 120,
      recognitionMs: 640,
      totalMs: 800,
      stages: {
        firstOcrMs: 400,
        visualMatchMs: 40,
        contrastPrepMs: 15,
        contrastOcrMs: 120,
        bottomPrepMs: 10,
        bottomOcrMs: 55,
        readingsMs: 6,
        somethingElse: 9999,
        negative: -5
      }
    })
  );
  assert.deepEqual(kept.stages, {
    firstOcrMs: 400,
    visualMatchMs: 40,
    contrastPrepMs: 15,
    contrastOcrMs: 120,
    bottomPrepMs: 10,
    bottomOcrMs: 55,
    readingsMs: 6
  });
  // A stage list on its own is still timing worth keeping, and a junk-only list is still nothing.
  assert.deepEqual(/** @type {any} */ (timing({ stages: { firstOcrMs: 5 } })).stages, { firstOcrMs: 5 });
  assert.equal(timing({ stages: { somethingElse: 5 } }), null);
  // And a recorded sample carries the breakdown through the lab, not just through the validator.
  const { lab, root } = fixture();
  const sample = lab.record({
    png: Buffer.from('x'),
    expectedState: 'lobby',
    observed: { state: 'lobby', score: 1, source: 'full-frame' },
    frame: { width: 100, height: 50 },
    timing: { surfaceMs: 10, recognitionMs: 20, totalMs: 30, stages: { firstOcrMs: 12, contrastOcrMs: 6 } }
  });
  assert.deepEqual(lab.list().find(entry => entry.id === sample.id).timing.stages, { firstOcrMs: 12, contrastOcrMs: 6 });
  fs.rmSync(root, { recursive: true, force: true });
});
