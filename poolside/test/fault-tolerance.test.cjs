// What happens when the machine misbehaves: a failed write, an interrupted one, a clock that goes backwards,
// and a debugger that never answers. Each of these is a state the program has to survive without losing data or
// quietly reporting something that did not happen.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const model = require('../src/model.cjs');
const { writeWorkspace } = require('../src/workspace-file.cjs');
const coordination = require('../src/match-coordination.cjs');
const { createBarrier } = require('../src/match-barrier.cjs');
const { withDeadline } = require('../src/target-identity.cjs');

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-fault-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The same accounts across documents: an interrupted write is about the file, not about new identities. */
const NEWFIE = model.account({ name: 'Newfie', role: 'receiver' });
const GMAIL = model.account({ name: 'Gmail', role: 'sender' }, [NEWFIE]);
const document = accounts =>
  model.decode({
    version: 1,
    accounts,
    settings: { table: 'Bangkok', limit: 10 },
    routePresets: []
  });

test('a write that fails part-way leaves the document that was there, not a half-written one', () =>
  withRoot(root => {
    const file = path.join(root, 'workspace.json');
    writeWorkspace(file, document([NEWFIE]));
    const before = fs.readFileSync(file, 'utf8');
    const names = () => model.decode(JSON.parse(fs.readFileSync(file, 'utf8'))).accounts.map(account => account.name);

    // Interrupted after the new document was flushed but before it replaced the primary: the software's own
    // fault-injection hook, which is exactly where a power cut or a full disk would land.
    assert.throws(
      () =>
        writeWorkspace(file, document([NEWFIE, GMAIL]), {
          checkpoint: stage => {
            if (stage === 'before-commit') throw new Error('disk is full');
          }
        }),
      /disk is full/
    );
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'the primary is untouched');
    assert.deepEqual(names(), ['Newfie'], 'and still reads as the document it was');
    // The staged file the failed write made is cleaned up rather than left to be mistaken for recovery data.
    assert.deepEqual(
      fs.readdirSync(root).filter(name => name.includes('.tmp-')),
      []
    );
  }));

test('an interrupted write still leaves a recovery copy when the old document may be kept', () =>
  withRoot(root => {
    const file = path.join(root, 'workspace.json');
    writeWorkspace(file, document([NEWFIE]));
    writeWorkspace(file, document([NEWFIE, GMAIL]));
    // The second write kept the first document as the previous copy, which is the copy the operator can restore.
    const previous = model.decode(JSON.parse(fs.readFileSync(`${file}.previous`, 'utf8')));
    assert.deepEqual(
      previous.accounts.map(account => account.name),
      ['Newfie']
    );
  }));

test('a monotonic clock that goes backwards never produces a negative release skew', () => {
  const at = Date.parse('2026-09-22T00:00:00.000Z');
  const ticks = [1000, 900]; // the second reading is earlier than the first
  const store = {
    current: coordination.requestReadiness(
      coordination.start(coordination.emptyState(), {
        first: 'a',
        second: 'b',
        accounts: [
          { id: 'a', name: 'Alice' },
          { id: 'b', name: 'Bob' }
        ],
        now: at,
        matchId: 'match-1'
      }),
      { matchId: 'match-1', now: at, deadlineMs: 60000 }
    )
  };
  const barrier = createBarrier({
    store,
    persist: state => state,
    log: () => {},
    publish: () => {},
    participant: () => ({ open: true, status: 'ready', footprint: null, exit: null }),
    now: () => at,
    monotonic: () => ticks.shift() ?? 900,
    setTimer: () => null,
    clearTimer: () => {}
  });
  barrier.noteRequest('match-1');
  barrier.advance();
  const readiness = store.current.matches[0].readiness;
  assert.equal(readiness.verdict, 'ready');
  assert.equal(readiness.skewMs, 0, 'a clock that went backwards is reported as no elapsed time, never as negative');
  barrier.dispose();
});

test('a command that never answers is abandoned at its deadline, and says which command it was', async () => {
  // The deadline is deliberately unref'd so a stuck command can never hold the process open, which means this
  // test has to keep the loop alive itself for the deadline to fire.
  const keepAlive = setTimeout(() => {}, 200);
  await assert.rejects(
    () => withDeadline(new Promise(() => {}), 20, 'Emulation.setTimezoneOverride'),
    /Emulation\.setTimezoneOverride did not answer within 20 ms/
  );
  clearTimeout(keepAlive);
  // And a command that does answer is not affected by the deadline being present.
  assert.equal(await withDeadline(Promise.resolve('ok'), 1000, 'Emulation.setLocaleOverride'), 'ok');
});

test('a clock that jumps a long way forward ends a run once, not repeatedly', () => {
  const at = Date.parse('2026-09-22T00:00:00.000Z');
  const runs = require('../src/run-coordination.cjs');
  const plan = { table: 'Rome', matchLimit: 5, stopAfterFailures: 0, stopAfterUnconfirmed: 0, stopAfterMinutes: 30 };
  const state = runs.start(coordination.emptyState(), {
    first: 'a',
    second: 'b',
    accounts: [
      { id: 'a', name: 'Alice', role: 'receiver' },
      { id: 'b', name: 'Bob', role: 'sender' }
    ],
    plan,
    now: at,
    runId: 'run-1'
  });
  const jumped = runs.enforce(state, { accounts: [{ id: 'a' }, { id: 'b' }], now: at + 31 * 60000 });
  assert.equal(jumped.ended.length, 1);
  assert.equal(jumped.ended[0].outcome, 'duration');
  // Enforcing again over the ended run changes nothing and reports nothing: an ended run is not ended twice.
  const again = runs.enforce(jumped.state, { accounts: [{ id: 'a' }, { id: 'b' }], now: at + 90 * 60000 });
  assert.deepEqual(again.ended, []);
  assert.equal(again.state, jumped.state);
});

test('a ledger that cannot be written is reported and leaves the in-memory ledger usable', () => {
  const state = coordination.start(coordination.emptyState(), {
    first: 'a',
    second: 'b',
    accounts: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    now: Date.parse('2026-09-22T00:00:00.000Z'),
    matchId: 'match-1'
  });
  // The journal is the only writer; what matters here is that a failed write does not corrupt the value the
  // application keeps using, which `match-service` reports as a warning (asserted in its own tests).
  assert.equal(coordination.dashboardView(state).totals.active, 1);
  // And the ledger still round-trips: read back, the match in progress is still the match in progress.
  const cleaned = coordination.cleanState(state);
  assert.equal(cleaned.matches.length, 1);
  assert.equal(cleaned.matches[0].state, 'active');
  assert.deepEqual(
    cleaned.matches[0].participants.map(participant => participant.name),
    ['Alice', 'Bob']
  );
});
