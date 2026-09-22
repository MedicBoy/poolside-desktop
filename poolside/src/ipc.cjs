// The IPC contract.
//
// Every dashboard action arrives here. `trusted` is the transport guard (only the dashboard's own
// main frame may call in) and it is a named capture of the workspace state, and every handler
// returns the same { ok, value | error } envelope. Extracted from main.cjs so the composition root
// stays wiring.

const fs = require('node:fs');
const path = require('node:path');
const model = require('./model.cjs');
const runReport = require('./run-report.cjs');
const settingsController = require('./settings-ui-controller.cjs');
const diagnosticsBundle = require('./diagnostics-bundle.cjs');
const { log, snapshot, save, getAccount, clearActivityHistory } = require('./workspace.cjs');
const { sessions, workspace } = require('./state.cjs');
const { messageOf } = require('./errors.cjs');
const { registerAccountManagement } = require('./account-management-ipc.cjs');
const workspaceBackup = require('./workspace-backup.cjs');
const { registerCaptureLab } = require('./capture-lab-ipc.cjs');
const { registerBackupIpc } = require('./backup-ipc.cjs');
const { registerRoutePresetIpc } = require('./route-preset-ipc.cjs');
const { registerRecoveryIpc } = require('./recovery-ipc.cjs');
const outputInventory = require('./output-inventory.cjs');
const { registerOutputsIpc } = require('./outputs-ipc.cjs');
const { registerIdentityIpc } = require('./identity-ipc.cjs');
const { createWorkspaceRecovery } = require('./workspace-recovery.cjs');
const { registerMatchIpc } = require('./match-ipc.cjs');
const { probeRoute } = require('./route-probe.cjs');

const PREFS_SAVED = 'Transfer preferences saved. Automation is not yet connected.';

/**
 * @param {{ipcMain: import('electron').IpcMain, UI_URL: string, windows: any, inspector: any, monitor: any, tableNavigation: any, matches: any, checkAccountIP: (id: string) => any, profiles: any, captureLab: any, diagnosticsRoot: string, dataRoot: string, openPath: (path: string) => Promise<string>, confirmChange: (title: string, detail: string, label?: string) => Promise<boolean>, confirmDestructive: (title: string, detail: string) => Promise<boolean>, chooseDirectory: (title: string, allowCreate: boolean) => Promise<string|null>}} deps
 */
function createIpc(deps) {
  const {
    ipcMain,
    UI_URL,
    windows,
    inspector,
    monitor,
    tableNavigation,
    matches,
    checkAccountIP,
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

  function register() {
    handle('workspace:get', () => snapshot());
    // The same probe the pasted-address test uses: trying a saved location goes through the identical path, so a
    // saved address cannot behave differently from one the operator just typed.
    registerRoutePresetIpc({ handle, workspace, save, log, sessions, probe: probeRoute });
    handle('account:open', id => windows.openAccount(id));
    handle('account:close', id => {
      getAccount(id);
      windows.closeAccount(id);
    });
    handle('account:check-ip', checkAccountIP);
    handle('account:check-route', id => windows.checkRoute(id));
    // Trying an address before it is saved or assigned, on a throwaway profile.
    handle('route:test', input => probeRoute(input && input.spec));
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
    // The bundle carries the state as well as the timeline. What the snapshot cannot know is gathered here: how
    // big the workspace file is and when it was last written (so two bundles can be told apart without a
    // fingerprint the secret scanner would refuse), and how many recovery copies exist.
    const diagnosticsFacts = () => {
      /** @type {number|null} */
      let workspaceBytes = null;
      /** @type {string|null} */
      let workspaceWrittenAt = null;
      try {
        if (workspace.storeFile && fs.existsSync(workspace.storeFile)) {
          const stat = fs.statSync(workspace.storeFile);
          workspaceBytes = stat.size;
          workspaceWrittenAt = stat.mtime.toISOString();
        }
      } catch {
        workspaceBytes = null;
      }
      let recoveryCandidates = 0;
      try {
        if (workspace.storeFile) recoveryCandidates = createWorkspaceRecovery({ file: workspace.storeFile }).candidates().length;
      } catch {
        recoveryCandidates = 0;
      }
      return { workspaceBytes, workspaceWrittenAt, recoveryCandidates };
    };
    handle('diagnostics:preview', () => diagnosticsBundle.prepare(snapshot(), diagnosticsFacts()));
    handle('diagnostics:save', () => diagnosticsBundle.write(diagnosticsRoot, diagnosticsBundle.prepare(snapshot(), diagnosticsFacts())));
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
    registerBackupIpc({
      handle,
      backup: workspaceBackup,
      dataRoot,
      chooseDirectory,
      workspace,
      save,
      log,
      // Which accounts have a window open right now: a running browser profile is copied as it stands, and the
      // operator is told so rather than discovering it later.
      openAccountNames: () => workspace.data.accounts.filter(account => sessions.has(account.id)).map(account => account.name)
    });
    // The way back: what recovery copies exist, and restoring one behind a native confirmation.
    if (workspace.storeFile)
      registerRecoveryIpc({
        handle,
        recovery: createWorkspaceRecovery({ file: workspace.storeFile }),
        save,
        log,
        confirmDestructive
      });
    // What the application wrote itself, and the only erasure control that touches it.
    registerOutputsIpc({ handle, inventory: outputInventory, root: diagnosticsRoot, confirmDestructive, log });
    // What each open session reports about itself, side by side.
    registerIdentityIpc({ handle, sessions, accounts: () => workspace.data.accounts.filter(account => !account.archived) });
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
    registerMatchIpc({
      handle,
      matches,
      // The report lands beside the diagnostics export, so one folder holds everything the operator may want to
      // send on, and the renderer is handed a file name rather than a path.
      saveReport: view => {
        // Screened before it is written, not after: a report that fails the scan must not exist on disk, because
        // a file the operator has already been told about is a file they will send on.
        const report = runReport.screen(runReport.build(view));
        const directory = diagnosticsBundle.directory(diagnosticsRoot);
        const name = runReport.fileName(Date.now());
        const target = path.join(directory, name);
        fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        log(`Run report written: ${report.runs.length} run(s) and ${report.standaloneMatches.length} standalone match(es).`);
        return {
          fileName: name,
          runs: report.runs.length,
          standaloneMatches: report.standaloneMatches.length,
          bytes: fs.statSync(target).size
        };
      }
    });
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
