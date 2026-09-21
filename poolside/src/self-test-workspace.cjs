// Where a self-test keeps its throwaway user-data directory, and which older ones are safe to remove.
//
// Defect: the directory used to be named from the process id alone. Windows reuses process ids, so a
// later run could open a directory an earlier run had left behind. The accounts it created were already
// there, every add was refused as a duplicate, and the dashboard check failed for a reason that had
// nothing to do with the code under test — a one-in-four flake with a completely misleading message. The
// name carries a timestamp as well now, and the abandoned directories are swept so they do not pile up.
//
// Pure: the caller does the filesystem work. Names and ages arrive as data so the rules are testable.

const PREFIX = 'poolside-test-';
/** A run that is still going is not abandoned; an hour is far longer than this suite takes. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/** @param {number} stamp @param {number} pid */
function rootName(stamp, pid) {
  return `${PREFIX}${pid}-${Number(stamp).toString(36)}`;
}

/** @param {unknown} name */
function isSelfTestRoot(name) {
  return typeof name === 'string' && name.startsWith(PREFIX) && name.length > PREFIX.length;
}

/**
 * Names of self-test directories old enough that the run which made them has finished.
 * @param {{name: string, modifiedMs: number}[]|null} entries
 * @param {{now: number, olderThanMs?: number}} options
 */
function staleRoots(entries, { now, olderThanMs = STALE_AFTER_MS }) {
  return (Array.isArray(entries) ? entries : [])
    .filter(
      entry =>
        entry &&
        isSelfTestRoot(entry.name) &&
        Number.isFinite(entry.modifiedMs) &&
        Number.isFinite(now) &&
        now - entry.modifiedMs >= olderThanMs
    )
    .map(entry => entry.name);
}

module.exports = { rootName, isSelfTestRoot, staleRoots, PREFIX, STALE_AFTER_MS };
