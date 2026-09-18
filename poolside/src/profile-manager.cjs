// Profile lifecycle for one account: establish its storage, track a generation, check its integrity,
// measure it, and delete it on request. The destructive operation lives in profile-removal.cjs and the
// repair in profile-repair.cjs; this module sequences them, so that closing the session first and
// recording the outcome cannot be skipped.
//
// Authoritative split (ADR-0004): the Chromium partition owns every cookie and all site storage; the
// carry-over file holds only the session cookies Chromium drops. So nothing here ever *rebuilds* a
// profile — damage is quarantined, and the profile keeps what mattered.
//
// The generation counter means one thing: how many times this account's storage **directory** has been
// established. Not on an ordinary open, and not for a damaged file, because the directory was not
// re-established in that case. `root` and `crypto` are injected, so this is testable without Electron.

const fs = require('node:fs');
const path = require('node:path');
const integrity = require('./profile-integrity.cjs');
const { repair } = require('./profile-repair.cjs');
const { removeAccount } = require('./profile-removal.cjs');
const diagnostics = require('./profile-diagnostics.cjs');
const { sweep, describeSweep } = require('./profile-sweep.cjs');
const paths = require('./profile-paths.cjs');
const store = require('./workspace.cjs');
const { sessions, profileReports, workspace } = require('./state.cjs');
const { messageOf } = require('./errors.cjs');

/**
 * @param {{log: import('./types.cjs').LogFn, root: string, crypto: {isEncryptionAvailable: () => boolean, decryptString: (value: Buffer) => string}, sessionFor?: (id: string) => any}} deps
 *
 * `sessionFor` must return a session the caller already holds: `session.fromPartition` *creates* the
 * partition and its directory, so looking one up for the account being deleted resurrects the directory
 * that was just removed. Deleting the files is the deletion.
 */
function createProfileManager(deps) {
  const { log, root, crypto, sessionFor } = deps;

  /** Make sure the two directories this application owns exist, so the first session has somewhere to live. */
  function ensureRoots() {
    for (const directory of [path.join(root, paths.PARTITIONS_DIR), path.join(root, paths.ACCOUNTS_DIR)]) {
      try {
        fs.mkdirSync(directory, { recursive: true });
      } catch (error) {
        log(`Profile storage could not be created at ${directory}: ${messageOf(error)}`, 'warning');
        return false;
      }
    }
    return true;
  }

  /**
   * Establish an account's storage, returning the generation it is now on.
   * @param {import('./types.cjs').Account} account
   */
  function initialise(account) {
    const id = paths.assertAccountId(account.id);
    ensureRoots();
    const directory = paths.profileDirectory(root, id);
    const existing = account.profile || {};
    const recorded = /** @type {number|undefined} */ (existing.generation);
    const known = Number.isInteger(recorded) && Number(recorded) > 0;
    const present = fs.existsSync(directory);
    let generation = known ? Number(recorded) : 0;
    let action = 'unchanged';
    /** @type {Record<string, unknown>} */
    const patch = {};
    if (!known) {
      // First time this account has been looked at. `adopted` when storage is already there (a profile
      // from before this feature existed), `created` when it is not.
      generation = 1;
      action = present ? 'adopted' : 'created';
    } else if (present && existing.established !== true) {
      // Chromium creates a partition directory on first use, so the first time we *see* one is when this
      // account's storage has demonstrably been established.
      patch.established = true;
    } else if (!present && existing.established === true) {
      // It was there and now it is not: that is a genuine re-establishment, and the only thing that
      // moves the counter. A freshly created account whose directory has not appeared yet is not.
      generation += 1;
      action = 're-created';
      patch.established = false;
    }
    if (generation !== existing.generation) patch.generation = generation;
    if (!existing.firstSeenAt) patch.firstSeenAt = new Date().toISOString();
    if (Object.keys(patch).length) store.updateAccountProfile(id, patch);
    if (action === 'created' || action === 're-created') {
      log(`${account.name}: profile storage ${action} (generation ${generation}).`);
    }
    return { id, directory, generation, action, present };
  }

  /**
   * Check one account's carry-over file, and quarantine it if it is unusable. The outcome is recorded in
   * the account's corruption history so it survives the session that found it.
   * @param {import('./types.cjs').Account} account @param {number} [at]
   */
  function inspectAndRepair(account, at = Date.now()) {
    const verdict = integrity.inspect(root, account.id, crypto);
    if (verdict.state !== 'corrupt') {
      if (verdict.severity > 0) {
        const kind = verdict.state === 'unverifiable' ? 'warning' : 'info';
        log(`${account.name}: saved-session check — ${verdict.issues.join('; ') || verdict.state}.`, kind);
      }
      return { verdict, repair: null };
    }
    const outcome = repair(root, account.id, crypto, at);
    const previous = (account.profile && account.profile.corruption) || { count: 0 };
    store.updateAccountProfile(account.id, {
      corruption: {
        count: previous.count + 1,
        lastAt: new Date(at).toISOString(),
        lastReason: verdict.issues[0] || verdict.state,
        lastAction: outcome.action
      }
    });
    log(`${account.name}: ${verdict.issues[0] || 'the saved session is unusable'} — ${outcome.note}`, 'warning');
    return { verdict, repair: outcome };
  }

  /** Measure every account into the live report map, then publish so the dashboard sees it. */
  function measure(accounts, options = {}) {
    diagnostics.measureAll({
      root,
      accounts,
      settings: (workspace.data && workspace.data.settings) || {},
      reports: profileReports,
      log,
      maxFiles: options.maxFiles
    });
    store.publish();
    return profileReports;
  }

  /**
   * The startup pass: sweep abandoned files, check and repair every account, then measure.
   * @param {import('./types.cjs').Account[]} accounts every account, archived included
   * @param {{measure?: boolean}} [options] `measure: false` lets a caller show the window first, because
   *   measuring walks every profile directory and that is the slow half of this
   */
  function scan(accounts, options = {}) {
    ensureRoots();
    const temporary = diagnostics.sweepTemporaryFiles(root);
    if (temporary.removed.length) log(`Removed ${temporary.removed.length} abandoned temporary file(s) left by an interrupted write.`);
    if (temporary.failed.length) log(`Temporary files could not all be removed: ${temporary.failed.join('; ')}`, 'warning');

    const orphaned = sweep(root, accounts);
    const orphanNote = describeSweep(orphaned);
    if (orphanNote) log(`Profile storage sweep: ${orphanNote}.`);
    if (orphaned.failed.length) log(`Some unclaimed storage could not be removed: ${orphaned.failed.join('; ')}`, 'warning');

    /** @type {ReturnType<typeof integrity.inspect>[]} */
    const verdicts = [];
    for (const account of accounts) verdicts.push(inspectAndRepair(account).verdict);
    const summary = integrity.summarise(verdicts);
    const described = Object.entries(summary)
      .map(([state, count]) => `${count} ${state}`)
      .join(', ');
    const damaged = (summary.corrupt || 0) + (summary.unverifiable || 0);
    log(
      damaged ? `Saved-session check: ${described}.` : `Saved-session check: ${described || 'nothing to check'}.`,
      damaged ? 'warning' : 'info'
    );
    if (options.measure !== false) measure(accounts);
    return { verdicts, summary, orphans: orphaned, temporary };
  }

  /**
   * Delete one account's storage. The work is in profile-removal.cjs; this wires it to the manager's own
   * state (which sessions are open) and bookkeeping (the report and the record), so that forgetting either
   * one is not something a caller can skip.
   * @param {import('./types.cjs').Account} account
   * @param {{clearStorageData?: () => Promise<void>}|null} [browserSession] a session the caller holds
   */
  async function remove(account, browserSession = null) {
    return removeAccount(root, account, {
      session: browserSession || (typeof sessionFor === 'function' ? sessionFor(account.id) : null),
      isOpen: id => sessions.has(id),
      forget: id => {
        profileReports.delete(id);
        store.updateAccountProfile(id, null);
      },
      log
    });
  }

  /** The last measurement taken for an account, or null if it has never been measured. */
  function report(id) {
    return profileReports.get(id) || null;
  }

  /** What is on disk that no account claims. `apply: false` reports without removing anything. */
  function sweepOrphans(accounts, options) {
    return sweep(root, accounts, options);
  }

  return { ensureRoots, initialise, inspectAndRepair, measure, report, scan, remove, sweepOrphans };
}

module.exports = { createProfileManager };
