// Runs: the plan above the matches. What may start, what belongs to a run, and every reason one stops.

const test = require('node:test');
const assert = require('node:assert/strict');
const coordination = require('../src/match-coordination.cjs');
const runs = require('../src/run-coordination.cjs');

const ACCOUNTS = [
  { id: 'a', name: 'Alice', role: 'receiver' },
  { id: 'b', name: 'Bob', role: 'sender' },
  { id: 'c', name: 'Cleo', role: 'sender' },
  { id: 'z', name: 'Zed', role: 'receiver', archived: true }
];
const AT = Date.parse('2026-09-21T12:00:00.000Z');
const PLAN = { table: 'Rome', matchLimit: 2, stopAfterFailures: 2, stopAfterMinutes: 60 };

/** A ledger with one run in it, and the pair it is between. */
function opened(plan = PLAN, now = AT) {
  const state = runs.start(coordination.emptyState(), { first: 'a', second: 'b', accounts: ACCOUNTS, plan, now, runId: 'run-1' });
  return { state, runId: runs.activeRun(state).runId };
}

/** Start a match that belongs to the run, the way the service does when a run is in progress. */
function began(state, runId, matchId, now = AT) {
  return coordination.start(state, { first: 'a', second: 'b', accounts: ACCOUNTS, now, matchId, runId });
}

/** The run in progress, as the card receives it. @param {any} state */
function active(state, now = AT) {
  return /** @type {any} */ (runs.view(state, now).active);
}

test('a run records the plan, the pair and the roles it is between', () => {
  const { state } = opened();
  const run = active(state);
  assert.equal(run.handle, 'r1');
  assert.equal(run.state, 'active');
  assert.deepEqual(
    run.participants.map(entry => [entry.name, entry.role]),
    [
      ['Alice', 'receiver'],
      ['Bob', 'sender']
    ]
  );
  assert.equal(run.plan.table, 'Rome');
  assert.match(run.describe, /Up to 2 matches with a recorded result on Rome/);
  assert.deepEqual(run.progress, {
    played: 0,
    completed: 0,
    cancelled: 0,
    active: 0,
    consecutiveFailures: 0,
    consecutiveUnconfirmed: 0,
    pausedMs: 0,
    elapsedMs: 0,
    remainingMs: 60 * 60000
  });
  assert.deepEqual(runs.view(state, AT).recent, []);
});

test('a run is between one pair, and only one run runs at a time', () => {
  const { state, runId } = opened();
  assert.throws(
    () => runs.start(state, { first: 'c', second: 'b', accounts: ACCOUNTS, plan: PLAN, now: AT, runId: 'run-2' }),
    /already in progress \(Alice vs Bob\)/
  );
  assert.throws(
    () => runs.start(state, { first: 'a', second: 'c', accounts: ACCOUNTS, plan: PLAN, now: AT, runId: 'run-2' }),
    /already in progress/
  );
  assert.throws(
    () => runs.start(coordination.emptyState(), { first: 'a', second: 'a', accounts: ACCOUNTS, plan: PLAN, now: AT, runId: 'run-2' }),
    /two different accounts/
  );
  assert.throws(
    () => runs.start(coordination.emptyState(), { first: 'a', second: 'z', accounts: ACCOUNTS, plan: PLAN, now: AT, runId: 'run-2' }),
    /no longer an active account/
  );

  // The pair that belongs to the run is bound to it; any other pair is refused, because a match played
  // beside a run would still be counted by anything that counts the ledger.
  assert.equal(runs.binding(state, { first: 'b', second: 'a' }).runId, runId);
  assert.throws(
    () => runs.binding(state, { first: 'a', second: 'c' }),
    /r1 is between Alice and Bob\. Stop the run before pairing other accounts\./
  );

  const after = runs.stop(state, { runId, now: AT });
  assert.equal(runs.binding(after, { first: 'a', second: 'c' }).runId, null, 'with no run in progress a pair is free again');
});

test('the plan is met when its matches have results, and the run ends saying so', () => {
  const { state: openedState, runId } = opened();
  let state = began(openedState, runId, 'm1');
  state = coordination.complete(state, { matchId: 'm1', winner: 'a', now: AT + 1000 });
  let outcome = runs.enforce(state, { accounts: ACCOUNTS, now: AT + 1000 });
  assert.deepEqual(outcome.ended, [], 'one of two matches is not the plan');
  assert.equal(active(outcome.state, AT + 1000).progress.completed, 1);

  state = began(outcome.state, runId, 'm2', AT + 2000);
  state = coordination.complete(state, { matchId: 'm2', winner: 'b', now: AT + 3000 });
  outcome = runs.enforce(state, { accounts: ACCOUNTS, now: AT + 3000 });
  assert.equal(outcome.ended.length, 1);
  assert.equal(outcome.ended[0].state, 'ended');
  assert.equal(outcome.ended[0].outcome, 'limit');
  assert.equal(outcome.ended[0].outcomeLabel, 'Match limit reached');
  assert.equal(runs.view(outcome.state, AT + 3000).active, null);
  assert.equal(runs.view(outcome.state, AT + 3000).recent[0].progress.completed, 2);
});

test('matches in a row with no result stop the run', () => {
  const { state: openedState, runId } = opened({ ...PLAN, matchLimit: 10, stopAfterFailures: 2 });
  let state = began(openedState, runId, 'm1');
  state = coordination.cancel(state, { matchId: 'm1', reason: 'no table was free', now: AT + 1000 });
  assert.deepEqual(runs.enforce(state, { accounts: ACCOUNTS, now: AT + 1000 }).ended, []);
  state = began(state, runId, 'm2', AT + 2000);
  state = coordination.cancel(state, { matchId: 'm2', reason: 'no table was free', now: AT + 3000 });
  const outcome = runs.enforce(state, { accounts: ACCOUNTS, now: AT + 3000 });
  assert.equal(outcome.ended[0].outcome, 'failures');
  assert.match(outcome.ended[0].reason, /2 matches in a row ended with no result, and the plan stops after 2\./);
});

test('the time limit ends the run and cancels the match it was still holding', () => {
  const { state: openedState, runId } = opened({ ...PLAN, matchLimit: 10, stopAfterMinutes: 30 });
  const state = began(openedState, runId, 'm1');
  const early = runs.enforce(state, { accounts: ACCOUNTS, now: AT + 29 * 60000 });
  assert.deepEqual(early.ended, [], 'the plan has not run out yet');
  const paused = runs.stop(early.state, { runId, reason: 'the operator stopped it', now: AT + 29 * 60000 });
  assert.equal(runs.view(paused, AT).active, null);

  const outcome = runs.enforce(state, { accounts: ACCOUNTS, now: AT + 31 * 60000 });
  assert.equal(outcome.ended[0].outcome, 'duration');
  const settled = /** @type {any} */ (outcome.state.matches.find(match => match.matchId === 'm1'));
  assert.equal(settled.state, 'cancelled', 'a run that has stopped does not leave a match in progress');
  assert.match(settled.reason, /r1 ended: The plan allowed 30 minutes, and 31 minutes have passed\./);
});

test('a participant leaving the workspace stops the run that needed them', () => {
  const { state: openedState, runId } = opened({ ...PLAN, matchLimit: 10 });
  const state = began(openedState, runId, 'm1');
  const outcome = runs.enforce(state, { accounts: ACCOUNTS.filter(account => account.id !== 'b'), now: AT + 1000 });
  assert.equal(outcome.ended[0].outcome, 'participants');
  assert.match(outcome.ended[0].reason, /Bob is no longer an active account, so r1 was stopped\./);
});

test('stopping a run by hand is recorded with the reason, and a run cannot be ended twice', () => {
  const { state: openedState, runId } = opened();
  const stopped = runs.stop(openedState, { runId, reason: 'the tables were busy', now: AT + 5000 });
  const run = runs.view(stopped, AT + 5000).recent[0];
  assert.equal(run.outcome, 'stopped');
  assert.equal(run.reason, 'the tables were busy');
  assert.equal(run.endedAt, new Date(AT + 5000).toISOString());
  assert.throws(() => runs.stop(stopped, { runId, now: AT + 6000 }), /already ended \(r1: the tables were busy\)/);
  assert.throws(() => runs.requireActive(stopped, runId), /r1 has ended: the tables were busy/);
  assert.throws(() => runs.requireActive(stopped, 'nobody'), /not in the local ledger/);
  // The default wording is used when the operator stops it without saying why.
  const { state: again, runId: second } = opened();
  assert.equal(runs.view(runs.stop(again, { runId: second, now: AT }), AT).recent[0].reason, 'Stopped by the operator.');
});

test('a paused run starts nothing, keeps its pair, and does not spend its own clock', () => {
  const { state: openedState, runId } = opened();
  // Something is in progress when the pause arrives: a pause is not a cancel, so it is left alone.
  const withMatch = began(openedState, runId, 'm1');
  const held = runs.pause(withMatch, { runId, now: AT + 60000 });
  assert.equal(active(held, AT + 60000).state, 'paused');
  assert.equal(active(held, AT + 60000).paused, true);
  assert.equal(held.matches[0].state, 'active', 'the match in progress was not interrupted');
  assert.match(active(held, AT + 60000).reason, /Paused by the operator\. No further match will be started\./);
  assert.throws(
    () => runs.binding(held, { first: 'a', second: 'b' }),
    /r1 is paused\. Resume it before starting the next match, or stop the run\./
  );
  assert.throws(
    () => runs.start(held, { first: 'a', second: 'b', accounts: ACCOUNTS, plan: PLAN, now: AT + 70000, runId: 'run-2' }),
    /r1 is paused\. Resume it or stop it before starting another run\./
  );
  assert.throws(() => runs.pause(held, { runId, now: AT + 70000 }), /r1 is already paused\./);

  // Two minutes on hold, then resumed: the plan's clock does not count the pause.
  const going = runs.resume(held, { runId, now: AT + 180000 });
  assert.equal(active(going).state, 'active');
  assert.equal(runs.binding(going, { first: 'b', second: 'a' }).runId, runId, "the pair is still the run's pair");
  assert.equal(runs.countersFor(going, runId, AT + 240000).elapsedMs, 240000 - 120000);
  assert.equal(runs.countersFor(going, runId, AT + 240000).pausedMs, 120000);
  assert.throws(() => runs.resume(going, { runId, now: AT + 250000 }), /r1 is not paused\./);
  assert.throws(() => runs.resume(runs.stop(going, { runId, now: AT + 250000 }), { runId, now: AT + 260000 }), /has already ended/);
});

test('a paused run is not ended by its own plan, but is ended when a participant leaves', () => {
  const { state: openedState, runId } = opened({ ...PLAN, matchLimit: 10, stopAfterMinutes: 30 });
  const held = runs.pause(openedState, { runId, now: AT + 1000 });
  // Well past the time limit: a pause freezes what the plan measures, so nothing fires.
  assert.deepEqual(runs.enforce(held, { accounts: ACCOUNTS, now: AT + 90 * 60000 }).ended, []);
  // Someone archiving an account is different: there is nobody left to play with.
  const left = runs.enforce(held, { accounts: ACCOUNTS.filter(account => account.id !== 'b'), now: AT + 90 * 60000 });
  assert.equal(left.ended[0].outcome, 'participants');
});

test('stopping a paused run banks the pause, so the record says how long the plan really ran', () => {
  const { state: openedState, runId } = opened();
  const held = runs.pause(openedState, { runId, now: AT + 30000 });
  const stopped = runs.stop(held, { runId, reason: 'the tables were busy', now: AT + 90000 });
  const run = runs.view(stopped, AT + 90000).recent[0];
  assert.equal(run.state, 'ended');
  assert.equal(run.outcome, 'stopped');
  assert.equal(run.progress.pausedMs, 60000);
  assert.equal(run.progress.elapsedMs, 30000, 'the 60 seconds on hold are not part of the run');
});

test('a run of results without a confirmed pairing stops, so the operator is asked to look', () => {
  const { state: openedState, runId } = opened({ ...PLAN, matchLimit: 10, stopAfterFailures: 0, stopAfterUnconfirmed: 2 });
  let state = began(openedState, runId, 'm1');
  state = coordination.complete(state, { matchId: 'm1', winner: 'a', now: AT + 1000 });
  assert.deepEqual(runs.enforce(state, { accounts: ACCOUNTS, now: AT + 1000 }).ended, [], 'one unconfirmed result is a retry');
  state = began(state, runId, 'm2', AT + 2000);
  state = coordination.complete(state, { matchId: 'm2', winner: 'b', now: AT + 3000 });
  const outcome = runs.enforce(state, { accounts: ACCOUNTS, now: AT + 3000 });
  assert.equal(outcome.ended[0].outcome, 'unconfirmed');
  assert.match(outcome.ended[0].reason, /2 matches in a row ended without a confirmed pairing, and the plan stops after 2\./);
  assert.equal(outcome.ended[0].outcomeLabel, 'Stopped: results without a confirmed pairing');
  // A confirmed pairing in the middle is what resets the streak, which is the difference between "this keeps
  // failing" and "this worked once and then did not".
  let streak = opened({ ...PLAN, matchLimit: 10, stopAfterFailures: 0, stopAfterUnconfirmed: 2 }).state;
  const runId2 = runs.activeRun(streak).runId;
  streak = began(streak, runId2, 'm3');
  streak = coordination.recordPairing(streak, {
    matchId: 'm3',
    pairing: {
      verdict: 'paired',
      label: 'Same entry seen on both accounts',
      reason: 'Both accounts paid.',
      checkedAt: new Date(AT).toISOString()
    },
    now: AT + 1000
  });
  streak = coordination.complete(streak, { matchId: 'm3', winner: 'a', now: AT + 2000 });
  assert.deepEqual(runs.enforce(streak, { accounts: ACCOUNTS, now: AT + 2000 }).ended, []);
  assert.equal(runs.countersFor(streak, runId2, AT + 2000).consecutiveUnconfirmed, 0);
});

test('a stored run is re-validated, and one whose plan cannot be read is dropped', () => {
  const { state } = opened();
  const stored = JSON.parse(JSON.stringify(state));
  const decoded = require('../src/match-record.cjs').cleanState(stored);
  assert.equal(decoded.runs.length, 1);
  assert.equal(decoded.runs[0].plan.table, 'Rome');
  const broken = require('../src/match-record.cjs').cleanState({ ...stored, runs: [{ ...stored.runs[0], plan: { table: 'Atlantis' } }] });
  assert.deepEqual(broken.runs, [], 'a run whose plan cannot be enforced is not loaded back');
  // The sequence survives the dropped run, so the next one is r2 rather than a second r1.
  assert.equal(broken.runSequence, 1);
  const next = runs.start(broken, { first: 'a', second: 'b', accounts: ACCOUNTS, plan: PLAN, now: AT, runId: 'run-2' });
  assert.equal(runs.activeRun(next).handle, 'r2');
});
