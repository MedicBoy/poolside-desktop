const test = require('node:test');
const assert = require('node:assert/strict');
const { SAMPLE_STATES } = require('../src/capture-manifest.cjs');
const { TABLES } = require('../src/table-list.cjs');
const { validateCaptureCorpus, macroF1, DEFAULT_THRESHOLDS } = require('../src/capture-validation.cjs');

/** @returns {any[]} */
function benchmarkCorpus() {
  let index = 0;
  let nonTableIndex = 0;
  const nonTableStates = SAMPLE_STATES.length - 1;
  const remaining = 300 - TABLES.length * 3;
  const perState = Math.floor(remaining / nonTableStates);
  const extra = remaining % nonTableStates;
  /** @type {any[]} */
  const samples = [];
  for (const state of SAMPLE_STATES) {
    if (state === 'table-selection') {
      for (const table of TABLES)
        for (let sample = 0; sample < 3; sample++)
          samples.push({
            cohort: 'benchmark',
            expectedState: state,
            expectedTable: table,
            observedState: state,
            observedTables: [table],
            score: 0.9,
            imageHash: (index++).toString(16).padStart(64, '0'),
            timing: { surfaceMs: 20, recognitionMs: 240, totalMs: 275 }
          });
      continue;
    }
    const stateSamples = perState + (nonTableIndex++ < extra ? 1 : 0);
    for (let sample = 0; sample < stateSamples; sample++)
      samples.push({
        cohort: 'benchmark',
        expectedState: state,
        expectedTable: null,
        observedState: state,
        observedTables: [],
        score: 0.9,
        imageHash: (index++).toString(16).padStart(64, '0'),
        timing: { surfaceMs: 20, recognitionMs: 240, totalMs: 275 }
      });
  }
  return samples;
}

function namedGate(report, id) {
  return report.gates.find(item => item.id === id);
}

test('production corpus gate passes a balanced, unique, accurate, table-specific benchmark', () => {
  const report = validateCaptureCorpus(benchmarkCorpus(), SAMPLE_STATES);
  assert.equal(report.ready, true);
  assert.equal(report.benchmarkSamples, 300);
  assert.equal(report.top1Accuracy, 1);
  assert.equal(report.macroF1, 1);
  assert.equal(report.unrecognizedRate, 0);
  assert.equal(report.passedGates, report.totalGates);
});

test('local capture-plus-OCR p95 target is inclusive at 2000 ms and still rejects slower runs', () => {
  assert.equal(DEFAULT_THRESHOLDS.maximumTotalP95Ms, 2000);
  const samples = benchmarkCorpus();
  for (const sample of samples.slice(-16)) sample.timing.totalMs = 2000;
  const atTarget = validateCaptureCorpus(samples, SAMPLE_STATES);
  assert.equal(namedGate(atTarget, 'total-p95').actual, 2000);
  assert.equal(namedGate(atTarget, 'total-p95').pass, true);
  for (const sample of samples.slice(-16)) sample.timing.totalMs = 2001;
  const overTarget = validateCaptureCorpus(samples, SAMPLE_STATES);
  assert.equal(namedGate(overTarget, 'total-p95').pass, false);
});

test('production corpus gate excludes development evidence and requires the full benchmark', () => {
  const samples = benchmarkCorpus();
  samples[0].cohort = 'evidence';
  const report = validateCaptureCorpus(samples, SAMPLE_STATES);
  assert.equal(report.benchmarkSamples, 299);
  assert.equal(namedGate(report, 'benchmark-samples').pass, false);
  assert.equal(report.ready, false);
});

test('production corpus gate catches a missing intended table and unresolved review work', () => {
  const samples = benchmarkCorpus();
  const berlin = samples.find(sample => sample.expectedTable === 'Berlin');
  assert.ok(berlin);
  berlin.observedTables = ['Rome'];
  const report = validateCaptureCorpus(samples, SAMPLE_STATES);
  assert.equal(report.unresolvedDisagreements, 1);
  assert.equal(namedGate(report, 'top1-accuracy').pass, true);
  assert.equal(namedGate(report, 'review-queue').pass, false);
});

test('production corpus gate fails duplicate images, excess unrecognized results, and a slow p95', () => {
  const samples = benchmarkCorpus();
  samples[1].imageHash = samples[0].imageHash;
  for (const sample of samples.filter(sample => sample.expectedState === 'loading').slice(0, 16)) sample.observedState = 'unrecognized';
  for (const sample of samples.slice(-16)) sample.timing.totalMs = 2200;
  const report = validateCaptureCorpus(samples, SAMPLE_STATES);
  assert.equal(namedGate(report, 'unique-images').pass, false);
  assert.equal(namedGate(report, 'unrecognized-rate').pass, false);
  assert.equal(namedGate(report, 'total-p95').pass, false);
});

test('production corpus gate requires coverage of every supported table', () => {
  const samples = benchmarkCorpus().filter(sample => sample.expectedTable !== 'Shanghai');
  const report = validateCaptureCorpus(samples, SAMPLE_STATES, { minimumBenchmarkSamples: 250 });
  assert.equal(namedGate(report, 'table-coverage').pass, false);
  assert.match(namedGate(report, 'table-coverage').detail, /held-out benchmark samples/);
  assert.match(namedGate(report, 'table-coverage').detail, /Evidence captures are saved separately/);
  assert.equal(report.tableCounts.Shanghai, 0);
});

test('production corpus gate measures table-target recognition separately from screen recognition', () => {
  const samples = benchmarkCorpus();
  for (const sample of samples.filter(sample => sample.expectedTable === 'Berlin')) sample.observedTables = ['Rome'];
  const report = validateCaptureCorpus(samples, SAMPLE_STATES);
  assert.equal(namedGate(report, 'macro-f1').pass, true, 'the table-selection screen itself was recognized');
  assert.equal(namedGate(report, 'table-target-accuracy').pass, false, 'the intended table was not recognized reliably');
});

test('gate macro F1 treats a supported class with no predictions as zero', () => {
  assert.equal(
    macroF1(
      [
        { expectedState: 'loading', observedState: 'unrecognized' },
        { expectedState: 'lobby', observedState: 'lobby' }
      ],
      ['loading', 'lobby']
    ),
    0.5
  );
});
