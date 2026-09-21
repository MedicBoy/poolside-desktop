// The dropout watcher: a match whose participant's session is gone, and the grace period that keeps a blink
// from being treated as one.

const test = require('node:test');
const assert = require('node:assert/strict');
const coordination = require('../src/match-coordination.cjs');
const { createDropoutWatcher } = require('../src/match-dropout.cjs');

const AT = Date.parse('2026-09-21T12:00:00.000Z');
const ACCOUNTS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' }
];

/** @param {{open?: Record<string, boolean>, graceMs?: number, participant?: any}} [options] */
function harness({ open = { a: true, b: true }, graceMs = 15000, participant } = {}) {
  let clock = AT;
  const logs = [];
  const timers = [];
  const store = {
    current: coordination.start(coordination.emptyState(), { first: 'a', second: 'b', accounts: ACCOUNTS, now: AT, matchId: 'match-1' })
  };
  const watcher = createDropoutWatcher({
    store,
    participant: participant === undefined ? id => ({ open: open[id] === true }) : participant,
    // The service's own cancel: it records the reason and enforces the run's plan. Here it only records.
    cancel: (matchId, reason) => {
      store.current = coordination.cancel(store.current, { matchId, reason, now: clock });
    },
    log: (message, kind) => logs.push({ message, kind }),
    now: () => clock,
    graceMs,
    checkMs: 5000,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref: () => {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    }
  });
  return {
    watcher,
    store,
    logs,
    timers,
    open,
    match: () => store.current.matches[0],
    setClock: value => {
      clock = value;
    }
  };
}

test('a participant with no session is a dropout once the grace period has passed', () => {
  const { watcher, match, logs, setClock, open } = harness({ graceMs: 5000 });
  open.b = false;
  // The first look only starts the clock: nothing is cancelled on the strength of one sample.
  assert.deepEqual(watcher.watch(), []);
  assert.equal(match().state, 'active');
  setClock(AT + 4000);
  assert.deepEqual(watcher.watch(), [], 'inside the grace period the match is left alone');
  setClock(AT + 5000);
  const cancelled = watcher.watch();
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].handle, 'm1');
  assert.equal(cancelled[0].reason, "Bob's session has been closed for 5 seconds, so m1 was cancelled as a dropout.");
  assert.equal(match().state, 'cancelled');
  assert.equal(match().reason, cancelled[0].reason);
  assert.equal(logs.length, 0, 'the watcher does not log: the cancel it calls does that, in one voice');
});

test('a session that comes back is a blink, and its clock is forgotten', () => {
  const { watcher, match, setClock, open } = harness({ graceMs: 5000 });
  open.b = false;
  watcher.watch();
  setClock(AT + 4000);
  open.b = true;
  assert.deepEqual(watcher.watch(), []);
  // Missing again later: the grace starts over, because the match is not a dropout for having blinked.
  open.b = false;
  setClock(AT + 10000);
  assert.deepEqual(watcher.watch(), []);
  setClock(AT + 16000);
  assert.equal(watcher.watch().length, 1);
  assert.equal(match().state, 'cancelled');
});

test('both participants missing is one dropout, naming the one that went first', () => {
  const { watcher, match, setClock, open } = harness({ graceMs: 5000 });
  open.a = false;
  watcher.watch();
  setClock(AT + 2000);
  open.b = false;
  watcher.watch();
  setClock(AT + 6000);
  const cancelled = watcher.watch();
  assert.equal(cancelled.length, 1, 'one match is cancelled once');
  assert.match(match().reason, /^Alice's session has been closed/);
});

test('a settled match is never watched, and the timer stops when nothing is in progress', () => {
  const { watcher, store, timers, setClock, match } = harness({ graceMs: 5000 });
  store.current = coordination.cancel(store.current, { matchId: 'match-1', reason: 'By hand.', now: AT });
  setClock(AT + 60000);
  assert.deepEqual(watcher.watch(), []);
  watcher.syncPoll();
  assert.equal(timers.length, 0, 'nothing in progress means nothing to watch');
  assert.equal(match().state, 'cancelled');
});

test('the watcher runs on its own check while a match is in progress, and stops on dispose', () => {
  const { watcher, timers, open, match, setClock } = harness({ graceMs: 5000 });
  watcher.syncPoll();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 5000);
  open.b = false;
  timers[0].callback();
  setClock(AT + 6000);
  timers[0].callback();
  assert.equal(match().state, 'cancelled');
  assert.equal(timers.length, 0, 'the check stops once nothing is in progress');
  watcher.dispose();
  assert.equal(timers.length, 0);
});

test('a build that cannot inspect participants watches nothing rather than guessing', () => {
  const { watcher, timers, match, setClock } = harness({ participant: null });
  assert.deepEqual(watcher.watch(), []);
  watcher.syncPoll();
  assert.equal(timers.length, 0);
  setClock(AT + 600000);
  assert.deepEqual(watcher.watch(), []);
  assert.equal(match().state, 'active', 'no session information means no dropout claim');
});

test('a participant that cannot be inspected at all is treated as missing, not as present', () => {
  const { watcher, match, setClock } = harness({
    participant: id => {
      if (id === 'b') throw new Error('the session could not be read');
      return { open: true };
    },
    graceMs: 1000
  });
  watcher.watch();
  setClock(AT + 2000);
  const cancelled = watcher.watch();
  assert.equal(cancelled.length, 1);
  assert.match(match().reason, /^Bob's session has been closed/);
});
