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

test('capture lab rejects duplicate content under the same expected label', () => {
  const { lab } = fixture();
  const first = { png: Buffer.from('same image'), expectedState: 'lobby', observed: {}, frame: {} };
  lab.record(first);
  assert.throws(() => lab.record(first), /already been recorded/);
  assert.doesNotThrow(() => lab.record({ ...first, expectedState: 'shop' }));
});

test('capture lab rejects unknown labels and permanently removes a user-selected sample', () => {
  const { lab } = fixture();
  assert.throws(
    () => lab.record({ png: Buffer.from('x'), expectedState: 'secret', observed: {}, frame: {} }),
    /supported expected screen state/
  );
  const sample = lab.record({ png: Buffer.from('x'), expectedState: 'unknown', observed: {}, frame: {} });
  lab.remove(sample.id);
  assert.deepEqual(lab.list(), []);
  assert.throws(() => lab.image(sample.id), /no longer available/);
  assert.equal(SAMPLE_STATES.includes('table-selection'), true);
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
    'height',
    'id',
    'imageHash',
    'observedState',
    'score',
    'source',
    'width'
  ]);
  assert.equal(saved.source, 'unknown');
  assert.equal(rewritten.includes('Master'), false);
  assert.equal(rewritten.includes('pageText'), false);
  assert.equal(rewritten.includes('abcdefghijklmnopqrstuvwxyz'), false);
});

test('capture review is an explicit local decision that survives a manifest round trip', () => {
  const { lab } = fixture();
  const sample = lab.record({
    png: Buffer.from('reviewed-sample'),
    expectedState: 'lobby',
    observed: { state: 'unknown', score: 0, source: 'full-frame' },
    frame: { width: 1200, height: 675 }
  });
  lab.markReviewed(sample.id);
  const stored = lab.list().find(entry => entry.id === sample.id);
  assert.match(stored.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});
