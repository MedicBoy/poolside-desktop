const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  selectEvidence,
  percentile,
  sameReadings,
  summary,
  stageSummary,
  panelRect
} = require('../scripts/replay-recognition-evidence.cjs');

/** @param {string} expectedState @param {string|null} [expectedTable] @param {string} [cohort] */
function sample(expectedState, expectedTable = null, cohort = 'evidence') {
  return { expectedState, expectedTable, cohort, imageAvailable: true, reviewedAt: '2026-09-21', matches: false };
}

test('Evidence replay chooses a bounded cross-section without ever selecting held-out Benchmark images', () => {
  const samples = [
    sample('loading'),
    sample('loading'),
    sample('loading'),
    sample('loading', null, 'benchmark'),
    sample('connecting'),
    sample('table-selection', 'Bangkok'),
    sample('table-selection', 'Bangkok'),
    sample('table-selection', 'Dubai'),
    sample('table-selection', 'Dubai', 'benchmark'),
    { ...sample('shop'), imageAvailable: false },
    { ...sample('lobby'), reviewedAt: null, matches: false }
  ];
  const selected = selectEvidence(samples, { perLabel: 2, perTable: 1 });
  assert.equal(selected.length, 5);
  assert.equal(selected.filter(item => item.expectedState === 'loading').length, 2);
  assert.deepEqual(
    selected.filter(item => item.expectedState === 'table-selection').map(item => item.expectedTable),
    ['Bangkok', 'Dubai']
  );
  assert.equal(selectEvidence(samples, { all: true }).length, 7);
  assert.equal(selectEvidence(samples, { all: true, only: ['table-selection'] }).length, 3);
  assert.ok(selected.every(item => item.cohort === 'evidence'));
});

test('Evidence replay reports measured percentiles and counts without treating timing as a label', () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([3, 1, 2], 0.5), 2);
  assert.deepEqual(
    summary([
      { expectedState: 'loading', firstState: 'loading', finalState: 'loading', firstMs: 10, finalMs: 20 },
      { expectedState: 'loading', firstState: 'unrecognized', finalState: 'loading', firstMs: 30, finalMs: 50 }
    ]),
    { count: 2, firstCorrect: 1, finalCorrect: 2, firstP50Ms: 10, firstP95Ms: 30, finalP50Ms: 20, finalP95Ms: 50 }
  );
});

test('experimental central-card crop stays inside a capture and retains its middle text band', () => {
  assert.deepEqual(panelRect(1200, 800), { left: 324, top: 312, width: 552, height: 296 });
  assert.deepEqual(panelRect(1200, 800, true), { left: 216, top: 224, width: 768, height: 400 });
});

test('reading comparison notices a changed value or missing account reading', () => {
  assert.equal(sameReadings({ coins: { value: 12, exact: true } }, { coins: { value: 12, exact: true } }), true);
  assert.equal(sameReadings({ coins: { value: 12, exact: true } }, { coins: { value: 13, exact: true } }), false);
  assert.equal(sameReadings({}, { cash: { value: 4, exact: true } }), false);
});

test('stage summary aggregates numeric durations without OCR content or unavailable measurements', () => {
  const result = stageSummary([{ stages: { firstOcrMs: 10, visualMatchMs: 0 } }, { stages: { firstOcrMs: 30, visualMatchMs: 12 } }]);
  assert.deepEqual(result.firstOcrMs, { used: 2, p50Ms: 10, p95Ms: 30, activeP95Ms: 30 });
  assert.deepEqual(result.visualMatchMs, { used: 1, p50Ms: 0, p95Ms: 12, activeP95Ms: 12 });
  assert.deepEqual(result.bottomOcrMs, { used: 0, p50Ms: null, p95Ms: null, activeP95Ms: null });
});
