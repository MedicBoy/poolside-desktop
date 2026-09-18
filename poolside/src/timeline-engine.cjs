// The diagnostic timeline: one ordered history, compiled from the two rings that already record one.
//
// Two bounded histories exist and neither is readable as a sequence:
//
//   - `session-fsm.cjs` keeps the last 50 transitions per session, `{at, from, to, event, reason}`, oldest first.
//   - `workspace.cjs` keeps the last 100 activity entries, `{id, at, message, kind}`, newest first.
//
// "What happened before the failure" therefore meant reading two lists with different shapes and opposite
// orderings and sorting them by eye. This compiles them into one stream, indexes it, and answers the questions a
// failure asks — M4's whole objective. What may *leave* the machine is `timeline-transfer.cjs`; keeping the two
// apart is what stops a redaction rule from drifting into a reading path.
//
// The timeline is a **view**, never a second log. Nothing here appends to anything: a new source of history is
// added to `compile` rather than to a parallel store, or the two drift and the timeline starts lying.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

const { UNHEALTHY_STATES } = require('./session-fsm.cjs');

/** Ordered oldest first, and ISO 8601 from `toISOString()` sorts lexicographically, so string order is time order. */
const SOURCES = { SESSION: 'session', ACTIVITY: 'activity' };

/** The ceiling on one compiled view, so a dashboard refresh cannot become an unbounded sort. */
const MAX_ENTRIES = 400;

/** An activity entry that carries a warning is the closest thing the feed has to a severity. */
const ACTIVITY_LEVELS = ['info', 'warning'];

/** @param {unknown} value */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {string|null} */
function readTime(value) {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Severity for a transition, from the state it moved into. Taken from `session-fsm.cjs`'s own `UNHEALTHY_STATES`
 * so it cannot disagree with the machine that made the transition.
 * @param {string} to
 */
function transitionLevel(to) {
  return /** @type {readonly string[]} */ (UNHEALTHY_STATES).includes(to) ? 'warning' : 'info';
}

/** One session's transitions, as timeline entries. @param {string} accountId @param {string|null} accountName @param {any[]} transitions */
function fromTransitions(accountId, accountName, transitions) {
  return (Array.isArray(transitions) ? transitions : []).map(transition => {
    const item = isPlainObject(transition) ? transition : {};
    const to = String(item.to === undefined ? 'unknown' : item.to);
    return {
      at: readTime(item.at) || '',
      source: SOURCES.SESSION,
      accountId,
      accountName,
      kind: 'transition',
      level: transitionLevel(to),
      from: String(item.from === undefined ? 'unknown' : item.from),
      to,
      event: item.event === undefined ? null : String(item.event),
      reason: item.reason === undefined ? null : String(item.reason),
      message: null
    };
  });
}

/** Activity entries, as timeline entries. @param {any[]} events */
function fromActivity(events) {
  return (Array.isArray(events) ? events : []).map(event => {
    const item = isPlainObject(event) ? event : {};
    const level = ACTIVITY_LEVELS.includes(String(item.kind)) ? String(item.kind) : 'info';
    return {
      at: readTime(item.at) || '',
      source: SOURCES.ACTIVITY,
      accountId: null,
      accountName: null,
      kind: 'activity',
      level,
      from: null,
      to: null,
      event: null,
      reason: null,
      message: item.message === undefined ? '' : String(item.message)
    };
  });
}

/**
 * Compile both sources into one ordered stream.
 *
 * Ordering is by timestamp, then by source (a session transition before an activity entry recorded in the same
 * millisecond, because the transition is the cause), then by arrival. Insertion order is preserved as `seq`, so
 * a caller can key rows without relying on index stability.
 *
 * @param {{sessions?: {id: string, name?: string|null, transitions?: any[]}[], events?: any[], limit?: number}} [input]
 */
function compile(input) {
  // `null` reaches this from a caller that had nothing to pass; a default parameter covers only `undefined`.
  const source = /** @type {any} */ (isPlainObject(input) ? input : {});
  /** @type {any[]} */
  const entries = [];
  for (const session of Array.isArray(source.sessions) ? source.sessions : []) {
    if (!isPlainObject(session)) continue;
    const id = String(session.id === undefined ? '' : session.id);
    const name = typeof session.name === 'string' ? session.name : null;
    entries.push(...fromTransitions(id, name, /** @type {any[]} */ (session.transitions)));
  }
  entries.push(...fromActivity(/** @type {any[]} */ (source.events)));

  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.source !== b.source) return a.source === SOURCES.SESSION ? -1 : 1;
    return 0;
  });

  const requested = Number(source.limit);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_ENTRIES) : MAX_ENTRIES;
  // Bounded by keeping the *newest* entries: a timeline that dropped the most recent failure would be useless.
  const bounded = entries.length > limit ? entries.slice(entries.length - limit) : entries;
  return bounded.map((entry, seq) => ({ ...entry, seq }));
}

module.exports = {
  compile,
  fromTransitions,
  fromActivity,
  transitionLevel,
  SOURCES,
  MAX_ENTRIES
};
