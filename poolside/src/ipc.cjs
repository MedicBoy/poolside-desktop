// The IPC contract.
//
// Every dashboard action arrives here. `trusted` is the transport guard (only the dashboard's own
// main frame may call in) and it is a named capture of the workspace state, and every handler
// returns the same { ok, value | error } envelope. Extracted from main.cjs so the composition root
// stays wiring.

const model = require('./model.cjs');
const settingsController = require('./settings-ui-controller.cjs');
const diagnosticsBundle = require('./diagnostics-bundle.cjs');
const { log, snapshot, save, publish, getAccount, clearActivityHistory } = require('./workspace.cjs');
const { sessions, workspace } = require('./state.cjs');
const { messageOf } = require('./errors.cjs');
const { registerAccountManagement } = require('./account-management-ipc.cjs');
const workspaceBackup = require('./workspace-backup.cjs');
const { registerCaptureLab } = require('./capture-lab-ipc.cjs');
const { registerBackupIpc } = require('./backup-ipc.cjs');
const { registerRoutePresetIpc } = require('./route-preset-ipc.cjs');
const { createAccountIpCheck } = require('./network-ipc.cjs');

const PREFS_SAVED = 'Transfer preferences saved. Automation is not yet connected.';

/**
 * @param {{ipcMain: import('electron').IpcMain, UI_URL: string, windows: any, inspector: any, monitor: any, tableNavigation: any, profiles: any, captureLab: any, diagnosticsRoot: string, dataRoot: string, openPath: (path: string) => Promise<string>, confirmChange: (title: string, detail: string, label?: string) => Promise<boolean>, confirmDestructive: (title: string, detail: string) => Promise<boolean>, chooseDirectory: (title: string, allowCreate: boolean) => Promise<string|null>}} deps
 */
function createIpc(deps) {
  const {
    ipcMain,
    UI_URL,
    windows,
    inspector,
    monitor,
    tableNavigation,
    profiles,
    captureLab,
    diagnosticsRoot,
    dataRoot,
    openPath,
    confirmChange,
    confirmDestructive,
    chooseDirectory
  } = deps;
  const activeAccounts = () => workspace.data.accounts.filter(a => !a.archived);

  /**
   * Only the dashboard's own main frame may call IPC.
   * @param {import('electron').IpcMainInvokeEvent} event
   */
  function trusted(event) {
    const dashboard = workspace.dashboard;
    if (!dashboard || event.sender !== dashboard.webContents) throw new Error('Request rejected.');
    if (event.senderFrame !== dashboard.webContents.mainFrame) throw new Error('Request rejected.');
    if (event.senderFrame.url !== UI_URL) throw new Error('Request rejected.');
  }

  /**
   * @param {string} name
   * @param {(input: any) => any} fn
   */
  function handle(name, fn) {
    ipcMain.handle(name, async (event, input) => {
      try {
        trusted(event);
        const result = await fn(input);
        return { ok: true, value: result ?? snapshot() };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    });
  }

  const checkAccountIP = createAccountIpCheck({ sessions, getAccount, publish, log });

  function register() {
    handle('workspace:get', () => snapshot());
    registerRoutePresetIpc({ handle, workspace, save, log });
    handle('account:open', id => windows.openAccount(id));
    handle('account:close', id => {
      getAccount(id);
      windows.closeAccount(id);
    });
    handle('account:check-ip', checkAccountIP);
    handle('account:check-route', id => windows.checkRoute(id));
    handle('account:delete-profile', async id => {
      const account = getAccount(id);
      // The only irreversible action in the application, so it is confirmed natively rather than by a
      // renderer-side confirm that a page script could forge.
      const agreed = await confirmDestructive(
        `Delete ${account.name}'s saved profile?`,
        "This removes that account's cookies, site storage and saved session from this PC. They cannot be recovered, and you will need to sign in again."
      );
      if (!agreed) throw new Error('Profile deletion was cancelled.');
      const outcome = await profiles.remove(account);
      if (outcome.failures.length) {
        throw new Error(
          `The profile was only partly removed: ${outcome.removed.length} item(s) deleted, but ${outcome.failures.join('; ')}`
        );
      }
      return outcome;
    });
    handle('profiles:refresh', () => {
      profiles.measure(workspace.data.accounts);
    });
    // Both preview and file export use the same prepare() step. A diagnostics file cannot be written unless the
    // exact payload preview first constructs and passes the secret scanner.
    handle('diagnostics:preview', () => diagnosticsBundle.prepare(snapshot()));
    handle('diagnostics:save', () => diagnosticsBundle.write(diagnosticsRoot, diagnosticsBundle.prepare(snapshot())));
    handle('diagnostics:open-folder', async () => {
      const error = await openPath(diagnosticsBundle.directory(diagnosticsRoot));
      if (error) throw new Error(`Diagnostics folder could not be opened: ${error}`);
      return { opened: true };
    });
    handle('activity:history-clear', async () => {
      const agreed = await confirmDestructive(
        'Erase saved activity history?',
        'This removes Poolside activity messages saved on this PC. It does not remove browser profiles or saved sign-in sessions.'
      );
      if (!agreed) throw new Error('Saved activity history was not erased.');
      return clearActivityHistory();
    });
    registerBackupIpc({ handle, backup: workspaceBackup, dataRoot, chooseDirectory, workspace, save, log });
    handle('account:return-game', id => windows.returnToGame(id));
    handle('account:reload', id => windows.reloadAccount(id));
    handle('account:inspect', id => inspector.inspectGame(id));
    handle('table-navigation:start', input => tableNavigation.start(input));
    handle('table-navigation:observe', id => tableNavigation.observe(id));
    handle('table-navigation:advance', id => tableNavigation.advance(id));
    handle('table-navigation:cancel', id => tableNavigation.cancel(id));
    handle('table-navigation:retry', id => tableNavigation.retry(id));
    handle('account:monitor-start', id => {
      getAccount(id);
      const group = sessions.get(id);
      if (!group) throw new Error('Open this account window before starting live monitoring.');
      group.monitoring = true;
      return monitor.start(id);
    });
    handle('account:monitor-stop', id => {
      getAccount(id);
      const group = sessions.get(id);
      if (group) group.monitoring = false;
      return monitor.stop(id);
    });
    registerCaptureLab({ handle, inspector, captureLab });
    registerAccountManagement({
      handle,
      model,
      workspace,
      sessions,
      windows,
      save,
      log,
      getAccount,
      profiles,
      confirmRoleChange: confirmChange,
      confirmDestructive,
      activeAccounts
    });
    handle('sessions:open', async () => {
      await Promise.all(activeAccounts().map(a => windows.openAccount(a.id)));
    });
    handle('sessions:close', () => windows.closeAll());
    handle('sessions:arrange', () => windows.arrange());
    handle('settings:form', () => {
      // The form is generated from the schema, so the renderer never holds a hardcoded field list that can
      // disagree with what the app can execute (ADR-0017).
      return settingsController.form('settings', workspace.data.settings);
    });
    handle('settings:save', input => {
      // One pipeline for a form edit: the controller types the submitted strings, merges them over the stored
      // settings, and validates the whole candidate. Schema-first (ADR-0014) still holds — an unusable value is
      // refused before it can reach a session rather than coerced on the way in — with one difference that only
      // applies to a form: a grammar refusal of a field the user just edited is an *error* the form shows,
      // because "saved, but your value was ignored" is not true enough to ship.
      const outcome = settingsController.route({ .../** @type {any} */ (input), section: 'settings', current: workspace.data.settings });
      // A refused edit is **data, not an exception**: the call succeeded in judging it, and the form needs to
      // know *which* control is wrong rather than one sentence about the whole panel. A thrown error here would
      // collapse that to a string on the way through the IPC envelope.
      if (!outcome.ok) return { saved: false, errors: outcome.errors, ignored: outcome.ignored, form: outcome.form };
      save({ ...workspace.data, settings: model.settings(/** @type {any} */ (outcome.value)) });
      // A field the user did not touch may still be unusable in the stored document; that stays a drop and is
      // reported, not silently discarded.
      if (outcome.ignored.length) log(`Some settings were ignored: ${settingsController.describe(outcome)}.`, 'warning');
      log(PREFS_SAVED);
      return { saved: true, errors: [], ignored: outcome.ignored, form: outcome.form };
    });
  }

  return { register, trusted, checkAccountIP };
}

module.exports = { createIpc, PREFS_SAVED };
