// Whether a locally recognised account reading can be trusted as a current figure, and why not.
//
// A reading is not "the balance". It is a value a screen showed at a moment, read by an OCR pass that
// reports its own confidence. Two things make it unusable as a current figure: the reader was unsure,
// or the observation is old. Both are decided here, once, so a card, a log, and any later consumer
// cannot each invent a different idea of "fresh enough" (ADR-0014).
//
// Pure: no Electron, no fs.

const CONFIDENCE_FLOOR = 0.8;
const STALE_AFTER_MS = 10 * 60 * 1000;

/** @typedef {'current'|'uncertain'|'stale'} ReadingStatus */

/**
 * The status of one reading. An unparseable or missing observation time is stale rather than current:
 * a value whose age cannot be shown cannot be presented as the figure on screen now.
 * @param {{confidence?: unknown, observedAt?: unknown}} reading
 * @param {number} nowMs
 * @returns {ReadingStatus}
 */
function readingStatus(reading, nowMs = Date.now()) {
  const observed = Date.parse(String(reading?.observedAt ?? ''));
  if (!Number.isFinite(observed) || !Number.isFinite(nowMs) || nowMs - observed > STALE_AFTER_MS) return 'stale';
  const confidence = Number(reading?.confidence);
  if (!Number.isFinite(confidence) || confidence < CONFIDENCE_FLOOR) return 'uncertain';
  return 'current';
}

/** The words a card and a log agree on, so one status never reads as two different things. */
const STATUS_LABELS = {
  current: 'Current reading',
  uncertain: 'Uncertain reading',
  stale: 'Stale reading'
};

/**
 * Stamp every usable reading with its status. A reading without a whole-number value is dropped rather
 * than shown as zero, and the input is never mutated.
 * @param {Record<string, any>} readings
 * @param {number} nowMs
 */
function describeReadings(readings, nowMs = Date.now()) {
  /** @type {Record<string, any>} */
  const result = {};
  for (const [key, reading] of Object.entries(readings || {})) {
    if (!reading || typeof reading !== 'object' || !Number.isSafeInteger(reading.value)) continue;
    const status = readingStatus(reading, nowMs);
    result[key] = { ...reading, status, statusLabel: STATUS_LABELS[status] };
  }
  return result;
}

module.exports = { readingStatus, describeReadings, STATUS_LABELS, CONFIDENCE_FLOOR, STALE_AFTER_MS };
