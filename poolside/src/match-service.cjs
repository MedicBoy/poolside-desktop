// Runtime bridge between the workspace accounts and the pure match-coordination engine.
//
// The engine decides; this module holds the ledger, notices when a participant has left the workspace,
// brings each participant's own browser session up when a match starts, writes the file, and tells the
// dashboard. Every mutation publishes, so a match appears, loads, settles and disappears in the
// dashboard while the app is running rather than after a restart.

const crypto = require('node:crypto');
const coordination = require('./match-coordination.cjs');
const { createBarrier } = require('./match-barrier.cjs');
const { routeVerdict } = require('./match-preflight.cjs');

/**
 * Whether a participant is actually ready to be released: its own window is up AND its session
 * reached `ready`. Defined once, here, so the barrier that gates release and the dashboard that
 * explains it cannot disagree about what ready means.
 * @param {{open: boolean, status: string}} session
 */
function participantReady({ open, status }) {
  return Boolean(open && status === 'ready');
}

/**
 * @param {{accounts: () => any[]|any[], store: {current: any}, publish: () => void, log: (message: string, kind?: 'info'|'warning') => void, openSession?: ((id: string) => Promise<any>)|null, participant?: ((id: string) => {open: boolean, status: string, footprint?: any})|null, probeExit?: ((id: string) => Promise<any>)|null, ready?: ((id: string) => boolean)|null, monotonic?: () => number, readyDeadlineMs?: number, readyCheckMs?: number, setTimer?: (callback: () => void, delay: number) => any, clearTimer?: (timer: any) => void, journal?: {read: Function, write: Function}|null, now?: () => number, makeId?: () => string}} deps
 */
function createMatchService({
  accounts,
  store,
  publish,
  log,
  openSession = null,
  participant = null,
  probeExit = null,
  journal = null,
  now = () => Date.now(),
  makeId = () => crypto.randomUUID(),
  ready = null,
  monotonic = () => performance.now(),
  readyDeadlineMs = 120000,
  readyCheckMs = 1000,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = timer => clearInterval(timer)
}) {
  function roster() {
    if (typeof accounts === 'function') return accounts();
    return Array.isArray(accounts) ? accounts : [];
  }

  function persist(state) {
    if (!journal) return state;
    try {
      return journal.write(state);
    } catch (error) {
      log(`The match ledger could not be saved: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      return state;
    }
  }

  function commit(state, message) {
    store.current = persist(state);
    if (message) log(message);
    publish();
    return coordination.dashboardView(store.current);
  }

  store.current = journal ? journal.read() : coordination.emptyState();

  // The barrier: when this match may be released, and when release must be withdrawn. It owns the check
  // loop and the monotonic marks; the rules live in `match-barrier.cjs` and `match-preflight.cjs`.
  const barrier = createBarrier({
    store,
    persist,
    log,
    publish,
    participant,
    ready,
    now,
    monotonic,
    readyDeadlineMs,
    readyCheckMs,
    setTimer,
    clearTimer
  });

  /**
   * Cancel anything whose participant has left the workspace. Called before every read, so the ledger
   * cannot show a match in progress between an account that is no longer there.
   */
  function refresh() {
    const before = store.current;
    const next = coordination.reconcile(before, roster(), now());
    if (next !== before) {
      const wasActive = id => before.matches.find(match => match.matchId === id)?.state === 'active';
      const cancelled = next.matches.filter(match => match.state === 'cancelled' && wasActive(match.matchId));
      store.current = persist(next);
      for (const match of cancelled) log(match.reason, 'warning');
      publish();
    }
    barrier.advance();
    return coordination.dashboardView(store.current);
  }

  /**
   * Bring up every participant's own browser session. Opening is idempotent — the session manager
   * focuses a window that is already open rather than creating a second one — and one participant
   * failing to load never stops the other. The failure is logged and reported rather than swallowed,
   * because a match whose participants are not loaded is not a match the operator can play.
   * @param {string} matchId
   */
  async function openParticipants(matchId) {
    const match = store.current.matches.find(candidate => candidate.matchId === matchId);
    if (!match) throw new Error('That match is not in the local ledger.');
    if (match.state !== 'active') throw new Error('That match is no longer active.');
    if (typeof openSession !== 'function') {
      log(`${match.handle}: this build cannot open participant sessions, so nothing was loaded.`, 'warning');
      return [];
    }
    const results = await Promise.all(
      match.participants.map(async participant => {
        try {
          await openSession(participant.id);
          return { id: participant.id, name: participant.name, opened: true, error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`${participant.name}: the session could not be opened for ${match.handle} (${message}).`, 'warning');
          return { id: participant.id, name: participant.name, opened: false, error: message };
        }
      })
    );
    publish();
    if (results.every(result => result.opened)) log(`${match.handle}: both sessions are loading.`);
    return results;
  }

  /** @param {{matchId: string}} input */
  async function load({ matchId }) {
    const results = await openParticipants(matchId);
    store.current = persist(
      coordination.requestReadiness(store.current, {
        matchId,
        now: now(),
        deadlineMs: readyDeadlineMs,
        reason: 'Release was requested again.'
      })
    );
    barrier.noteRequest(matchId);
    await proveExits(matchId);
    barrier.advance();
    return { ...coordination.dashboardView(store.current), load: results };
  }

  /**
   * Read the address each participant leaves through — but only where a route is configured, because that
   * is the only case where the address proves something (that the route is doing what it says). With no
   * route there is nothing to prove and nothing is requested, which is also what keeps the offline checks
   * offline. A failure here is not fatal on its own: the barrier sees no exit and decides.
   * @param {string} matchId
   */
  async function proveExits(matchId) {
    if (typeof probeExit !== 'function' || typeof participant !== 'function') return;
    const match = store.current.matches.find(candidate => candidate.matchId === matchId);
    if (!match || match.state !== 'active') return;
    await Promise.all(
      match.participants.map(async entry => {
        try {
          if (!routeVerdict(participant(entry.id) && participant(entry.id).footprint).required) return;
          await probeExit(entry.id);
        } catch (error) {
          log(`${entry.name}: the exit address could not be read (${error instanceof Error ? error.message : String(error)}).`, 'warning');
        }
      })
    );
  }

  async function start({ first, second, load: shouldLoad = true }) {
    const created = coordination.start(store.current, { first, second, accounts: roster(), now: now(), matchId: makeId() });
    const opened = created.matches.find(
      match => match.state === 'active' && !store.current.matches.some(before => before.matchId === match.matchId)
    );
    if (!opened) throw new Error('The match could not be created.');
    // The barrier exists from the moment the match does, so a restart never finds an active match with
    // no readiness deadline attached to it.
    const next = coordination.requestReadiness(created, {
      matchId: opened.matchId,
      now: now(),
      deadlineMs: readyDeadlineMs,
      reason: 'Waiting for both participants to load.'
    });
    barrier.noteRequest(opened.matchId);
    const view = commit(next, `${opened.participants[0].name} vs ${opened.participants[1].name}: ${opened.handle} is in progress.`);
    if (shouldLoad === false) {
      barrier.syncPoll();
      return view;
    }
    const results = await openParticipants(opened.matchId);
    await proveExits(opened.matchId);
    barrier.advance();
    return { ...coordination.dashboardView(store.current), load: results };
  }

  function complete({ matchId, winner }) {
    const next = coordination.complete(store.current, { matchId, winner, now: now() });
    const settled = next.matches.find(match => match.matchId === matchId);
    return commit(next, settled ? `${settled.handle}: ${settled.winnerName} recorded as the winner.` : null);
  }

  function cancel({ matchId, reason }) {
    const next = coordination.cancel(store.current, { matchId, reason, now: now() });
    const settled = next.matches.find(match => match.matchId === matchId);
    return commit(next, settled ? `${settled.handle}: ${settled.reason}` : null);
  }

  /** Stop the barrier check. Used when the app is shutting down and by tests. */
  function dispose() {
    barrier.dispose();
  }

  return { start, complete, cancel, load, refresh, advance: barrier.advance, dispose, view: refresh, state: () => store.current };
}

module.exports = { createMatchService, participantReady };
