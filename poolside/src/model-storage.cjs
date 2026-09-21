// Disposable profile bookkeeping and remembered window geometry in a workspace document.

const { normaliseRemembered } = require('./geometry.cjs');

/** @param {unknown} input */
function pickProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const source = /** @type {Record<string, any>} */ (input);
  /** @type {Record<string, unknown>} */
  const picked = {};
  if (Number.isInteger(source.generation) && source.generation >= 0) picked.generation = source.generation;
  if (source.established === true || source.established === false) picked.established = source.established;
  if (typeof source.firstSeenAt === 'string') picked.firstSeenAt = source.firstSeenAt;
  const corruption = source.corruption;
  if (corruption && typeof corruption === 'object' && !Array.isArray(corruption) && Number.isInteger(corruption.count)) {
    picked.corruption = {
      count: corruption.count,
      lastAt: typeof corruption.lastAt === 'string' ? corruption.lastAt : null,
      lastReason: typeof corruption.lastReason === 'string' ? corruption.lastReason : null,
      lastAction: typeof corruption.lastAction === 'string' ? corruption.lastAction : null
    };
  }
  return Object.keys(picked).length ? picked : undefined;
}

/** @param {unknown} input @param {Set<string>} ids */
function windowGeometry(input, ids) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  /** @type {Record<string, object>} */
  const result = {};
  for (const [id, value] of Object.entries(/** @type {Record<string, unknown>} */ (input))) {
    if (!ids.has(id)) continue;
    const clean = normaliseRemembered(value);
    if (!clean) continue;
    const raw = /** @type {Record<string, unknown>} */ (value);
    result[id] = {
      ...clean,
      displayId: Number.isInteger(raw.displayId) ? raw.displayId : null,
      at: typeof raw.at === 'string' ? raw.at : null
    };
  }
  return result;
}

module.exports = { pickProfile, windowGeometry };
