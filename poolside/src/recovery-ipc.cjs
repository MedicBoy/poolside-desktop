// The dashboard's way back: what recovery copies exist, and restoring one deliberately.
//
// `workspace-recovery.cjs` reads and describes; this is the dashboard surface. A restore is destructive — it
// replaces the current account list — so it asks natively, like the one other irreversible action in the
// application does, rather than through a confirmation a page script could forge.

/**
 * @param {{handle: (name: string, fn: (input?: any) => any) => void, recovery: {candidates: Function, read: Function}, restore: (value: any) => {preservedName: string|null}, isReadOnly: () => boolean, hasOpenSessions: () => boolean, log: (message: string, level?: 'info'|'warning') => void, confirmDestructive: (title: string, detail: string) => Promise<boolean>}} deps
 */
function registerRecoveryIpc({ handle, recovery, restore, isReadOnly, hasOpenSessions, log, confirmDestructive }) {
  handle('recovery:preview', () => ({ candidates: recovery.candidates() }));

  handle('recovery:restore', async input => {
    const name = typeof input?.name === 'string' ? input.name : '';
    const listed = recovery.candidates().find(candidate => candidate.name === name);
    if (!listed) throw new Error('That recovery copy is no longer there.');
    if (!listed.usable) throw new Error(listed.problem);
    if (hasOpenSessions()) throw new Error('Close every account window before restoring the workspace.');
    const names = listed.accounts.map(account => account.name).join(', ') || 'no accounts';
    const preservation = isReadOnly()
      ? 'If the current workspace file exists, its original bytes will be kept in a separate unreadable copy.'
      : 'The current workspace is kept as the previous copy when its account and credential data can safely be retained.';
    const agreed = await confirmDestructive(
      'Replace the workspace with this recovery copy?',
      `This replaces the current accounts with the selected copy (${names}) from ${listed.writtenAt}. ${preservation}`
    );
    if (!agreed) throw new Error('The restore was cancelled.');
    if (hasOpenSessions()) throw new Error('An account window opened while recovery was being confirmed. Close it and try again.');
    const result = restore(recovery.read(name, listed.revision));
    log(`Workspace restored from ${name} (${listed.accounts.length} account slot(s)).`);
    return { ...listed, preservedName: result.preservedName };
  });
}

module.exports = { registerRecoveryIpc };
