// Durable workspace-document replacement. Only validated version-1 documents reach disk.
// A single previous-known-good sibling is retained for explicit recovery; it is never loaded
// automatically as authoritative account data.

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const model = require('./model.cjs');

function writeFlushed(file, contents) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, contents);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function stagedFiles(file) {
  const directory = path.dirname(file);
  const prefix = `${path.basename(file)}.tmp-`;
  try {
    return fs.readdirSync(directory).filter(name => name.startsWith(prefix));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
    throw error;
  }
}

function recoveryAvailable(file) {
  return fs.existsSync(`${file}.previous`) || fs.existsSync(`${file}.tmp`) || stagedFiles(file).length > 0;
}

// A recovery copy may contain only metadata that is still present in the current workspace.
// Removing an account, note, identity, or route must not leave its old value in a hidden sibling.
function mayRetainPrevious(old, next) {
  const current = new Map(next.accounts.map(account => [account.id, account]));
  const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  if (!same(old.routePresets, next.routePresets)) return false;
  if (!same(old.settings.proxy, next.settings.proxy) || !same(old.settings.identity, next.settings.identity)) return false;
  return old.accounts.every(account => {
    const updated = current.get(account.id);
    return (
      updated &&
      same(account.name, updated.name) &&
      same(account.note, updated.note) &&
      same(account.identity, updated.identity) &&
      same(account.proxy, updated.proxy)
    );
  });
}

/**
 * @param {string} file
 * @param {import('./types.cjs').WorkspaceData} next
 * @param {{checkpoint?: (stage: string) => void}} [options] deterministic fault injection for tests
 */
function writeWorkspace(file, next, { checkpoint = () => {} } = {}) {
  const canonical = model.decode(next);
  const target = path.resolve(file);
  const previous = `${target}.previous`;
  const temporary = `${target}.tmp-${randomUUID()}`;
  const previousTemporary = `${previous}.tmp-${randomUUID()}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    // Refuse to overwrite an externally damaged primary or promote it to the recovery copy.
    const old = fs.existsSync(target) ? fs.readFileSync(target) : null;
    const oldDocument = old ? model.decode(JSON.parse(old.toString('utf8'))) : null;
    writeFlushed(temporary, JSON.stringify(canonical, null, 2));
    checkpoint('new-flushed');
    if (old && mayRetainPrevious(oldDocument, canonical)) {
      writeFlushed(previousTemporary, old);
      fs.renameSync(previousTemporary, previous);
      checkpoint('previous-replaced');
    } else if (old) {
      fs.rmSync(previous, { force: true });
      checkpoint('previous-purged');
    }
    checkpoint('before-commit');
    fs.renameSync(temporary, target);
    return canonical;
  } finally {
    // These are random, exact sibling paths created by this call; no directory tree is removed.
    fs.rmSync(temporary, { force: true });
    fs.rmSync(previousTemporary, { force: true });
  }
}

/** Explicit recovery from a primary that could not be loaded. Never discard its original bytes. */
function restoreUnreadableWorkspace(file, next) {
  const canonical = model.decode(next);
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  /** @type {string|null} */
  let preservedName = null;
  if (fs.existsSync(target)) {
    const original = fs.readFileSync(target);
    let changedToValid = false;
    try {
      model.decode(JSON.parse(original.toString('utf8')));
      changedToValid = true;
    } catch {}
    if (changedToValid) throw new Error('The workspace file has changed since startup. Restart Poolside before restoring a copy.');
    const preserved = `${target}.unreadable-${randomUUID()}`;
    writeFlushed(preserved, original);
    preservedName = path.basename(preserved);
  }
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    writeFlushed(temporary, JSON.stringify(canonical, null, 2));
    fs.renameSync(temporary, target);
    return { document: canonical, preservedName };
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = { writeWorkspace, restoreUnreadableWorkspace, recoveryAvailable, stagedFiles };
