const { test } = require('node:test');
const assert = require('node:assert/strict');
const { attachSupervision } = require('../src/supervision.cjs');
const { createHealth, recoveryDelay, MAX_RECOVERY_ATTEMPTS } = require('../src/recovery-policy.cjs');
const { createSessionFsm } = require('../src/session-fsm.cjs');

// A minimal stand-in for Electron's webContents: an event emitter with reload(). Supervision is
// deliberately free of Electron imports, so the whole recovery policy is testable here.

function fakeWebContents() {
  const handlers = new Map();
  const wc = {
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
      return wc;
    },
    removeListener(name, handler) {
      const list = handlers.get(name) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
      return wc;
    },
    emit(name, ...args) {
      for (const handler of [...(handlers.get(name) || [])]) handler({}, ...args);
    },
    listenerCount: name => (handlers.get(name) || []).length,
    isDestroyed: () => false
  };
  return wc;
}

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
    delays: () => [...pending.values()].map(entry => entry.ms),
    fireNext: () => {
      const [first] = [...pending.entries()];
      if (!first) return false;
      pending.delete(first[0]);
      first[1].fn();
      return true;
    },
    count: () => pending.size
  };
}

function harness(options = {}) {
  const wc = fakeWebContents();
  const timers = fakeTimers();
  const logs = [];
  const fsm = createSessionFsm({ id: 'test' });
  let recoveries = 0;
  const supervision = attachSupervision({
    label: 'Main',
    group: { window: { webContents: wc, isDestroyed: () => false } },
    fsm,
    log: (message, kind) => logs.push({ message, kind }),
    publish: () => {},
    recover: () => {
      recoveries += 1;
    },
    timers: { setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    ...options
  });
  const reachReady = () => {
    fsm.send('launch');
    fsm.send('loaded');
  };
  return { wc, timers, logs, fsm, supervision, reachReady, recoveries: () => recoveries };
}

test('the backoff doubles, then stops at the cap', () => {
  assert.equal(recoveryDelay(0), 1500);
  assert.equal(recoveryDelay(1), 3000);
  assert.equal(recoveryDelay(2), 6000);
  assert.equal(recoveryDelay(5), 30000, 'capped');
  assert.equal(recoveryDelay(50), 30000, 'still capped');
  assert.equal(recoveryDelay(-1), 1500, 'a nonsense attempt index behaves like the first');
  assert.equal(recoveryDelay(1.7), 3000, 'fractional input is floored');
  assert.equal(recoveryDelay(0, { baseMs: 10, maxMs: 25 }), 10);
  assert.equal(recoveryDelay(3, { baseMs: 10, maxMs: 25 }), 25);
});

test('an initial health record is empty and not exhausted', () => {
  assert.deepEqual(createHealth(), {
    failures: 0,
    recoveries: 0,
    consecutive: 0,
    attempts: 0,
    exhausted: false,
    lastFailureAt: null,
    lastFailureReason: null,
    nextAttemptAt: null
  });
});

test('a dead renderer degrades the session and schedules a bounded recovery', () => {
  const h = harness();
  h.reachReady();
  h.wc.emit('render-process-gone', { reason: 'crashed', exitCode: 133 });
  assert.equal(h.fsm.state, 'degraded');
  assert.match(String(h.fsm.reason), /renderer gone: crashed \(exit 133\)/);
  assert.equal(h.supervision.health.failures, 1);
  assert.equal(h.supervision.health.attempts, 1);
  assert.deepEqual(h.timers.delays(), [1500], 'one recovery scheduled, at the base delay');
  assert.ok(h.supervision.health.nextAttemptAt, 'the dashboard can show when');
  assert.ok(
    h.logs.some(entry => entry.kind === 'warning' && /Recovering in 2s \(attempt 1\/3\)/.test(entry.message)),
    'the user is told what is happening'
  );
});

test('firing the recovery timer reloads through the injected mechanism', () => {
  const h = harness();
  h.reachReady();
  h.wc.emit('render-process-gone', { reason: 'crashed' });
  assert.equal(h.timers.fireNext(), true);
  assert.equal(h.recoveries(), 1, 'windows.cjs performed the reload');
  assert.equal(h.fsm.state, 'loading', 'the machine is recovering, not ready');
  assert.equal(h.supervision.health.nextAttemptAt, null);
});

test('three attempts are made, then the module stops and says so', () => {
  const h = harness();
  h.reachReady();
  for (let i = 0; i < 6; i++) {
    h.wc.emit('render-process-gone', { reason: 'crashed' });
    h.timers.fireNext();
  }
  assert.equal(h.supervision.health.failures, 6, 'every failure is recorded');
  assert.equal(h.supervision.health.attempts, MAX_RECOVERY_ATTEMPTS, 'the budget is not exceeded');
  assert.equal(h.supervision.health.exhausted, true);
  assert.equal(h.timers.count(), 0, 'no timer is left running');
  const giveUp = h.logs.filter(entry => /giving up after 3 recovery attempts/.test(entry.message));
  assert.equal(giveUp.length, 1, 'the user is told once, not once per failure');
  assert.match(giveUp[0].message, /Close and reopen the window to retry/);
  assert.equal(h.fsm.state, 'degraded', 'the session stays visibly degraded');
});

test('a successful load credits the recovery budget back', () => {
  const h = harness();
  h.reachReady();
  h.wc.emit('render-process-gone', { reason: 'crashed' });
  h.timers.fireNext();
  h.wc.emit('did-finish-load');
  assert.equal(h.supervision.health.consecutive, 0);
  assert.equal(h.supervision.health.attempts, 0, 'a later failure gets a fresh budget');
  assert.equal(h.supervision.health.exhausted, false);
  // It can now fail and be recovered again rather than being permanently written off.
  h.wc.emit('render-process-gone', { reason: 'oom' });
  assert.deepEqual(h.timers.delays(), [1500]);
});

test('an unresponsive renderer is given a grace period before it is acted on', () => {
  const h = harness({ policy: { graceMs: 5000 } });
  h.reachReady();
  h.wc.emit('unresponsive');
  assert.equal(h.fsm.state, 'ready', 'a busy renderer is not a hung one');
  assert.deepEqual(h.timers.delays(), [5000]);
  h.timers.fireNext();
  assert.equal(h.fsm.state, 'degraded');
  assert.match(String(h.fsm.reason), /unresponsive for 5s/);
});

test('a renderer that answers inside the grace period is never degraded', () => {
  const h = harness({ policy: { graceMs: 5000 } });
  h.reachReady();
  h.wc.emit('unresponsive');
  h.wc.emit('responsive');
  assert.equal(h.fsm.state, 'ready');
  assert.equal(h.timers.count(), 0, 'the grace timer is cancelled');
  assert.equal(h.supervision.health.failures, 0, 'no failure is recorded for a blip');
});

test('repeated unresponsive events do not stack grace timers', () => {
  const h = harness({ policy: { graceMs: 5000 } });
  h.reachReady();
  h.wc.emit('unresponsive');
  h.wc.emit('unresponsive');
  h.wc.emit('unresponsive');
  assert.equal(h.timers.count(), 1);
});

test('a degraded session that answers on its own returns to ready and is credited', () => {
  const h = harness({ policy: { graceMs: 5000 } });
  h.reachReady();
  h.wc.emit('unresponsive');
  h.timers.fireNext();
  assert.equal(h.fsm.state, 'degraded');
  h.wc.emit('responsive');
  assert.equal(h.fsm.state, 'ready');
  assert.equal(h.supervision.health.recoveries, 1);
  assert.equal(h.supervision.health.consecutive, 0);
});

test('a responsive event on a healthy session changes nothing', () => {
  const h = harness();
  h.reachReady();
  h.wc.emit('responsive');
  assert.equal(h.fsm.state, 'ready');
  assert.equal(h.supervision.health.recoveries, 0);
});

test('a failing recovery mechanism is recorded rather than thrown', () => {
  let attempts = 0;
  const h = harness({
    recover: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('window is gone');
    }
  });
  h.reachReady();
  h.wc.emit('render-process-gone', { reason: 'crashed' });
  h.timers.fireNext();
  assert.match(String(h.supervision.health.lastFailureReason), /recovery failed: window is gone/);
  assert.equal(h.timers.count(), 1, 'it schedules another attempt instead of dying');
});

test('a terminal session ignores renderer events entirely', () => {
  const h = harness();
  h.reachReady();
  h.fsm.send('closed');
  h.wc.emit('render-process-gone', { reason: 'crashed' });
  h.wc.emit('unresponsive');
  assert.equal(h.supervision.health.failures, 0);
  assert.equal(h.timers.count(), 0);
});

test('dispose removes every listener and clears every timer', () => {
  const h = harness({ policy: { graceMs: 5000 } });
  h.reachReady();
  h.wc.emit('unresponsive');
  assert.equal(h.timers.count(), 1);
  h.supervision.dispose();
  assert.equal(h.timers.count(), 0);
  assert.equal(h.wc.listenerCount('render-process-gone'), 0);
  assert.equal(h.wc.listenerCount('unresponsive'), 0);
  assert.equal(h.wc.listenerCount('responsive'), 0);
  assert.equal(h.wc.listenerCount('did-finish-load'), 0);
  h.wc.emit('render-process-gone', { reason: 'crashed' });
  assert.equal(h.supervision.health.failures, 0, 'a disposed supervisor is inert');
});

test('the exit code is reported when the renderer dies without a known reason', () => {
  const h = harness();
  h.reachReady();
  h.wc.emit('render-process-gone', { reason: 'something-new', exitCode: 7 });
  assert.match(String(h.fsm.reason), /renderer gone: unknown \(exit 7\)/);
});
