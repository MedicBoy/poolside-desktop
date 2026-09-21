// The local match ledger on disk.
//
// Bounded and self-validating for the same reason the table-navigation journal is: this file is read
// back at startup and its contents reach the dashboard, so a hand-edited or half-written document must
// degrade to "nothing recorded" rather than to a phantom match in progress.

const fs = require('node:fs');
const path = require('node:path');
const { cleanState, emptyState, FORMAT } = require('./match-coordination.cjs');

const FILE_NAME = 'match-coordination.json';

/** @param {{root: string}} options */
function createMatchJournal({ root }) {
  const file = path.join(root, FILE_NAME);

  function read() {
    if (!fs.existsSync(file)) return emptyState();
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!stored || typeof stored !== 'object' || stored.format !== FORMAT) return emptyState();
      return cleanState(stored);
    } catch {
      return emptyState();
    }
  }

  /** @param {unknown} state */
  function write(state) {
    const clean = cleanState(state);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(clean, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
    return clean;
  }

  return { read, write, file };
}

module.exports = { createMatchJournal, FILE_NAME, FORMAT };
