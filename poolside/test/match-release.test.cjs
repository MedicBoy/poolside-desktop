// The count-in's clock: when it refuses, what it records at GO, and how it measures the two clicks from the
// sessions' own screens. The clicks themselves are the operator's; this only watches what happens afterwards.

const test = require('node:test');
const assert = require('node:assert/strict');
const coordination = require('../src/match-coordination.cjs');
const { createReleaseService } = require('../src/match-release.cjs');

const AT = Date.parse('2026-09-21T12:00:00.000Z');
const ACCOUNTS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' }
];

/** @param {{screens?: Record<string, any>, leadInMs?: number}} [options] */
function harness({ screens = {}, leadInMs = 5000 } = {}) {
  let clock = AT;
  const logs = [];
  const commits = [];
  const timers = [];
  const store = { current: coordination.emptyState() };
  const service = /** @type {any} */ (
    createReleaseService({
      store,
      commit: (state, message) => {
        store.current = state;
        commits.push(message);
        return message;
      },
      log: (message, kind) => logs.push({ message, kind }),
      observe: id => screens[id] || null,
      now: () => clock,
      leadInMs,
      setTimer: (callback, delay) => {
        const timer = { callback, delay, unref: () => {} };
        timers.push(timer);
        return timer;
      },
      clearTimer: timer => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      }
    })
  );
  /** A match that has been released — the only state a count-in can start in. */
  function released(matchId = 'match-1') {
    let state = coordination.start(store.current, { first: 'a', second: 'b', accounts: ACCOUNTS, now: clock, matchId });
    state = coordination.requestReadiness(state, { matchId, now: clock, deadlineMs: 120000 });
    state = coordination.settleReadiness(state, {
      matchId,
      verdict: 'ready',
      reason: 'Alice and Bob are ready.',
      releasedAt: clock,
      skewMs: 400,
      now: clock
    });
    store.current = state;
  }
  return {
    service,
    store,
    logs,
    commits,
    timers,
    screens,
    released,
    setClock: value => {
      clock = value;
    },
    history: () => store.current.matches[0].history.map(entry => entry.event)
  };
}

const screen = state => ({ state, observedAt: new Date(AT).toISOString() });

test('a count-in refuses to start until the barrier has released the match', () => {
  const { service, store } = harness();
  store.current = coordination.start(store.current, { first: 'a', second: 'b', accounts: ACCOUNTS, now: AT, matchId: 'match-1' });
  assert.throws(() => service.arm({ matchId: 'match-1' }), /waits until both profiles are released\. Release has not been requested yet\./);
  store.current = coordination.requestReadiness(store.current, { matchId: 'match-1', now: AT, deadlineMs: 120000 });
  assert.throws(() => service.arm({ matchId: 'match-1' }), /Waiting for every participant to be ready\./);
  store.current = coordination.settleReadiness(store.current, {
    matchId: 'match-1',
    verdict: 'blocked',
    reason: 'Alice did not become ready.',
    now: AT
  });
  assert.throws(() => service.arm({ matchId: 'match-1' }), /Alice did not become ready\./);
  assert.throws(() => service.arm({ matchId: 'nobody' }), /not in the local ledger/);
});

test('the count-in counts, records GO with the order, and then watches both screens', () => {
  const { service, logs, commits, timers, screens, released, setClock, history } = harness({ leadInMs: 5000 });
  released();
  screens.a = screen('table-selection');
  screens.b = screen('table-selection');
  const armed = service.arm({ matchId: 'match-1' });
  assert.equal(armed.phase, 'counting');
  assert.equal(armed.line, "5… click Alice's Play button, then Bob's.");
  assert.equal(timers.length, 1);
  assert.match(logs.at(-1).message, /count-in started\. Click Alice's Play button first, then Bob's\. GO in 5 seconds\./);

  setClock(AT + 5000);
  service.tick();
  assert.equal(history().includes('count-in-go'), true, 'GO is recorded in the match history');
  assert.match(commits.at(-1), /^m1: GO — click Alice's Play button, then Bob's\.$/);
  assert.equal(service.status('match-1').phase, 'go');

  // Both windows queue: each screen moves away from the table it was sitting on, a fraction apart.
  setClock(AT + 5400);
  screens.a = screen('connecting');
  service.tick();
  setClock(AT + 6100);
  screens.b = screen('connecting');
  service.tick();
  const done = /** @type {any} */ (service.status('match-1'));
  assert.equal(done.phase, 'done');
  assert.equal(done.skewMs, 700);
  assert.equal(done.line, 'Alice 0.4 s after GO, Bob 1.1 s after GO — 0.7 s apart.');
  assert.equal(history().includes('count-in-done'), true);
  assert.match(commits.at(-1), /^m1: Queued by hand: Alice 0\.4 s after GO, Bob 1\.1 s after GO — 0\.7 s apart\.$/);
  assert.equal(timers.length, 0, 'the clock stops once both have been seen');
});

test('a count-in that watches and sees only one screen move says so instead of inventing a gap', () => {
  const { service, released, screens, setClock, history } = harness({ leadInMs: 1000 });
  released();
  screens.a = screen('table-selection');
  screens.b = screen('table-selection');
  service.arm({ matchId: 'match-1' });
  setClock(AT + 1000);
  service.tick();
  setClock(AT + 1400);
  screens.a = screen('connecting');
  service.tick();
  // Run out the watch window with Bob's screen never moving.
  setClock(AT + 40000);
  service.tick();
  const done = /** @type {any} */ (service.status('match-1'));
  assert.equal(done.phase, 'done');
  assert.equal(done.skewMs, null);
  assert.match(done.line, /only 1 of 2 moved/);
  assert.match(history().join(','), /count-in-done/);
});

test('stopping a count-in before GO records nothing about a queue', () => {
  const { service, released, logs, timers, history, setClock } = harness();
  released();
  service.arm({ matchId: 'match-1' });
  service.cancel({ matchId: 'match-1' });
  assert.equal(timers.length, 0);
  assert.equal(history().includes('count-in-go'), false);
  assert.match(logs.at(-1).message, /count-in stopped before GO\./);
  const stopped = service.status('match-1');
  assert.equal(stopped.phase, 'cancelled');
  assert.match(stopped.line, /The clicks were yours to make; the app queues nothing\./);
  setClock(AT + 60000);
  assert.throws(() => service.cancel({ matchId: 'match-1' }), /No count-in is running/);
});

test('a second count-in cannot start over the top of a running one', () => {
  const { service, released } = harness();
  released();
  service.arm({ matchId: 'match-1' });
  assert.throws(() => service.arm({ matchId: 'match-1' }), /A count-in is already running for m1\. Stop it first\./);
  service.dispose();
});

test('a screen that never reads at all is treated as having not moved', () => {
  const { service, released, screens, setClock } = harness({ leadInMs: 1000 });
  released();
  service.arm({ matchId: 'match-1' });
  setClock(AT + 1000);
  service.tick();
  setClock(AT + 45000);
  service.tick();
  const done = /** @type {any} */ (service.status('match-1'));
  assert.match(done.line, /only 0 of 2 moved/);
  assert.equal(screens.a, undefined, 'nothing was invented for a session that has no reading');
});

test('the card can ask for the running count-in or the last one, and only for that match', () => {
  const { service, released } = harness();
  released('match-1');
  service.arm({ matchId: 'match-1' });
  assert.equal(service.status('match-1').phase, 'counting');
  assert.equal(service.status('match-2'), null, 'another match has no count-in of its own');
  service.dispose();
});
