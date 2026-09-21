// The plan rules: what a plan may say, what the counters are, and which condition is the one that stops a
// run when more than one of them is true at once.

const test = require('node:test');
const assert = require('node:assert/strict');
const runPlan = require('../src/run-plan.cjs');

const AT = Date.parse('2026-09-21T12:00:00.000Z');
/** @param {string|null} runId @param {string} state @param {string|null} pairing */
const match = (runId, state, pairing = null) => ({ runId, state, pairing: pairing ? { verdict: pairing } : null });

test('a plan is typed and bounded, and defaults where the operator left a field alone', () => {
  assert.deepEqual(runPlan.plan({ table: 'Rome' }), {
    table: 'Rome',
    matchLimit: runPlan.DEFAULTS.matchLimit,
    stopAfterFailures: runPlan.DEFAULTS.stopAfterFailures,
    stopAfterUnconfirmed: runPlan.DEFAULTS.stopAfterUnconfirmed,
    stopAfterMinutes: runPlan.DEFAULTS.stopAfterMinutes
  });
  assert.deepEqual(runPlan.plan({ table: 'Tokyo', matchLimit: '2', stopAfterFailures: 0, stopAfterUnconfirmed: 0, stopAfterMinutes: 0 }), {
    table: 'Tokyo',
    matchLimit: 2,
    stopAfterFailures: 0,
    stopAfterUnconfirmed: 0,
    stopAfterMinutes: 0
  });
});

test('a plan refuses anything the program could not enforce', () => {
  assert.throws(() => runPlan.plan({ table: 'Atlantis' }), /Choose the table this run is for\./);
  assert.throws(() => runPlan.plan({}), /Choose the table this run is for\./);
  assert.throws(() => runPlan.plan({ table: 'Rome', matchLimit: 0 }), /whole number between 1 and 50/);
  assert.throws(() => runPlan.plan({ table: 'Rome', matchLimit: 51 }), /whole number between 1 and 50/);
  assert.throws(() => runPlan.plan({ table: 'Rome', matchLimit: 2.5 }), /whole number between 1 and 50/);
  assert.throws(() => runPlan.plan({ table: 'Rome', matchLimit: 'lots' }), /whole number between 1 and 50/);
  assert.throws(() => runPlan.plan({ table: 'Rome', stopAfterFailures: 26 }), /whole number between 0 and 25/);
  assert.throws(() => runPlan.plan({ table: 'Rome', stopAfterUnconfirmed: 26 }), /whole number between 0 and 25/);
  assert.throws(() => runPlan.plan({ table: 'Rome', stopAfterMinutes: 601 }), /whole number between 0 and 600/);
  assert.throws(() => runPlan.plan(null), /Choose the table this run is for\./);
});

test('the counters are counted from the ledger and belong to one run only', () => {
  const matches = [
    match('r1', 'active'),
    match('r1', 'completed', 'paired'),
    match('r1', 'cancelled'),
    match('r1', 'cancelled'),
    match('r2', 'completed', 'incomplete'),
    match(null, 'cancelled')
  ];
  const counts = runPlan.counters({ matches, runId: 'r1', startedAt: AT, now: AT + 90000 });
  assert.deepEqual(counts, {
    played: 4,
    completed: 1,
    cancelled: 2,
    active: 1,
    consecutiveFailures: 0,
    consecutiveUnconfirmed: 0,
    pausedMs: 0,
    elapsedMs: 90000
  });
});

test('the failure streak is the most recent run of matches with no result, newest first', () => {
  const counts = forRunId => runPlan.counters({ matches: forRunId, runId: 'r1', startedAt: AT, now: AT });
  assert.equal(counts([match('r1', 'cancelled'), match('r1', 'completed', 'paired'), match('r1', 'cancelled')]).consecutiveFailures, 1);
  assert.equal(counts([match('r1', 'cancelled'), match('r1', 'cancelled')]).consecutiveFailures, 2);
  // A match still in progress has not failed, so it does not break or extend the streak.
  assert.equal(counts([match('r1', 'active'), match('r1', 'cancelled')]).consecutiveFailures, 1);
  assert.equal(counts([match('r1', 'completed')]).consecutiveFailures, 0);
});

test('the unconfirmed streak counts settled matches whose pairing was never confirmed', () => {
  const counts = matches => runPlan.counters({ matches, runId: 'r1', startedAt: AT, now: AT });
  // A recorded result with no confirmed pairing is an attempt that came to nothing, exactly like a match that
  // ended with no result at all; a confirmed one is what ends the streak.
  assert.equal(counts([match('r1', 'completed'), match('r1', 'cancelled')]).consecutiveUnconfirmed, 2);
  assert.equal(counts([match('r1', 'completed', 'incomplete'), match('r1', 'completed', 'paired')]).consecutiveUnconfirmed, 1);
  assert.equal(counts([match('r1', 'completed', 'mismatch'), match('r1', 'completed', 'agreed')]).consecutiveUnconfirmed, 2);
  assert.equal(counts([match('r1', 'completed', 'paired')]).consecutiveUnconfirmed, 0);
  // In progress is neither confirmed nor unconfirmed yet.
  assert.equal(counts([match('r1', 'completed', 'incomplete'), match('r1', 'active')]).consecutiveUnconfirmed, 1);
});

test('time spent paused does not count against the plan', () => {
  const counts = runPlan.counters({ matches: [], runId: 'r1', startedAt: AT, now: AT + 600000, pausedMs: 300000 });
  assert.equal(counts.elapsedMs, 300000);
  assert.equal(counts.pausedMs, 300000);
  // A pause still open when the counters are taken is included, so a card cannot show a clock that keeps
  // running while the run is held.
  const held = runPlan.counters({ matches: [], runId: 'r1', startedAt: AT, now: AT + 300000, pausedAt: AT + 60000 });
  assert.equal(held.elapsedMs, 60000);
});

test('reaching the plan is reported before a time bound that crossed at the same moment', () => {
  const plan = runPlan.plan({
    table: 'Rome',
    matchLimit: 2,
    stopAfterFailures: 2,
    stopAfterUnconfirmed: 3,
    stopAfterMinutes: 30
  });
  const atLimit = /** @type {any} */ (
    runPlan.verdict(plan, { completed: 2, consecutiveFailures: 0, consecutiveUnconfirmed: 0, elapsedMs: 31 * 60000 })
  );
  assert.equal(atLimit.continue, false);
  assert.equal(atLimit.outcome, 'limit');
  assert.match(atLimit.reason, /2 matches with a recorded result, and all of them are recorded\./);

  const failures = /** @type {any} */ (
    runPlan.verdict(plan, { completed: 0, consecutiveFailures: 2, consecutiveUnconfirmed: 0, elapsedMs: 31 * 60000 })
  );
  assert.equal(failures.outcome, 'failures');
  assert.match(failures.reason, /2 matches in a row ended with no result, and the plan stops after 2\./);

  const unconfirmed = /** @type {any} */ (
    runPlan.verdict(plan, { completed: 1, consecutiveFailures: 0, consecutiveUnconfirmed: 3, elapsedMs: 60000 })
  );
  assert.equal(unconfirmed.outcome, 'unconfirmed');
  assert.match(unconfirmed.reason, /3 matches in a row ended without a confirmed pairing, and the plan stops after 3\./);

  const duration = /** @type {any} */ (
    runPlan.verdict(plan, { completed: 1, consecutiveFailures: 0, consecutiveUnconfirmed: 0, elapsedMs: 30 * 60000 })
  );
  assert.equal(duration.outcome, 'duration');
  assert.match(duration.reason, /allowed 30 minutes, and 30 minutes have passed\./);

  assert.deepEqual(runPlan.verdict(plan, { completed: 1, consecutiveFailures: 1, consecutiveUnconfirmed: 1, elapsedMs: 60000 }), {
    continue: true
  });
});

test('a bound of zero means that condition is not part of the plan at all', () => {
  const plan = runPlan.plan({ table: 'Rome', matchLimit: 5, stopAfterFailures: 0, stopAfterUnconfirmed: 0, stopAfterMinutes: 0 });
  assert.deepEqual(
    runPlan.verdict(plan, { completed: 4, consecutiveFailures: 9, consecutiveUnconfirmed: 9, elapsedMs: 100 * 60 * 60000 }),
    {
      continue: true
    }
  );
  assert.deepEqual(runPlan.bounds(plan), [
    '5 matches with a recorded result',
    'no limit on matches in a row with no result',
    'no retry limit on matches without a confirmed pairing',
    'no time limit'
  ]);
  assert.equal(runPlan.describe(plan), 'Up to 5 matches with a recorded result on Rome, with no other stop condition');
});

test('a plan reads as one sentence and as its parts, and both say the same thing', () => {
  const plan = runPlan.plan({ table: 'Rome', matchLimit: 2, stopAfterFailures: 0, stopAfterUnconfirmed: 0, stopAfterMinutes: 60 });
  assert.equal(runPlan.describe(plan), 'Up to 2 matches with a recorded result on Rome, stopping after 60 minutes');
  assert.deepEqual(runPlan.bounds(plan), [
    '2 matches with a recorded result',
    'no limit on matches in a row with no result',
    'no retry limit on matches without a confirmed pairing',
    'stop after 60 minutes'
  ]);
  // Every bound at once, so the sentence cannot quietly drop one of them.
  const everything = runPlan.plan({ table: 'Rome', matchLimit: 4, stopAfterFailures: 2, stopAfterUnconfirmed: 3, stopAfterMinutes: 45 });
  assert.equal(
    runPlan.describe(everything),
    'Up to 4 matches with a recorded result on Rome, stopping after 2 matches in a row with no result, 3 matches in a row without a confirmed pairing or 45 minutes'
  );
  assert.equal(runPlan.OUTCOMES.limit, 'Match limit reached');
  assert.equal(runPlan.OUTCOMES.unconfirmed, 'Stopped: results without a confirmed pairing');
});
