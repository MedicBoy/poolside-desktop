// What settling a match does: record it, then let the run's plan judge it — in one write.
//
// Split out of `match-service.cjs`. The point of doing both in the same commit is that there is never a
// moment where a run is over and the record does not say so, or where a result is played on past a plan that
// has already stopped. A dropout arrives here too, because a match whose participant's window is gone is
// settled exactly like one that was cancelled by hand.

const coordination = require('./match-coordination.cjs');

/**
 * @param {{store: {current: any}, commit: (state: any, message: string|null) => any, runs: {judge: Function, announce: Function, syncPoll: Function}, now?: () => number}} deps
 */
function createMatchLifecycle({ store, commit, runs, now = () => Date.now() }) {
  /**
   * Record a settled match and judge the run plans against it in one write: the result and the run it ends
   * reach the file and the dashboard together.
   */
  function settle(next, message) {
    const outcome = runs.judge(next);
    const view = commit(outcome.state, message);
    runs.announce(outcome.ended);
    runs.syncPoll();
    return view;
  }

  /** @param {{matchId: string, winner: string}} input */
  function complete({ matchId, winner }) {
    const next = coordination.complete(store.current, { matchId, winner, now: now() });
    const settled = next.matches.find(match => match.matchId === matchId);
    return settle(next, settled ? `${settled.handle}: ${settled.winnerName} recorded as the winner.` : null);
  }

  /** @param {{matchId: string, reason?: string}} input */
  function cancel({ matchId, reason }) {
    const next = coordination.cancel(store.current, { matchId, reason, now: now() });
    const settled = next.matches.find(match => match.matchId === matchId);
    return settle(next, settled ? `${settled.handle}: ${settled.reason}` : null);
  }

  return { complete, cancel, settle };
}

module.exports = { createMatchLifecycle };
