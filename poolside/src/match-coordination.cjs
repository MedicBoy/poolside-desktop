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
// below is arithmetic a test can pin. The record shape and its validation live in `match-record.cjs`;
// this module owns the operations that move a ledger from one valid state to the next.

const {
  FORMAT,
  LEDGER_LIMIT,
  HISTORY_LIMIT,
  ID_LIMIT,
  NAME_LIMIT,
  TEXT_LIMIT,
  STATES,
  READINESS_VERDICTS,
  text,
  stamp,
  emptyState,
  cleanState
} = require('./match-record.cjs');

/** How many finished matches the dashboard shows. */
const VIEW_LIMIT = 8;

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

function activeMatch(state, matchId) {
  const match = locate(state, matchId);
  if (match.state !== 'active') throw new Error('That match is no longer active.');
  return match;
}

/**
 * Open the barrier: from now until the deadline, this match is waiting for every participant to be
 * ready. Called when a match starts and again whenever release has to be re-requested.
 * @param any state
 * @param {{matchId: string, now?: number, deadlineMs: number, reason?: string}} input
 */
function requestReadiness(state, { matchId, now = Date.now(), deadlineMs, reason }) {
  const match = activeMatch(state, matchId);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error('A readiness deadline is required.');
  const detail = text(reason, TEXT_LIMIT) || 'Waiting for every participant to be ready.';
  const readiness = {
    verdict: 'preparing',
    requestedAt: stamp(now),
    deadlineAt: stamp(now + deadlineMs),
    releasedAt: null,
    skewMs: null,
    reason: detail,
    checkedAt: stamp(now)
  };
  return replaced(state, moved({ ...match, readiness }, match.state, 'readiness-requested', detail, now));
}

/**
 * Close the barrier with a verdict. `ready` records when release actually happened and how long it
 * took against the monotonic clock the caller measured; `blocked` records why release did not happen.
 * @param any state
 * @param {{matchId: string, verdict: string, reason: string, releasedAt?: number, skewMs?: number|null, now?: number}} input
 */
function settleReadiness(state, { matchId, verdict, reason, releasedAt, skewMs = null, now = Date.now() }) {
  const match = activeMatch(state, matchId);
  if (!['ready', 'blocked'].includes(verdict)) throw new Error(`Unknown readiness verdict: ${verdict}`);
  const detail = text(reason, TEXT_LIMIT) || (verdict === 'ready' ? 'Every participant is ready.' : 'Readiness was not reached.');
  const readiness = {
    ...match.readiness,
    verdict,
    reason: detail,
    releasedAt: verdict === 'ready' ? stamp(releasedAt === undefined ? now : releasedAt) : null,
    skewMs: verdict === 'ready' && typeof skewMs === 'number' && Number.isFinite(skewMs) && skewMs >= 0 ? Math.round(skewMs) : null,
    checkedAt: stamp(now)
  };
  return replaced(state, moved({ ...match, readiness }, match.state, verdict === 'ready' ? 'released' : 'blocked', detail, now));
}

/**
 * Record what the two screens amount to. The checker writes this only when the verdict changes, so the
 * ledger holds evidence rather than a heartbeat.
 * @param {any} state
 * @param {{matchId: string, pairing: any, now?: number}} input
 */
function recordPairing(state, { matchId, pairing, now = Date.now() }) {
  const match = activeMatch(state, matchId);
  const detail = `${pairing.label}: ${pairing.reason}`;
  return replaced(state, moved({ ...match, pairing: { ...pairing } }, match.state, 'pairing-evidence', detail, now));
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
 * @param any state
 * @param {{first: string, second: string, accounts: any[], now?: number, matchId: string, runId?: string|null}} input
 */
function start(state, { first, second, accounts, now = Date.now(), matchId, runId = null }) {
  const current = reconcile(state, accounts, now);
  if (!first || !second) throw new Error('Choose two accounts to coordinate.');
  if (first === second) throw new Error('A match needs two different accounts.');
  const participants = [participantFor(accounts, first), participantFor(accounts, second)];
  for (const participant of participants) {
    const busy = activeMatchFor(current, participant.id);
    // The refusal names the match, because the operator's next move is to find that card and settle it.
    if (busy)
      throw new Error(
        `${participant.name} is already in an active match (${busy.handle}). Cancel ${busy.handle} on the match card to start another.`
      );
  }
  const sequence = current.sequence + 1;
  const record = {
    handle: `m${sequence}`,
    matchId: text(matchId, ID_LIMIT),
    participants,
    state: 'active',
    // The run this match belongs to, or null when it was started on its own. The run's counters are
    // counted from this, so it is recorded here rather than kept in a second place that can drift.
    runId: text(runId, ID_LIMIT) || null,
    winnerId: null,
    winnerName: null,
    reason: '',
    startedAt: stamp(now),
    endedAt: null,
    readiness: null,
    history: []
  };
  if (!record.matchId) throw new Error('A match identity could not be created.');
  const opened = {
    ...record,
    history: [step('active', 'active', 'started', `${participants[0].name} and ${participants[1].name} paired.`, now)]
  };
  return { ...current, sequence, matches: [opened, ...current.matches].slice(0, LEDGER_LIMIT) };
}

/** @param any state */
function complete(state, { matchId, winner, now = Date.now() }) {
  const match = locate(state, matchId);
  if (match.state !== 'active') throw new Error('That match is no longer active.');
  const won = match.participants.find(participant => participant.id === winner);
  if (!won) throw new Error('The result must name one of the two participants.');
  const next = moved(match, 'completed', 'completed', `${won.name} recorded as the winner.`, now);
  return replaced(state, { ...next, winnerId: won.id, winnerName: won.name, endedAt: stamp(now) });
}

/** @param any state @param {{matchId: string, reason?: string, now?: number}} input */
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
 * @param any state
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

/**
 * A match cannot outlive the process that was holding it.
 *
 * The windows belong to the process, so when the application starts there is no session behind anything the
 * ledger still calls "in progress" — and a match left active blocks both of its accounts from ever being
 * paired again, with nothing on screen to explain why. Rather than leaving that to be discovered, every
 * match still in progress at startup is recorded as interrupted, which is what happened: the app was closed
 * while the match was being played.
 * @param {any} state @param {{now?: number}} [options]
 */
function interrupt(state, { now = Date.now() } = {}) {
  const running = state.matches.some(match => match.state === 'active');
  if (!running) return state;
  const matches = state.matches.map(match => {
    if (match.state !== 'active') return match;
    const detail = `Poolside was closed while ${match.handle} was in progress, so it was recorded as interrupted.`;
    return { ...moved(match, 'cancelled', 'interrupted', detail, now), reason: detail, endedAt: stamp(now) };
  });
  return { ...state, matches };
}

function matchView(match) {
  return {
    handle: match.handle,
    matchId: match.matchId,
    participants: match.participants.map(participant => ({ ...participant })),
    state: match.state,
    runId: match.runId || null,
    winnerId: match.winnerId,
    winnerName: match.winnerName,
    reason: match.reason,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    readiness: match.readiness ? { ...match.readiness } : null,
    pairing: match.pairing ? { ...match.pairing } : null,
    history: match.history.slice(-4).map(item => ({ ...item }))
  };
}

/**
 * The dashboard-safe projection: counts, the matches in progress, and the most recent finished ones.
 * @param any state
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
  interrupt,
  requestReadiness,
  settleReadiness,
  recordPairing,
  dashboardView,
  cleanState,
  emptyState,
  FORMAT,
  LEDGER_LIMIT,
  HISTORY_LIMIT,
  STATES,
  READINESS_VERDICTS
};
