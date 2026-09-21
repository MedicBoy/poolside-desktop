// Local match coordination: pair two of your own accounts into a match, record the result, and keep a
// bounded ledger of what happened.
//
// This is the production successor to the throwaway guest simulator. The simulator proved the shape of
// the state machine — a dynamic participant list, pairing guards, a recorded result, cancellation, and
// an immutable snapshot — against invented identities. Here the participants are the accounts already in
// the workspace, the guards are the same, and there is no cap on how many accounts or matches a
// workspace may hold.
//
// What it is not: it does not pair accounts on the live game service, observe a real match, or verify an
// outcome. A recorded result is what the operator recorded, and the ledger says so.
//
// Pure: no Electron, no fs, no clock of its own. Time and identity arrive as arguments so every rule
// below is arithmetic a test can pin.

const FORMAT = 'poolside-match-coordination/v1';
/** Bounded because the ledger is broadcast to the dashboard on every change and written on every match. */
const LEDGER_LIMIT = 200;
const HISTORY_LIMIT = 12;
const VIEW_LIMIT = 8;
const NAME_LIMIT = 60;
const TEXT_LIMIT = 200;
const ID_LIMIT = 64;

const STATES = ['active', 'completed', 'cancelled'];

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
    .map(step => {
      if (!step || typeof step !== 'object') return null;
      const at = text(step.at, 40);
      const from = STATES.includes(step.from) ? step.from : null;
      const to = STATES.includes(step.to) ? step.to : null;
      const event = text(step.event, 32);
      if (!Number.isFinite(Date.parse(at)) || !from || !to || !/^[a-z0-9-]+$/.test(event)) return null;
      return { at, from, to, event, detail: text(step.detail, TEXT_LIMIT) };
    })
    .filter(Boolean)
    .slice(-HISTORY_LIMIT);
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

function step(from, to, event, detail, at) {
  return { at: stamp(at), from, to, event, detail: text(detail, TEXT_LIMIT) };
}

function moved(match, to, event, detail, now) {
  return {
    ...match,
    state: to,
    history: [...match.history, step(match.state, to, event, detail, now)].slice(-HISTORY_LIMIT)
  };
}

/** Replace one match in place in the ledger order, newest first, and keep the ledger bounded. */
function replaced(state, match) {
  const matches = state.matches.map(candidate => (candidate.matchId === match.matchId ? match : candidate));
  return { ...state, matches: matches.slice(0, LEDGER_LIMIT) };
}

function locate(state, handleOrId) {
  const wanted = text(handleOrId, ID_LIMIT);
  const match = state.matches.find(candidate => candidate.matchId === wanted || candidate.handle === wanted);
  if (!match) throw new Error('That match is not in the local ledger.');
  return match;
}

/** @param {any[]} accounts @param {string} id */
function participantFor(accounts, id) {
  const account = (Array.isArray(accounts) ? accounts : []).find(candidate => candidate && candidate.id === id);
  if (!account || account.archived === true) throw new Error('That account is no longer an active account.');
  return { id: text(account.id, ID_LIMIT), name: text(account.name, NAME_LIMIT) || 'Unnamed account' };
}

function activeMatchFor(state, id) {
  return state.matches.find(match => match.state === 'active' && match.participants.some(participant => participant.id === id)) || null;
}

/**
 * @param {{format: string, sequence: number, matches: any[]}} state
 * @param {{first: string, second: string, accounts: any[], now?: number, matchId: string}} input
 */
function start(state, { first, second, accounts, now = Date.now(), matchId }) {
  const current = reconcile(state, accounts, now);
  if (!first || !second) throw new Error('Choose two accounts to coordinate.');
  if (first === second) throw new Error('A match needs two different accounts.');
  const participants = [participantFor(accounts, first), participantFor(accounts, second)];
  for (const participant of participants) {
    const busy = activeMatchFor(current, participant.id);
    if (busy) throw new Error(`${participant.name} is already in an active match.`);
  }
  const sequence = current.sequence + 1;
  const record = {
    handle: `m${sequence}`,
    matchId: text(matchId, ID_LIMIT),
    participants,
    state: 'active',
    winnerId: null,
    winnerName: null,
    reason: '',
    startedAt: stamp(now),
    endedAt: null,
    history: []
  };
  if (!record.matchId) throw new Error('A match identity could not be created.');
  const opened = {
    ...record,
    history: [step('active', 'active', 'started', `${participants[0].name} and ${participants[1].name} paired.`, now)]
  };
  return { ...current, sequence, matches: [opened, ...current.matches].slice(0, LEDGER_LIMIT) };
}

/** @param {{format: string, sequence: number, matches: any[]}} state */
function complete(state, { matchId, winner, now = Date.now() }) {
  const match = locate(state, matchId);
  if (match.state !== 'active') throw new Error('That match is no longer active.');
  const won = match.participants.find(participant => participant.id === winner);
  if (!won) throw new Error('The result must name one of the two participants.');
  const next = moved(match, 'completed', 'completed', `${won.name} recorded as the winner.`, now);
  return replaced(state, { ...next, winnerId: won.id, winnerName: won.name, endedAt: stamp(now) });
}

/** @param {{format: string, sequence: number, matches: any[]}} state @param {{matchId: string, reason?: string, now?: number}} input */
function cancel(state, { matchId, reason, now = Date.now() }) {
  const match = locate(state, matchId);
  if (match.state !== 'active') throw new Error('That match is no longer active.');
  const detail = text(reason, TEXT_LIMIT) || 'Cancelled before a result was recorded.';
  const next = moved(match, 'cancelled', 'cancelled', detail, now);
  return replaced(state, { ...next, reason: detail, endedAt: stamp(now) });
}

/**
 * A match cannot outlive its participants. An account that was archived or removed while a match was
 * running cancels that match instead of leaving a phantom in progress, which is what the ledger would
 * otherwise show after a workspace edit.
 * @param {{format: string, sequence: number, matches: any[]}} state
 * @param {any[]} accounts
 */
function reconcile(state, accounts, now = Date.now()) {
  const available = new Set((Array.isArray(accounts) ? accounts : []).filter(a => a && a.archived !== true).map(a => a.id));
  let changed = false;
  const matches = state.matches.map(match => {
    if (match.state !== 'active') return match;
    const missing = match.participants.find(participant => !available.has(participant.id));
    if (!missing) return match;
    changed = true;
    const detail = `${missing.name} is no longer an active account, so ${match.handle} was cancelled.`;
    return { ...moved(match, 'cancelled', 'reconciled', detail, now), reason: detail, endedAt: stamp(now) };
  });
  return changed ? { ...state, matches } : state;
}

function matchView(match) {
  return {
    handle: match.handle,
    matchId: match.matchId,
    participants: match.participants.map(participant => ({ ...participant })),
    state: match.state,
    winnerId: match.winnerId,
    winnerName: match.winnerName,
    reason: match.reason,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    history: match.history.slice(-4).map(item => ({ ...item }))
  };
}

/**
 * The dashboard-safe projection: counts, the matches in progress, and the most recent finished ones.
 * @param {{format: string, sequence: number, matches: any[]}} state
 */
function dashboardView(state) {
  const ledger = state.matches;
  return {
    totals: {
      recorded: ledger.length,
      active: ledger.filter(match => match.state === 'active').length,
      completed: ledger.filter(match => match.state === 'completed').length,
      cancelled: ledger.filter(match => match.state === 'cancelled').length
    },
    active: ledger.filter(match => match.state === 'active').map(matchView),
    recent: ledger
      .filter(match => match.state !== 'active')
      .slice(0, VIEW_LIMIT)
      .map(matchView)
  };
}

module.exports = {
  start,
  complete,
  cancel,
  reconcile,
  dashboardView,
  cleanState,
  emptyState,
  FORMAT,
  LEDGER_LIMIT,
  HISTORY_LIMIT,
  STATES
};
