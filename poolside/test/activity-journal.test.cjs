const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createActivityJournal, cleanMessage, FILE_NAME } = require('../src/activity-journal.cjs');
const { findSecrets } = require('../src/telemetry-redaction.cjs');

test('activity journal keeps a bounded, redacted local history across restarts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-activity-'));
  try {
    const journal = createActivityJournal({ root, limit: 2 });
    journal.append(
      {
        at: '2026-09-19T12:00:00.000Z',
        kind: 'warning',
        message: 'Master failed at C:\\Users\\nicho\\secret with 192.0.2.1 and abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12'
      },
      ['Master']
    );
    journal.append({ at: '2026-09-19T12:01:00.000Z', message: 'Master window reopened.' }, ['Master']);
    journal.append({ at: '2026-09-19T12:02:00.000Z', message: 'Master window ready.' }, ['Master']);
    const raw = fs.readFileSync(path.join(root, FILE_NAME), 'utf8');
    assert.equal(raw.includes('Master'), false);
    assert.equal(raw.includes('C:\\Users'), false);
    assert.equal(findSecrets(JSON.parse(raw), { forbidden: ['Master'] }).length, 0);
    const restarted = createActivityJournal({ root, limit: 2 });
    const entries = restarted.load(['Master']);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].message, '[account] window ready.');
    assert.equal(entries[1].message, '[account] window reopened.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('activity journal can erase its persisted entries and cleans malformed input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-activity-'));
  try {
    const journal = createActivityJournal({ root });
    journal.append({ at: '2026-09-19T12:00:00.000Z', message: 'Kept.' });
    assert.equal(journal.clear().entries, 0);
    assert.equal(fs.existsSync(path.join(root, FILE_NAME)), false);
    assert.equal(journal.load().length, 0);
    assert.equal(cleanMessage('  a\n b  '), 'a b');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('activity persistence writes a fixed entry shape and does not retain injected fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-activity-'));
  try {
    const journal = createActivityJournal({ root });
    journal.append(
      {
        at: '2026-09-19T12:00:00.000Z',
        kind: 'info',
        message: 'Master opened a page at C:\\Users\\nicho\\profile',
        accountName: 'Master',
        cookie: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
        pageText: 'browser content does not belong here'
      },
      ['Master']
    );
    const document = JSON.parse(fs.readFileSync(path.join(root, FILE_NAME), 'utf8'));
    assert.deepEqual(Object.keys(document.entries[0]).sort(), ['at', 'id', 'kind', 'message']);
    assert.equal(findSecrets(document, { forbidden: ['Master'] }).length, 0);
    assert.equal(JSON.stringify(document).includes('pageText'), false);
    assert.equal(JSON.stringify(document).includes('cookie'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
