const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionFsm, STATES, TRANSITIONS, BUSY_STATES } = require('../src/session-fsm.cjs');

// Deterministic timers: expiry behaviour is the whole point of the machine owning deadlines, so it
// must not depend on wall-clock timing in a test.
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer: id => pending.delete(id),
    pending: () => [...pending.values()].map(entry => entry.ms),
    fireAll: () => {
      const entries = [...pending.values()];
      pending.clear();
      for (const entry of entries) entry.fn();
    }
  };
}

function machine(options = {}) {
  const timers = fakeTimers();
  const transitions = [];
  const warnings = [];
  const fsm = createSessionFsm({
    id: 'test',
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    log: (message, kind) => kind === 'warning' && warnings.push(message),
    onTransition: transition => transitions.push(transition),
    ...options
  });
  return { fsm, timers, transitions, warnings };
}

test('a session walks the happy path: idle, launching, loading, ready', () => {
  const { fsm, transitions } = machine();
  assert.equal(fsm.state, 'idle');
  assert.equal(fsm.send('launch'), true);
  assert.equal(fsm.state, 'launching');
  assert.equal(fsm.send('load'), true);
  assert.equal(fsm.state, 'loading');
  assert.equal(fsm.send('loaded'), true);
  assert.equal(fsm.state, 'ready');
  assert.deepEqual(
    transitions.map(t => `${t.from}->${t.to}`),
    ['idle->launching', 'launching->loading', 'loading->ready']
  );
  assert.equal(fsm.isBusy(), false, 'ready is not busy');
  assert.equal(fsm.isUnhealthy(), false);
});

test('every state is reachable, and the table only names known states', () => {
  const reachable = new Set(['idle']);
  for (const targets of Object.values(TRANSITIONS)) for (const next of Object.values(targets)) reachable.add(next);
  for (const state of STATES) assert.ok(reachable.has(state), `${state} is unreachable`);
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    assert.ok(
      STATES.some(state => state === from),
      `${from} is not a known state`
    );
    for (const next of Object.values(targets)) assert.ok(STATES.includes(next), `${from} targets unknown state ${next}`);
  }
});

test('an event that does not apply is refused, and says so', () => {
  const { fsm, warnings } = machine();
  assert.equal(fsm.canSend('loaded'), false, 'nothing is loaded before launch');
  assert.equal(fsm.send('loaded'), false);
  assert.equal(fsm.state, 'idle', 'a refused event changes nothing');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /'loaded' does not apply in state 'idle'/);
});

test('a second launch is refused rather than restarting the machine', () => {
  const { fsm } = machine();
  fsm.send('launch');
  assert.equal(fsm.send('launch'), false);
  assert.equal(fsm.state, 'launching');
});

test('the machine owns the deadline for launching and fires stalled', () => {
  const { fsm, timers } = machine({ timeouts: { launching: 100, loading: 200 } });
  fsm.send('launch');
  assert.deepEqual(timers.pending(), [100]);
  timers.fireAll();
  assert.equal(fsm.state, 'degraded');
  assert.equal(fsm.reason, 'no progress within 100 ms');
  assert.equal(fsm.isUnhealthy(), true);
});

test('the deadline is re-armed per state and cleared on a state without one', () => {
  const { fsm, timers } = machine({ timeouts: { launching: 100, loading: 200 } });
  fsm.send('launch');
  assert.deepEqual(timers.pending(), [100]);
  fsm.send('load');
  assert.deepEqual(timers.pending(), [200], 'the launching deadline is replaced, not stacked');
  fsm.send('loaded');
  assert.deepEqual(timers.pending(), [], 'ready has no deadline');
});

test('an expired deadline cannot fire after the state moved on', () => {
  const { fsm, timers } = machine({ timeouts: { launching: 100, loading: 200 } });
  fsm.send('launch');
  const armed = [...timers.pending()];
  assert.deepEqual(armed, [100]);
  fsm.send('loaded');
  // Nothing is pending, so firing is a no-op; the machine must still be ready.
  timers.fireAll();
  assert.equal(fsm.state, 'ready');
});

test('a load failure degrades the session without discarding the reason', () => {
  const { fsm } = machine();
  fsm.send('launch');
  fsm.send('load');
  fsm.send('failed', 'page could not load (code -105)');
  assert.equal(fsm.state, 'degraded');
  assert.equal(fsm.reason, 'page could not load (code -105)');
  assert.equal(fsm.isBusy(), false);
});

test('recovery from degraded goes through loading and can reach ready', () => {
  const { fsm } = machine();
  fsm.send('launch');
  fsm.send('failed', 'renderer crashed');
  assert.equal(fsm.state, 'degraded');
  assert.equal(fsm.send('recover'), true);
  assert.equal(fsm.state, 'loading');
  fsm.send('loaded');
  assert.equal(fsm.state, 'ready');
});

test('a responsive window returns a degraded session to ready directly', () => {
  const { fsm } = machine();
  fsm.send('launch');
  fsm.send('failed', 'unresponsive');
  fsm.send('loaded');
  assert.equal(fsm.state, 'ready');
});

test('reloading from ready passes through loading rather than jumping', () => {
  const { fsm } = machine();
  fsm.send('launch');
  fsm.send('loaded');
  assert.equal(fsm.send('reload'), true);
  assert.equal(fsm.state, 'loading');
});

test('closing then closed is the orderly shutdown path', () => {
  const { fsm } = machine();
  fsm.send('launch');
  fsm.send('loaded');
  fsm.send('close');
  assert.equal(fsm.state, 'closing');
  assert.equal(fsm.isBusy(), true, 'closing is still busy for UI purposes');
  fsm.send('closed');
  assert.equal(fsm.state, 'closed');
  assert.equal(fsm.isTerminal(), true);
});

test('closed is reachable from every live state, because a window can vanish', () => {
  for (const state of STATES.filter(s => s !== 'closed')) {
    const { fsm } = machine();
    if (state !== 'idle') {
      // Walk to the state under test.
      fsm.send('launch');
      if (state !== 'launching') fsm.send('load');
      if (state === 'ready' || state === 'closing') fsm.send('loaded');
      if (state === 'closing') fsm.send('close');
      if (state === 'degraded') fsm.send('failed', 'x');
    }
    assert.equal(fsm.state, state, `setup reached ${state}`);
    assert.equal(fsm.send('closed'), true, `${state} can close`);
    assert.equal(fsm.state, 'closed');
  }
});

test('a closed machine ignores every later event', () => {
  const { fsm, warnings } = machine();
  fsm.send('launch');
  fsm.send('closed');
  assert.equal(fsm.send('loaded'), false);
  assert.equal(fsm.send('launch'), false);
  assert.equal(fsm.state, 'closed');
  assert.equal(warnings.length, 0, 'a terminal machine is silent, not noisy');
});

test('history records each move with its reason and stays bounded', () => {
  const { fsm } = machine();
  fsm.send('launch');
  fsm.send('failed', 'boom');
  const history = fsm.history();
  assert.equal(history.length, 2);
  assert.equal(history[0].from, 'idle');
  assert.equal(history[0].event, 'launch');
  assert.ok(Number.isFinite(Date.parse(history[0].at)));
  assert.equal(history[1].reason, 'boom');
  // Drive a cycle until the cap is exceeded: degraded -> loading -> degraded.
  for (let i = 0; i < 40; i++) {
    fsm.send('reload');
    fsm.send('failed', `failure ${i}`);
  }
  assert.equal(fsm.history().length, 50, 'history is capped');
  const newest = fsm.history().at(-1);
  assert.ok(newest, 'history is not empty');
  assert.equal(newest.reason, 'failure 39', 'the cap keeps the newest entries');
  assert.ok(!fsm.history().some(entry => entry.reason === 'boom'), 'the oldest entries were evicted');
});

test('dispose releases the pending deadline so a closed window cannot fire later', () => {
  const { fsm, timers } = machine({ timeouts: { launching: 100 } });
  fsm.send('launch');
  assert.deepEqual(timers.pending(), [100]);
  fsm.dispose();
  assert.deepEqual(timers.pending(), [], 'no timer survives dispose');
  assert.equal(fsm.state, 'launching', 'dispose does not invent a transition');
});

test('busy states are exactly the ones the UI must not offer actions in', () => {
  assert.deepEqual(BUSY_STATES, ['launching', 'loading', 'closing']);
});
