// Starting a match, and asking for release again.
//
// Every other job of the coordinator has its own file — the barrier decides release, the lifecycle settles a
// match, the run keeper owns plans, the pairing checker judges evidence, the dropout watcher clears a match
// nobody can play. This is the one that remains: create the match, bring both sessions up, and put it in front
// of the barrier. Split out when `match-service.cjs` reached the size ceiling for the last time.

const runPlan = require('./run-plan.cjs');

/**
 * @param {{store: {current: any}, commit: (state: any, message: string|null) => any, view: () => any, coordination: any, participants: any, barrier: any, pairing: any, runs: any, outcomes: {remember: Function, rememberWaiting: Function}, roster: () => any[], now: () => number, makeId: () => string, readyDeadlineMs: number, text: (value: unknown, max: number) => string, idLimit: number}} deps
 */
function createMatchStart({
  store,
  commit,
  view,
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
  idLimit
}) {
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
    outcomes.remember(opened);
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
    const started = commit(
      next,
      `${plan}${opened.participants[0].name} vs ${opened.participants[1].name}: ${opened.handle} is in progress.`
    );
    if (shouldLoad === false) {
      barrier.syncPoll();
      return { ...started, load: [] };
    }
    const results = await participants.open(opened.matchId);
    await participants.proveExits(opened.matchId);
    barrier.advance();
    pairing.checkReleased();
    return { ...view(), load: results };
  }

  /**
   * Start a match. When a run is in progress the match joins it — the run's counters are counted from the
   * matches that carry its id — and a pair that is not the run's pair is refused rather than played beside it.
   * With no run in progress this is the standalone pairing it has always been.
   * @param {{first: string, second: string, load?: boolean}} input
   */
  async function start({ first, second, load: shouldLoad = true }) {
    const bound = runs.binding({ first: text(first, idLimit), second: text(second, idLimit) });
    return await openMatch({ first, second, runId: bound.runId, run: bound.run, load: shouldLoad });
  }

  /**
   * Start a run: the plan, and its first match, in one action. Nothing is written unless the match itself can
   * be created, so a refusal here leaves the ledger exactly as it was.
   * @param {{first: string, second: string, plan?: any, load?: boolean}} input
   */
  async function startRun({ first, second, plan, load: shouldLoad = true }) {
    const created = runs.start({ first: text(first, idLimit), second: text(second, idLimit), plan });
    return await openMatch({ first, second, runId: created.run.runId, run: created.run, base: created.state, load: shouldLoad });
  }

  /**
   * Bring the participants up again and re-request release. Opening is idempotent — the session manager focuses
   * a window that is already open — and this is also what the operator presses when release was blocked.
   * @param {{matchId: string}} input
   */
  async function load({ matchId }) {
    const results = await participants.open(matchId);
    // `commit` persists and publishes; a release request is not worth an activity entry of its own.
    commit(
      coordination.requestReadiness(store.current, {
        matchId,
        now: now(),
        deadlineMs: readyDeadlineMs,
        reason: 'Release was requested again.'
      }),
      null
    );
    barrier.noteRequest(matchId);
    await participants.proveExits(matchId);
    barrier.advance();
    pairing.checkReleased();
    return { ...view(), load: results };
  }

  return { start, startRun, load, openMatch };
}

module.exports = { createMatchStart };
