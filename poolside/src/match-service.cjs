// Runtime bridge between the workspace accounts and the pure match-coordination engine.
//
// The engine decides; this module holds the ledger, notices when a participant has left the workspace,
// writes the file, and tells the dashboard. Every mutation publishes, so a match appears, settles and
// disappears in the dashboard while the app is running rather than after a restart.

const crypto = require('node:crypto');
const coordination = require('./match-coordination.cjs');

/**
 * @param {{accounts: () => any[]|any[], store: {current: any}, publish: () => void, log: (message: string, kind?: 'info'|'warning') => void, journal?: {read: Function, write: Function}|null, now?: () => number, makeId?: () => string}} deps
 */
function createMatchService({ accounts, store, publish, log, journal = null, now = () => Date.now(), makeId = () => crypto.randomUUID() }) {
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

  function start({ first, second }) {
    const next = coordination.start(store.current, { first, second, accounts: roster(), now: now(), matchId: makeId() });
    const opened = next.matches.find(
      match => match.state === 'active' && !store.current.matches.some(before => before.matchId === match.matchId)
    );
    return commit(
      next,
      opened ? `${opened.participants[0].name} vs ${opened.participants[1].name}: ${opened.handle} is in progress.` : null
    );
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

  return { start, complete, cancel, refresh, view: refresh, state: () => store.current };
}

module.exports = { createMatchService };
