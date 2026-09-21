// Bounded, local-only journal for table-navigation plans. It stores no browser text or account names.

const fs = require('node:fs');
const path = require('node:path');
const { TABLES } = require('./table-list.cjs');
const { STATES } = require('./table-navigation-state.cjs');

const FILE_NAME = 'table-navigation-history.json';
const FORMAT = 'poolside-table-navigation-history/v1';
const LIMIT = 500;

function text(value, max) {
  return typeof value === 'string'
    ? value
        .replace(/[\r\n\t]/g, ' ')
        .trim()
        .slice(0, max)
    : '';
}

function cleanEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const at = text(value.at, 40);
  const accountId = text(value.accountId, 64);
  const targetTable = TABLES.includes(value.targetTable) ? value.targetTable : null;
  const from = STATES.includes(value.from) ? value.from : null;
  const to = STATES.includes(value.to) ? value.to : null;
  const event = text(value.event, 48);
  const detail = text(value.detail, 240);
  if (!Number.isFinite(Date.parse(at)) || !accountId || !targetTable || !from || !to || !/^[a-z0-9-]+$/.test(event)) return null;
  return { at, accountId, targetTable, from, to, event, detail };
}

function createTableNavigationJournal({ root }) {
  const file = path.join(root, FILE_NAME);

  function read() {
    if (!fs.existsSync(file)) return [];
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (stored.format !== FORMAT || !Array.isArray(stored.entries)) return [];
      return stored.entries.map(cleanEntry).filter(Boolean).slice(0, LIMIT);
    } catch {
      return [];
    }
  }

  function append(value) {
    const entry = cleanEntry(value);
    if (!entry) throw new Error('Table-navigation journal entry is invalid.');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ format: FORMAT, entries: [entry, ...read()].slice(0, LIMIT) }, null, 2), {
      mode: 0o600
    });
    fs.renameSync(temporary, file);
    return entry;
  }

  return { append, read, file };
}

module.exports = { createTableNavigationJournal, cleanEntry, FILE_NAME, FORMAT, LIMIT };
