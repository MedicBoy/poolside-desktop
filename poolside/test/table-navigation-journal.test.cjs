const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTableNavigationJournal, cleanEntry, FORMAT, LIMIT } = require('../src/table-navigation-journal.cjs');

const record = (over = {}) => ({
  at: '2026-09-21T12:00:00.000Z',
  accountId: '11111111-1111-4111-8111-111111111111',
  targetTable: 'London',
  from: 'locating-lobby',
  to: 'opening-table-selection',
  event: 'observed-lobby',
  detail: 'Lobby observed.',
  ...over
});

test('the navigation journal is durable, bounded, and stores only its fixed local shape', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-navigation-journal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journal = createTableNavigationJournal({ root });
  journal.append({ ...record(), accountName: 'Private label', browserText: 'secret page content' });
  assert.deepEqual(journal.read(), [record()]);
  const stored = JSON.parse(fs.readFileSync(journal.file, 'utf8'));
  assert.equal(stored.format, FORMAT);
  assert.equal(JSON.stringify(stored).includes('Private label'), false);
  assert.equal(JSON.stringify(stored).includes('secret page content'), false);
});

test('invalid journal input is rejected instead of being widened', () => {
  assert.equal(cleanEntry(record({ targetTable: 'Atlantis' })), null);
  assert.equal(cleanEntry(record({ event: 'bad event!' })), null);
  assert.equal(cleanEntry(null), null);
});

test('journal reads are capped even if a hand-edited file is oversized', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-navigation-cap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journal = createTableNavigationJournal({ root });
  fs.writeFileSync(journal.file, JSON.stringify({ format: FORMAT, entries: Array.from({ length: LIMIT + 5 }, () => record()) }));
  assert.equal(journal.read().length, LIMIT);
});
