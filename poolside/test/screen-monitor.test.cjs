const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenMonitor, MIN_INTERVAL_MS } = require('../src/screen-monitor.cjs');
/** Let the tick that `start` triggers finish before the test drives its own. */
async function settle() {
  for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve));
}
test('the monitor service requires an open window and stops cleanly', async () => {
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

test('every window that is on screen is read, whether or not it has focus', async () => {
  // The defect this pins: only the focused window used to be read, so clicking one account starved the other
  // and two readings could never be fresh together. Focus has nothing to do with it — being on screen does.
  const open = new Set(['a']);
  let onScreen = true;
  let reads = 0;
  const monitor = createScreenMonitor({
    inspect: async () => {
      reads += 1;
    },
    isOpen: id => open.has(id),
    isSampleable: () => onScreen,
    publish: () => {},
    intervalMs: 1
  });
  monitor.start('a');
  await settle();
  assert.equal(reads, 1, 'a window on screen is read without being focused');
  assert.equal(monitor.status('a').sampleable, true);
  onScreen = false;
  await monitor.tick();
  assert.equal(reads, 1, 'a window that is not on screen is not read');
  assert.equal(monitor.status('a').active, true, 'it stays monitored while it is away');
  assert.equal(monitor.status('a').sampleable, false);
  onScreen = true;
  await monitor.tick();
  assert.equal(reads, 2, 'coming back on screen resumes reading');
  monitor.dispose();
});

test('a page that is not being rendered is skipped rather than read from its last painted frame', async () => {
  const open = new Set(['a']);
  let visible = false;
  const reads = [];
  const monitor = createScreenMonitor({
    inspect: async id => {
      reads.push(id);
    },
    isOpen: id => open.has(id),
    isRendering: async () => visible,
    publish: () => {},
    intervalMs: 1
  });
  monitor.start('a');
  await settle();
  assert.deepEqual(reads, [], 'a hidden page is left alone, and its own interval is kept');
  visible = true;
  await monitor.tick();
  assert.deepEqual(reads, ['a'], 'and it is read as soon as it is rendering again');
  monitor.dispose();
});

test('a page that cannot be asked about rendering is left to the inspector to judge', async () => {
  const reads = [];
  const monitor = createScreenMonitor({
    inspect: async id => {
      reads.push(id);
    },
    isOpen: () => true,
    isRendering: async () => {
      throw new Error('the page did not answer');
    },
    publish: () => {},
    intervalMs: 1
  });
  monitor.start('a');
  await settle();
  assert.deepEqual(reads, ['a']);
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
