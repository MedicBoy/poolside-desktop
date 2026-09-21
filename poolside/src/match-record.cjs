// The shape of a match ledger record, and the only place that decides whether a stored one is trusted.
//
// Split out of `match-coordination.cjs` for the same reason the ledger exists at all: this shape is read
// back from a file, written by one process and read by another, and shown in the dashboard. Every field
// therefore arrives from somewhere that could be wrong — a half-written file, a hand-edited edit, an
// older build — so the rules for accepting a record are kept together, away from the operations that
// move a ledger from one valid state to another.

const FORMAT = 'poolside-match-coordination/v1';
/** Bounded because the ledger is broadcast to the dashboard on every change and written on every match. */
const LEDGER_LIMIT = 200;
const HISTORY_LIMIT = 12;
const NAME_LIMIT = 60;
const TEXT_LIMIT = 200;
const ID_LIMIT = 64;

const STATES = ['active', 'completed', 'cancelled'];
/** The readiness barrier: a match is released only when every participant is ready. */
const READINESS_VERDICTS = ['preparing', 'ready', 'blocked'];

/** @param {unknown} value @param {number} max */
function text(value, max) {
  return typeof value === 'string'
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
}

function stamp(now) {
  return new Date(now).toISOString();
}

/** @returns {{format: string, sequence: number, matches: any[]}} */
function emptyState() {
  return { format: FORMAT, sequence: 0, matches: [] };
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
    winnerId: winner ? winner.id : null,
    winnerName: winner ? winner.name : null,
    reason: text(value.reason, TEXT_LIMIT),
    startedAt,
    endedAt: Number.isFinite(Date.parse(endedAt)) ? endedAt : null,
    readiness: cleanReadiness(value.readiness),
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
  if (source.format !== FORMAT) return emptyState();
  const matches = (Array.isArray(source.matches) ? source.matches : []).map(cleanMatch).filter(Boolean).slice(0, LEDGER_LIMIT);
  const sequence = Number.isInteger(source.sequence) && source.sequence >= 0 ? source.sequence : matches.length;
  return { format: FORMAT, sequence: Math.max(sequence, matches.length), matches };
}

module.exports = {
  FORMAT,
  LEDGER_LIMIT,
  HISTORY_LIMIT,
  NAME_LIMIT,
  TEXT_LIMIT,
  ID_LIMIT,
  STATES,
  READINESS_VERDICTS,
  text,
  stamp,
  emptyState,
  cleanParticipant,
  cleanHistory,
  cleanReadiness,
  cleanMatch,
  cleanState
};
