const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenMonitor, MIN_INTERVAL_MS } = require('../src/screen-monitor.cjs');
test('screen monitoring is opt-in, needs an open window, and stops cleanly', async () => {
  const open = new Set(['a']);
  let calls = 0;
  let published = 0;
  const monitor = createScreenMonitor({
    inspect: async () => {
      calls += 1;
    },
    isOpen: id => open.has(id),
    publish: () => {
      published += 1;
    },
    intervalMs: 1
  });
  assert.throws(() => monitor.start('missing'), /Open this account/);
  assert.equal(monitor.start('a').active, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(monitor.interval, MIN_INTERVAL_MS);
  assert.equal(monitor.stop('a').active, false);
  assert.ok(published >= 2);
  monitor.dispose();
});

test('a closed window is dropped from monitoring on the next tick', async () => {
  const open = new Set(['a']);
  let calls = 0;
  const monitor = createScreenMonitor({
    inspect: async () => {
      calls += 1;
    },
    isOpen: id => open.has(id),
    publish: () => {},
    intervalMs: 1
  });
  monitor.start('a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  open.delete('a');
  await monitor.tick();
  assert.equal(monitor.status('a').active, false, 'a window that disappeared is no longer monitored');
  assert.equal(calls, 1);
  monitor.dispose();
});

test('an unfocused window pauses and resumes without losing its place', async () => {
  const open = new Set(['a']);
  let focused = false;
  let calls = 0;
  const monitor = createScreenMonitor({
    inspect: async () => {
      calls += 1;
    },
    isOpen: id => open.has(id),
    isFocused: () => focused,
    publish: () => {},
    intervalMs: 1
  });
  monitor.start('a');
  await monitor.tick();
  assert.equal(calls, 0, 'an account that is not focused is not inspected');
  assert.equal(monitor.status('a').active, true, 'it stays monitored while paused');
  assert.equal(monitor.status('a').focused, false);
  focused = true;
  await monitor.tick();
  assert.equal(calls, 1, 'regaining focus resumes inspection');
  assert.equal(monitor.status('a').focused, true);
  monitor.dispose();
});

test('each account observes its own interval', async () => {
  const open = new Set(['a', 'b']);
  const calls = { a: 0, b: 0 };
  const monitor = createScreenMonitor({
    inspect: async id => {
      calls[id] += 1;
    },
    isOpen: id => open.has(id),
    publish: () => {},
    intervalFor: id => (id === 'b' ? 120000 : 30000)
  });
  assert.equal(monitor.start('a').intervalMs, 30000);
  assert.equal(monitor.start('b').intervalMs, 120000);
  await monitor.tick();
  assert.equal(calls.a, 1);
  assert.equal(calls.b, 1);
  await monitor.tick();
  assert.equal(calls.a, 1, 'neither account is due again before its own interval elapses');
  assert.equal(calls.b, 1);
  monitor.dispose();
});

test('start accepts an explicit interval override, and otherwise uses the configured one', () => {
  const open = new Set(['a']);
  const monitor = createScreenMonitor({
    inspect: async () => {},
    isOpen: id => open.has(id),
    publish: () => {},
    intervalFor: () => 30000
  });
  assert.equal(monitor.start('a', { intervalMs: 45000 }).intervalMs, 45000, 'an explicit override wins');
  assert.equal(monitor.start('a').intervalMs, 30000, 'without an override the configured interval is used');
  monitor.dispose();
});
