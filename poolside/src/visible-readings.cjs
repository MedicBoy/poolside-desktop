// Extract display-only account readings from locally recognised text. Values require an explicit nearby
// label; a bare number is never guessed to be a balance, rank, or trophy count.
const SPECS = [
  { key: 'coinBalance', label: 'Coins', terms: ['coins', 'coin balance'] },
  { key: 'cash', label: 'Cash', terms: ['cash', 'pool cash'] },
  { key: 'rank', label: 'Rank', terms: ['rank'] },
  { key: 'trophies', label: 'Trophies', terms: ['trophies', 'trophy'] }
];
const NUMBER = '(\\d[\\d,.]{0,18})';
function value(text) {
  const digits = String(text).replace(/[^0-9]/g, '');
  if (!digits || digits.length > 15) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
/**
 * @param {unknown} input recognised text
 * @param {string} observedAt
 * @param {number} confidence the recogniser's own 0–1 confidence for the pass that produced the text. A
 *   reading that carries a number this module cannot vouch for is worse than no reading, so the value is
 *   never invented here: a caller that has no confidence figure gets the low default and the reading
 *   shows up as uncertain rather than current.
 */
function parseVisibleReadings(input, observedAt = new Date().toISOString(), confidence = 0.65) {
  const certainty = Number.isFinite(confidence) ? Math.max(0, Math.min(1, Number(confidence))) : 0;
  const text = String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const readings = {};
  for (const spec of SPECS) {
    for (const term of spec.terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const after = new RegExp(`(?:${escaped})\\s*[:\\-]?\\s*${NUMBER}`, 'i').exec(text);
      const before = after ? null : new RegExp(`${NUMBER}\\s*(?:${escaped})`, 'i').exec(text);
      const number = value(after?.[1] || before?.[1]);
      if (number === null) continue;
      readings[spec.key] = { label: spec.label, value: number, confidence: certainty, observedAt, source: 'labelled local OCR' };
      break;
    }
  }
  return readings;
}
module.exports = { parseVisibleReadings, value, SPECS };
