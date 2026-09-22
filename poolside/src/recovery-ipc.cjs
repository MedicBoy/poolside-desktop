// The dashboard's way back: what recovery copies exist, and restoring one deliberately.
//
// `workspace-recovery.cjs` reads and describes; this is the dashboard surface. A restore is destructive — it
// replaces the current account list — so it asks natively, like the one other irreversible action in the
// application does, rather than through a confirmation a page script could forge.

/**
 * @param {{handle: (name: string, fn: (input?: any) => any) => void, recovery: {candidates: Function, read: Function}, save: (value: any) => void, log: (message: string, level?: 'info'|'warning') => void, confirmDestructive: (title: string, detail: string) => Promise<boolean>}} deps
 */
function registerRecoveryIpc({ handle, recovery, save, log, confirmDestructive }) {
  handle('recovery:preview', () => ({ candidates: recovery.candidates() }));

  handle('recovery:restore', async input => {
    const name = typeof input?.name === 'string' ? input.name : '';
    const listed = recovery.candidates().find(candidate => candidate.name === name);
    if (!listed) throw new Error('That recovery copy is no longer there.');
    if (!listed.usable) throw new Error(listed.problem);
    const names = listed.accounts.map(account => account.name).join(', ') || 'no accounts';
    const agreed = await confirmDestructive(
      'Replace the workspace with this recovery copy?',
      `This replaces the current accounts (${names}) with the copy from ${listed.writtenAt}. The copy that is in place now is kept as the previous copy first, so this can be undone by restoring that one.`
    );
    if (!agreed) throw new Error('The restore was cancelled.');
    // Through the application's own save, so the same validation and the same atomic write apply.
    save(recovery.read(name));
    log(`Workspace restored from ${name} (${listed.accounts.length} account slot(s)).`);
    return listed;
  });
}

module.exports = { registerRecoveryIpc };
