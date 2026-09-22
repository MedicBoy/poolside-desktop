// Runtime bridge between the workspace accounts and the pure match-coordination engine.
//
// This module is the composition root for the coordinator, and nothing else: it builds the pieces — the
// ledger of record, the readiness barrier, the run keeper, the pairing checker, the dropout watcher, the
// hand-queueing count-in, the lifecycle that settles a match, and the job that starts one — and exposes the
// commands the dashboard has. Each of those jobs lives in its own module with its own tests; what is left here
// is the wiring, which is why a reader can see the whole coordinator's shape in one screen.

const crypto = require('node:crypto');
const coordination = require('./match-coordination.cjs');
const { createBarrier } = require('./match-barrier.cjs');
const { createRunKeeper } = require('./match-runs.cjs');
const { createPairingChecker } = require('./match-pairing.cjs');
const { createDropoutWatcher } = require('./match-dropout.cjs');
const { createMatchLedger } = require('./match-ledger.cjs');
const { createMatchLifecycle } = require('./match-lifecycle.cjs');
const { createReleaseService } = require('./match-release.cjs');
const { createMatchStart } = require('./match-start.cjs');
const { createOutcomeRecorder } = require('./match-outcome.cjs');
const { createParticipantLoader } = require('./match-participants.cjs');
const { text, ID_LIMIT } = require('./match-record.cjs');

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
 * @param {{accounts: () => any[]|any[], store: {current: any}, publish: () => void, log: (message: string, kind?: 'info'|'warning') => void, openSession?: ((id: string) => Promise<any>)|null, participant?: ((id: string) => {open: boolean, status: string, footprint?: any})|null, probeExit?: ((id: string) => Promise<any>)|null, observe?: ((id: string) => any)|null, ready?: ((id: string) => boolean)|null, monotonic?: () => number, readyDeadlineMs?: number, readyCheckMs?: number, runCheckMs?: number, pairingWindowMs?: number, pairingCheckMs?: number, releaseTickMs?: number, dropoutGraceMs?: number, dropoutCheckMs?: number, setTimer?: (callback: () => void, delay: number) => any, clearTimer?: (timer: any) => void, journal?: {read: Function, write: Function}|null, now?: () => number, makeId?: () => string}} deps
 */
function createMatchService({
  accounts,
  store,
  publish,
  log,
  openSession = null,
  participant = null,
  probeExit = null,
  observe = null,
  journal = null,
  now = () => Date.now(),
  makeId = () => crypto.randomUUID(),
  ready = null,
  monotonic = () => performance.now(),
  readyDeadlineMs = 120000,
  readyCheckMs = 1000,
  runCheckMs = 30000,
  pairingWindowMs,
  pairingCheckMs = 5000,
  releaseTickMs = 250,
  dropoutGraceMs = 15000,
  dropoutCheckMs = 5000,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = timer => clearInterval(timer)
}) {
  function roster() {
    if (typeof accounts === 'function') return accounts();
    return Array.isArray(accounts) ? accounts : [];
  }

  // The ledger of record. Everything that changes it goes through here, so the file and the dashboard cannot
  // drift apart, and opening it settles what a previous run of the program could not still be holding.
  const ledger = createMatchLedger({ store, journal, log, publish, now });
  const { persist, commit } = ledger;

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

  // Runs: a plan between two accounts, its stop conditions, and the time check that enforces the clock.
  const runs = createRunKeeper({
    store,
    persist,
    commit,
    log,
    publish,
    accounts,
    now,
    makeId,
    runCheckMs,
    setTimer,
    clearTimer
  });

  // Sessions belong to the match, but loading them and proving their exits is a separate job from coordinating
  // the pairing. A participant whose session is gone is the dropout watcher's business.
  const participants = createParticipantLoader({ store, publish, log, openSession, participant, probeExit });

  // What the two screens amounted to. Judged only after release, and re-judged while it is still unproven, so
  // the verdict improves by itself once the operator has looked at each window.
  const pairing = createPairingChecker({
    store,
    persist,
    publish,
    log,
    observe,
    view: () => ledger.view(),
    now,
    windowMs: pairingWindowMs,
    checkMs: pairingCheckMs,
    setTimer,
    clearTimer
  });

  // The balances around a match: read before release, read again when it settles, recorded once.
  const outcomes = createOutcomeRecorder({ store, observe, now });

  // A participant whose session is gone. Cancelling goes through the lifecycle's own cancel, so a dropout is
  // recorded, counted against the run's plan and published like any other match with no result.
  const dropouts = createDropoutWatcher({
    store,
    participant,
    cancel: (matchId, reason) => lifecycle.cancel({ matchId, reason }),
    log,
    now,
    graceMs: dropoutGraceMs,
    checkMs: dropoutCheckMs,
    setTimer,
    clearTimer
  });

  // Settling a match: record the result, the balances it moved, and let the run's plan judge it, in one write.
  const lifecycle = createMatchLifecycle({ store, commit, runs, now, outcomeFor: outcomes.take });

  // Counting the operator in to queue both windows by hand, and measuring the gap their clicks produced.
  const release = createReleaseService({
    store,
    commit,
    log,
    observe,
    view: () => ledger.view(),
    now,
    tickMs: releaseTickMs,
    setTimer,
    clearTimer
  });

  // Starting a match: create it, bring both sessions up, put it in front of the barrier.
  const starter = createMatchStart({
    store,
    commit,
    view: () => ledger.view(),
    coordination,
    participants,
    barrier,
    pairing,
    runs,
    outcomes,
    roster,
    now,
    makeId,
    readyDeadlineMs,
    text,
    idLimit: ID_LIMIT
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
    // A run's clock is a stop condition like any other, so reading the state applies it: the dashboard
    // cannot show a run that its own plan has already ended.
    runs.enforce();
    pairing.checkReleased();
    dropouts.watch();
    // Balances as they stand before release: that is when the screens are on the table screen, and it is the
    // last moment before an entry could be paid.
    outcomes.rememberWaiting();
    return ledger.view();
  }

  /** Stop the checks. Used when the app is shutting down and by tests. */
  function dispose() {
    barrier.dispose();
    runs.dispose();
    pairing.dispose();
    dropouts.dispose();
    release.dispose();
  }

  return {
    start: starter.start,
    startRun: starter.startRun,
    load: starter.load,
    complete: lifecycle.complete,
    cancel: lifecycle.cancel,
    stopRun: runs.stopRun,
    pauseRun: runs.pauseRun,
    resumeRun: runs.resumeRun,
    checkPairing: pairing.command,
    armRelease: release.armCommand,
    cancelRelease: release.cancelCommand,
    releaseStatus: release.status,
    refresh,
    advance: barrier.advance,
    dispose,
    view: refresh,
    state: () => store.current
  };
}

module.exports = { createMatchService, participantReady };
