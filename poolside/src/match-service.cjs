// Runtime bridge between the workspace accounts and the pure match-coordination engine.
//
// The engine decides; this module holds the ledger, notices when a participant has left the workspace,
// brings each participant's own browser session up when a match starts, writes the file, and tells the
// dashboard. Every mutation publishes, so a match appears, loads, settles and disappears in the
// dashboard while the app is running rather than after a restart.

const crypto = require('node:crypto');
const coordination = require('./match-coordination.cjs');
const runPlan = require('./run-plan.cjs');
const { createBarrier } = require('./match-barrier.cjs');
const { createRunKeeper } = require('./match-runs.cjs');
const { createPairingChecker } = require('./match-pairing.cjs');
const { createDropoutWatcher } = require('./match-dropout.cjs');
const { createMatchLedger } = require('./match-ledger.cjs');
const { createMatchLifecycle } = require('./match-lifecycle.cjs');
const { createReleaseService } = require('./match-release.cjs');
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
  // drift apart.
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

  // Sessions belong to the match, but loading them and proving their exits is a separate job from
  // coordinating the pairing.
  const participants = createParticipantLoader({ store, publish, log, openSession, participant, probeExit });

  // What the two screens amounted to. Judged only after release, and re-judged while it is still unproven,
  // so the verdict improves by itself once the operator has looked at each window.
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

  // A participant whose session is gone. Cancelling goes through the coordinator's own cancel, so a dropout
  // is recorded, counted against the run's plan and published like any other match with no result.
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

  // Settling a match: record the result, then let the run's plan judge it, in one write.
  const lifecycle = createMatchLifecycle({ store, commit, runs, now });

  // Counting the operator in to queue both windows by hand, and measuring the gap their clicks produced.
  // It sends no input to the game: the clicks are the operator's, and this only says how close together they
  // landed, from the two sessions' own screens.
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
    return ledger.view();
  }

  /** @param {{matchId: string}} input */
  async function load({ matchId }) {
    const results = await participants.open(matchId);
    store.current = persist(
      coordination.requestReadiness(store.current, {
        matchId,
        now: now(),
        deadlineMs: readyDeadlineMs,
        reason: 'Release was requested again.'
      })
    );
    barrier.noteRequest(matchId);
    await participants.proveExits(matchId);
    barrier.advance();
    pairing.checkReleased();
    return { ...ledger.view(), load: results };
  }

  /**
   * Create a match, open its participants' sessions, and publish it. `base` lets a run be committed in the
   * same step as its first match, so a match that cannot start does not leave an empty run behind.
   * @param {{first: string, second: string, runId?: string|null, run?: any, base?: any, load?: boolean}} input
   */
  async function openMatch({ first, second, runId = null, run = null, base = null, load: shouldLoad = true }) {
    const from = base || store.current;
    const created = coordination.start(from, { first, second, accounts: roster(), now: now(), matchId: makeId(), runId });
    const opened = created.matches.find(
      match => match.state === 'active' && !from.matches.some(before => before.matchId === match.matchId)
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
    const plan = run ? `${run.handle}: ${runPlan.describe(run.plan)}. ` : '';
    const view = commit(next, `${plan}${opened.participants[0].name} vs ${opened.participants[1].name}: ${opened.handle} is in progress.`);
    if (shouldLoad === false) {
      barrier.syncPoll();
      // The same shape either way: "nothing was asked to load" is a list, not a missing key, so a caller
      // never has to wonder whether it forgot to load or the reply forgot to say.
      return { ...view, load: [] };
    }
    const results = await participants.open(opened.matchId);
    await participants.proveExits(opened.matchId);
    barrier.advance();
    pairing.checkReleased();
    return { ...ledger.view(), load: results };
  }

  /**
   * Start a match. When a run is in progress the match joins it — the run's counters are counted from the
   * matches that carry its id — and a pair that is not the run's pair is refused rather than played beside
   * it. With no run in progress this is the standalone pairing it has always been.
   * @param {{first: string, second: string, load?: boolean}} input
   */
  async function start({ first, second, load: shouldLoad = true }) {
    const bound = runs.binding({ first: text(first, ID_LIMIT), second: text(second, ID_LIMIT) });
    return await openMatch({ first, second, runId: bound.runId, run: bound.run, load: shouldLoad });
  }

  /**
   * Start a run: the plan, and its first match, in one action. Nothing is written unless the match itself
   * can be created, so a refusal here leaves the ledger exactly as it was.
   * @param {{first: string, second: string, plan?: any, load?: boolean}} input
   */
  async function startRun({ first, second, plan, load: shouldLoad = true }) {
    const created = runs.start({ first: text(first, ID_LIMIT), second: text(second, ID_LIMIT), plan });
    return await openMatch({ first, second, runId: created.run.runId, run: created.run, base: created.state, load: shouldLoad });
  }

  /** Stop a run by hand. A match of its still in progress is cancelled with the reason. */
  function stopRun({ runId, reason }) {
    return runs.stopRun({ runId: text(runId, ID_LIMIT), reason });
  }

  /** Hold a run where it is: the match being played is left alone and no further match is started. */
  function pauseRun({ runId, reason }) {
    return runs.pauseRun({ runId: text(runId, ID_LIMIT), reason });
  }

  /** Let a paused run continue, with the time it spent paused taken out of the plan's clock. */
  function resumeRun({ runId }) {
    return runs.resumeRun({ runId: text(runId, ID_LIMIT) });
  }

  /** Stop the barrier check. Used when the app is shutting down and by tests. */
  function dispose() {
    barrier.dispose();
    runs.dispose();
    pairing.dispose();
    dropouts.dispose();
    release.dispose();
  }

  return {
    start,
    startRun,
    stopRun,
    pauseRun,
    resumeRun,
    checkPairing: pairing.command,
    releaseStatus: release.status,
    armRelease: release.armCommand,
    cancelRelease: release.cancelCommand,
    complete: lifecycle.complete,
    cancel: lifecycle.cancel,
    load,
    refresh,
    advance: barrier.advance,
    dispose,
    view: refresh,
    state: () => store.current
  };
}

module.exports = { createMatchService, participantReady };
