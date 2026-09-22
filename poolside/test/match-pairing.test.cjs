// The pairing checker: when it judges, what it writes, and when it stops looking.

const test = require('node:test');
const assert = require('node:assert/strict');
const coordination = require('../src/match-coordination.cjs');
const { createPairingChecker } = require('../src/match-pairing.cjs');

const AT = Date.parse('2026-09-21T12:00:00.000Z');
const ACCOUNTS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' }
];

/** @param {{screens?: Record<string, any>, windowMs?: number}} [options] */
function harness({ screens = {}, windowMs = 120000 } = {}) {
  let clock = AT;
  const logs = [];
  let publishes = 0;
  const timers = [];
  const store = { current: coordination.emptyState() };
  const checker = createPairingChecker({
    store,
    persist: state => state,
    publish: () => publishes++,
    log: (message, kind) => logs.push({ message, kind }),
    observe: id => screens[id] || null,
    now: () => clock,
    windowMs,
    checkMs: 5000,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref: () => {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    }
  });
  /** A match that has been released: the only state a pairing is judged in. */
  function released(matchId = 'match-1') {
    let state = coordination.start(store.current, { first: 'a', second: 'b', accounts: ACCOUNTS, now: clock, matchId });
    state = coordination.requestReadiness(state, { matchId, now: clock, deadlineMs: 120000 });
    state = coordination.settleReadiness(state, {
      matchId,
      verdict: 'ready',
      reason: 'Both are ready.',
      releasedAt: clock,
      skewMs: 400,
      now: clock
    });
    store.current = state;
  }
  const match = () => store.current.matches[0];
  return {
    checker,
    store,
    logs,
    timers,
    screens,
    released,
    match,
    publishes: () => publishes,
    setClock: value => {
      clock = value;
    }
  };
}

/** @param {string} state @param {any} options */
const screen = (state, { at = AT, table = null, readings = null } = {}) => ({
  state,
  observedAt: new Date(at).toISOString(),
  visibleTables: [],
  tableMatch: table ? { table, method: 'local-evidence' } : null,
  readings: readings || {}
});
/** @param {number} value @param {number} at */
const coins = (value, at = AT) => ({
  label: 'Coins',
  value,
  exact: true,
  confidence: 0.95,
  observedAt: new Date(at).toISOString(),
  source: 'in-game header'
});

test('a released match with nothing on either screen is recorded as not enough evidence', () => {
  const { checker, released, match, logs } = harness();
  released();
  checker.check('match-1');
  assert.equal(match().pairing.verdict, 'incomplete');
  assert.equal(match().pairing.label, 'Not enough evidence yet');
  assert.equal(match().pairing.reason, 'No screen reading yet from Alice and Bob.');
  assert.equal(match().pairing.checkedAt, new Date(AT).toISOString());
  assert.equal(match().history.at(-1).event, 'pairing-evidence');
  assert.equal(match().history.at(-1).from, 'active');
  assert.match(logs.at(-1).message, /m1: pairing evidence — Not enough evidence yet/);
});

test('a verdict that has not changed is not written again', () => {
  const { checker, released, match, publishes, logs } = harness();
  released();
  checker.check('match-1');
  const writes = publishes();
  const entries = match().history.length;
  checker.check('match-1');
  checker.check('match-1');
  assert.equal(publishes(), writes, 'the ledger is not rewritten for an unchanged verdict');
  assert.equal(match().history.length, entries);
  assert.equal(logs.length, 1);
});

test('the verdict improves by itself when a screen changes, and is written when it does', () => {
  const { checker, released, match, screens, setClock } = harness();
  released();
  checker.check('match-1');
  assert.equal(match().pairing.verdict, 'incomplete');
  screens.a = screen('table-selection', { table: 'Rome' });
  screens.b = screen('table-selection', { table: 'Rome' });
  setClock(AT + 5000);
  checker.check('match-1');
  assert.equal(match().pairing.verdict, 'agreed');
  assert.equal(match().pairing.table, 'Rome');
  assert.equal(
    match().pairing.reason,
    'Both screens show Rome. The balances do not confirm a shared entry, so this is agreement rather than proof of a pairing.'
  );
});

test('a paid entry is noticed between two readings and completes the strongest verdict', () => {
  const { checker, released, match, screens, setClock } = harness();
  released();
  screens.a = screen('table-selection', { table: 'Rome', readings: { coins: coins(5000) } });
  screens.b = screen('table-selection', { table: 'Rome', readings: { coins: coins(5000) } });
  checker.check('match-1');
  assert.equal(match().pairing.verdict, 'agreed', 'the balances have not moved yet');

  // Both accounts pay the same entry fee, a few seconds apart: what entering one table looks like.
  setClock(AT + 6000);
  screens.a = screen('table-selection', { table: 'Rome', readings: { coins: coins(4000, AT + 5000) }, at: AT + 5000 });
  checker.check('match-1');
  setClock(AT + 8000);
  screens.b = screen('table-selection', { table: 'Rome', readings: { coins: coins(4000, AT + 7000) }, at: AT + 7000 });
  checker.check('match-1');
  assert.equal(match().pairing.verdict, 'paired');
  assert.equal(match().pairing.amount, 1000);
  assert.equal(match().pairing.currency, 'coins');
});

test('an unchanged balance is not an entry, and a sighting older than the window stops counting', () => {
  const { checker, released, match, screens, setClock } = harness({ windowMs: 30000 });
  released();
  screens.a = screen('table-selection', { readings: { coins: coins(5000) } });
  screens.b = screen('table-selection', { readings: { coins: coins(5000) } });
  checker.check('match-1');
  setClock(AT + 2000);
  screens.a = screen('table-selection', { readings: { coins: coins(5000, AT + 2000) }, at: AT + 2000 });
  screens.b = screen('table-selection', { readings: { coins: coins(4000, AT + 2000) }, at: AT + 2000 });
  checker.check('match-1');
  assert.equal(match().pairing.verdict, 'incomplete', 'one account paying in is not a pairing');
  assert.match(match().pairing.reason, /Alice did not\./);

  // Far enough in the future that Bob's sighting and reading have both left the window: the answer names
  // Bob, whose screen has to be looked at again, rather than reporting the evidence it still has.
  setClock(AT + 200000);
  screens.a = screen('table-selection', { readings: { coins: coins(2000, AT + 199000) }, at: AT + 199000 });
  checker.check('match-1');
  assert.equal(match().pairing.verdict, 'incomplete');
  assert.equal(match().pairing.reason, 'The reading from Bob is older than the 30 second window. Look at that window again.');
});

test('a screen that disagrees is recorded as a warning, not written quietly', () => {
  const { checker, released, match, screens, logs, setClock } = harness();
  released();
  screens.a = screen('table-selection', { table: 'Rome' });
  screens.b = screen('table-selection', { table: 'Tokyo' });
  setClock(AT + 1000);
  checker.check('match-1');
  assert.equal(match().pairing.verdict, 'mismatch');
  assert.equal(logs.at(-1).kind, 'warning');
});

test('a match in progress is watched from the start, judged once released, and watched until paired', () => {
  const { checker, store, timers, screens, setClock } = harness();
  store.current = coordination.start(coordination.emptyState(), {
    first: 'a',
    second: 'b',
    accounts: ACCOUNTS,
    now: AT,
    matchId: 'match-1'
  });
  // Still preparing: there is nothing on either screen to read yet.
  checker.checkReleased();
  assert.equal(timers.length, 1, 'a match in progress is watched from the moment it exists');
  assert.equal(store.current.matches[0].pairing || null, null);

  store.current = coordination.settleReadiness(store.current, {
    matchId: 'match-1',
    verdict: 'ready',
    reason: 'Both are ready.',
    releasedAt: AT,
    skewMs: 10,
    now: AT
  });
  checker.checkReleased();
  assert.equal(timers.length, 1, 'a released match without a pairing is checked on a timer');
  assert.equal(timers[0].delay, 5000);
  assert.equal(store.current.matches[0].pairing.verdict, 'incomplete', 'release is what makes a judgement possible');

  screens.a = screen('table-selection', { table: 'Rome' });
  screens.b = screen('table-selection', { table: 'Rome' });
  setClock(AT + 1000);
  timers[0].callback();
  assert.equal(store.current.matches[0].pairing.verdict, 'agreed');
  assert.equal(timers.length, 1, 'agreement is not the strongest verdict, so the check goes on');

  const seen = { currency: 'coins', amount: 1000, at: AT - 1000 };
  checker.sightings.set('a', seen);
  checker.sightings.set('b', seen);
  timers[0].callback();
  assert.equal(store.current.matches[0].pairing.verdict, 'paired');
  assert.equal(timers.length, 0, 'with a pairing seen there is nothing left to watch for');
});

test('a match that is not in the ledger, or is already settled, cannot be judged', () => {
  const { checker, released, store, setClock } = harness();
  released();
  assert.throws(() => checker.check('nobody'), /not in the local ledger/);
  store.current = coordination.complete(store.current, { matchId: 'match-1', winner: 'a', now: AT + 1000 });
  setClock(AT + 2000);
  assert.throws(() => checker.check('match-1'), /no longer active/);
});

test('an explicit re-check answers even when the verdict has not moved', () => {
  const { checker, released, logs, match } = harness();
  released();
  const first = checker.check('match-1', { force: true });
  const second = checker.check('match-1', { force: true });
  assert.equal(first.verdict, 'incomplete');
  assert.equal(second.reason, match().pairing.reason);
  assert.match(logs.at(-1).message, /re-checked — Not enough evidence yet/);
});

test('stopping the checker clears the timer', () => {
  const { checker, released, timers } = harness();
  released();
  checker.checkReleased();
  assert.equal(timers.length, 1);
  checker.dispose();
  assert.equal(timers.length, 0);
});
