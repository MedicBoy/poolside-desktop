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
  let clock = Date.parse('2026-09-21T12:00:00.000Z');
  let mono = 1000;
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
    participant: overrides.participant || null,
    journal: {
      // A ledger left behind by a previous run, when a test wants one.
      read: () => overrides.initial || coordination.emptyState(),
      write: state => {
        if (overrides.failWrite) throw new Error('disk is full');
        writes.push(state);
        return state;
      }
    },
    now: () => clock,
    monotonic: () => mono,
    ready: overrides.ready || null,
    setTimer: (callback, delay) => ({ callback, delay, unref: () => {} }),
    clearTimer: () => {},
    dropoutGraceMs: overrides.dropoutGraceMs,
    makeId: (() => {
      let index = 0;
      return () => `match-${++index}`;
    })()
  });
  return {
    service,
    logs,
    writes,
    opened,
    accounts,
    publishes: () => publishes,
    setClock: value => {
      clock = value;
    },
    advanceClock: ms => {
      clock += ms;
    },
    bumpMonotonic: ms => {
      mono += ms;
    },
    match: () => service.state().matches[0]
  };
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

test('a match left in progress by a previous run is interrupted when the ledger is opened', async () => {
  // The operator's report: "I am already in a match" with nothing open. Nothing from a previous run of the
  // program can still be in progress, because the windows went with the process that held them.
  const initial = coordination.start(coordination.emptyState(), {
    first: 'a',
    second: 'b',
    accounts: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    now: Date.parse('2026-09-21T12:00:00.000Z'),
    matchId: 'from-last-run'
  });
  const { service, logs, writes } = harness({ initial });
  const view = service.view();
  assert.equal(view.totals.active, 0, 'nothing is in progress at startup');
  assert.equal(view.totals.cancelled, 1);
  assert.equal(service.state().matches[0].reason, 'Poolside was closed while m1 was in progress, so it was recorded as interrupted.');
  assert.match(logs[0].message, /recorded as interrupted/);
  assert.equal(logs[0].kind, 'warning');
  assert.ok(writes.length, 'the interruption is written, not only held in memory');
  // And the accounts are free again: the whole point of settling it rather than leaving it.
  const started = await service.start({ first: 'a', second: 'b', load: false });
  assert.equal(started.totals.active, 1);
  assert.equal(started.active[0].handle, 'm2');
});

test('a run can be paused and resumed, and a paused run starts nothing', async () => {
  const { service, logs } = harness();
  const started = await service.startRun({ first: 'a', second: 'b', plan: { table: 'Rome', matchLimit: 3 }, load: false });
  const running = /** @type {any} */ (started.runs.active);
  const runId = running.runId;
  // The run takes an identity of its own, then the match takes the next one.
  service.complete({ matchId: started.active[0].matchId, winner: 'a' });

  const paused = service.pauseRun({ runId, reason: '' });
  assert.equal(/** @type {any} */ (paused.runs.active).state, 'paused');
  assert.equal(/** @type {any} */ (paused.runs.active).progress.completed, 1);
  assert.match(logs.at(-1).message, /r1 paused: Paused by the operator\./);
  await assert.rejects(
    () => service.start({ first: 'a', second: 'b', load: false }),
    /r1 is paused\. Resume it before starting the next match, or stop the run\./
  );

  const resumed = service.resumeRun({ runId });
  assert.equal(/** @type {any} */ (resumed.runs.active).state, 'active');
  assert.match(logs.at(-1).message, /r1 resumed\./);
  const next = await service.start({ first: 'a', second: 'b', load: false });
  assert.equal(next.totals.active, 1);
  assert.equal(next.active[0].runId, runId, 'the next match still belongs to the run');
});

test('a match whose session has gone is cancelled as a dropout, but only after the grace period', async () => {
  const open = { a: true, b: true };
  const { service, logs, advanceClock, accounts, match } = harness({
    participant: id => ({ open: open[id] === true, status: open[id] === true ? 'ready' : 'closed', footprint: null }),
    dropoutGraceMs: 5000
  });
  assert.equal(accounts.length, 3);
  await service.start({ first: 'a', second: 'b', load: false });
  open.b = false;
  service.refresh();
  assert.equal(match().state, 'active', 'a session that has only just gone is not a dropout yet');
  advanceClock(2000);
  open.b = true;
  service.refresh();
  assert.equal(match().state, 'active', 'a window that comes back is a blink, not a dropout');
  open.b = false;
  service.refresh();
  advanceClock(9000);
  service.refresh();
  assert.equal(match().state, 'cancelled');
  assert.match(match().reason, /Bob's session has been closed for 9 seconds, so m1 was cancelled as a dropout\./);
  assert.match(logs.map(entry => entry.message).join(' '), /cancelled as a dropout/);
  assert.equal(service.view().totals.active, 0);
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

test('the dashboard surface exposes the match and run channels and passes input through to the engine', async () => {
  const { service } = harness();
  const handlers = new Map();
  registerMatchIpc({ handle: (name, fn) => handlers.set(name, fn), matches: service });
  assert.deepEqual([...handlers.keys()].sort(), [
    'match:arm',
    'match:arm-cancel',
    'match:cancel',
    'match:complete',
    'match:load',
    'match:pairing',
    'match:start',
    'match:state',
    'run:pause',
    'run:resume',
    'run:start',
    'run:stop'
  ]);
  assert.equal(handlers.get('match:state')().totals.recorded, 0);
  assert.equal((await handlers.get('match:start')({ first: 'a', second: 'b', load: false })).totals.active, 1);
  assert.equal(handlers.get('match:complete')({ matchId: 'match-1', winner: 'a' }).totals.completed, 1);
  await assert.rejects(() => handlers.get('match:start')({ first: 'a', second: 'a', load: false }), /two different accounts/);
  await assert.rejects(() => handlers.get('match:start')({ load: false }), /Choose two accounts/);
  assert.throws(() => handlers.get('match:cancel')({ matchId: 42 }), /not in the local ledger/);
});

test('a run started through the dashboard surface plans the match it begins and stops on request', async () => {
  const { service } = harness();
  const handlers = new Map();
  registerMatchIpc({ handle: (name, fn) => handlers.set(name, fn), matches: service });
  const started = await handlers.get('run:start')({
    first: 'a',
    second: 'b',
    plan: { table: 'Rome', matchLimit: 3, stopAfterFailures: 2, stopAfterMinutes: 45 },
    load: false
  });
  assert.equal(started.runs.active.handle, 'r1');
  assert.equal(started.runs.active.plan.table, 'Rome');
  assert.equal(started.runs.active.progress.completed, 0);
  assert.equal(started.active[0].runId, started.runs.active.runId, 'the first match belongs to the run');
  const stopped = handlers.get('run:stop')({ runId: started.runs.active.runId });
  assert.equal(stopped.runs.active, null);
  assert.equal(stopped.runs.recent[0].outcomeLabel, 'Stopped by the operator');
  assert.equal(stopped.totals.cancelled, 1, 'stopping the run cancelled the match it was holding');
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

test('a match waits at the barrier until every participant is ready', async () => {
  const readyIds = new Set();
  const { service, match, bumpMonotonic } = harness({ openSession: true, ready: id => readyIds.has(id) });
  await service.start({ first: 'a', second: 'b' });
  assert.equal(match().readiness.verdict, 'preparing');
  assert.equal(match().readiness.releasedAt, null);

  readyIds.add('a');
  service.advance();
  assert.equal(match().readiness.verdict, 'preparing', 'one ready participant does not release the match');

  bumpMonotonic(2500);
  readyIds.add('b');
  service.advance();
  assert.equal(match().readiness.verdict, 'ready');
  assert.equal(match().readiness.skewMs, 2500, 'release records how long the barrier took');
  assert.ok(match().readiness.releasedAt);
  assert.match(match().readiness.reason, /Alice and Bob are ready/);
});

test('a participant that never becomes ready blocks release at the deadline', async () => {
  const { service, match, logs, advanceClock } = harness({ openSession: true, ready: id => id === 'a' });
  await service.start({ first: 'a', second: 'b' });
  advanceClock(119000);
  service.advance();
  assert.equal(match().readiness.verdict, 'preparing', 'still within the deadline');
  advanceClock(2000);
  service.advance();
  assert.equal(match().readiness.verdict, 'blocked');
  assert.match(match().readiness.reason, /Bob \(The session is not ready\.\) did not become ready within 120 seconds/);
  assert.equal(match().readiness.releasedAt, null);
  assert.equal(logs.at(-1).kind, 'warning');
  assert.match(logs.at(-1).message, /m1: Bob \(The session is not ready\.\) did not become ready/);
});

test('release is withdrawn the moment a participant stops being ready', async () => {
  const readyIds = new Set(['a', 'b']);
  const { service, match } = harness({ openSession: true, ready: id => readyIds.has(id) });
  await service.start({ first: 'a', second: 'b' });
  service.advance();
  assert.equal(match().readiness.verdict, 'ready');
  readyIds.delete('b');
  service.advance();
  assert.equal(match().readiness.verdict, 'preparing');
  assert.match(match().readiness.reason, /Release was withdrawn: Bob \(The session is not ready\.\)/);
  assert.equal(match().readiness.releasedAt, null);
});

test('checking the barrier writes nothing while nothing has changed', async () => {
  const { service, writes, advanceClock } = harness({ openSession: true, ready: () => false });
  await service.start({ first: 'a', second: 'b' });
  const before = writes.length;
  advanceClock(1000);
  assert.equal(service.advance(), false, 'nothing to record');
  assert.equal(writes.length, before, 'a no-op check does not write the ledger');
});

test('a readiness check with no predicate blocks rather than pretending to be ready', async () => {
  const { service, match, advanceClock } = harness();
  await service.start({ first: 'a', second: 'b', load: false });
  advanceClock(121000);
  service.advance();
  assert.equal(match().readiness.verdict, 'blocked');
  assert.match(
    match().readiness.reason,
    /Alice \(This build cannot inspect a participant\.\); Bob \(This build cannot inspect a participant\.\) did not become ready within 120 seconds/
  );
});

test('a participant that loaded on the wrong route blocks release, and says which route it used', async () => {
  const footprints = {
    a: {
      route: { configured: true, label: 'Proxy 1.2.3.4:8080' },
      verified: { ok: true, matches: true, route: { label: 'Proxy 1.2.3.4:8080' } }
    },
    b: {
      route: { configured: true, label: 'Proxy 5.6.7.8:8080' },
      verified: { ok: true, matches: false, route: { label: 'Direct connection' } }
    }
  };
  const exits = { a: { checked: true, ip: '203.0.113.1' }, b: { checked: true, ip: '203.0.113.1' } };
  const { service, match, logs } = harness({
    openSession: true,
    participant: id => ({ open: true, status: 'ready', footprint: footprints[id], exit: exits[id] })
  });
  await service.start({ first: 'a', second: 'b' });
  assert.equal(match().readiness.verdict, 'preparing', 'one participant on the wrong route is not releasable');
  service.advance();
  assert.equal(match().readiness.verdict, 'preparing');

  // Fix the route and the match releases on the next check.
  footprints.b.verified = { ok: true, matches: true, route: { label: 'Proxy 5.6.7.8:8080' } };
  exits.b = { checked: true, ip: '203.0.113.2' };
  service.advance();
  assert.equal(match().readiness.verdict, 'ready');
  assert.match(logs.map(entry => entry.message).join(' '), /Alice and Bob are ready, leaving through different exits\./);
});

test('a blocked match names the check that failed, not just the participant', async () => {
  const { service, match, advanceClock } = harness({
    openSession: true,
    participant: () => ({
      open: true,
      status: 'ready',
      footprint: { route: { configured: true, label: 'Proxy 1.2.3.4:8080' }, verified: { ok: false, error: 'resolveProxy failed' } }
    })
  });
  await service.start({ first: 'a', second: 'b' });
  advanceClock(121000);
  service.advance();
  assert.equal(match().readiness.verdict, 'blocked');
  assert.match(match().readiness.reason, /Alice \(The route could not be read: resolveProxy failed\.\)/);
  assert.match(match().readiness.reason, /Bob \(The route could not be read: resolveProxy failed\.\)/);
});
