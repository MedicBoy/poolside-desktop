// A record of a run: what it holds, what it refuses to hold, and that it is built from the same view the
// dashboard shows.

const test = require('node:test');
const assert = require('node:assert/strict');
const report = require('../src/run-report.cjs');

const AT = Date.parse('2026-09-22T00:00:00.000Z');
const participant = name => ({ id: name.toLowerCase(), name, role: 'receiver' });
const match = overrides => ({
  handle: 'm1',
  matchId: 'match-1',
  runId: 'run-1',
  participants: [participant('Newfie'), participant('Gmail')],
  state: 'completed',
  winnerName: 'Newfie',
  reason: 'Newfie recorded as the winner.',
  startedAt: new Date(AT).toISOString(),
  endedAt: new Date(AT + 60000).toISOString(),
  readiness: {
    verdict: 'ready',
    reason: 'Both are ready.',
    skewMs: 421,
    requestedAt: null,
    deadlineAt: null,
    releasedAt: null,
    checkedAt: null
  },
  pairing: { verdict: 'paired', label: 'Same entry seen on both accounts', reason: 'Both paid 50 coins.', table: 'London' },
  outcome: {
    verdict: 'observed',
    reason: 'Newfie: Coins 1,000 → 950 (-50). Gmail: Coins 1,000 → 950 (-50). Recorded, not reconciled.',
    readings: [{ name: 'Newfie', currency: 'coins', from: 1000, to: 950, delta: -50, exact: true, status: 'current' }]
  },
  history: [],
  ...overrides
});
const run = overrides => ({
  handle: 'r1',
  runId: 'run-1',
  state: 'ended',
  paused: false,
  participants: [
    { name: 'Newfie', role: 'receiver' },
    { name: 'Gmail', role: 'sender' }
  ],
  plan: { table: 'London', matchLimit: 2, stopAfterFailures: 3, stopAfterUnconfirmed: 3, stopAfterMinutes: 60 },
  describe: 'Up to 2 matches with a recorded result on London, stopping after 60 minutes',
  startedAt: new Date(AT).toISOString(),
  endedAt: new Date(AT + 600000).toISOString(),
  outcome: 'limit',
  outcomeLabel: 'Match limit reached',
  reason: 'The plan was 2 matches with a recorded result, and all of them are recorded.',
  progress: { played: 2, completed: 2, cancelled: 0, consecutiveFailures: 0, consecutiveUnconfirmed: 0, elapsedMs: 600000, remainingMs: 0 },
  ...overrides
});
const view = overrides => ({ totals: {}, active: [], recent: [], runs: { active: null, recent: [] }, ...overrides });

test('the report carries each run with the matches it owns, and the standalone matches apart', () => {
  const built = report.build(
    view({
      runs: { active: null, recent: [run()] },
      recent: [match(), match({ handle: 'm9', matchId: 'match-9', runId: null, state: 'cancelled', winnerName: null })]
    }),
    { now: AT }
  );
  assert.equal(built.format, 'poolside-run-report/v1');
  assert.equal(built.generatedAt, new Date(AT).toISOString());
  assert.match(built.note, /contains your account names/);
  assert.match(built.note, /no passwords, no browser profiles, no screenshots and no page text/);
  assert.match(built.note, /never reconciled against a fee table/);
  assert.equal(built.runs.length, 1);
  const [one] = built.runs;
  assert.equal(one.handle, 'r1');
  assert.equal(one.planInWords, 'Up to 2 matches with a recorded result on London, stopping after 60 minutes');
  assert.equal(one.outcomeLabel, 'Match limit reached');
  assert.deepEqual(one.progress, {
    played: 2,
    completed: 2,
    cancelled: 0,
    consecutiveFailures: 0,
    consecutiveUnconfirmed: 0,
    elapsedMs: 600000,
    remainingMs: 0
  });
  assert.equal(one.matches.length, 1, 'the run owns the match that carries its id');
  assert.equal(one.matches[0].pairing.verdict, 'paired');
  assert.equal(one.matches[0].outcome.readings.length, 1);
  assert.equal(built.standaloneMatches.length, 1, 'a match with no run is listed apart, not dropped');
  assert.equal(built.standaloneMatches[0].handle, 'm9');
});

test('an active run is included, so a report can be taken while a run is still going', () => {
  const built = report.build(
    view({ runs: { active: run({ state: 'paused', endedAt: null, outcome: null }), recent: [] }, active: [match({ state: 'active' })] }),
    {
      now: AT
    }
  );
  assert.equal(built.runs.length, 1);
  assert.equal(built.runs[0].paused, true);
  assert.equal(built.runs[0].matches[0].state, 'active');
});

test('nothing a report carries could hold a credential, a path or page text', () => {
  // The view a report is built from is the dashboard's own, which carries route labels rather than addresses.
  const built = report.build(view({ runs: { active: null, recent: [run()] }, recent: [match()] }), { now: AT });
  // The note is a fixed sentence that names what is absent; what matters is the data the report carries.
  const serialised = JSON.stringify({ runs: built.runs, standaloneMatches: built.standaloneMatches });
  for (const forbidden of ['password', 'pass', 'spec', 'proxyRules', 'profile', 'C:\\\\', 'screenshot', 'canvas'])
    assert.equal(serialised.toLowerCase().includes(forbidden.toLowerCase()), false, `${forbidden} must not appear`);
  // What it does carry, stated in the file itself: names, because a record of who played whom needs them.
  assert.equal(serialised.includes('Newfie'), true);
});

test('an empty ledger still produces a well-formed report rather than an error', () => {
  const built = report.build(view(), { now: AT });
  assert.deepEqual(built.runs, []);
  assert.deepEqual(built.standaloneMatches, []);
  assert.match(report.fileName(AT), /^poolside-run-report-2026-09-22_00-00-00-\d{3}\.json$/);
});
