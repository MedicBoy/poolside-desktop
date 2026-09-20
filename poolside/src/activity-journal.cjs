// A small, private, redacted activity journal.
//
// The dashboard feed is useful only while Poolside is open. This journal retains a deliberately
// smaller version across restarts, without turning browser contents into application data. It stores
// only timestamps, level and cleaned application messages. Screenshots, page text, cookies,
// passwords, tokens, account labels, addresses and filesystem paths do not belong here.

const fs = require('node:fs');
const path = require('node:path');
const { stripSecretShapes } = require('./telemetry-redaction.cjs');

const FORMAT = 'poolside-activity/v1';
const DEFAULT_LIMIT = 200;
const FILE_NAME = 'activity-history.json';

/** @param {unknown} value @returns {string[]} */
function namesOf(value) {
  return (Array.isArray(value) ? value : []).filter(name => typeof name === 'string' && name.length > 0);
}

/** Remove account labels and sensitive-looking shapes from a human-readable application message. */
function cleanMessage(value, forbidden = []) {
  let text = String(value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  for (const name of namesOf(forbidden)) text = text.split(name).join('[account]');
  return stripSecretShapes(text);
}

/** @param {unknown} value @param {number} index @param {string[]} names */
function normalise(value, index, names) {
  const source = /** @type {any} */ (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  const at = typeof source.at === 'string' && !Number.isNaN(Date.parse(source.at)) ? source.at : null;
  const message = cleanMessage(source.message, names);
  if (!at || !message) return null;
  return { id: Date.parse(at) + index, at, message, kind: source.kind === 'warning' ? 'warning' : 'info' };
}

/** @param {{root: string, limit?: number}} input */
function createActivityJournal(input) {
  const root = String(input && input.root ? input.root : '');
  const requestedLimit = input && input.limit;
  const limit =
    typeof requestedLimit === 'number' && Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : DEFAULT_LIMIT;
  const file = path.join(root, FILE_NAME);
  /** @type {any[]} */
  let entries = [];
  let loaded = false;
  const status = () => ({ saved: loaded, entries: entries.length, limit });
  const persist = () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ format: FORMAT, entries }, null, 2), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  const read = names => {
    loaded = true;
    if (!fs.existsSync(file)) return [];
    try {
      const document = JSON.parse(fs.readFileSync(file, 'utf8'));
      const values = document && document.format === FORMAT && Array.isArray(document.entries) ? document.entries : [];
      entries = values
        .map((entry, index) => normalise(entry, index, names))
        .filter(Boolean)
        .slice(0, limit);
      persist(); // Rewrite old or hand-edited documents only after the same redaction pass used for new messages.
    } catch {
      entries = [];
    }
    return entries.map(entry => ({ ...entry }));
  };
  return {
    load(names = []) {
      return read(namesOf(names));
    },
    append(entry, names = []) {
      const forbidden = namesOf(names);
      if (!loaded) read(forbidden);
      const safe = normalise(entry, 0, forbidden);
      if (!safe) return status();
      entries = [safe, ...entries].slice(0, limit);
      persist();
      return status();
    },
    clear() {
      entries = [];
      loaded = true;
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}.tmp`, { force: true });
      return status();
    },
    status,
    file
  };
}

module.exports = { createActivityJournal, cleanMessage, normalise, FORMAT, DEFAULT_LIMIT, FILE_NAME };
