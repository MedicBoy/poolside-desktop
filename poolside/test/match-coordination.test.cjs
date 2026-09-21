const { test } = require('node:test');
const assert = require('node:assert/strict');
const coordination = require('../src/match-coordination.cjs');

const ACCOUNTS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Cleo' },
  { id: 'd', name: 'Dee' },
  { id: 'z', name: 'Zed', archived: true }
];
const AT = Date.parse('2026-09-21T12:00:00.000Z');
const pair = (first, second, extra = {}) => ({ first, second, accounts: ACCOUNTS, now: AT, matchId: `id-${first}${second}`, ...extra });

test('a match pairs two accounts and reports it in progress', () => {
  const state = coordination.start(coordination.emptyState(), pair('a', 'b'));
  assert.equal(state.sequence, 1);
  assert.equal(state.matches.length, 1);
  const match = state.matches[0];
  assert.equal(match.handle, 'm1');
  assert.equal(match.state, 'active');
  assert.deepEqual(
    match.participants.map(participant => participant.name),
    ['Alice', 'Bob']
  );
  assert.equal(match.history.at(-1).event, 'started');
  assert.equal(match.winnerId, null);
  const view = coordination.dashboardView(state);
  assert.deepEqual(view.totals, { recorded: 1, active: 1, completed: 0, cancelled: 0 });
  assert.equal(view.active.length, 1);
  assert.equal(view.recent.length, 0);
});

test('pairing refuses what the ledger could not describe honestly', () => {
  const empty = coordination.emptyState();
  assert.throws(() => coordination.start(empty, pair('a', 'a')), /two different accounts/);
  assert.throws(() => coordination.start(empty, pair('a', 'ghost')), /no longer an active account/);
  assert.throws(() => coordination.start(empty, pair('a', 'z')), /no longer an active account/);
  assert.throws(() => coordination.start(empty, pair('', 'b')), /Choose two accounts/);
  const running = coordination.start(empty, pair('a', 'b'));
  assert.throws(() => coordination.start(running, pair('a', 'c')), /Alice is already in an active match/);
  assert.throws(() => coordination.start(running, pair('c', 'b')), /Bob is already in an active match/);
});

test('two matches may run at once, and a finished account can be re-paired', () => {
  const first = coordination.start(coordination.emptyState(), pair('a', 'b'));
  const second = coordination.start(first, pair('c', 'd'));
  assert.equal(second.sequence, 2);
  assert.equal(coordination.dashboardView(second).totals.active, 2);
  const completed = coordination.complete(second, { matchId: second.matches[0].matchId, winner: 'c', now: AT + 1000 });
  const again = coordination.start(completed, pair('c', 'd', { matchId: 'id-again' }));
  assert.equal(coordination.dashboardView(again).totals.active, 2);
});

test('a result names one of the two participants and settles the match once', () => {
  const state = coordination.start(coordination.emptyState(), pair('a', 'b'));
  const matchId = state.matches[0].matchId;
  assert.throws(() => coordination.complete(state, { matchId, winner: 'c' }), /one of the two participants/);
  assert.throws(() => coordination.complete(state, { matchId: 'missing', winner: 'a' }), /not in the local ledger/);
  const done = coordination.complete(state, { matchId, winner: 'b', now: AT + 5000 });
  const match = done.matches[0];
  assert.equal(match.state, 'completed');
  assert.equal(match.winnerId, 'b');
  assert.equal(match.winnerName, 'Bob');
  assert.equal(match.endedAt, new Date(AT + 5000).toISOString());
  assert.equal(coordination.dashboardView(done).totals.completed, 1);
  assert.equal(coordination.dashboardView(done).active.length, 0);
  assert.throws(() => coordination.complete(done, { matchId, winner: 'a' }), /no longer active/);
  assert.throws(() => coordination.cancel(done, { matchId }), /no longer active/);
});

test('cancelling records why, and a blank reason still says something true', () => {
  const state = coordination.start(coordination.emptyState(), pair('a', 'b'));
  const matchId = state.matches[0].matchId;
  const silent = coordination.cancel(state, { matchId, reason: '   ' });
  assert.equal(silent.matches[0].reason, 'Cancelled before a result was recorded.');
  const spoken = coordination.cancel(state, { matchId, reason: 'Window closed before the rack finished.' });
  assert.equal(spoken.matches[0].reason, 'Window closed before the rack finished.');
  assert.equal(coordination.dashboardView(spoken).totals.cancelled, 1);
});

test('an account that leaves the workspace cancels its match rather than leaving a phantom', () => {
  const state = coordination.start(coordination.emptyState(), pair('a', 'b'));
  const unchanged = coordination.reconcile(state, ACCOUNTS, AT + 10);
  assert.equal(unchanged, state, 'a healthy ledger is returned untouched');
  const archived = coordination.reconcile(
    state,
    ACCOUNTS.filter(account => account.id !== 'a'),
    AT + 20
  );
  const match = archived.matches[0];
  assert.equal(match.state, 'cancelled');
  assert.match(match.reason, /Alice is no longer an active account/);
  assert.equal(match.history.at(-1).event, 'reconciled');
  assert.equal(coordination.dashboardView(archived).totals.cancelled, 1);
  const stillArchived = coordination.reconcile(
    archived,
    ACCOUNTS.filter(account => account.id !== 'a'),
    AT + 30
  );
  assert.equal(stillArchived, archived, 'an already-cancelled match is not touched twice');
});

test('the ledger never aliases the caller, and a dashboard view cannot be edited into the ledger', () => {
  const empty = coordination.emptyState();
  const state = coordination.start(empty, pair('a', 'b'));
  assert.deepEqual(empty, coordination.emptyState(), 'the input state is untouched');
  const view = coordination.dashboardView(state);
  view.active[0].participants[0].name = 'Tampered';
  view.active[0].state = 'completed';
  assert.equal(coordination.dashboardView(state).active[0].participants[0].name, 'Alice');
  assert.equal(state.matches[0].state, 'active');
});

test('the ledger stays bounded and keeps the newest records', () => {
  let state = coordination.emptyState();
  for (let index = 0; index < coordination.LEDGER_LIMIT + 5; index++) {
    state = coordination.start(state, pair('a', 'b', { matchId: `id-${index}` }));
    state = coordination.complete(state, { matchId: `id-${index}`, winner: 'a', now: AT + index });
  }
  assert.equal(state.matches.length, coordination.LEDGER_LIMIT);
  assert.equal(state.matches[0].handle, `m${coordination.LEDGER_LIMIT + 5}`);
  assert.equal(coordination.dashboardView(state).recent.length, 8, 'the dashboard shows a bounded recent list');
});

test('only a ledger this module could have written is read back from disk', () => {
  assert.deepEqual(coordination.cleanState(null), coordination.emptyState());
  assert.deepEqual(coordination.cleanState({ format: 'something-else/v1', matches: [{}] }), coordination.emptyState());
  const good = coordination.start(coordination.emptyState(), pair('a', 'b'));
  const stored = JSON.parse(JSON.stringify(good));
  stored.matches.push({ handle: 'm9', matchId: 'x', participants: [{ id: 'a', name: 'A' }], state: 'active', startedAt: 'nonsense' });
  const cleaned = coordination.cleanState(stored);
  assert.equal(cleaned.matches.length, 1, 'an unreadable entry is dropped rather than trusted');
  assert.equal(cleaned.sequence, Math.max(good.sequence, 1));
  const withoutSequence = coordination.cleanState({ format: coordination.FORMAT, matches: stored.matches.slice(0, 1) });
  assert.ok(Number.isInteger(withoutSequence.sequence) && withoutSequence.sequence >= 1);
});
