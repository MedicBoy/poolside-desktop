const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatchService } = require('../src/match-service.cjs');
const coordination = require('../src/match-coordination.cjs');
const { registerMatchIpc } = require('../src/match-ipc.cjs');

function harness(overrides = {}) {
  const logs = [];
  let publishes = 0;
  const writes = [];
  const accounts = overrides.accounts || [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
    { id: 'c', name: 'Cleo' }
  ];
  const service = createMatchService({
    accounts: () => accounts,
    store: { current: coordination.emptyState() },
    publish: () => publishes++,
    log: (message, kind) => logs.push({ message, kind }),
    journal: {
      read: () => coordination.emptyState(),
      write: state => {
        if (overrides.failWrite) throw new Error('disk is full');
        writes.push(state);
        return state;
      }
    },
    now: () => Date.parse('2026-09-21T12:00:00.000Z'),
    makeId: (() => {
      let index = 0;
      return () => `match-${++index}`;
    })()
  });
  return { service, logs, writes, accounts, publishes: () => publishes };
}

test('starting a match publishes, logs and persists it', () => {
  const { service, logs, writes, publishes } = harness();
  const view = service.start({ first: 'a', second: 'b' });
  assert.equal(view.totals.active, 1);
  assert.match(logs[0].message, /Alice vs Bob: m1 is in progress\./);
  assert.equal(writes.length, 1);
  assert.equal(publishes(), 1);
});

test('completing and cancelling name what happened in the activity history', () => {
  const { service, logs } = harness();
  service.start({ first: 'a', second: 'b' });
  const settled = service.complete({ matchId: 'match-1', winner: 'b' });
  assert.equal(settled.totals.completed, 1);
  assert.match(logs.at(-1).message, /m1: Bob recorded as the winner\./);
  service.start({ first: 'a', second: 'b' });
  const cancelled = service.cancel({ matchId: 'match-2', reason: 'Window closed.' });
  assert.equal(cancelled.totals.cancelled, 1);
  assert.match(logs.at(-1).message, /m2: Window closed\./);
});

test('reading the ledger cancels a match whose participant has left the workspace', () => {
  const { service, logs, accounts } = harness();
  service.start({ first: 'a', second: 'b' });
  accounts.splice(1, 1); // Bob is removed from the workspace.
  const view = service.view();
  assert.equal(view.totals.active, 0);
  assert.equal(view.totals.cancelled, 1);
  assert.equal(logs.at(-1).kind, 'warning');
  assert.match(logs.at(-1).message, /Bob is no longer an active account/);
});

test('a refused operation says why and changes nothing', () => {
  const { service, writes } = harness();
  assert.throws(() => service.start({ first: 'a', second: 'a' }), /two different accounts/);
  assert.throws(() => service.start({ first: 'a', second: 'ghost' }), /no longer an active account/);
  assert.throws(() => service.complete({ matchId: 'nope', winner: 'a' }), /not in the local ledger/);
  assert.equal(writes.length, 0);
});

test('a ledger that cannot be written is reported without losing the match in memory', () => {
  const { service, logs } = harness({ failWrite: true });
  const view = service.start({ first: 'a', second: 'b' });
  assert.equal(view.totals.active, 1);
  assert.match(logs[0].message, /could not be saved: disk is full/);
  assert.equal(logs[0].kind, 'warning');
});

test('the dashboard surface exposes four channels and passes input through to the engine', () => {
  const { service } = harness();
  const handlers = new Map();
  registerMatchIpc({ handle: (name, fn) => handlers.set(name, fn), matches: service });
  assert.deepEqual([...handlers.keys()].sort(), ['match:cancel', 'match:complete', 'match:start', 'match:state']);
  assert.equal(handlers.get('match:state')().totals.recorded, 0);
  assert.equal(handlers.get('match:start')({ first: 'a', second: 'b' }).totals.active, 1);
  assert.equal(handlers.get('match:complete')({ matchId: 'match-1', winner: 'a' }).totals.completed, 1);
  assert.throws(() => handlers.get('match:start')({ first: 'a', second: 'a' }), /two different accounts/);
  assert.throws(() => handlers.get('match:start')(null), /Choose two accounts/);
  assert.throws(() => handlers.get('match:cancel')({ matchId: 42 }), /not in the local ledger/);
});
