const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTableNavigationService } = require('../src/table-navigation-service.cjs');

/** @param {(() => Promise<any>) | null} [inspectGame] */
function fixture(inspectGame = null) {
  let now = Date.parse('2026-09-21T12:00:00.000Z');
  let timerId = 0;
  const timers = new Map();
  const account = { id: 'account-1', name: 'Main' };
  const group = { window: { isDestroyed: () => false } };
  const sessions = new Map([[account.id, group]]);
  const logs = [];
  let publishes = 0;
  let observed = { state: 'lobby', visibleTables: [], observedAt: new Date(now).toISOString() };
  const service = createTableNavigationService({
    sessions,
    getAccount: id => {
      if (id !== account.id) throw new Error('Account not found.');
      return account;
    },
    inspector: { inspectGame: inspectGame || (async () => observed) },
    publish: () => {
      publishes += 1;
    },
    log: (message, kind) => logs.push({ message, kind }),
    now: () => now,
    setTimer: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: id => timers.delete(id)
  });
  return {
    service,
    account,
    group,
    logs,
    timers,
    publishes: () => publishes,
    setNow: value => {
      now = value;
    },
    setObserved: value => {
      observed = value;
    }
  };
}

test('the service stores a no-click plan on the live session and advances it from inspection', async () => {
  const f = fixture();
  const started = f.service.start({ id: f.account.id, targetTable: 'London' });
  assert.equal(started.mode, 'dry-run');
  assert.equal(started.input.performed, false);
  assert.equal(f.group.tableNavigation.targetTable, 'London');
  const observed = await f.service.observe(f.account.id);
  assert.equal(observed.state, 'opening-table-selection');
  assert.equal(observed.input.action, 'open-table-selection');
  const advanced = f.service.advance(f.account.id);
  assert.equal(advanced.state, 'locating-table');
  assert.ok(f.publishes() >= 3);
  assert.match(f.logs.map(entry => entry.message).join(' '), /table-navigation dry run/);
  f.service.dispose();
});

test('the service refuses parallel plans and supports cancel then retry', () => {
  const f = fixture();
  f.service.start({ id: f.account.id, targetTable: 'Rome' });
  assert.throws(() => f.service.start({ id: f.account.id, targetTable: 'Tokyo' }), /Cancel the current/);
  assert.equal(f.service.cancel(f.account.id).state, 'cancelled');
  const retried = f.service.retry(f.account.id);
  assert.equal(retried.state, 'locating-lobby');
  assert.equal(retried.retryCount, 1);
  f.service.dispose();
});

test('a screen check started before cancel cannot advance a retried plan', async () => {
  let finishInspection;
  const f = fixture(
    () =>
      new Promise(resolve => {
        finishInspection = resolve;
      })
  );
  f.service.start({ id: f.account.id, targetTable: 'Rome' });
  const pending = f.service.observe(f.account.id);
  f.service.cancel(f.account.id);
  const retried = f.service.retry(f.account.id);
  const publishCount = f.publishes();
  finishInspection({ state: 'lobby', observedAt: '2026-09-21T12:00:00.000Z' });
  assert.equal(await pending, retried);
  assert.equal(f.group.tableNavigation.state, 'locating-lobby');
  assert.equal(f.publishes(), publishCount);
  f.service.dispose();
});

test('a live deadline marks the plan failed and publishes a warning', () => {
  const f = fixture();
  const started = f.service.start({ id: f.account.id, targetTable: 'Seoul' });
  assert.equal(f.timers.size, 1);
  const pending = [...f.timers.values()][0];
  f.setNow(Date.parse(started.deadlineAt));
  pending.callback();
  assert.equal(f.group.tableNavigation.state, 'failed');
  assert.equal(f.logs.at(-1).kind, 'warning');
  assert.match(f.logs.at(-1).message, /120 seconds/);
  f.service.dispose();
});

test('closed sessions cannot acquire a navigation plan', () => {
  const f = fixture();
  f.group.window.isDestroyed = () => true;
  assert.throws(() => f.service.start({ id: f.account.id, targetTable: 'London' }), /Open this account window/);
});
