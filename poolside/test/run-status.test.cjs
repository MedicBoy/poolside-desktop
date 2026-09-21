// The run dashboard's rules: where a run is, and what the operator should do about it. Every branch here is
// a state the coordinator can actually be in, so the card never has to guess.

const test = require('node:test');
const assert = require('node:assert/strict');
const { statusFor, duration, STALE_OBSERVATION_MS } = require('../src/run-status.cjs');

const NOW = Date.parse('2026-09-21T12:10:00.000Z');
const PLAN = { table: 'Rome', matchLimit: 5, stopAfterFailures: 3, stopAfterUnconfirmed: 3, stopAfterMinutes: 90 };

/** @param {any} [overrides] */
function run(overrides = {}) {
  return {
    handle: 'r1',
    state: 'active',
    plan: PLAN,
    progress: { played: 2, completed: 2, cancelled: 0, consecutiveFailures: 0, consecutiveUnconfirmed: 0, remainingMs: 43 * 60000 },
    participants: [
      { name: 'Newfie', open: true, screen: { observedAt: new Date(NOW - 12000).toISOString(), state: 'table-selection' } },
      { name: 'Gmail', open: true, screen: null }
    ],
    ...overrides
  };
}

/** @param {any} [overrides] */
function match(overrides = {}) {
  return {
    readiness: { verdict: 'ready', skewMs: 665, releasedAt: new Date(NOW - 5000).toISOString() },
    participants: [
      { name: 'Newfie', releasable: true },
      { name: 'Gmail', releasable: true }
    ],
    pairing: null,
    ...overrides
  };
}

test('a run between matches says so and points at the next attempt', () => {
  const status = /** @type {any} */ (statusFor({ run: run(), match: null, now: NOW }));
  assert.equal(status.stage, 'between-matches');
  assert.equal(status.stageLabel, 'Between matches');
  assert.equal(status.attention, 'act');
  assert.deepEqual(status.attempt, { number: 3, planned: 5 });
  assert.equal(status.release, 'No match in progress.');
  assert.equal(status.nextAction, 'Start match to begin attempt 3 of 5; it will join this run and load both profiles.');
  assert.match(
    status.nextStop,
    /Stops when: 3 more results, 3 more matches with no result, 3 more matches without a confirmed pairing, 43 min left\./
  );
});

test('while the profiles are loading, the status says what is being waited for', () => {
  const waiting = match({
    readiness: { verdict: 'preparing', reason: 'Waiting for both participants to load.' },
    participants: [
      { name: 'Newfie', releasable: false, detail: 'The session is not ready.' },
      { name: 'Gmail', releasable: true }
    ]
  });
  const status = /** @type {any} */ (statusFor({ run: run(), match: waiting, now: NOW }));
  assert.equal(status.stage, 'preparing');
  assert.equal(status.attention, 'watch');
  // The sentence the barrier wrote is used verbatim, minus the full stop it already carries.
  assert.equal(status.release, 'Waiting to release: Newfie — The session is not ready.');
  assert.equal(
    status.nextAction,
    'Wait for Newfie and Gmail to finish loading; release happens by itself, and the release and how long it took will appear here.'
  );
});

test('a preparing match with no window behind it tells the operator to load the profiles', () => {
  const closed = run({
    participants: [
      { name: 'Newfie', open: false, screen: null },
      { name: 'Gmail', open: false, screen: null }
    ]
  });
  const status = /** @type {any} */ (statusFor({ run: closed, match: match({ readiness: { verdict: 'preparing' } }), now: NOW }));
  assert.equal(status.stage, 'preparing');
  assert.equal(status.nextAction, 'Load both profiles from the match card — Newfie and Gmail have no window open yet.');
});

test('a blocked release names what is blocking it', () => {
  const blocked = match({ readiness: { verdict: 'blocked', reason: 'Newfie did not become ready within 120 seconds.' } });
  const status = /** @type {any} */ (statusFor({ run: run(), match: blocked, now: NOW }));
  assert.equal(status.stage, 'blocked');
  assert.equal(status.attention, 'act');
  assert.equal(status.release, 'Release is blocked — Newfie did not become ready within 120 seconds.');
  assert.equal(status.nextAction, 'Wait for the profile to finish loading, then press Load both profiles again, or cancel the match.');
});

test('a released match reports the release and its skew, and asks for the evidence', () => {
  const status = /** @type {any} */ (statusFor({ run: run(), match: match(), now: NOW }));
  assert.equal(status.stage, 'released');
  assert.equal(status.stageLabel, 'Released — play it');
  assert.equal(status.skewMs, 665);
  assert.match(status.release, /^Released in 0\.7 s \(/);
  assert.equal(status.attention, 'watch', 'a release with no pairing verdict yet is worth watching');
  assert.equal(
    status.nextAction,
    'Play this match and record the result. Then look at each window in turn and press Check pairing evidence.'
  );
  assert.equal(status.pairing.line, 'Pairing evidence has not been judged yet.');
});

test('a confirmed pairing is reported, and the next action drops the evidence step', () => {
  const paired = match({
    pairing: { verdict: 'paired', label: 'Same entry seen on both accounts', reason: 'Both accounts paid 1000 coins.' }
  });
  const status = /** @type {any} */ (statusFor({ run: run(), match: paired, now: NOW }));
  assert.equal(status.attention, 'none');
  assert.equal(status.pairing.line, 'Same entry seen on both accounts. Both accounts paid 1000 coins.');
  assert.equal(status.nextAction, 'Play this match, then record the result on the match card.');
});

test('the screen readings are reported with their age, and an old one is called old', () => {
  const fresh = /** @type {any} */ (statusFor({ run: run(), match: match(), now: NOW }));
  assert.deepEqual(
    fresh.observations.map(entry => entry.ageMs),
    [12000, null]
  );
  assert.equal(fresh.observations[0].line, 'Newfie: read 12 s ago (table-selection).');
  assert.equal(fresh.observations[1].line, 'Gmail: nothing read from the screen yet.');
  assert.equal(fresh.oldestObservationMs, 12000);

  const aged = run({
    participants: [
      { name: 'Newfie', open: true, screen: { observedAt: new Date(NOW - STALE_OBSERVATION_MS - 1000).toISOString(), state: 'lobby' } },
      { name: 'Gmail', open: true, screen: null }
    ]
  });
  const stale = /** @type {any} */ (statusFor({ run: aged, match: match(), now: NOW }));
  assert.match(stale.observations[0].line, /read 2 min 1 s ago \(lobby\) — that is old, look at that window again\./);
});

test('a paused run keeps its plan and says whether a match is still in flight', () => {
  const idle = /** @type {any} */ (statusFor({ run: run({ state: 'paused' }), match: null, now: NOW }));
  assert.equal(idle.stage, 'paused');
  assert.equal(idle.stageLabel, 'Paused');
  assert.equal(idle.nextAction, 'Resume the run when you are ready: nothing new is started while it is paused.');
  const inFlight = /** @type {any} */ (statusFor({ run: run({ state: 'paused' }), match: match(), now: NOW }));
  assert.equal(
    inFlight.nextAction,
    'The match in progress is not affected. Finish it and record the result, then resume the run for the next one.'
  );
});

test('an ended run reports the reason it stopped and asks nothing more', () => {
  const ended = run({
    state: 'ended',
    outcome: 'unconfirmed',
    outcomeLabel: 'Stopped: results without a confirmed pairing',
    reason: '3 matches in a row ended without a confirmed pairing, and the plan stops after 3.'
  });
  const status = /** @type {any} */ (statusFor({ run: ended, match: null, now: NOW }));
  assert.equal(status.stage, 'ended');
  assert.equal(status.attention, 'none');
  assert.deepEqual(status.stop, {
    outcome: 'unconfirmed',
    label: 'Stopped: results without a confirmed pairing',
    reason: '3 matches in a row ended without a confirmed pairing, and the plan stops after 3.'
  });
  assert.equal(status.nextStop, null);
  assert.equal(status.nextAction, 'Nothing to do: this run is over. Start a new one when you want to.');
});

test('a plan with no bounds left says so rather than promising a stop that cannot come', () => {
  const unbounded = run({
    plan: { ...PLAN, stopAfterFailures: 0, stopAfterUnconfirmed: 0, stopAfterMinutes: 0 },
    progress: { played: 4, completed: 4, cancelled: 0, consecutiveFailures: 0, consecutiveUnconfirmed: 0, remainingMs: null }
  });
  const status = /** @type {any} */ (statusFor({ run: unbounded, match: null, now: NOW }));
  assert.equal(status.nextStop, 'Stops when: 1 more result.');
});

test('durations are written the way a person reads them', () => {
  assert.equal(duration(0), '0.0 s');
  assert.equal(duration(665), '0.7 s');
  assert.equal(duration(9865), '9.9 s');
  assert.equal(duration(45000), '45 s');
  assert.equal(duration(60000), '1 min');
  assert.equal(duration(121000), '2 min 1 s');
  assert.equal(duration(-5), '0.0 s');
});
