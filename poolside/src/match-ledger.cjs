// The ledger of record: the one place the match and run ledger is read, written, published and projected.
//
// Split out of `match-service.cjs`, which was holding the ledger *and* coordinating matches in it. Every
// operation that changes the ledger goes through `commit` here, so "what the file holds" and "what the
// dashboard has been told" cannot drift apart, and a failed write never takes down the action that caused it.

const coordination = require('./match-coordination.cjs');
const runsView = require('./run-view.cjs');

/**
 * @param {{store: {current: any}, journal?: {read: Function, write: Function}|null, log: (message: string, kind?: 'info'|'warning') => void, publish: () => void, now?: () => number}} deps
 */
function createMatchLedger({ store, journal = null, log, publish, now = () => Date.now() }) {
  store.current = journal ? journal.read() : coordination.emptyState();

  /** Write the ledger, and treat a failed write as a warning rather than as the end of the operation. */
  function persist(state) {
    if (!journal) return state;
    try {
      return journal.write(state);
    } catch (error) {
      log(`The match ledger could not be saved: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      return state;
    }
  }

  /** What the dashboard and the IPC replies see: the matches, plus the run that has not ended and recent ones. */
  function view() {
    return { ...coordination.dashboardView(store.current), runs: runsView.view(store.current, now()) };
  }

  /** Persist a change, say what happened, and publish it. Returns the view of the new state. */
  function commit(state, message) {
    store.current = persist(state);
    if (message) log(message);
    publish();
    return view();
  }

  // A match cannot outlive the process that was holding it: the windows went with the process. Left alone, a
  // match the ledger still calls "in progress" blocks both of its accounts forever with nothing on screen to
  // explain it — which is exactly what an operator sees as "I am already in a match" with nothing open. So
  // opening the ledger settles that question: whatever is still in progress is recorded as interrupted.
  const opened = coordination.interrupt(store.current, { now: now() });
  if (opened !== store.current) {
    store.current = persist(opened);
    for (const match of store.current.matches)
      if (match.state === 'cancelled' && /recorded as interrupted\.$/.test(match.reason)) log(match.reason, 'warning');
  }

  return { persist, commit, view };
}

module.exports = { createMatchLedger };
