// What one capture pass recorded: geometry, outcome, timings, and the bounded per-stage breakdown.
const { TABLES } = require('./table-list.cjs');

const SAMPLE_STATES = ['loading', 'connecting', 'lucky-promotion', 'lucky-shot', 'lobby', 'table-selection', 'shop'];
const OBSERVED_STATES = [...SAMPLE_STATES, 'unrecognized'];
const COHORTS = ['evidence', 'benchmark'];
const OCR_SOURCES = ['full-frame', 'bottom-band', 'unavailable'];

function validId(id) {
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
}

function validState(state) {
  if (!SAMPLE_STATES.includes(state)) throw new Error('Choose a supported expected screen state.');
  return state;
}

function validExpectedTable(state, table) {
  if (state === 'table-selection' && !TABLES.includes(table)) throw new Error('Choose the table this sample is meant to locate.');
  return state === 'table-selection' ? table : null;
}

/** @param {unknown} value */
function validCohort(value) {
  if (typeof value !== 'string' || !COHORTS.includes(value)) throw new Error('Choose a supported capture set.');
  return value;
}

/** @param {unknown} value */
function normaliseCohort(value) {
  return value === 'benchmark' ? 'benchmark' : 'evidence';
}

function milliseconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 300000 ? Math.round(value) : null;
}

/**
 * The per-stage breakdown the reader measures inside one recognition pass. Allowlisted rather than copied: the
 * lab reports what the pipeline actually spends its time on, and nothing else rides along with it.
 */
const STAGE_KEYS = ['firstOcrMs', 'visualMatchMs', 'contrastPrepMs', 'contrastOcrMs', 'bottomPrepMs', 'bottomOcrMs', 'readingsMs'];

function stages(value) {
  if (!value || typeof value !== 'object') return null;
  /** @type {Record<string, number>} */
  const kept = {};
  for (const key of STAGE_KEYS) {
    const measured = milliseconds(value[key]);
    if (measured !== null) kept[key] = measured;
  }
  return Object.keys(kept).length ? kept : null;
}

function timing(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {
    surfaceMs: milliseconds(value.surfaceMs),
    recognitionMs: milliseconds(value.recognitionMs),
    totalMs: milliseconds(value.totalMs)
  };
  const breakdown = stages(value.stages);
  if (breakdown) result.stages = breakdown;
  return Object.values(result).some(measurement => measurement !== null) ? result : null;
}

/**
 * The manifest is an allowlist, rather than a copy of inspection output. A screen capture can contain
 * sensitive page pixels, so no browser-derived text, account metadata, navigation data, or arbitrary
 * inspection fields may ever be retained beside it.
 *
 * @param {unknown} value
 */
function normaliseSample(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sample = /** @type {any} */ (value);
  if (!validId(sample.id) || !SAMPLE_STATES.includes(sample.expectedState)) return null;
  const expectedTable = sample.expectedState === 'table-selection' && TABLES.includes(sample.expectedTable) ? sample.expectedTable : null;
  if (sample.expectedState === 'table-selection' && !expectedTable) return null;
  if (typeof sample.imageHash !== 'string' || !/^[a-f0-9]{64}$/i.test(sample.imageHash)) return null;
  const capturedAt = typeof sample.capturedAt === 'string' && !Number.isNaN(Date.parse(sample.capturedAt)) ? sample.capturedAt : null;
  if (!capturedAt) return null;
  const width = Number.isInteger(sample.width) && sample.width > 0 && sample.width <= 20000 ? sample.width : null;
  const height = Number.isInteger(sample.height) && sample.height > 0 && sample.height <= 20000 ? sample.height : null;
  const stored = /** @type {any} */ ({
    id: sample.id,
    imageHash: sample.imageHash.toLowerCase(),
    cohort: normaliseCohort(sample.cohort),
    expectedState: sample.expectedState,
    expectedTable,
    observedState: OBSERVED_STATES.includes(sample.observedState) ? sample.observedState : 'unrecognized',
    observedTables: Array.isArray(sample.observedTables) ? [...new Set(sample.observedTables.filter(table => TABLES.includes(table)))] : [],
    score: Number.isFinite(sample.score) ? Math.max(0, Math.min(1, Number(sample.score))) : 0,
    source: OCR_SOURCES.includes(sample.source) ? sample.source : 'unavailable',
    capturedAt,
    width,
    height
  });
  const measured = timing(sample.timing);
  if (measured) stored.timing = measured;
  if (typeof sample.reviewedAt === 'string' && !Number.isNaN(Date.parse(sample.reviewedAt))) stored.reviewedAt = sample.reviewedAt;
  return stored;
}

module.exports = {
  SAMPLE_STATES,
  OBSERVED_STATES,
  COHORTS,
  OCR_SOURCES,
  validId,
  validState,
  validExpectedTable,
  validCohort,
  normaliseCohort,
  milliseconds,
  timing,
  normaliseSample
};
