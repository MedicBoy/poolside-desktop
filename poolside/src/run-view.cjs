// The dashboard-safe projection of a run.
//
// Split out of `run-coordination.cjs`, which was carrying the run's operations *and* the shape the dashboard
// reads. The counters are counted here from the ledger rather than stored beside it — a stored counter is a
// counter that can disagree with the matches it is counting — and the pause is applied to the clock in
// exactly one place: `run-plan.counters`.

const runPlan = require('./run-plan.cjs');

/** How many finished runs the dashboard shows. */
const VIEW_LIMIT = 5;

/** The counters for one run, pause included. @param {any} state @param {any} run @param {number} now */
function counters(state, run, now) {
  return runPlan.counters({
    matches: state.matches,
    runId: run.runId,
    startedAt: Date.parse(run.startedAt),
    now,
    pausedMs: run.pausedMs,
    pausedAt: run.pausedAt ? Date.parse(run.pausedAt) : null
  });
}

/**
 * One run, as the card receives it.
 * @param {any} run @param {any} counts
 */
function runView(run, counts) {
  return {
    handle: run.handle,
    runId: run.runId,
    participants: run.participants.map(entry => ({ ...entry })),
    plan: { ...run.plan },
    state: run.state,
    paused: run.state === 'paused',
    outcome: run.outcome,
    outcomeLabel: run.outcome ? runPlan.OUTCOMES[run.outcome] || run.outcome : null,
    reason: run.reason,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    pausedAt: run.pausedAt || null,
    progress: {
      played: counts.played,
      completed: counts.completed,
      cancelled: counts.cancelled,
      active: counts.active,
      consecutiveFailures: counts.consecutiveFailures,
      consecutiveUnconfirmed: counts.consecutiveUnconfirmed,
      pausedMs: counts.pausedMs,
      elapsedMs: counts.elapsedMs,
      remainingMs: run.plan.stopAfterMinutes > 0 ? Math.max(0, run.plan.stopAfterMinutes * 60000 - counts.elapsedMs) : null
    },
    describe: runPlan.describe(run.plan),
    bounds: runPlan.bounds(run.plan),
    history: run.history.slice(-4).map(entry => ({ ...entry }))
  };
}

/** The run that has not ended, and the most recent ones that did. @param {any} state @param {number} now */
function view(state, now = Date.now()) {
  const runs = state.runs || [];
  const current = runs.find(run => run.state !== 'ended');
  return {
    active: current ? runView(current, counters(state, current, now)) : null,
    recent: runs
      .filter(run => run.state === 'ended')
      .slice(0, VIEW_LIMIT)
      .map(run => runView(run, counters(state, run, now)))
  };
}

module.exports = { view, runView, counters, VIEW_LIMIT };
