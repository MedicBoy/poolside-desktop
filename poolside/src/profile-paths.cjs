// Where an account's profile lives, and the guards that make deleting one safe.
//
// The profile management subsystem removes directories, so this module exists to make "is this path
// actually ours?" a pure, testable question rather than a check buried in a delete call. Every removal
// goes through `assertRemovable`, which refuses anything that resolves outside the Poolside data
// directory — the last line of defence against a corrupted id, a hand-edited workspace, or a future
// refactor passing the wrong argument.
//
// Pure module: no filesystem, no Electron. Enforced by test/architecture.test.cjs.

const path = require('node:path');

const IDENTIFIER = /^[a-f0-9-]{36}$/i;
const PARTITIONS_DIR = 'Partitions';
const ACCOUNTS_DIR = 'accounts';
const PARTITION_PREFIX = 'poolside-';

/** @param {unknown} id */
function assertAccountId(id) {
  if (typeof id !== 'string' || !IDENTIFIER.test(id)) throw new Error('Invalid account identifier.');
  return id;
}

/**
 * The Chromium partition name for an account. Electron stores a persistent partition's data in
 * `<userData>/Partitions/<name-without-the-persist-prefix>`.
 * @param {string} id
 */
function partitionName(id) {
  return `${PARTITION_PREFIX}${assertAccountId(id)}`;
}

/** @param {string} id */
function partition(id) {
  return `persist:${partitionName(id)}`;
}

/**
 * The directory Chromium owns for this account. Deleting it deletes that session's cookies and site
 * storage, which is why it is only ever reached through `remove`.
 * @param {string} root @param {string} id
 */
function profileDirectory(root, id) {
  return path.join(root, PARTITIONS_DIR, partitionName(id));
}

/**
 * The carry-over file: the session cookies Chromium drops, and nothing else (ADR-0004).
 * @param {string} root @param {string} id
 */
function carryOverFile(root, id) {
  return path.join(root, ACCOUNTS_DIR, `${assertAccountId(id)}.plist`);
}

/** Where an unreadable or undecryptable carry-over file is moved, rather than deleted. */
function quarantineFile(root, id, at) {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
  return `${carryOverFile(root, id)}.corrupt-${stamp}`;
}

/**
 * Is this path strictly inside that directory? Resolved, so `..` segments and symlink-free relative
 * tricks are compared as the filesystem would see them.
 * @param {string} root @param {string} candidate
 */
function isInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  if (target === base) return false;
  const relative = path.relative(base, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The guard every removal and quarantine passes through.
 * @param {string} root @param {string} target
 */
function assertRemovable(root, target) {
  if (!isInside(root, target)) {
    throw new Error('Refusing to change a path outside the Poolside data directory.');
  }
  return target;
}

/**
 * Names of the directories under `Partitions` that belong to this application, mapped back to account
 * ids. Chromium also keeps its own directories there (`Shared Dictionary`, caches), so anything that is
 * not a `poolside-<uuid>` directory is reported as foreign rather than claimed as ours.
 * @param {string[]} entries directory names
 */
function classifyPartitionEntries(entries) {
  /** @type {{id: string, name: string}[]} */
  const ours = [];
  /** @type {string[]} */
  const foreign = [];
  /** @type {string[]} */
  const malformed = [];
  for (const name of Array.isArray(entries) ? entries : []) {
    if (typeof name !== 'string') continue;
    if (!name.startsWith(PARTITION_PREFIX)) {
      foreign.push(name);
      continue;
    }
    const id = name.slice(PARTITION_PREFIX.length);
    if (IDENTIFIER.test(id)) ours.push({ id, name });
    else malformed.push(name);
  }
  return { ours, foreign, malformed };
}

/**
 * `poolside-<id>.plist` files, and anything else sitting in the accounts directory.
 * @param {string[]} entries file names
 */
function classifyAccountEntries(entries) {
  /** @type {{id: string, name: string, quarantined: boolean}[]} */
  const ours = [];
  /** @type {string[]} */
  const malformed = [];
  for (const name of Array.isArray(entries) ? entries : []) {
    if (typeof name !== 'string') continue;
    const quarantined = /\.corrupt-\d{4}-\d{2}-\d{2}T/.test(name);
    const id = name.replace(/\.plist(\.corrupt-.*)?$/, '');
    if (/\.plist(\.corrupt-.*)?$/.test(name) && IDENTIFIER.test(id)) ours.push({ id, name, quarantined });
    else malformed.push(name);
  }
  return { ours, malformed };
}

module.exports = {
  assertAccountId,
  assertRemovable,
  carryOverFile,
  classifyAccountEntries,
  classifyPartitionEntries,
  isInside,
  partition,
  partitionName,
  profileDirectory,
  quarantineFile,
  ACCOUNTS_DIR,
  PARTITIONS_DIR,
  IDENTIFIER
};
