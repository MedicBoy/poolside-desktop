// Sequence startup profile maintenance. Startup is deliberately non-destructive: an account record can
// be replaced, restored, or temporarily absent while its browser profile still contains the only usable
// login. Unclaimed storage is reported for later user-directed recovery or removal, never erased here.

const integrity = require('./profile-integrity.cjs');
const { sweep, describeSweep } = require('./profile-sweep.cjs');

/** @param {any} input */
function scanProfiles(input) {
  const { root, accounts, options, ensureRoots, inspectAndRepair, measure, log } = input;
  ensureRoots();
  // An interrupted first session save may leave the only recoverable encrypted payload in `.plist.tmp`.
  // Startup therefore does not treat temporary-looking profile data as disposable either.
  const temporary = { removed: [], failed: [] };

  // Even a fully decoded workspace is not proof that an unlisted profile is disposable. In particular,
  // recreating an account slot gives it a new id while the old id can still own a valid login session.
  const orphaned = sweep(root, accounts, { apply: false });
  const orphanNote = describeSweep(orphaned);
  if (orphanNote) log(`Profile storage sweep: ${orphanNote}.`);
  if (orphaned.failed.length) log(`Some profile storage could not be inspected: ${orphaned.failed.join('; ')}`, 'warning');

  const verdicts = accounts.map(account => inspectAndRepair(account).verdict);
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

module.exports = { scanProfiles };
