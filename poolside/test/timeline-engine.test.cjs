// The timeline: compilation, ordering, bounding, queries and redaction.
//
// The two sources it compiles are already tested where they live (`session-fsm.test.cjs`, and the activity feed
// through `workspace`). What is tested here is the join: that ordering is real, that the bound keeps the newest
// entries rather than the oldest, and that redaction removes a name from a *message* — which is where a name
// actually leaks, because `log()` interpolates it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const timeline = require('../src/timeline-engine.cjs');
const timelineQuery = require('../src/timeline-query.cjs');
const timelineTransfer = require('../src/timeline-transfer.cjs');
const { UNHEALTHY_STATES, HISTORY_LIMIT } = require('../src/session-fsm.cjs');

const T = ms => new Date(Date.UTC(2026, 8, 18, 12, 0, 0, ms)).toISOString();

const SESSIONS = [
  {
    id: 'acct-1',
    name: 'Main',
    transitions: [
      { at: T(100), from: 'idle', to: 'launching', event: 'launch', reason: null },
      { at: T(200), from: 'launching', to: 'loading', event: 'load', reason: null },
      { at: T(300), from: 'loading', to: 'ready', event: 'loaded', reason: null },
      { at: T(400), from: 'ready', to: 'degraded', event: 'failed', reason: 'renderer gone: crashed' }
    ]
  },
  {
    id: 'acct-2',
    name: 'Second',
    transitions: [{ at: T(150), from: 'idle', to: 'launching', event: 'launch', reason: null }]
  }
];

// Newest first, as workspace.log() writes them.
const EVENTS = [
  { id: 2, at: T(500), message: 'Main: screen observation: unknown', kind: 'warning' },
  { id: 1, at: T(50), message: 'Workspace ready.', kind: 'info' }
];

test('both sources compile into one chronological stream', () => {
  const entries = timeline.compile({ sessions: SESSIONS, events: EVENTS });
  assert.deepEqual(
    entries.map(entry => entry.at),
    [T(50), T(100), T(150), T(200), T(300), T(400), T(500)],
    'activity newest-first and transitions oldest-first must merge into one order'
  );
  assert.equal(entries[0].source, 'activity');
  assert.equal(entries[1].source, 'session');
  assert.equal(entries[1].from, 'idle');
  assert.equal(entries[1].to, 'launching');
  assert.equal(entries[1].accountName, 'Main');
  assert.deepEqual(
    entries.map(entry => entry.seq),
    [0, 1, 2, 3, 4, 5, 6],
    'seq is contiguous and monotonic, so a row can be keyed without relying on index stability'
  );
});

test('a transition recorded in the same millisecond as an activity entry comes first', () => {
  const compiled = timeline.compile({
    sessions: [{ id: 'a', name: 'A', transitions: [{ at: T(10), from: 'ready', to: 'degraded', event: 'failed', reason: 'x' }] }],
    events: [{ at: T(10), message: 'A: something', kind: 'warning' }]
  });
  assert.deepEqual(
    compiled.map(entry => entry.source),
    ['session', 'activity'],
    'the transition is the cause; the log line about it follows'
  );
});

test('severity comes from the state machine, not from a second list', () => {
  for (const state of UNHEALTHY_STATES) {
    assert.equal(timeline.transitionLevel(state), 'warning', `${state} is an unhealthy state, so it is a warning`);
  }
  assert.equal(timeline.transitionLevel('ready'), 'info');
  assert.equal(timeline.transitionLevel('launching'), 'info');
  const compiled = timeline.compile({ sessions: SESSIONS });
  assert.equal(compiled.filter(entry => entry.level === 'warning').length, 1, 'only the degraded transition is a warning');
});

test('the bound keeps the newest entries', () => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    at: T(index),
    from: 'ready',
    to: 'ready',
    event: 'reload',
    reason: null
  }));
  const compiled = timeline.compile({ sessions: [{ id: 'a', transitions: many }], limit: 10 });
  assert.equal(compiled.length, 10);
  assert.equal(compiled[0].at, T(50), 'the oldest entries are the ones dropped');
  assert.equal(compiled[9].at, T(59));
  // The default ceiling, and a request above it, both stop at MAX_ENTRIES.
  assert.equal(timeline.compile({ sessions: [{ id: 'a', transitions: many }], limit: 100000 }).length, Math.min(60, timeline.MAX_ENTRIES));
  assert.ok(timeline.MAX_ENTRIES >= HISTORY_LIMIT, 'the timeline must not be tighter than the history it reads');
});

test('queries filter and compose', () => {
  const entries = timeline.compile({ sessions: SESSIONS, events: EVENTS });
  assert.equal(timelineQuery.query(entries, { accountId: 'acct-1' }).length, 4);
  assert.equal(timelineQuery.query(entries, { source: 'activity' }).length, 2);
  assert.equal(timelineQuery.query(entries, { event: 'launch' }).length, 2);
  assert.equal(timelineQuery.query(entries, { level: 'warning' }).length, 2);
  assert.equal(timelineQuery.query(entries, { since: T(200) }).length, 4);
  assert.equal(timelineQuery.query(entries, { until: T(200) }).length, 4);
  assert.equal(timelineQuery.query(entries, { since: T(200), until: T(400) }).length, 3);
  assert.equal(timelineQuery.query(entries, { limit: 2 }).map(entry => entry.at)[0], T(400), 'a limit takes the newest');
  assert.equal(timelineQuery.query(entries, { limit: 0 }).length, 0);
});

test('failures are the warnings, in order', () => {
  const entries = timeline.compile({ sessions: SESSIONS, events: EVENTS });
  const failures = timelineQuery.failures(entries);
  assert.deepEqual(
    failures.map(entry => entry.at),
    [T(400), T(500)]
  );
  assert.equal(failures[0].to, 'degraded');
  assert.equal(failures[1].kind, 'activity');
});

test('the summary counts both sources, and measures the span', () => {
  const entries = timeline.compile({ sessions: SESSIONS, events: EVENTS });
  const summary = timelineQuery.summarise(entries);
  assert.equal(summary.total, 7);
  assert.deepEqual(summary.bySource, { session: 5, activity: 2 });
  assert.deepEqual(summary.byKind, { transition: 5, activity: 2 });
  assert.deepEqual(summary.byLevel, { info: 5, warning: 2 });
  assert.equal(summary.accounts, 2, 'the activity entries belong to no account, so only the sessions are counted');
  assert.equal(summary.first, T(50));
  assert.equal(summary.last, T(500));
  assert.equal(summary.spanMs, 450);
});

test('the index answers which account, which event, which transitions', () => {
  const entries = timeline.compile({ sessions: SESSIONS, events: EVENTS });
  const indexed = timelineQuery.index(entries);
  assert.equal(indexed.byAccount.size, 2);
  assert.equal(indexed.byAccount.get('acct-1')?.length, 4);
  assert.equal(indexed.byEvent.get('launch')?.length, 2);
  assert.equal(indexed.byTransition.get('ready->degraded'), 1);
  assert.equal(indexed.byTransition.get('loading->ready'), 1);
});

test('redaction removes names from the field and from the message', () => {
  const entries = timeline.compile({ sessions: SESSIONS, events: EVENTS });
  const { entries: redacted, nameMap } = timelineTransfer.redact(entries);
  assert.deepEqual(nameMap, { Main: 'account 1', Second: 'account 2' });
  assert.equal(
    redacted.some(entry => entry.accountName !== null),
    false,
    'no name survives in its own field'
  );
  assert.equal(
    redacted.some(entry => entry.message && entry.message.includes('Main')),
    false,
    'nor inside a message'
  );
  const observation = redacted.find(entry => entry.message && entry.message.includes('observation'));
  assert.match(observation.message, /^account 1: screen observation: unknown$/);
  assert.deepEqual(
    redacted.filter(entry => entry.source === 'session').map(entry => entry.accountId),
    ['account 1', 'account 2', 'account 1', 'account 1', 'account 1'],
    'identifiers become stable sequential references, in the order the entries were merged'
  );
  assert.equal(JSON.stringify(redacted).includes('acct-'), false, 'the raw identifier is gone');
});

test('redaction survives a name that looks like a pattern', () => {
  // Account names are user input. A regex would treat `(2)` and `+` as syntax, which is why redaction uses
  // split/join — and why this is a test rather than a comment.
  const name = 'Main (2) +x [a-z]*';
  const compiled = timeline.compile({
    sessions: [{ id: 'a', name, transitions: [{ at: T(10), from: 'ready', to: 'degraded', event: 'failed', reason: 'x' }] }],
    events: [{ at: T(20), message: `${name}: screen observation: unknown`, kind: 'info' }]
  });
  const { entries: redacted } = timelineTransfer.redact(compiled);
  assert.equal(JSON.stringify(redacted).includes('Main'), false);
  assert.equal(redacted[1].message, 'account 1: screen observation: unknown');
});

test('the view is what crosses IPC, and redaction is declared in it', () => {
  const view = timelineTransfer.view({ sessions: SESSIONS, events: EVENTS });
  assert.equal(view.redacted, false);
  assert.equal(view.entries.length, 7);
  assert.equal(view.summary.total, 7);
  assert.deepEqual(view.index, { accounts: 2, events: 4, transitions: 4 });
  // The index itself must not be in the payload: a Map does not survive a structured clone.
  assert.equal(typeof (/** @type {any} */ (view.index).byAccount), 'undefined');

  const safe = timelineTransfer.view({ sessions: SESSIONS, events: EVENTS }, { redact: true });
  assert.equal(safe.redacted, true);
  assert.equal(JSON.stringify(safe).includes('Main'), false);
  assert.equal(JSON.stringify(safe).includes('Second'), false);
});

test('nothing here throws, whatever it is handed', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { sessions: 'x', events: 5 }, { sessions: [null, 3] }, { events: [null] }];
  for (const value of junk) {
    assert.doesNotThrow(() => timeline.compile(/** @type {any} */ (value)));
    assert.doesNotThrow(() => timelineTransfer.view(/** @type {any} */ (value)));
    assert.doesNotThrow(() => timelineQuery.index(/** @type {any} */ (value)));
    assert.doesNotThrow(() => timelineQuery.summarise(/** @type {any} */ (value)));
    assert.doesNotThrow(() => timelineQuery.query(/** @type {any} */ (value), { accountId: 'x' }));
    assert.doesNotThrow(() => timelineTransfer.redact(/** @type {any} */ (value)));
  }
  assert.equal(timeline.compile().length, 0);
  assert.equal(timelineQuery.summarise([]).spanMs, 0);
  assert.equal(timelineQuery.summarise([]).first, null);
});

test('a transition with a missing timestamp does not corrupt the order', () => {
  const compiled = timeline.compile({
    sessions: [
      {
        id: 'a',
        name: 'A',
        transitions: [
          { from: 'ready', to: 'closed', event: 'close' },
          { at: T(5), from: 'idle', to: 'launching', event: 'launch' }
        ]
      }
    ]
  });
  assert.equal(compiled.length, 2);
  assert.equal(compiled[0].at, '', 'an entry with no time sorts first, and is still reported');
  assert.equal(compiled[1].at, T(5));
});

test('a closed account is redacted by name even though no entry carries it', () => {
  // The case the desktop suite's IPC guard caught: this account has no live session, so no timeline entry carries
  // its name, and the name reached the payload through an activity message alone. The names to sweep therefore
  // come from the caller's account list, not from the entries.
  const entries = timeline.compile({
    sessions: [{ id: 'acct-1', name: 'Main', transitions: [{ at: T(100), from: 'idle', to: 'launching', event: 'launch' }] }],
    events: [{ id: 'e1', at: T(600), message: 'Closed account: profile deleted', kind: 'info' }]
  });
  const redacted = timelineTransfer.redact(entries, [
    { id: 'acct-1', name: 'Main' },
    { id: 'acct-9', name: 'Closed account' }
  ]);
  assert.equal(JSON.stringify(redacted.entries).includes('Closed account'), false, 'a name only in a message is swept');
  assert.equal(JSON.stringify(redacted.entries).includes('Main'), false);
  assert.match(
    redacted.entries.find(entry => entry.message && entry.message.includes('profile deleted')).message,
    /^account 2: profile deleted$/
  );
});
