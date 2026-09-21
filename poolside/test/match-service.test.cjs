const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatchService } = require('../src/match-service.cjs');
const coordination = require('../src/match-coordination.cjs');
const { registerMatchIpc } = require('../src/match-ipc.cjs');

function harness(overrides = {}) {
  const logs = [];
  let publishes = 0;
  const writes = [];
  const opened = [];
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
    openSession:
      overrides.openSession === undefined
        ? null
        : async id => {
            if (overrides.failFor === id) throw new Error('this profile could not be opened');
            opened.push(id);
          },
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
  return { service, logs, writes, opened, accounts, publishes: () => publishes };
}

test('starting a match publishes, logs and persists it', async () => {
  const { service, logs, writes, publishes } = harness();
  const view = await service.start({ first: 'a', second: 'b', load: false });
  assert.equal(view.totals.active, 1);
  assert.match(logs[0].message, /Alice vs Bob: m1 is in progress\./);
  assert.equal(writes.length, 1);
  assert.equal(publishes(), 1);
});

test('completing and cancelling name what happened in the activity history', () => {
  const { service, logs } = harness();
  service.start({ first: 'a', second: 'b', load: false });
  const settled = service.complete({ matchId: 'match-1', winner: 'b' });
  assert.equal(settled.totals.completed, 1);
  assert.match(logs.at(-1).message, /m1: Bob recorded as the winner\./);
  service.start({ first: 'a', second: 'b', load: false });
  const cancelled = service.cancel({ matchId: 'match-2', reason: 'Window closed.' });
  assert.equal(cancelled.totals.cancelled, 1);
  assert.match(logs.at(-1).message, /m2: Window closed\./);
});

test('reading the ledger cancels a match whose participant has left the workspace', () => {
  const { service, logs, accounts } = harness();
  service.start({ first: 'a', second: 'b', load: false });
  accounts.splice(1, 1); // Bob is removed from the workspace.
  const view = service.view();
  assert.equal(view.totals.active, 0);
  assert.equal(view.totals.cancelled, 1);
  assert.equal(logs.at(-1).kind, 'warning');
  assert.match(logs.at(-1).message, /Bob is no longer an active account/);
});

test('a refused operation says why and changes nothing', async () => {
  const { service, writes } = harness();
  await assert.rejects(() => service.start({ first: 'a', second: 'a', load: false }), /two different accounts/);
  await assert.rejects(() => service.start({ first: 'a', second: 'ghost', load: false }), /no longer an active account/);
  assert.throws(() => service.complete({ matchId: 'nope', winner: 'a' }), /not in the local ledger/);
  assert.equal(writes.length, 0);
});

test('a ledger that cannot be written is reported without losing the match in memory', async () => {
  const { service, logs } = harness({ failWrite: true });
  const view = await service.start({ first: 'a', second: 'b', load: false });
  assert.equal(view.totals.active, 1);
  assert.match(logs[0].message, /could not be saved: disk is full/);
  assert.equal(logs[0].kind, 'warning');
});

test('the dashboard surface exposes five channels and passes input through to the engine', async () => {
  const { service } = harness();
  const handlers = new Map();
  registerMatchIpc({ handle: (name, fn) => handlers.set(name, fn), matches: service });
  assert.deepEqual([...handlers.keys()].sort(), ['match:cancel', 'match:complete', 'match:load', 'match:start', 'match:state']);
  assert.equal(handlers.get('match:state')().totals.recorded, 0);
  assert.equal((await handlers.get('match:start')({ first: 'a', second: 'b', load: false })).totals.active, 1);
  assert.equal(handlers.get('match:complete')({ matchId: 'match-1', winner: 'a' }).totals.completed, 1);
  await assert.rejects(() => handlers.get('match:start')({ first: 'a', second: 'a', load: false }), /two different accounts/);
  await assert.rejects(() => handlers.get('match:start')({ load: false }), /Choose two accounts/);
  assert.throws(() => handlers.get('match:cancel')({ matchId: 42 }), /not in the local ledger/);
});

test('starting a match loads both participants through the session manager', async () => {
  const { service, opened, logs } = harness({ openSession: true });
  const view = await service.start({ first: 'a', second: 'b' });
  assert.deepEqual(opened, ['a', 'b']);
  assert.deepEqual(
    view.load.map(entry => [entry.name, entry.opened]),
    [
      ['Alice', true],
      ['Bob', true]
    ]
  );
  assert.match(logs.at(-1).message, /m1: both sessions are loading\./);
});

test('one participant failing to load is reported without stopping the other', async () => {
  const { service, opened, logs } = harness({ openSession: true, failFor: 'b' });
  const view = await service.start({ first: 'a', second: 'b' });
  assert.deepEqual(opened, ['a'], 'the healthy participant still loads');
  const failed = view.load.filter(entry => !entry.opened);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].name, 'Bob');
  assert.match(failed[0].error, /could not be opened/);
  assert.equal(logs.at(-1).kind, 'warning');
  assert.match(logs.at(-1).message, /Bob: the session could not be opened for m1/);
  assert.equal(view.totals.active, 1, 'the match itself is still recorded');
});

test('a match can be re-loaded after a profile was closed', async () => {
  const { service, opened } = harness({ openSession: true });
  await service.start({ first: 'a', second: 'b' });
  opened.length = 0;
  const view = await service.load({ matchId: 'match-1' });
  assert.deepEqual(opened, ['a', 'b']);
  assert.equal(view.load.length, 2);
  assert.equal(view.totals.active, 1);
});

test('loading refuses an unknown or settled match', async () => {
  const { service } = harness({ openSession: true });
  await service.start({ first: 'a', second: 'b', load: false });
  await assert.rejects(() => service.load({ matchId: 'nope' }), /not in the local ledger/);
  service.complete({ matchId: 'match-1', winner: 'a' });
  await assert.rejects(() => service.load({ matchId: 'match-1' }), /no longer active/);
});
