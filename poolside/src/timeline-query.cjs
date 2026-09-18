// Reading the compiled timeline: the questions a failure asks.
//
// Split from `timeline-engine.cjs` (which builds the stream) because building and reading are different jobs, and
// this half has no knowledge of where an entry came from. Nothing here throws on an unusable input: it is the
// module a caller reaches for *while* something is already going wrong.

const { SOURCES } = require('./timeline-engine.cjs');

/** Index the stream for the questions a failure asks. @param {any[]} entries */
function index(entries) {
  const stream = Array.isArray(entries) ? entries : [];
  /** @type {Map<string, any[]>} */
  const byAccount = new Map();
  /** @type {Map<string, any[]>} */
  const byEvent = new Map();
  /** @type {Map<string, number>} */
  const byTransition = new Map();
  for (const entry of stream) {
    if (entry.accountId) {
      const list = byAccount.get(entry.accountId) || [];
      list.push(entry);
      byAccount.set(entry.accountId, list);
    }
    if (entry.event) {
      const list = byEvent.get(entry.event) || [];
      list.push(entry);
      byEvent.set(entry.event, list);
    }
    if (entry.source === SOURCES.SESSION) {
      const key = `${entry.from}->${entry.to}`;
      byTransition.set(key, (byTransition.get(key) || 0) + 1);
    }
  }
  return { byAccount, byEvent, byTransition };
}

/**
 * Filter the stream. Every option is optional and they compose.
 * @param {any[]} entries
 * @param {{accountId?: string, event?: string, source?: string, level?: string, since?: string, until?: string, limit?: number}} [filter]
 */
function query(entries, filter = {}) {
  let stream = Array.isArray(entries) ? entries : [];
  if (filter.accountId) stream = stream.filter(entry => entry.accountId === filter.accountId);
  if (filter.event) stream = stream.filter(entry => entry.event === filter.event);
  if (filter.source) stream = stream.filter(entry => entry.source === filter.source);
  if (filter.level) stream = stream.filter(entry => entry.level === filter.level);
  const since = filter.since;
  const until = filter.until;
  if (typeof since === 'string' && since) stream = stream.filter(entry => entry.at >= since);
  if (typeof until === 'string' && until) stream = stream.filter(entry => entry.at <= until);
  if (Number.isInteger(filter.limit) && Number(filter.limit) >= 0) {
    // `slice(-0)` is `slice(0)`, which returns the whole array: a limit of zero means *no* entries, and is
    // handled explicitly rather than left to the sign of zero.
    const limit = Number(filter.limit);
    stream = limit === 0 ? [] : stream.slice(-limit);
  }
  return stream;
}

/** Everything that went wrong, in order. @param {any[]} entries */
function failures(entries) {
  return query(entries, { level: 'warning' });
}

/**
 * Counts over the stream. `span` is the distance between the first and last entry, so a reader can tell a busy
 * minute from a quiet day without parsing timestamps themselves.
 * @param {any[]} entries
 */
function summarise(entries) {
  const stream = Array.isArray(entries) ? entries : [];
  /** @type {Record<string, number>} */
  const bySource = {};
  /** @type {Record<string, number>} */
  const byKind = {};
  /** @type {Record<string, number>} */
  const byLevel = {};
  const accounts = new Set();
  for (const entry of stream) {
    bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    byLevel[entry.level] = (byLevel[entry.level] || 0) + 1;
    if (entry.accountId) accounts.add(entry.accountId);
  }
  const first = stream.length ? stream[0].at : null;
  const last = stream.length ? stream[stream.length - 1].at : null;
  const span = first && last ? Math.max(0, Date.parse(last) - Date.parse(first)) : 0;
  return {
    total: stream.length,
    bySource,
    byKind,
    byLevel,
    accounts: accounts.size,
    first,
    last,
    spanMs: Number.isFinite(span) ? span : 0
  };
}

module.exports = { index, query, failures, summarise };
