const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMatchJournal, FILE_NAME } = require('../src/match-journal.cjs');
const coordination = require('../src/match-coordination.cjs');

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-match-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const ACCOUNTS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' }
];

test('a missing ledger reads as nothing recorded', () =>
  withRoot(root => {
    const journal = createMatchJournal({ root });
    assert.deepEqual(journal.read(), coordination.emptyState());
    assert.equal(journal.file, path.join(root, FILE_NAME));
  }));

test('a written ledger round-trips and leaves no temporary file behind', () =>
  withRoot(root => {
    const journal = createMatchJournal({ root });
    const state = coordination.start(coordination.emptyState(), {
      first: 'a',
      second: 'b',
      accounts: ACCOUNTS,
      now: Date.parse('2026-09-21T12:00:00.000Z'),
      matchId: 'round-trip'
    });
    const written = journal.write(state);
    assert.deepEqual(journal.read(), written);
    assert.deepEqual(
      fs.readdirSync(root).filter(name => name.endsWith('.tmp')),
      []
    );
    assert.equal(fs.statSync(journal.file).isFile(), true);
  }));

test('a damaged or foreign ledger degrades to nothing recorded instead of a phantom match', () =>
  withRoot(root => {
    const journal = createMatchJournal({ root });
    fs.writeFileSync(journal.file, '{ this is not json');
    assert.deepEqual(journal.read(), coordination.emptyState());
    fs.writeFileSync(journal.file, JSON.stringify({ format: 'poolside-something-else/v1', matches: [] }));
    assert.deepEqual(journal.read(), coordination.emptyState());
  }));

test('hand-edited entries that could not have been produced are dropped on read', () =>
  withRoot(root => {
    const journal = createMatchJournal({ root });
    fs.writeFileSync(
      journal.file,
      JSON.stringify({
        format: coordination.FORMAT,
        sequence: 4,
        matches: [
          {
            handle: 'm4',
            matchId: 'kept',
            participants: [
              { id: 'a', name: 'Alice' },
              { id: 'b', name: 'Bob' }
            ],
            state: 'completed',
            winnerId: 'b',
            startedAt: '2026-09-21T12:00:00.000Z',
            endedAt: '2026-09-21T12:05:00.000Z',
            history: [{ at: '2026-09-21T12:05:00.000Z', from: 'active', to: 'completed', event: 'completed', detail: 'Bob won.' }]
          },
          { handle: 'not-a-handle', matchId: 'dropped', participants: [], state: 'bogus' }
        ]
      })
    );
    const read = journal.read();
    assert.equal(read.matches.length, 1);
    assert.equal(read.matches[0].matchId, 'kept');
    assert.equal(read.matches[0].winnerName, 'Bob');
    assert.equal(read.sequence, 4);
  }));
