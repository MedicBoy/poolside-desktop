// The workspace's own recovery material, read as candidates rather than guessed at.
//
// A workspace write keeps one previous-known-good copy beside the file, and an interrupted write can leave a
// staged file behind. Until now the application could only say that recovery material *existed*: the file was
// opened read-only and the operator had no way to see what the copies held, let alone choose one. This module
// reads them — what each copy contains, when it was written, and whether it is usable at all. It writes nothing.
//
// Nothing here reaches the dashboard with a proxy password in it: a candidate is described through the same
// redaction the rest of the dashboard uses, because it is described, not handed over.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const model = require('./model.cjs');
const { stagedFiles } = require('./workspace-file.cjs');
const { redactWorkspaceProxyCredentials } = require('./proxy-public.cjs');

/**
 * @param {{file: string}} deps
 */
function createWorkspaceRecovery({ file }) {
  /** Everything that could be restored from, newest first, with what each one actually holds. */
  function scan() {
    const previous = `${file}.previous`;
    const temporary = `${file}.tmp`;
    const sources = [
      { source: 'previous', file: previous, label: 'The copy kept beside the workspace file' },
      { source: 'staged-temporary', file: temporary, label: 'A staged write that was never committed' },
      ...stagedFiles(file).map(name => ({
        source: 'staged',
        file: path.join(path.dirname(file), name),
        label: 'A staged write that was never committed'
      }))
    ];
    const found = [];
    for (const entry of sources) {
      /** @type {any} */
      let stat = null;
      try {
        stat = fs.statSync(entry.file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      /** @type {any} */
      let document = null;
      /** @type {string|null} */
      let revision = null;
      try {
        const bytes = fs.readFileSync(entry.file);
        revision = createHash('sha256').update(bytes).digest('hex');
        document = model.decode(JSON.parse(bytes.toString('utf8')));
      } catch {
        document = null;
      }
      found.push({ ...entry, stat, document, revision });
    }
    return found.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  }

  /** One candidate as the dashboard may see it: no credentials, and no full document. */
  function view(entry) {
    const document = entry.document;
    const described = {
      source: entry.source,
      name: path.basename(entry.file),
      label: entry.label,
      writtenAt: new Date(entry.stat.mtimeMs).toISOString(),
      bytes: entry.stat.size,
      revision: entry.revision,
      usable: document !== null,
      problem: document === null ? 'This copy could not be read as a workspace document.' : null,
      accounts: document
        ? document.accounts.map(account => ({ name: account.name, role: account.role, archived: account.archived === true }))
        : [],
      archived: document ? document.accounts.filter(account => account.archived === true).length : 0,
      locations: document && Array.isArray(document.routePresets) ? document.routePresets.map(preset => preset.name) : [],
      settings: document ? document.settings : null
    };
    return redactWorkspaceProxyCredentials(described);
  }

  /** @returns {any[]} */
  function candidates() {
    return scan().map(view);
  }

  /**
   * The document one named candidate holds, ready for the application's explicit restore path.
   * @param {string} name
   * @param {string} [expectedRevision]
   */
  function read(name, expectedRevision) {
    const wanted = String(name || '');
    const entry = scan().find(candidate => path.basename(candidate.file) === wanted);
    if (!entry) throw new Error('That recovery copy is no longer there.');
    if (expectedRevision && entry.revision !== expectedRevision)
      throw new Error('That recovery copy changed after the preview. Review it again before restoring.');
    if (!entry.document) throw new Error('That recovery copy could not be read as a workspace document.');
    return entry.document;
  }

  return { candidates, read };
}

module.exports = { createWorkspaceRecovery };
