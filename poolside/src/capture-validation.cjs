// The corpus gate: cohort counts, per-label precision and recall, and the release conditions over a frozen set.
const { cohort, durationSummary, records, sampleMatches } = require('./capture-evaluation.cjs');
const { TABLES } = require('./table-list.cjs');

const POSITIVE_STATES = ['loading', 'connecting', 'lucky-promotion', 'lucky-shot', 'lobby', 'table-selection', 'shop'];
const DEFAULT_THRESHOLDS = Object.freeze({
  minimumBenchmarkSamples: 300,
  minimumSamplesPerLabel: 20,
  minimumSamplesPerTable: 3,
  minimumTimingSamples: 30,
  minimumTop1Accuracy: 0.97,
  minimumTableTargetAccuracy: 0.97,
  minimumMacroF1: 0.9,
  maximumUnrecognizedRate: 0.05,
  maximumTotalP95Ms: 2000
});

function ratio(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'unavailable';
}

function macroF1(samples, states) {
  if (!samples.length || !states.length) return null;
  const values = states.map(state => {
    const truePositive = samples.filter(sample => sample.expectedState === state && sample.observedState === state).length;
    const falsePositive = samples.filter(sample => sample.expectedState !== state && sample.observedState === state).length;
    const falseNegative = samples.filter(sample => sample.expectedState === state && sample.observedState !== state).length;
    const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0;
    const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0;
    return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  });
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function duplicateHashes(samples) {
  const seen = new Set();
  let duplicates = 0;
  for (const sample of samples) {
    if (typeof sample.imageHash !== 'string' || seen.has(sample.imageHash)) duplicates += 1;
    else seen.add(sample.imageHash);
  }
  return duplicates;
}

function gate(id, label, pass, actual, target, detail) {
  return { id, label, pass, actual, target, detail };
}

/**
 * Apply the production corpus gate to the held-out benchmark set. Evidence samples are intentionally
 * excluded so examples used while tuning the recognizer cannot also prove its accuracy.
 */
function validateCaptureCorpus(samples, states, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options };
  const supported = Array.isArray(states) ? states.filter(state => typeof state === 'string') : [];
  const benchmark = records(samples).filter(sample => cohort(sample) === 'benchmark');
  const counts = Object.fromEntries(supported.map(state => [state, benchmark.filter(sample => sample.expectedState === state).length]));
  const matches = benchmark.filter(sampleMatches).length;
  const top1Accuracy = benchmark.length ? matches / benchmark.length : null;
  const measuredMacroF1 = macroF1(benchmark, supported);
  const tableSamples = benchmark.filter(sample => sample.expectedState === 'table-selection');
  const tableTargetAccuracy = tableSamples.length ? tableSamples.filter(sampleMatches).length / tableSamples.length : null;
  const unrecognized = benchmark.filter(sample => sample.observedState === 'unrecognized').length;
  const unrecognizedRate = benchmark.length ? unrecognized / benchmark.length : null;
  const unresolvedDisagreements = benchmark.filter(sample => !sampleMatches(sample) && !sample.reviewedAt).length;
  const duplicateBenchmarkImages = duplicateHashes(benchmark);
  const timings = durationSummary(benchmark);
  const labelsBelowMinimum = supported.filter(state => counts[state] < thresholds.minimumSamplesPerLabel);
  const tableCounts = Object.fromEntries(
    TABLES.map(table => [
      table,
      benchmark.filter(sample => sample.expectedState === 'table-selection' && sample.expectedTable === table).length
    ])
  );
  const tablesBelowMinimum = TABLES.filter(table => tableCounts[table] < thresholds.minimumSamplesPerTable);
  const gates = [
    gate(
      'benchmark-samples',
      'Held-out benchmark size',
      benchmark.length >= thresholds.minimumBenchmarkSamples,
      benchmark.length,
      thresholds.minimumBenchmarkSamples,
      `${benchmark.length} / ${thresholds.minimumBenchmarkSamples} samples`
    ),
    gate(
      'per-label-coverage',
      'Every label represented',
      labelsBelowMinimum.length === 0,
      supported.length - labelsBelowMinimum.length,
      supported.length,
      labelsBelowMinimum.length ? `Below ${thresholds.minimumSamplesPerLabel}: ${labelsBelowMinimum.join(', ')}` : 'All labels covered'
    ),
    gate(
      'table-coverage',
      'Every supported table represented',
      tablesBelowMinimum.length === 0,
      TABLES.length - tablesBelowMinimum.length,
      TABLES.length,
      tablesBelowMinimum.length
        ? `Below ${thresholds.minimumSamplesPerTable} held-out benchmark samples: ${tablesBelowMinimum.join(', ')}. Evidence captures are saved separately.`
        : 'All supported tables covered'
    ),
    gate(
      'top1-accuracy',
      'Top-1 accuracy',
      top1Accuracy !== null && top1Accuracy >= thresholds.minimumTop1Accuracy,
      top1Accuracy,
      thresholds.minimumTop1Accuracy,
      `${ratio(top1Accuracy)} / at least ${ratio(thresholds.minimumTop1Accuracy)}`
    ),
    gate(
      'macro-f1',
      'Macro F1',
      measuredMacroF1 !== null && measuredMacroF1 >= thresholds.minimumMacroF1,
      measuredMacroF1,
      thresholds.minimumMacroF1,
      `${ratio(measuredMacroF1)} / at least ${ratio(thresholds.minimumMacroF1)}`
    ),
    gate(
      'table-target-accuracy',
      'Table target accuracy',
      tableTargetAccuracy !== null && tableTargetAccuracy >= thresholds.minimumTableTargetAccuracy,
      tableTargetAccuracy,
      thresholds.minimumTableTargetAccuracy,
      `${ratio(tableTargetAccuracy)} / at least ${ratio(thresholds.minimumTableTargetAccuracy)}`
    ),
    gate(
      'unrecognized-rate',
      'Unrecognized result rate',
      unrecognizedRate !== null && unrecognizedRate <= thresholds.maximumUnrecognizedRate,
      unrecognizedRate,
      thresholds.maximumUnrecognizedRate,
      `${ratio(unrecognizedRate)} / at most ${ratio(thresholds.maximumUnrecognizedRate)}`
    ),
    gate(
      'unique-images',
      'Independent images',
      duplicateBenchmarkImages === 0,
      duplicateBenchmarkImages,
      0,
      `${duplicateBenchmarkImages} duplicate or missing image hashes`
    ),
    gate(
      'review-queue',
      'Benchmark review queue',
      unresolvedDisagreements === 0,
      unresolvedDisagreements,
      0,
      `${unresolvedDisagreements} unresolved disagreements`
    ),
    gate(
      'timing-samples',
      'Measured timing samples',
      timings.total.samples >= thresholds.minimumTimingSamples,
      timings.total.samples,
      thresholds.minimumTimingSamples,
      `${timings.total.samples} / ${thresholds.minimumTimingSamples} samples`
    ),
    gate(
      'total-p95',
      'Capture and OCR p95',
      timings.total.p95Ms !== null && timings.total.p95Ms <= thresholds.maximumTotalP95Ms,
      timings.total.p95Ms,
      thresholds.maximumTotalP95Ms,
      `${timings.total.p95Ms === null ? 'unavailable' : `${timings.total.p95Ms} ms`} / at most ${thresholds.maximumTotalP95Ms} ms`
    )
  ];
  return {
    version: 1,
    ready: gates.every(item => item.pass),
    passedGates: gates.filter(item => item.pass).length,
    totalGates: gates.length,
    thresholds,
    benchmarkSamples: benchmark.length,
    counts,
    tableCounts,
    top1Accuracy,
    macroF1: measuredMacroF1,
    tableTargetAccuracy,
    unrecognizedRate,
    unresolvedDisagreements,
    duplicateBenchmarkImages,
    timing: timings,
    gates
  };
}

module.exports = { validateCaptureCorpus, macroF1, POSITIVE_STATES, DEFAULT_THRESHOLDS };
