// Deleting one account's storage. The only destructive operation in the application.
//
// Four rules, in the order they are enforced:
//
//   1. **Refused while the session is open.** Removing the directory underneath a live Chromium session
//      leaves that session writing into a deleted tree.
//   2. **Storage is cleared first.** Best effort: a failure is logged and the files are removed anyway,
//      because the account is going away either way.
//   3. **Every path is built here and re-checked** by `assertRemovable` against the data directory, so a
//      corrupted workspace record cannot direct a delete somewhere else.
//   4. **Nothing is reported as removed that still exists**, and every failure is named.
//
// No Electron import: the caller supplies the session and the bookkeeping callbacks.

const fs = require('node:fs');
const path = require('node:path');
const {
  assertAccountId,
  assertRemovable,
  classifyAccountEntries,
  partitionName,
  profileDirectory,
  ACCOUNTS_DIR
} = require('./profile-paths.cjs');
const { messageOf } = require('./errors.cjs');

/** @param {string} directory */
function listNames(directory) {
  try {
    return fs.readdirSync(directory);
  } catch (error) {
    if (/** @type {any} */ (error).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * @param {string} root the Poolside data directory
 * @param {{id: string, name: string}} account
 * @param {{session?: {clearStorageData?: () => Promise<void>}|null, isOpen?: (id: string) => boolean, forget?: (id: string) => void, log?: import('./types.cjs').LogFn}} [options]
 * @returns {Promise<{removed: string[], failures: string[]}>}
 */
async function removeAccount(root, account, options = {}) {
  const id = assertAccountId(account.id);
  if (typeof options.isOpen === 'function' && options.isOpen(id)) {
    throw new Error('Close this session before deleting its profile.');
  }
  const session = options.session || null;
  if (session && typeof session.clearStorageData === 'function') {
    try {
      await session.clearStorageData();
    } catch (error) {
      options.log?.(`${account.name}: storage data could not be cleared (${messageOf(error)}); removing the files anyway.`, 'warning');
    }
  }

  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const failures = [];
  const accountsDirectory = path.join(root, ACCOUNTS_DIR);
  // The carry-over file and any quarantined copies of it: a deleted profile takes its evidence with it.
  for (const name of listNames(accountsDirectory)) {
    if (!classifyAccountEntries([name]).ours.some(entry => entry.id === id)) continue;
    try {
      fs.rmSync(assertRemovable(root, path.join(accountsDirectory, name)), { force: true });
      removed.push(name);
    } catch (error) {
      failures.push(`${name}: ${messageOf(error)}`);
    }
  }
  const directory = profileDirectory(root, id);
  if (fs.existsSync(directory)) {
    try {
      fs.rmSync(assertRemovable(root, directory), { recursive: true, force: true });
      removed.push(partitionName(id));
    } catch (error) {
      failures.push(`${partitionName(id)}: ${messageOf(error)}`);
    }
  }
  if (typeof options.forget === 'function') options.forget(id);
  options.log?.(
    failures.length
      ? `${account.name}: profile removed with ${failures.length} failure(s): ${failures.join('; ')}`
      : `${account.name}: profile removed (${removed.length} item(s)).`,
    failures.length ? 'warning' : 'info'
  );
  return { removed, failures };
}

module.exports = { removeAccount };
