const { test } = require('node:test');
const assert = require('node:assert/strict');
const navigation = require('../src/table-navigation-state.cjs');

const T0 = Date.parse('2026-09-21T12:00:00.000Z');

test('the dry-run plan follows lobby, table selection, target, table opening, and matchmaking', () => {
  let plan = navigation.start('London', { now: T0 });
  assert.equal(plan.state, 'locating-lobby');
  plan = navigation.observe(plan, { state: 'lobby' }, T0 + 1);
  assert.equal(plan.state, 'opening-table-selection');
  assert.equal(navigation.requiredAction(plan), 'open-table-selection');
  plan = navigation.advance(plan, T0 + 2);
  assert.equal(plan.state, 'locating-table');
  plan = navigation.observe(plan, { state: 'table-selection', visibleTables: ['London', 'Sydney'] }, T0 + 3);
  assert.equal(plan.state, 'target-ready');
  assert.equal(navigation.requiredAction(plan), 'open-target-table');
  plan = navigation.advance(plan, T0 + 4);
  assert.equal(plan.state, 'opening-table');
  plan = navigation.observe(plan, { state: 'connecting' }, T0 + 5);
  assert.equal(plan.state, 'matchmaking');
  plan = navigation.confirmMatchReady(plan, T0 + 6);
  assert.equal(plan.state, 'complete');
  assert.equal(plan.deadlineAt, null);
});

test('table observations distinguish a visible target from a list that still needs searching', () => {
  const plan = navigation.start('Rome', { now: T0 });
  const missing = navigation.observe(plan, { state: 'table-selection', visibleTables: ['London', 'Sydney'] }, T0 + 1);
  assert.equal(missing.state, 'locating-table');
  assert.equal(navigation.requiredAction(missing), 'search-table-list');
  assert.match(missing.history.at(-1).detail, /Rome is not visible/);
  const found = navigation.observe(missing, { state: 'table-selection', visibleTables: ['Rome'] }, T0 + 2);
  assert.equal(found.state, 'target-ready');
});

test('detours return to lobby-finding without being invented as navigation progress', () => {
  let plan = navigation.start('Tokyo', { now: T0 });
  plan = navigation.observe(plan, { state: 'shop' }, T0 + 1);
  assert.equal(plan.state, 'locating-lobby');
  assert.equal(navigation.requiredAction(plan), 'return-to-lobby');
  plan = navigation.observe(plan, { state: 'unrecognized' }, T0 + 2);
  assert.equal(plan.state, 'locating-lobby');
  assert.equal(plan.history.at(-1).event, 'observation-inconclusive');
});

test('timeouts, cancellation, and retries are explicit and bounded', () => {
  const plan = navigation.start('Berlin', { now: T0 });
  const failed = navigation.observe(plan, { state: 'lobby' }, T0 + navigation.STAGE_TIMEOUT_MS);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.deadlineAt, null);
  const retried = navigation.retry(failed, T0 + navigation.STAGE_TIMEOUT_MS + 1);
  assert.equal(retried.state, 'locating-lobby');
  assert.equal(retried.retryCount, 1);
  const cancelled = navigation.cancel(retried, T0 + navigation.STAGE_TIMEOUT_MS + 2);
  assert.equal(cancelled.state, 'cancelled');
  assert.throws(() => navigation.advance(cancelled), /no manual navigation step/i);
});

test('only catalogued table targets can start a plan', () => {
  assert.throws(() => navigation.start('Atlantis', { now: T0 }), /supported target table/);
});
