// Measuring a profile: how much disk it occupies, and how that compares with its configured ceiling.
//
// Bounded on purpose. A Chromium partition is thousands of files, and an unbounded walk on a cold disk
// would stall the app at startup. The walk stops at a file cap and reports `truncated`, so a reported
// number is always a *lower bound* and the caller can say so rather than implying it is exact.
//
// Symlinks are never followed: a junction inside a profile would otherwise pull an unrelated directory
// into the total, or loop forever.
//
// The ceiling is a comparison, not enforcement — Electron exposes no per-session storage quota
// (ADR-0012). This module reports; it never deletes to make a number look right.

const fs = require('node:fs');
const path = require('node:path');
const { profileDirectory, carryOverFile, ACCOUNTS_DIR } = require('./profile-paths.cjs');
const { resolveIdentity } = require('./identity.cjs');
const { messageOf } = require('./errors.cjs');

const DEFAULT_MAX_FILES = 5000;

/**
 * Walk a directory iteratively (no recursion, so depth cannot blow the stack), summing file sizes.
 * @param {string} directory
 * @param {{maxFiles?: number}} [limits]
 * @returns {{bytes: number, files: number, directories: number, unreadable: number, truncated: boolean, missing: boolean}}
 */
function measureDirectory(directory, limits = {}) {
  const requested = limits.maxFiles;
  const maxFiles = typeof requested === 'number' && Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_MAX_FILES;
  const result = { bytes: 0, files: 0, directories: 0, unreadable: 0, truncated: false, missing: false };
  if (typeof directory !== 'string' || !directory) {
    result.missing = true;
    return result;
  }
  const pending = [directory];
  while (pending.length) {
    const current = /** @type {string} */ (pending.pop());
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      // The profile directory does not exist until Chromium first uses the partition: normal, not a fault.
      if (current === directory && /** @type {any} */ (error).code === 'ENOENT') {
        result.missing = true;
        return result;
      }
      result.unreadable += 1;
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        result.directories += 1;
        pending.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (result.files >= maxFiles) {
        result.truncated = true;
        return result;
      }
      try {
        result.bytes += fs.statSync(full).size;
        result.files += 1;
      } catch {
        result.unreadable += 1;
      }
    }
  }
  return result;
}

/** @param {number|null|undefined} bytes */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The diagnostic picture for one account: what is on disk, and what the ceiling says about it.
 *
 * `totalBytes` is the partition directory plus the carry-over file, because both are that session's
 * footprint on disk. They are also reported separately, since only the partition is Chromium's.
 *
 * @param {string} root @param {string} id
 * @param {{quotaBytes?: number|null, maxFiles?: number, now?: number}} [options]
 */
function report(root, id, options = {}) {
  const directory = profileDirectory(root, id);
  const measured = measureDirectory(directory, { maxFiles: options.maxFiles });
  /** @type {number|null} */
  let carryOverBytes = null;
  try {
    carryOverBytes = fs.statSync(carryOverFile(root, id)).size;
  } catch {
    carryOverBytes = null;
  }
  const quotaBytes = Number.isFinite(options.quotaBytes) && Number(options.quotaBytes) > 0 ? Number(options.quotaBytes) : null;
  const totalBytes = measured.bytes + (carryOverBytes || 0);
  return {
    id,
    path: directory,
    directoryBytes: measured.bytes,
    carryOverBytes,
    totalBytes,
    fileCount: measured.files,
    directoryCount: measured.directories,
    unreadable: measured.unreadable,
    truncated: measured.truncated,
    missing: measured.missing,
    quotaBytes,
    overQuota: quotaBytes !== null && totalBytes > quotaBytes,
    checkedAt: new Date(options.now === undefined ? Date.now() : options.now).toISOString()
  };
}

/**
 * One line for the activity feed. Says "at least" when the walk was capped, and never presents the
 * ceiling as something the app enforces.
 * @param {ReturnType<typeof report>} snapshot
 */
function describeReport(snapshot) {
  if (snapshot.missing) return 'no profile directory yet';
  const size = `${snapshot.truncated ? 'at least ' : ''}${formatBytes(snapshot.totalBytes)} in ${snapshot.fileCount} files`;
  if (snapshot.quotaBytes === null) return size;
  return snapshot.overQuota
    ? `${size}, over the configured ${formatBytes(snapshot.quotaBytes)} ceiling`
    : `${size}, within the configured ceiling`;
}

/**
 * Remove the debris a half-finished write leaves behind: abandoned `.tmp` files. Two writers use that
 * pattern (the workspace document and each carry-over file), and both are safe to delete because a
 * `.tmp` file is by definition never the live copy.
 * @param {string} root
 */
function sweepTemporaryFiles(root) {
  /** @type {{removed: string[], failed: string[]}} */
  const outcome = { removed: [], failed: [] };
  /** @type {string[]} */
  const directories = [root, path.join(root, ACCOUNTS_DIR)];
  for (const directory of directories) {
    /** @type {string[]} */
    let entries;
    try {
      entries = fs.readdirSync(directory);
    } catch (error) {
      if (/** @type {any} */ (error).code !== 'ENOENT') outcome.failed.push(`${directory}: ${messageOf(error)}`);
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.tmp')) continue;
      const target = path.join(directory, name);
      try {
        fs.unlinkSync(target);
        outcome.removed.push(path.relative(root, target));
      } catch (error) {
        outcome.failed.push(`${path.relative(root, target)}: ${messageOf(error)}`);
      }
    }
  }
  return outcome;
}

/**
 * Measure every account and fill the live report map the snapshot reads from.
 *
 * The ceiling comes from the same identity configuration the session itself uses, so the number the
 * dashboard shows and the number the session claims cannot drift apart.
 * @param {{root: string, accounts: import('./types.cjs').Account[], settings: any, reports: Map<string, import('./types.cjs').ProfileReport>, log: import('./types.cjs').LogFn, maxFiles?: number}} options
 */
function measureAll(options) {
  const { root, accounts, settings, reports, log } = options;
  for (const account of accounts) {
    const { identity } = resolveIdentity(account, settings || {});
    const measured = report(root, account.id, { quotaBytes: identity.quotaBytes, maxFiles: options.maxFiles });
    reports.set(account.id, measured);
    if (measured.overQuota) {
      log(`${account.name}: profile storage is ${describeReport(measured)}. That ceiling is measured, not enforced.`, 'warning');
    }
  }
}

module.exports = { measureDirectory, report, measureAll, formatBytes, describeReport, sweepTemporaryFiles, DEFAULT_MAX_FILES };
