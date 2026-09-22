// The run keeper: the wiring between the run rules and the running application.
//
// `run-coordination.cjs` decides what a run is and when it is over, and knows nothing about stores, files or
// clocks. This module holds the ledger, persists and publishes what changes, says so in the activity log,
// and keeps a check running while a run has a time limit so the stop happens on time rather than the next
// time somebody presses a button. Same split as the readiness barrier, for the same reason.

const crypto = require('node:crypto');
const runs = require('./run-coordination.cjs');

/**
 * @param {{store: {current: any}, persist: (state: any) => any, commit: (state: any, message: string|null) => any, log: (message: string, kind?: 'info'|'warning') => void, publish: () => void, accounts: () => any[]|any[], now?: () => number, makeId?: () => string, runCheckMs?: number, setTimer?: (callback: () => void, delay: number) => any, clearTimer?: (timer: any) => void}} deps
 */
function createRunKeeper({
  store,
  persist,
  commit,
  log,
  publish,
  accounts,
  now = () => Date.now(),
  makeId = () => crypto.randomUUID(),
  runCheckMs = 30000,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = timer => clearInterval(timer)
}) {
  /** @type {any} */
  let poll = null;

  function roster() {
    if (typeof accounts === 'function') return accounts();
    return Array.isArray(accounts) ? accounts : [];
  }

  /**
   * A run with a time limit has to be checked by the clock, not by the operator. A run with no time limit
   * needs no timer: its stop conditions are all decided by matches settling. A paused run needs no timer
   * either — its clock is not running, so there is nothing for the clock to reach.
   */
  function syncPoll() {
    const active = runs.activeRun(store.current);
    const timed = Boolean(active && active.state === 'active' && active.plan.stopAfterMinutes > 0);
    if (timed && !poll) {
      poll = setTimer(() => {
        try {
          enforce();
        } catch (error) {
          log(`The run could not be checked: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        }
      }, runCheckMs);
      if (poll && typeof poll.unref === 'function') poll.unref();
    }
    if (!timed && poll) {
      clearTimer(poll);
      poll = null;
    }
  }

  /**
   * Apply every active run's plan to a ledger, without writing anything. The caller decides when that
   * becomes the ledger of record, so a settled match and the run it ends are one write rather than two.
   * @param {any} state
   * @returns {{state: any, ended: any[]}}
   */
  function judge(state) {
    return runs.enforce(state, { accounts: roster(), now: now() });
  }

  /**
   * Apply every active run's plan to the ledger of record. Returns the runs that ended, so the caller can
   * put the outcome in the reply as well as in the activity log.
   */
  function enforce() {
    const outcome = judge(store.current);
    if (outcome.state !== store.current) {
      store.current = persist(outcome.state);
      announce(outcome.ended);
      publish();
    }
    syncPoll();
    return outcome.ended;
  }

  /** Say in the activity log what ended a run, at the level the outcome deserves. */
  function announce(ended) {
    for (const run of ended) log(`${run.handle}: ${run.reason}`, run.outcome === 'limit' ? 'info' : 'warning');
  }

  /**
   * A run and the ledger it was recorded in, uncommitted. The caller commits it together with the first
   * match, so a match that cannot be started does not leave an empty run behind.
   * @param {{first: string, second: string, plan?: any}} input
   */
  function start({ first, second, plan }) {
    const state = runs.start(store.current, { first, second, accounts: roster(), plan, now: now(), runId: makeId() });
    return { state, run: runs.activeRun(state) };
  }

  /** End a run by hand, and hand back the ledger and the run that ended. */
  function stop({ runId, reason }) {
    const state = runs.stop(store.current, { runId, reason, now: now() });
    return { state, run: runs.find(state, runId) };
  }

  /** Hold the run where it is: no further match is started, and the one in progress is left alone. */
  function pause({ runId, reason }) {
    const state = runs.pause(store.current, { runId, reason, now: now() });
    return { state, run: runs.find(state, runId) };
  }

  /** Let the run continue, with the time it spent paused taken out of the plan's clock. */
  function resume({ runId }) {
    const state = runs.resume(store.current, { runId, now: now() });
    return { state, run: runs.find(state, runId) };
  }

  /** The three commands the operator has: each commits in one write and says what happened in one voice. */
  function stopRun({ runId, reason }) {
    const stopped = stop({ runId, reason });
    const view = commit(stopped.state, `${stopped.run.handle} stopped: ${stopped.run.reason}`);
    syncPoll();
    return view;
  }

  function pauseRun({ runId, reason }) {
    const held = pause({ runId, reason });
    const view = commit(held.state, `${held.run.handle} paused: ${held.run.reason}`);
    syncPoll();
    return view;
  }

  function resumeRun({ runId }) {
    const going = resume({ runId });
    const view = commit(going.state, `${going.run.handle} resumed.`);
    syncPoll();
    return view;
  }

  /** Stop the check. Used when the app is shutting down and by tests. */
  function dispose() {
    if (poll) clearTimer(poll);
    poll = null;
  }

  return {
    start,
    stop,
    pause,
    resume,
    stopRun,
    pauseRun,
    resumeRun,
    judge,
    enforce,
    announce,
    syncPoll,
    dispose,
    view: () => runs.view(store.current, now()),
    binding: pair => runs.binding(store.current, pair),
    requireActive: runId => runs.requireActive(store.current, runId)
  };
}

module.exports = { createRunKeeper };
