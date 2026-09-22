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

test('a match cannot outlive the process that was holding it', () => {
  // Reported as "I am already in a match" with nothing open. At startup no window from an earlier run
  // exists, so every match the ledger still calls active is recorded as interrupted, which frees the
  // accounts and says what happened rather than leaving a phantom in progress.
  let state = coordination.start(coordination.emptyState(), pair('a', 'b'));
  state = coordination.start(state, pair('c', 'd', { matchId: 'id-cd' }));
  state = coordination.complete(state, { matchId: 'id-ab', winner: 'a', now: AT + 1000 });
  const interrupted = coordination.interrupt(state, { now: AT + 2000 });
  assert.equal(interrupted.matches.filter(match => match.state === 'active').length, 0);
  const live = interrupted.matches.find(match => match.matchId === 'id-cd');
  assert.equal(live.state, 'cancelled');
  assert.equal(live.reason, 'Poolside was closed while m2 was in progress, so it was recorded as interrupted.');
  assert.equal(live.endedAt, new Date(AT + 2000).toISOString());
  assert.equal(live.history.at(-1).event, 'interrupted');
  assert.equal(interrupted.matches.find(match => match.matchId === 'id-ab').state, 'completed', 'a settled match is untouched');
  // Nothing in progress means nothing to do, and the same document comes back rather than a copy.
  assert.equal(coordination.interrupt(interrupted, { now: AT + 3000 }), interrupted);
  // And the accounts are free again.
  const restarted = coordination.start(interrupted, pair('a', 'b', { matchId: 'id-ab-again' }));
  assert.equal(restarted.matches.filter(match => match.state === 'active').length, 1);
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

test('the readiness barrier opens with a deadline and closes with a verdict', () => {
  const state = coordination.start(coordination.emptyState(), pair('a', 'b'));
  const matchId = state.matches[0].matchId;
  const waiting = coordination.requestReadiness(state, { matchId, now: AT, deadlineMs: 120000 });
  const opened = waiting.matches[0].readiness;
  assert.equal(opened.verdict, 'preparing');
  assert.equal(opened.requestedAt, new Date(AT).toISOString());
  assert.equal(opened.deadlineAt, new Date(AT + 120000).toISOString());
  assert.equal(opened.releasedAt, null);
  assert.equal(opened.skewMs, null);
  assert.equal(waiting.matches[0].history.at(-1).event, 'readiness-requested');

  const released = coordination.settleReadiness(waiting, {
    matchId,
    verdict: 'ready',
    reason: 'Alice and Bob are ready.',
    releasedAt: AT + 4200,
    skewMs: 4200,
    now: AT + 4200
  });
  const closed = released.matches[0].readiness;
  assert.equal(closed.verdict, 'ready');
  assert.equal(closed.releasedAt, new Date(AT + 4200).toISOString());
  assert.equal(closed.skewMs, 4200);
  assert.equal(released.matches[0].history.at(-1).event, 'released');
  assert.equal(coordination.dashboardView(released).active[0].readiness.verdict, 'ready');

  const blocked = coordination.settleReadiness(waiting, {
    matchId,
    verdict: 'blocked',
    reason: 'Bob did not become ready within 120 seconds.',
    now: AT + 121000
  });
  assert.equal(blocked.matches[0].readiness.verdict, 'blocked');
  assert.equal(blocked.matches[0].readiness.releasedAt, null);
  assert.equal(blocked.matches[0].readiness.skewMs, null);
  assert.match(blocked.matches[0].readiness.reason, /Bob did not become ready/);
  assert.equal(blocked.matches[0].history.at(-1).event, 'blocked');
});

test('the barrier refuses nonsense and a settled match cannot be re-armed', () => {
  const state = coordination.start(coordination.emptyState(), pair('a', 'b'));
  const matchId = state.matches[0].matchId;
  assert.throws(() => coordination.requestReadiness(state, { matchId, deadlineMs: 0 }), /deadline is required/);
  assert.throws(() => coordination.requestReadiness(state, { matchId: 'nope', deadlineMs: 1000 }), /not in the local ledger/);
  assert.throws(() => coordination.settleReadiness(state, { matchId, verdict: 'maybe', reason: '' }), /Unknown readiness verdict/);
  const done = coordination.complete(state, { matchId, winner: 'a', now: AT + 10 });
  assert.throws(() => coordination.requestReadiness(done, { matchId, deadlineMs: 1000 }), /no longer active/);
  assert.throws(() => coordination.settleReadiness(done, { matchId, verdict: 'ready', reason: '' }), /no longer active/);
});

test('a stored readiness record survives a round trip, and a malformed one is dropped', () => {
  const state = coordination.start(coordination.emptyState(), pair('a', 'b'));
  const matchId = state.matches[0].matchId;
  const withBarrier = coordination.requestReadiness(state, { matchId, now: AT, deadlineMs: 5000 });
  const roundTripped = coordination.cleanState(JSON.parse(JSON.stringify(withBarrier)));
  assert.deepEqual(roundTripped.matches[0].readiness, withBarrier.matches[0].readiness);
  const invented = JSON.parse(JSON.stringify(withBarrier));
  invented.matches[0].readiness = { verdict: 'probably', requestedAt: 'whenever', deadlineAt: 'whenever' };
  assert.equal(coordination.cleanState(invented).matches[0].readiness, null, 'an invented verdict is not trusted');
});
