// A local evidence summary for Capture Lab. This is deliberately descriptive rather than an accuracy claim:
// agreement is only the detector's result against the label the user supplied, and repeated samples are counted
// visibly instead of being treated as independent proof.

const MINIMUM_EVIDENCE_PER_LABEL = 3;

/** @param {{cohort?: unknown}|null|undefined} sample */
function cohort(sample) {
  return sample && typeof sample === 'object' && sample.cohort === 'benchmark' ? 'benchmark' : 'evidence';
}

/** @param {{expectedState?: unknown, observedState?: unknown}[]} samples */
function summary(samples) {
  const matches = samples.filter(sample => sample.expectedState === sample.observedState).length;
  const unknown = samples.filter(sample => sample.observedState === 'unknown').length;
  return {
    samples: samples.length,
    agreement: samples.length ? matches / samples.length : null,
    disagreements: samples.length - matches,
    unknown: samples.length ? unknown / samples.length : null
  };
}

// This is a normal one-vs-rest measurement for the label chosen during capture.  It deliberately
// does not infer a "correct" label from recognition confidence: the user-approved label remains
// the reference, and an unavailable denominator stays null instead of becoming a misleading zero.
function labelMetrics(samples, expectedState) {
  const truePositive = samples.filter(sample => sample.expectedState === expectedState && sample.observedState === expectedState).length;
  const falsePositive = samples.filter(sample => sample.expectedState !== expectedState && sample.observedState === expectedState).length;
  const falseNegative = samples.filter(sample => sample.expectedState === expectedState && sample.observedState !== expectedState).length;
  const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null;
  const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null;
  return {
    truePositive,
    falsePositive,
    falseNegative,
    precision,
    recall,
    f1: precision === null || recall === null ? null : precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  };
}

function cohortMetrics(samples, states) {
  const labels = states.map(expectedState => ({ expectedState, ...labelMetrics(samples, expectedState) }));
  const measured = labels.filter(label => label.recall !== null && label.precision !== null);
  const average = key => (measured.length ? measured.reduce((total, label) => total + label[key], 0) / measured.length : null);
  return {
    ...summary(samples),
    measuredLabels: measured.length,
    macroPrecision: average('precision'),
    macroRecall: average('recall'),
    macroF1: average('f1'),
    labels
  };
}

function timingValues(samples, key) {
  return samples.map(sample => sample?.timing?.[key]).filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function durationSummary(samples) {
  const describe = key => {
    const values = timingValues(samples, key);
    return {
      samples: values.length,
      meanMs: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null,
      medianMs: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95)
    };
  };
  return { surface: describe('surfaceMs'), recognition: describe('recognitionMs'), total: describe('totalMs') };
}

/** @param {unknown} value */
function records(value) {
  return Array.isArray(value) ? value.filter(sample => sample && typeof sample === 'object') : [];
}

/** @param {unknown} value */
function score(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

/**
 * @param {unknown} samples
 * @param {unknown} states
 */
function evaluate(samples, states) {
  const list = records(samples);
  const evidence = list.filter(sample => cohort(sample) === 'evidence');
  const benchmark = list.filter(sample => cohort(sample) === 'benchmark');
  const supported = Array.isArray(states) ? states.filter(state => typeof state === 'string') : [];
  const labels = supported.map(expectedState => {
    const captured = evidence.filter(sample => sample.expectedState === expectedState);
    const matches = captured.filter(sample => sample.observedState === expectedState);
    const unknown = captured.filter(sample => sample.observedState === 'unknown');
    const disagreements = captured.length - matches.length;
    const reviewNeeded = captured.filter(sample => sample.expectedState !== sample.observedState && !sample.reviewedAt).length;
    const values = captured.map(sample => score(sample.score)).filter(value => value !== null);
    return {
      expectedState,
      count: captured.length,
      samplesNeeded: Math.max(0, MINIMUM_EVIDENCE_PER_LABEL - captured.length),
      evidenceStatus: captured.length === 0 ? 'missing' : captured.length < MINIMUM_EVIDENCE_PER_LABEL ? 'limited' : 'ready',
      matches: matches.length,
      disagreements,
      reviewNeeded,
      unknown: unknown.length,
      agreement: captured.length ? matches.length / captured.length : null,
      meanScore: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null
    };
  });
  const totals = summary(list);
  const reviewNeeded = list.filter(sample => sample.expectedState !== sample.observedState && !sample.reviewedAt).length;
  return {
    ...totals,
    reviewNeeded,
    evidenceSamples: evidence.length,
    benchmark: cohortMetrics(benchmark, supported),
    evidenceMetrics: cohortMetrics(evidence, supported),
    timing: durationSummary(list),
    labelsWithEvidence: labels.filter(label => label.count > 0).length,
    labelsAvailable: labels.length,
    labelsReady: labels.filter(label => label.evidenceStatus === 'ready').length,
    minimumEvidencePerLabel: MINIMUM_EVIDENCE_PER_LABEL,
    samplesNeeded: labels.reduce((total, label) => total + label.samplesNeeded, 0),
    labels
  };
}

module.exports = {
  evaluate,
  records,
  score,
  cohort,
  summary,
  labelMetrics,
  cohortMetrics,
  timingValues,
  percentile,
  durationSummary,
  MINIMUM_EVIDENCE_PER_LABEL
};
