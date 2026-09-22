const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/capture-evaluation.cjs');

test('capture evaluation makes repeated labels and missing coverage visible', () => {
  const result = evaluate(
    [
      { expectedState: 'lobby', observedState: 'lobby', score: 0.73 },
      {
        expectedState: 'table-selection',
        expectedTable: 'Berlin',
        observedState: 'table-selection',
        observedTables: ['Berlin'],
        score: 0.63
      },
      { expectedState: 'table-selection', expectedTable: 'Rome', observedState: 'unrecognized', observedTables: [], score: 0 }
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
  assert.equal(result.unrecognized, 1 / 3);
  assert.deepEqual(result.labels[1], {
    expectedState: 'table-selection',
    count: 2,
    samplesNeeded: 1,
    evidenceStatus: 'limited',
    matches: 1,
    disagreements: 1,
    reviewNeeded: 1,
    unrecognized: 1,
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
      { expectedState: 'shop', observedState: 'unrecognized', score: 0 }
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
      { expectedState: 'shop', observedState: 'unrecognized', score: 0, cohort: 'benchmark' },
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
      { expectedState: 'lobby', observedState: 'unrecognized', cohort: 'benchmark' }
    ],
    ['shop', 'lobby', 'loading']
  );
  const [shop, lobby, loading] = result.benchmark.labels;
  assert.deepEqual({ precision: shop.precision, recall: shop.recall, f1: shop.f1 }, { precision: 0.5, recall: 0.5, f1: 0.5 });
  assert.deepEqual({ precision: lobby.precision, recall: lobby.recall, f1: lobby.f1 }, { precision: 0, recall: 0, f1: 0 });
  assert.equal(loading.precision, null);
  assert.equal(loading.recall, null);
  assert.equal(result.benchmark.unrecognized, 0.25);
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
      { expectedState: 'shop', observedState: 'unrecognized', reviewedAt: '2026-09-20T12:00:00.000Z' },
      { expectedState: 'shop', observedState: 'unrecognized' }
    ],
    ['shop']
  );
  assert.equal(result.disagreements, 2, 'the accuracy record keeps both OCR disagreements');
  assert.equal(result.reviewNeeded, 1, 'the review queue contains only the unresolved item');
  assert.equal(result.labels[0].reviewNeeded, 1);
});

test('a table-selection sample matches only when the intended table was visible', () => {
  const result = evaluate(
    [
      {
        expectedState: 'table-selection',
        expectedTable: 'Berlin',
        observedState: 'table-selection',
        observedTables: ['Rome', 'Berlin']
      },
      {
        expectedState: 'table-selection',
        expectedTable: 'London',
        observedState: 'table-selection',
        observedTables: ['Sydney']
      }
    ],
    ['table-selection']
  );
  assert.equal(result.agreement, 0.5);
  assert.equal(result.reviewNeeded, 1);
});

test('table targets are reported separately instead of being collapsed into one screen-label row', () => {
  const result = evaluate(
    [
      {
        expectedState: 'table-selection',
        expectedTable: 'London',
        observedState: 'table-selection',
        observedTables: ['London']
      },
      {
        expectedState: 'table-selection',
        expectedTable: 'London',
        observedState: 'table-selection',
        observedTables: []
      },
      {
        cohort: 'benchmark',
        expectedState: 'table-selection',
        expectedTable: 'Dubai',
        observedState: 'table-selection',
        observedTables: ['Dubai']
      }
    ],
    ['table-selection'],
    ['London', 'Dubai']
  );
  assert.deepEqual(result.evidenceMetrics.tables[0], {
    table: 'London',
    count: 2,
    matches: 1,
    misses: 1,
    reviewNeeded: 1,
    accuracy: 0.5
  });
  assert.equal(result.evidenceMetrics.tables[1].count, 0);
  assert.equal(result.benchmark.tables[1].matches, 1);
});

test('the lab reports where a recognition pass spends its time, stage by stage', () => {
  const sample = (offset, firstOcrMs, contrastOcrMs) => ({
    id: `s${offset}`,
    expectedState: 'lobby',
    observedState: 'lobby',
    score: 1,
    cohort: 'evidence',
    capturedAt: new Date(Date.parse('2026-09-22T00:00:00.000Z') + offset).toISOString(),
    timing: {
      surfaceMs: 10,
      recognitionMs: firstOcrMs + contrastOcrMs,
      totalMs: 10 + firstOcrMs + contrastOcrMs,
      stages: { firstOcrMs, contrastOcrMs }
    }
  });
  const evaluated = evaluate([sample(0, 100, 50), sample(1, 200, 60), sample(2, 300, 70)], ['lobby']);
  assert.deepEqual(evaluated.timing.stages.firstOcrMs, { samples: 3, meanMs: 200, medianMs: 200, p95Ms: 300 });
  assert.deepEqual(evaluated.timing.stages.contrastOcrMs, { samples: 3, meanMs: 60, medianMs: 60, p95Ms: 70 });
  // A stage no sample reported is present with no samples rather than missing, so a card cannot read it as zero.
  assert.deepEqual(evaluated.timing.stages.bottomPrepMs, { samples: 0, meanMs: null, medianMs: null, p95Ms: null });
});
