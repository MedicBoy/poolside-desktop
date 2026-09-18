// Sweeping the storage directories: what is on disk that no account claims.
//
// This is the only place in the application that deletes a directory tree, so it is deliberately
// conservative. Three rules:
//
//   1. **Archived accounts are not orphans.** An archived account is still in the workspace document, so
//      its profile must survive — deleting it would silently destroy the session behind an account the
//      user may unarchive tomorrow. The caller passes every account, not just the active ones.
//   2. **Only `poolside-<uuid>` directories and `<uuid>.plist` files are ever touched.** Chromium keeps
//      its own directories under `Partitions` (`Shared Dictionary`, code caches), and a hand-placed file
//      in `accounts` may be the user's own backup. Those are reported as foreign and left alone.
//   3. **Every removal is expressed as a path this module built**, then re-checked against the data
//      directory by `assertRemovable`. A corrupted workspace cannot direct a delete elsewhere.

const fs = require('node:fs');
const path = require('node:path');
const {
  assertRemovable,
  classifyAccountEntries,
  classifyPartitionEntries,
  partitionName,
  ACCOUNTS_DIR,
  PARTITIONS_DIR
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
 * @param {string} root
 * @param {{id: string}[]} accounts every account in the workspace document, archived included
 * @param {{apply?: boolean}} [options] `apply: false` reports what would be removed and touches nothing
 * @returns {{removed: {profiles: string[], carryOver: string[]}, kept: {foreign: string[], malformed: string[], unclaimed: string[]}, failed: string[]}}
 */
function sweep(root, accounts, options = {}) {
  const apply = options.apply !== false;
  const known = new Set((Array.isArray(accounts) ? accounts : []).map(account => account && account.id).filter(Boolean));
  /** @type {{removed: {profiles: string[], carryOver: string[]}, kept: {foreign: string[], malformed: string[], unclaimed: string[]}, failed: string[]}} */
  const outcome = { removed: { profiles: [], carryOver: [] }, kept: { foreign: [], malformed: [], unclaimed: [] }, failed: [] };

  const partitions = classifyPartitionEntries(listNames(path.join(root, PARTITIONS_DIR)));
  for (const entry of partitions.ours) {
    if (known.has(entry.id)) continue;
    // `unclaimed` means it is still on disk afterwards: either this was a dry run, or the removal
    // failed. Recording it as kept on the way past a successful delete would report the same entry as
    // both removed and left alone.
    if (!apply) {
      outcome.kept.unclaimed.push(entry.name);
      continue;
    }
    try {
      const target = assertRemovable(root, path.join(root, PARTITIONS_DIR, entry.name));
      fs.rmSync(target, { recursive: true, force: true });
      outcome.removed.profiles.push(partitionName(entry.id));
    } catch (error) {
      outcome.failed.push(`${entry.name}: ${messageOf(error)}`);
      outcome.kept.unclaimed.push(entry.name);
    }
  }
  outcome.kept.foreign.push(...partitions.foreign);
  outcome.kept.malformed.push(...partitions.malformed);

  const files = classifyAccountEntries(listNames(path.join(root, ACCOUNTS_DIR)));
  for (const entry of files.ours) {
    if (known.has(entry.id)) continue;
    if (!apply) {
      outcome.kept.unclaimed.push(entry.name);
      continue;
    }
    try {
      const target = assertRemovable(root, path.join(root, ACCOUNTS_DIR, entry.name));
      fs.rmSync(target, { force: true });
      outcome.removed.carryOver.push(entry.name);
    } catch (error) {
      outcome.failed.push(`${entry.name}: ${messageOf(error)}`);
      outcome.kept.unclaimed.push(entry.name);
    }
  }
  outcome.kept.malformed.push(...files.malformed);
  return outcome;
}

/** One line for the activity feed, or null when there was nothing to say. */
function describeSweep(outcome) {
  const parts = [];
  if (outcome.removed.profiles.length) parts.push(`${outcome.removed.profiles.length} unclaimed profile(s) removed`);
  if (outcome.removed.carryOver.length) parts.push(`${outcome.removed.carryOver.length} unclaimed cookie file(s) removed`);
  if (outcome.kept.unclaimed.length) parts.push(`${outcome.kept.unclaimed.length} unclaimed item(s) left in place`);
  if (outcome.kept.foreign.length) parts.push(`${outcome.kept.foreign.length} foreign director(ies) left alone`);
  if (outcome.kept.malformed.length) parts.push(`${outcome.kept.malformed.length} unrecognised name(s) left alone`);
  if (outcome.failed.length) parts.push(`${outcome.failed.length} could not be removed`);
  return parts.length ? parts.join(', ') : null;
}

module.exports = { sweep, describeSweep };
