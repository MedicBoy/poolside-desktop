const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRecovery, MONITOR_INTERVAL_DEFAULT } = require('../src/recovery-settings.cjs');
const { ShopReturnGate } = require('../src/shop-recovery.cjs');
const { observe } = require('../src/screen-attention.cjs');
test('reliability preferences keep safe defaults and use account values', () => {
  assert.deepEqual(resolveRecovery({}), {
    shopReturnDelaySeconds: 5,
    backgroundThrottling: false,
    repaintMitigation: true,
    monitorIntervalSeconds: MONITOR_INTERVAL_DEFAULT
  });
  assert.deepEqual(
    resolveRecovery({
      recovery: { shopReturnDelaySeconds: 9, backgroundThrottling: true, repaintMitigation: false, monitorIntervalSeconds: 45 }
    }),
    { shopReturnDelaySeconds: 9, backgroundThrottling: true, repaintMitigation: false, monitorIntervalSeconds: 45 }
  );
  // A malformed interval falls back rather than reaching the scheduler.
  assert.equal(resolveRecovery({ recovery: { monitorIntervalSeconds: 'fast' } }).monitorIntervalSeconds, MONITOR_INTERVAL_DEFAULT);
  const gate = new ShopReturnGate(9000);
  assert.equal(gate.observe('https://8ballpool.com/game', true, 0), false);
  assert.equal(gate.observe('https://8ballpool.com/game', true, 8999), false);
  assert.equal(gate.observe('https://8ballpool.com/game', true, 9000), true);
});
test('a prolonged local loading state is reported and a resolved screen clears it', () => {
  const initial = observe(null, { state: 'loading', observedAt: '2026-09-20T12:00:00.000Z' }, Date.parse('2026-09-20T12:00:00.000Z'));
  assert.ok(initial);
  assert.equal(initial.message, '');
  const stuck = observe(initial, { state: 'loading', observedAt: '2026-09-20T12:00:50.000Z' }, Date.parse('2026-09-20T12:00:50.000Z'));
  assert.ok(stuck);
  assert.match(stuck.message, /Reload page/);
  assert.equal(observe(stuck, { state: 'lobby' }), null);
});
