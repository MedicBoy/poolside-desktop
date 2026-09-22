// What Poolside itself has written, and the one erasure control that may touch it.
//
// Two documents can be written on purpose: a redacted diagnostics export and a run report. Both land in one
// folder, both are the operator's to send on, and nothing ever removed them — a folder that grows for the life
// of the installation, that the operator could open but not see the size of or clear. This is that view.
//
// It is deliberately narrow, and the narrowness is the safety: it reads only the folder this application owns,
// it recognises only the names this application writes, and it erases only an exact name that resolves inside
// that folder. Anything else in there — a file the operator put there, a subdirectory, a name that looks like one
// of ours with `..` in it — is counted as left alone and is never touched. No path leaves this module: the
// dashboard is handed names and sizes, never the directory those names live in.
//
// Pure of Electron (fs only), so the rules are pinned by tests rather than by opening a folder.

const fs = require('node:fs');
const path = require('node:path');
const { isInside } = require('./profile-paths.cjs');

/** Where the two exports live, under the application's own data directory. */
const OUTPUT_DIR = 'diagnostics';

/**
 * The names this application writes, declared once.
 *
 * `staged` is first and is the reason the list is ordered rather than matched by first hit: an interrupted write
 * leaves `…json.tmp-<pid>` behind, which would otherwise read as a report that failed to parse.
 */
const KINDS = [
  {
    kind: 'staged',
    pattern: /^poolside-(?:diagnostics|run-report)-[\w.-]+\.json\.tmp-\d+$/,
    label: 'Leftover from an interrupted write'
  },
  { kind: 'run-report', pattern: /^poolside-run-report-[\w.-]+\.json$/, label: 'Run report' },
  { kind: 'diagnostics', pattern: /^poolside-diagnostics-[\w.-]+\.json$/, label: 'Redacted diagnostics export' }
];

/** Which of this application's own documents a name is, or null when it is not one of them. @param {unknown} name */
function classify(name) {
  if (typeof name !== 'string') return null;
  for (const entry of KINDS) if (entry.pattern.test(name)) return { kind: entry.kind, label: entry.label };
  return null;
}

/** The folder this application owns under a data root. Never returned to the dashboard. @param {unknown} root */
function directory(root) {
  return path.join(String(root || ''), OUTPUT_DIR);
}

/**
 * Every file Poolside wrote into its own export folder, newest first, with what each one is and how big it is.
 *
 * The directory path is deliberately absent from the answer: the dashboard needs to say "four files, 21 KB,
 * newest this morning", and knowing where they are adds nothing but a path in a page. `ignored` counts what was
 * left alone, so a folder that also holds somebody else's files says so rather than looking empty.
 * @param {{root?: string}} [input]
 */
function list({ root } = {}) {
  const folder = directory(root);
  /** @type {string[]} */
  let names;
  try {
    names = fs.readdirSync(folder);
  } catch {
    // No folder yet is not an error: nothing has been exported, which is the same answer as an empty one.
    return { exists: false, entries: [], ignored: 0, bytes: 0, oldest: null, newest: null };
  }
  /** @type {{name: string, kind: string, label: string, bytes: number, writtenAt: string}[]} */
  const entries = [];
  let ignored = 0;
  for (const name of names) {
    const known = classify(name);
    if (!known) {
      ignored += 1;
      continue;
    }
    try {
      const stat = fs.statSync(path.join(folder, name));
      if (!stat.isFile()) {
        ignored += 1;
        continue;
      }
      entries.push({ name, ...known, bytes: stat.size, writtenAt: stat.mtime.toISOString() });
    } catch {
      // A file that vanished between the listing and the stat is not a problem worth failing the view over.
      ignored += 1;
    }
  }
  entries.sort((a, b) => Date.parse(b.writtenAt) - Date.parse(a.writtenAt) || a.name.localeCompare(b.name));
  const times = entries.map(entry => entry.writtenAt);
  return {
    exists: true,
    entries,
    ignored,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    oldest: times.length ? times[times.length - 1] : null,
    newest: times.length ? times[0] : null
  };
}

/**
 * Erase named files from the folder this application owns.
 *
 * Every refusal below is one an operator cannot cause by clicking, which is exactly why each is written down: a
 * name is input, and input is where a path escapes. A file that is not one of ours is refused by name, a
 * subdirectory is refused, and a name that does not resolve strictly inside the folder is refused — so this
 * cannot be talked into deleting the workspace, a browser profile, or anything else on the machine.
 * @param {{root?: string, names?: unknown}} [input]
 */
function clear({ root, names } = {}) {
  const folder = directory(root);
  const requested = Array.isArray(names) ? names : [];
  /** @type {string[]} */
  const removed = [];
  /** @type {{name: string, reason: string}[]} */
  const skipped = [];
  let bytes = 0;
  for (const name of requested) {
    const known = classify(name);
    if (typeof name !== 'string' || !known) {
      skipped.push({ name: String(name), reason: 'not a file this application writes' });
      continue;
    }
    const target = path.resolve(folder, name);
    if (path.basename(name) !== name || !isInside(folder, target)) {
      skipped.push({ name, reason: 'outside the folder this application owns' });
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      skipped.push({ name, reason: 'already gone' });
      continue;
    }
    if (!stat.isFile()) {
      skipped.push({ name, reason: 'not a file' });
      continue;
    }
    fs.rmSync(target, { force: true });
    removed.push(name);
    bytes += stat.size;
  }
  return { removed, skipped, bytes };
}

module.exports = { list, clear, classify, directory, KINDS, OUTPUT_DIR };
