// Runtime bridge between the workspace accounts and the pure match-coordination engine.
//
// The engine decides; this module holds the ledger, notices when a participant has left the workspace,
// brings each participant's own browser session up when a match starts, writes the file, and tells the
// dashboard. Every mutation publishes, so a match appears, loads, settles and disappears in the
// dashboard while the app is running rather than after a restart.

const crypto = require('node:crypto');
const coordination = require('./match-coordination.cjs');

/**
 * @param {{accounts: () => any[]|any[], store: {current: any}, publish: () => void, log: (message: string, kind?: 'info'|'warning') => void, openSession?: ((id: string) => Promise<any>)|null, journal?: {read: Function, write: Function}|null, now?: () => number, makeId?: () => string}} deps
 */
function createMatchService({
  accounts,
  store,
  publish,
  log,
  openSession = null,
  journal = null,
  now = () => Date.now(),
  makeId = () => crypto.randomUUID()
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

  /**
   * Cancel anything whose participant has left the workspace. Called before every read, so the ledger
   * cannot show a match in progress between an account that is no longer there.
   */
  function refresh() {
    const before = store.current;
    const next = coordination.reconcile(before, roster(), now());
    if (next === before) return coordination.dashboardView(before);
    const wasActive = id => before.matches.find(match => match.matchId === id)?.state === 'active';
    const cancelled = next.matches.filter(match => match.state === 'cancelled' && wasActive(match.matchId));
    store.current = persist(next);
    for (const match of cancelled) log(match.reason, 'warning');
    publish();
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
    return { ...coordination.dashboardView(store.current), load: await openParticipants(matchId) };
  }

  async function start({ first, second, load: shouldLoad = true }) {
    const next = coordination.start(store.current, { first, second, accounts: roster(), now: now(), matchId: makeId() });
    const opened = next.matches.find(
      match => match.state === 'active' && !store.current.matches.some(before => before.matchId === match.matchId)
    );
    const view = commit(
      next,
      opened ? `${opened.participants[0].name} vs ${opened.participants[1].name}: ${opened.handle} is in progress.` : null
    );
    if (!opened || shouldLoad === false) return view;
    return { ...coordination.dashboardView(store.current), load: await openParticipants(opened.matchId) };
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

  return { start, complete, cancel, load, refresh, view: refresh, state: () => store.current };
}

module.exports = { createMatchService };
