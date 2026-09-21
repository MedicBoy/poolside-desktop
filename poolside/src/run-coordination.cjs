// Runs: a plan, the matches played under it, and the reasons it stops.
//
// `match-coordination.cjs` owns what a match is and what may happen to one. This module owns the thing
// above it: a run is a plan between two accounts, matches belong to it, and the plan decides when it is
// over. Split out for the same reason the barrier was — the match module was at the module ceiling and
// carrying two jobs — and because a run is a different question from a match: not "is this pair playing?"
// but "should this pair still be playing at all?".
//
// Pure: no Electron, no fs, no clock of its own. The ledger arrives as an argument and leaves as a value.

const coordination = require('./match-coordination.cjs');
const runPlan = require('./run-plan.cjs');
const { RUN_LEDGER_LIMIT, RUN_HISTORY_LIMIT, ID_LIMIT, NAME_LIMIT, TEXT_LIMIT, text, stamp } = require('./match-record.cjs');

/** How many finished runs the dashboard shows. */
const VIEW_LIMIT = 5;

function step(event, detail, at) {
  return { at: stamp(at), event, detail: text(detail, TEXT_LIMIT) };
}

function find(state, handleOrId) {
  const wanted = text(handleOrId, ID_LIMIT);
  return (state.runs || []).find(run => run.runId === wanted || run.handle === wanted) || null;
}

/** The run in progress, or null. One at a time: a second plan would make "the run" ambiguous everywhere. */
function activeRun(state) {
  return (state.runs || []).find(run => run.state === 'active') || null;
}

/** @param {{runs: any[], matches: any[]}} state @param {string} runId @param {number} now */
function countersFor(state, runId, now) {
  const run = find(state, runId);
  if (!run) throw new Error('That run is not in the local ledger.');
  return runPlan.counters({ matches: state.matches, runId: run.runId, startedAt: Date.parse(run.startedAt), now });
}

/** The run a match belongs to, or null. */
function runOf(state, matchId) {
  const match = (state.matches || []).find(candidate => candidate.matchId === matchId);
  return match && match.runId ? find(state, match.runId) : null;
}

/**
 * The run that keeps this pair together, or null when they are not in one. A pair that is not the run's
 * pair is refused rather than quietly played beside it, because a ledger that mixes an unrelated match
 * into a run's counters stops being a record of the plan.
 * @param {{runs: any[]}} state
 * @param {{first: string, second: string}} pair
 */
function binding(state, { first, second }) {
  const run = activeRun(state);
  if (!run) return { runId: null, run: null };
  const ids = run.participants.map(entry => entry.id);
  if (!ids.includes(first) || !ids.includes(second))
    throw new Error(
      `${run.handle} is between ${run.participants.map(entry => entry.name).join(' and ')}. Stop the run before pairing other accounts.`
    );
  return { runId: run.runId, run };
}

/** @param {any} account */
function participant(account) {
  return {
    id: text(account.id, ID_LIMIT),
    name: text(account.name, NAME_LIMIT) || 'Unnamed account',
    role: account.role === 'sender' ? 'sender' : 'receiver'
  };
}

/**
 * Begin a run. The plan is validated before anything is recorded, so a run that exists is a run whose stop
 * conditions can be enforced.
 * @param {{format: string, runSequence: number, runs: any[]}} state
 * @param {{first: string, second: string, accounts: any[], plan?: any, now?: number, runId: string}} input
 */
function start(state, { first, second, accounts, plan: submitted, now = Date.now(), runId }) {
  const running = activeRun(state);
  if (running)
    throw new Error(
      `${running.handle} is already in progress (${running.participants.map(entry => entry.name).join(' vs ')}). Stop it before starting another.`
    );
  if (!first || !second) throw new Error('Choose two accounts for the run.');
  if (first === second) throw new Error('A run needs two different accounts.');
  const chosen = [first, second].map(id => {
    const account = (Array.isArray(accounts) ? accounts : []).find(
      candidate => candidate && candidate.id === id && candidate.archived !== true
    );
    if (!account) throw new Error('That account is no longer an active account.');
    return participant(account);
  });
  const value = runPlan.plan(submitted);
  const runSequence = (Number.isInteger(state.runSequence) ? state.runSequence : 0) + 1;
  const record = {
    handle: `r${runSequence}`,
    runId: text(runId, ID_LIMIT),
    participants: chosen,
    plan: value,
    state: 'active',
    outcome: null,
    reason: '',
    startedAt: stamp(now),
    endedAt: null,
    history: []
  };
  if (!record.runId) throw new Error('A run identity could not be created.');
  const opened = {
    ...record,
    history: [step('started', runPlan.describe(value), now)]
  };
  return { ...state, runSequence, runs: [opened, ...(state.runs || [])].slice(0, RUN_LEDGER_LIMIT) };
}

/**
 * End a run: mark it ended, and cancel a match of its that is still in progress. A run that has stopped
 * with a match still being prepared would be a plan the program is not actually enforcing.
 * @param {any} state
 * @param {{runId: string, outcome: string, reason: string, now?: number}} input
 */
function end(state, { runId, outcome, reason, now = Date.now() }) {
  const run = find(state, runId);
  if (!run) throw new Error('That run is not in the local ledger.');
  if (run.state !== 'active') throw new Error('That run has already ended.');
  const ended = {
    ...run,
    state: 'ended',
    outcome,
    reason: text(reason, TEXT_LIMIT) || (outcome === 'limit' ? 'The plan was completed.' : 'The run was stopped.'),
    endedAt: stamp(now),
    history: [...run.history, step('ended', reason, now)].slice(-RUN_HISTORY_LIMIT)
  };
  let next = { ...state, runs: state.runs.map(candidate => (candidate.runId === run.runId ? ended : candidate)) };
  const live = state.matches.find(match => match.state === 'active' && match.runId === run.runId);
  if (live)
    next = coordination.cancel(next, {
      matchId: live.matchId,
      reason: `${run.handle} ended: ${ended.reason}`,
      now
    });
  return next;
}

/** Stop the run by hand. @param {any} state @param {{runId: string, reason?: string, now?: number}} input */
function stop(state, { runId, reason, now = Date.now() }) {
  const run = find(state, runId);
  if (!run) throw new Error('That run is not in the local ledger.');
  if (run.state !== 'active') throw new Error(`That run has already ended (${run.handle}: ${run.reason}).`);
  return end(state, { runId: run.runId, outcome: 'stopped', reason: text(reason, TEXT_LIMIT) || 'Stopped by the operator.', now });
}

/**
 * Apply every active run's plan to what has happened, and end the ones that are over.
 *
 * Called after anything that could change the answer — a match settling, a read of the dashboard, or the
 * run's own check — so the stop is enforced by the program rather than noticed by the operator afterwards.
 * @param {any} state
 * @param {{accounts?: any[]|null, now?: number}} input
 * @returns {{state: any, ended: any[]}}
 */
function enforce(state, { accounts = null, now = Date.now() } = {}) {
  let next = state;
  /** @type {any[]} */
  const ended = [];
  for (const run of (state.runs || []).filter(candidate => candidate.state === 'active')) {
    const available = Array.isArray(accounts)
      ? accounts.filter(account => account && account.archived !== true).map(account => account.id)
      : null;
    const missing = available ? run.participants.find(entry => !available.includes(entry.id)) : null;
    const counts = runPlan.counters({ matches: state.matches, runId: run.runId, startedAt: Date.parse(run.startedAt), now });
    const judgement = runPlan.verdict(run.plan, counts);
    // A participant leaving the workspace stops the run whatever the plan says: there is nobody left to
    // play the next match with, and the counters cannot continue.
    const stop = missing
      ? { outcome: 'participants', reason: `${missing.name} is no longer an active account, so ${run.handle} was stopped.` }
      : judgement.continue === false
        ? { outcome: judgement.outcome, reason: judgement.reason }
        : null;
    if (stop) {
      next = end(next, { runId: run.runId, outcome: stop.outcome, reason: stop.reason, now });
      ended.push(
        runView(
          next.runs.find(candidate => candidate.runId === run.runId),
          runPlan.counters({ matches: next.matches, runId: run.runId, startedAt: Date.parse(run.startedAt), now })
        )
      );
    }
  }
  return { state: next, ended };
}

function runView(run, counts) {
  return {
    handle: run.handle,
    runId: run.runId,
    participants: run.participants.map(entry => ({ ...entry })),
    plan: { ...run.plan },
    state: run.state,
    outcome: run.outcome,
    outcomeLabel: run.outcome ? runPlan.OUTCOMES[run.outcome] || run.outcome : null,
    reason: run.reason,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    progress: {
      played: counts.played,
      completed: counts.completed,
      cancelled: counts.cancelled,
      active: counts.active,
      consecutiveFailures: counts.consecutiveFailures,
      elapsedMs: counts.elapsedMs,
      remainingMs: run.plan.stopAfterMinutes > 0 ? Math.max(0, run.plan.stopAfterMinutes * 60000 - counts.elapsedMs) : null
    },
    describe: runPlan.describe(run.plan),
    bounds: runPlan.bounds(run.plan),
    history: run.history.slice(-4).map(entry => ({ ...entry }))
  };
}

/** The dashboard-safe projection: the run in progress, and the most recent ones that ended. */
function view(state, now = Date.now()) {
  const counts = run => runPlan.counters({ matches: state.matches, runId: run.runId, startedAt: Date.parse(run.startedAt), now });
  const runs = state.runs || [];
  const active = runs.find(run => run.state === 'active');
  return {
    active: active ? runView(active, counts(active)) : null,
    recent: runs
      .filter(run => run.state !== 'active')
      .slice(0, VIEW_LIMIT)
      .map(run => runView(run, counts(run)))
  };
}

/** The run, or a refusal that says what happened to it. @param {any} state @param {string} runId */
function requireActive(state, runId) {
  const run = find(state, runId);
  if (!run) throw new Error('That run is not in the local ledger.');
  if (run.state !== 'active') throw new Error(`${run.handle} has ended: ${run.reason}`);
  return run;
}

module.exports = { start, stop, end, enforce, view, binding, activeRun, runOf, find, countersFor, requireActive, VIEW_LIMIT };
