// Backup IPC handlers. The filesystem work remains in workspace-backup.cjs.

/**
 * @param {{handle: (name: string, fn: (input?: any) => any) => void, backup: any, dataRoot: string, chooseDirectory: (title: string, allowCreate: boolean) => Promise<string|null>, workspace: any, save: (value: any) => void, log: (message: string) => void}} deps
 */
function registerBackupIpc({ handle, backup, dataRoot, chooseDirectory, workspace, save, log }) {
  handle('backup:export', async () => {
    const destination = await chooseDirectory('Choose a folder to save the Poolside backup in', true);
    if (!destination) throw new Error('The backup was cancelled.');
    const result = backup.create({
      root: dataRoot,
      destination,
      accounts: workspace.data.accounts,
      appVersion: workspace.version,
      at: Date.now()
    });
    log(
      `Backup written: ${result.accountCount} account slot(s), ${result.sessionCount} encrypted session file(s), ${result.profileCount} browser profile(s).`
    );
    return result;
  });

  handle('backup:import', async () => {
    const source = await chooseDirectory('Choose the Poolside backup folder to restore', false);
    if (!source) throw new Error('The restore was cancelled.');
    const result = backup.restore({ root: dataRoot, source, existing: workspace.data.accounts });
    if (result.restored.length) {
      save({ ...workspace.data, accounts: [...workspace.data.accounts, ...result.restored] });
      log(`Backup restored: ${result.restored.length} account slot(s) added to this workspace.`);
    }
    return result;
  });
}

module.exports = { registerBackupIpc };
