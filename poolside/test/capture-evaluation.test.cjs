const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/capture-evaluation.cjs');

test('capture evaluation makes repeated labels and missing coverage visible', () => {
  const result = evaluate(
    [
      { expectedState: 'lobby', observedState: 'lobby', score: 0.73 },
      { expectedState: 'table-selection', observedState: 'table-selection', score: 0.63 },
      { expectedState: 'table-selection', observedState: 'unknown', score: 0 }
    ],
    ['lobby', 'table-selection', 'shop']
  );
  assert.deepEqual(
    {
      samples: result.samples,
      labelsWithEvidence: result.labelsWithEvidence,
      labelsAvailable: result.labelsAvailable,
      labelsReady: result.labelsReady,
      minimumEvidencePerLabel: result.minimumEvidencePerLabel,
      samplesNeeded: result.samplesNeeded,
      disagreements: result.disagreements,
      reviewNeeded: result.reviewNeeded
    },
    {
      samples: 3,
      labelsWithEvidence: 2,
      labelsAvailable: 3,
      labelsReady: 0,
      minimumEvidencePerLabel: 3,
      samplesNeeded: 6,
      disagreements: 1,
      reviewNeeded: 1
    }
  );
  assert.equal(result.agreement, 2 / 3);
  assert.equal(result.unknown, 1 / 3);
  assert.deepEqual(result.labels[1], {
    expectedState: 'table-selection',
    count: 2,
    samplesNeeded: 1,
    evidenceStatus: 'limited',
    matches: 1,
    disagreements: 1,
    reviewNeeded: 1,
    unknown: 1,
    agreement: 0.5,
    meanScore: 0.315
  });
  assert.equal(result.labels[2].count, 0);
  assert.equal(result.labels[2].evidenceStatus, 'missing');
  assert.equal(result.labels[2].agreement, null);
});

test('capture evaluation marks a label ready only after enough separate samples', () => {
  const result = evaluate(
    [
      { expectedState: 'shop', observedState: 'shop', score: 0.8 },
      { expectedState: 'shop', observedState: 'shop', score: 0.81 },
      { expectedState: 'shop', observedState: 'unknown', score: 0 }
    ],
    ['shop']
  );
  assert.equal(result.labelsReady, 1);
  assert.equal(result.samplesNeeded, 0);
  assert.equal(result.disagreements, 1);
  assert.equal(result.labels[0].evidenceStatus, 'ready');
});

test('benchmark captures are measured separately and do not fill evidence coverage', () => {
  const result = evaluate(
    [
      { expectedState: 'shop', observedState: 'shop', score: 0.8, cohort: 'benchmark' },
      { expectedState: 'shop', observedState: 'unknown', score: 0, cohort: 'benchmark' },
      { expectedState: 'shop', observedState: 'shop', score: 0.8 }
    ],
    ['shop']
  );
  assert.equal(result.evidenceSamples, 1);
  assert.equal(result.labels[0].count, 1);
  assert.equal(result.benchmark.samples, 2);
  assert.equal(result.benchmark.agreement, 0.5);
  assert.equal(result.benchmark.disagreements, 1);
});

test('benchmark report calculates per-label precision, recall, and F1 without claiming missing data is zero', () => {
  const result = evaluate(
    [
      { expectedState: 'shop', observedState: 'shop', cohort: 'benchmark' },
      { expectedState: 'shop', observedState: 'lobby', cohort: 'benchmark' },
      { expectedState: 'lobby', observedState: 'shop', cohort: 'benchmark' },
      { expectedState: 'lobby', observedState: 'unknown', cohort: 'benchmark' }
    ],
    ['shop', 'lobby', 'loading']
  );
  const [shop, lobby, loading] = result.benchmark.labels;
  assert.deepEqual({ precision: shop.precision, recall: shop.recall, f1: shop.f1 }, { precision: 0.5, recall: 0.5, f1: 0.5 });
  assert.deepEqual({ precision: lobby.precision, recall: lobby.recall, f1: lobby.f1 }, { precision: 0, recall: 0, f1: 0 });
  assert.equal(loading.precision, null);
  assert.equal(loading.recall, null);
  assert.equal(result.benchmark.unknown, 0.25);
  assert.equal(result.benchmark.macroPrecision, 0.25);
  assert.equal(result.benchmark.macroRecall, 0.25);
  assert.equal(result.benchmark.macroF1, 0.25);
});

test('capture evaluation reports local timing medians and p95 only from valid measured samples', () => {
  const result = evaluate(
    [
      { expectedState: 'shop', observedState: 'shop', timing: { surfaceMs: 10, recognitionMs: 100, totalMs: 115 } },
      { expectedState: 'shop', observedState: 'shop', timing: { surfaceMs: 30, recognitionMs: 300, totalMs: 335 } },
      { expectedState: 'shop', observedState: 'shop', timing: { surfaceMs: 20, recognitionMs: 200, totalMs: 225 } },
      { expectedState: 'shop', observedState: 'shop', timing: { surfaceMs: -1, recognitionMs: 'slow' } }
    ],
    ['shop']
  );
  assert.deepEqual(result.timing.surface, { samples: 3, meanMs: 20, medianMs: 20, p95Ms: 30 });
  assert.deepEqual(result.timing.recognition, { samples: 3, meanMs: 200, medianMs: 200, p95Ms: 300 });
  assert.deepEqual(result.timing.total, { samples: 3, meanMs: 225, medianMs: 225, p95Ms: 335 });
});

test('review-needed excludes an OCR disagreement once the user has reviewed it', () => {
  const result = evaluate(
    [
      { expectedState: 'shop', observedState: 'unknown', reviewedAt: '2026-09-20T12:00:00.000Z' },
      { expectedState: 'shop', observedState: 'unknown' }
    ],
    ['shop']
  );
  assert.equal(result.disagreements, 2, 'the accuracy record keeps both OCR disagreements');
  assert.equal(result.reviewNeeded, 1, 'the review queue contains only the unresolved item');
  assert.equal(result.labels[0].reviewNeeded, 1);
});
