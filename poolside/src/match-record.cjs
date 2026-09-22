// The shape of a match ledger record, and the only place that decides whether a stored one is trusted.
//
// This shape is read back from a file, written by one process and read by another, and shown in the dashboard.
// Every field therefore arrives from somewhere that could be wrong — a half-written file, a hand-edited edit,
// an older build — so the rules for accepting a record are kept together, away from the operations that move a
// ledger from one valid state to another.
//
// Two things this module used to carry live in their own files now: the text helpers every record shares
// (`record-text.cjs`) and the shape of a run (`run-record.cjs`), which is the same kind of record and grew
// here until the module hit its size ceiling.

const { text, stamp, NAME_LIMIT, TEXT_LIMIT, ID_LIMIT } = require('./record-text.cjs');
const { RUN_LEDGER_LIMIT, RUN_HISTORY_LIMIT, RUN_STATES, RUN_OUTCOMES, cleanRun } = require('./run-record.cjs');

const FORMAT = 'poolside-match-coordination/v2';
/**
 * Formats this module still reads. v1 held matches and no runs, so it migrates by gaining an empty run
 * list: a build that gains runs must not throw away the matches an earlier one recorded.
 */
const LEGACY_FORMATS = ['poolside-match-coordination/v1'];
/** Bounded because the ledger is broadcast to the dashboard on every change and written on every match. */
const LEDGER_LIMIT = 200;
const HISTORY_LIMIT = 12;

const STATES = ['active', 'completed', 'cancelled'];
/** The readiness barrier: a match is released only when every participant is ready. */
const READINESS_VERDICTS = ['preparing', 'ready', 'blocked'];
/** What a pairing claim may be. The wording lives with the rules in `pairing-evidence.cjs`. */
const PAIRING_VERDICTS = ['paired', 'agreed', 'mismatch', 'incomplete'];
/** What a recorded change to the balances amounts to. The wording lives in `outcome-evidence.cjs`. */
const OUTCOME_VERDICTS = ['observed', 'unchanged', 'uncertain', 'incomplete'];

/** @returns {{format: string, sequence: number, runSequence: number, matches: any[], runs: any[]}} */
function emptyState() {
  return { format: FORMAT, sequence: 0, runSequence: 0, matches: [], runs: [] };
}

function cleanParticipant(value) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id, ID_LIMIT);
  const name = text(value.name, NAME_LIMIT);
  return id && name ? { id, name } : null;
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const at = text(entry.at, 40);
      const from = STATES.includes(entry.from) ? entry.from : null;
      const to = STATES.includes(entry.to) ? entry.to : null;
      const event = text(entry.event, 32);
      if (!Number.isFinite(Date.parse(at)) || !from || !to || !/^[a-z0-9-]+$/.test(event)) return null;
      return { at, from, to, event, detail: text(entry.detail, TEXT_LIMIT) };
    })
    .filter(Boolean)
    .slice(-HISTORY_LIMIT);
}

/**
 * A readiness record, or null. It accepts only the shape this module writes: a verdict, when release
 * was requested, and the deadline that request ran under.
 * @param {unknown} value
 */
function cleanReadiness(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {any} */ (value);
  const verdict = READINESS_VERDICTS.includes(source.verdict) ? source.verdict : null;
  const requestedAt = text(source.requestedAt, 40);
  const deadlineAt = text(source.deadlineAt, 40);
  if (!verdict || !Number.isFinite(Date.parse(requestedAt)) || !Number.isFinite(Date.parse(deadlineAt))) return null;
  const releasedAt = text(source.releasedAt, 40);
  const checkedAt = text(source.checkedAt, 40);
  return {
    verdict,
    requestedAt,
    deadlineAt,
    releasedAt: Number.isFinite(Date.parse(releasedAt)) ? releasedAt : null,
    skewMs: Number.isFinite(source.skewMs) && source.skewMs >= 0 ? Math.round(source.skewMs) : null,
    reason: text(source.reason, TEXT_LIMIT),
    checkedAt: Number.isFinite(Date.parse(checkedAt)) ? checkedAt : requestedAt
  };
}

/**
 * A recorded pairing verdict, or null.
 *
 * Only the evidence that can be re-read is kept: the verdict, the words, when it was judged, and — when
 * they exist — the table and the entry both screens agreed on. No image, no address, no raw screen text.
 * @param {unknown} value
 */
function cleanPairing(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {any} */ (value);
  const verdict = PAIRING_VERDICTS.includes(source.verdict) ? source.verdict : null;
  const label = text(source.label, 80);
  const reason = text(source.reason, TEXT_LIMIT);
  const checkedAt = text(source.checkedAt, 40);
  if (!verdict || !label || !reason || !Number.isFinite(Date.parse(checkedAt))) return null;
  const table = text(source.table, 40);
  const currency = text(source.currency, 20);
  const amount = Number.isInteger(source.amount) && source.amount > 0 ? source.amount : null;
  const windowMs = Number.isInteger(source.windowMs) && source.windowMs > 0 ? source.windowMs : null;
  return {
    verdict,
    label,
    reason,
    checkedAt,
    table: table || null,
    currency: currency || null,
    amount: amount !== null && currency ? amount : null,
    windowMs
  };
}

/**
 * A recorded outcome, or null. What the balances did, from the two sessions' own readings — deliberately not a
 * reconciliation: there is no fee table here to check a change against.
 * @param {unknown} value
 */
function cleanOutcome(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {any} */ (value);
  const verdict = OUTCOME_VERDICTS.includes(source.verdict) ? source.verdict : null;
  const reason = text(source.reason, TEXT_LIMIT);
  const checkedAt = text(source.checkedAt, 40);
  if (!verdict || !reason || !Number.isFinite(Date.parse(checkedAt))) return null;
  const readings = (Array.isArray(source.readings) ? source.readings : [])
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const name = text(entry.name, NAME_LIMIT);
      const currency = entry.currency === 'coins' || entry.currency === 'cash' ? entry.currency : null;
      if (!name || !currency) return null;
      if (!Number.isFinite(entry.from) || !Number.isFinite(entry.to) || !Number.isFinite(entry.delta)) return null;
      return {
        name,
        currency,
        from: Math.round(entry.from),
        to: Math.round(entry.to),
        delta: Math.round(entry.delta),
        exact: entry.exact !== false,
        status: ['current', 'uncertain', 'stale'].includes(entry.status) ? entry.status : 'uncertain'
      };
    })
    .filter(Boolean)
    .slice(0, 8);
  return { verdict, reason, checkedAt, readings };
}

function cleanMatch(value) {
  if (!value || typeof value !== 'object') return null;
  const handle = text(value.handle, 24);
  const matchId = text(value.matchId, ID_LIMIT);
  const participants = Array.isArray(value.participants) ? value.participants.map(cleanParticipant).filter(Boolean) : [];
  const state = STATES.includes(value.state) ? value.state : null;
  const startedAt = text(value.startedAt, 40);
  if (!/^m\d+$/.test(handle) || !matchId || participants.length !== 2 || !state || !Number.isFinite(Date.parse(startedAt))) return null;
  const winner = participants.find(participant => participant.id === value.winnerId) || null;
  const endedAt = text(value.endedAt, 40);
  return {
    handle,
    matchId,
    participants,
    state,
    // Which run this match belongs to, or null for a match started on its own. Kept as text rather than
    // dropped when it points at a run that is no longer in the ledger: the match's own record still says
    // what it was part of, and the counters ignore a run they cannot find.
    runId: text(value.runId, ID_LIMIT) || null,
    winnerId: winner ? winner.id : null,
    winnerName: winner ? winner.name : null,
    reason: text(value.reason, TEXT_LIMIT),
    startedAt,
    endedAt: Number.isFinite(Date.parse(endedAt)) ? endedAt : null,
    readiness: cleanReadiness(value.readiness),
    pairing: cleanPairing(value.pairing),
    outcome: cleanOutcome(value.outcome),
    history: cleanHistory(value.history)
  };
}

/**
 * Accept only a ledger this module could have produced. Anything else is dropped rather than trusted,
 * because this shape is read back from a file and from the dashboard.
 * @param {unknown} value
 */
function cleanState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyState();
  const source = /** @type {any} */ (value);
  if (source.format !== FORMAT && !LEGACY_FORMATS.includes(source.format)) return emptyState();
  const matches = (Array.isArray(source.matches) ? source.matches : []).map(cleanMatch).filter(Boolean).slice(0, LEDGER_LIMIT);
  const sequence = Number.isInteger(source.sequence) && source.sequence >= 0 ? source.sequence : matches.length;
  const runs = (Array.isArray(source.runs) ? source.runs : []).map(cleanRun).filter(Boolean).slice(0, RUN_LEDGER_LIMIT);
  const runSequence = Number.isInteger(source.runSequence) && source.runSequence >= 0 ? source.runSequence : runs.length;
  return {
    format: FORMAT,
    sequence: Math.max(sequence, matches.length),
    runSequence: Math.max(runSequence, runs.length),
    matches,
    runs
  };
}

module.exports = {
  // Re-exported so the rest of the ledger keeps one import for the shapes and the helpers they use.
  text,
  stamp,
  NAME_LIMIT,
  TEXT_LIMIT,
  ID_LIMIT,
  RUN_LEDGER_LIMIT,
  RUN_HISTORY_LIMIT,
  RUN_STATES,
  RUN_OUTCOMES,
  FORMAT,
  LEGACY_FORMATS,
  LEDGER_LIMIT,
  HISTORY_LIMIT,
  STATES,
  READINESS_VERDICTS,
  PAIRING_VERDICTS,
  OUTCOME_VERDICTS,
  emptyState,
  cleanParticipant,
  cleanHistory,
  cleanReadiness,
  cleanPairing,
  cleanOutcome,
  cleanMatch,
  cleanRun,
  cleanState
};
