// The IPC contract.
//
// Every dashboard action arrives here. `trusted` is the transport guard (only the dashboard's own
// main frame may call in) and it is a named capture of the workspace state, and every handler
// returns the same { ok, value | error } envelope. Extracted from main.cjs so the composition root
// stays wiring.

const { checkPublicIP } = require('./network.cjs');
const model = require('./model.cjs');
const settingsController = require('./settings-ui-controller.cjs');
const timelineTransfer = require('./timeline-transfer.cjs');
const telemetryRedaction = require('./telemetry-redaction.cjs');
const { log, snapshot, save, publish, getAccount } = require('./workspace.cjs');
const { sessions, workspace } = require('./state.cjs');
const { messageOf } = require('./errors.cjs');

const PREFS_SAVED = 'Transfer preferences saved. Automation is not yet connected.';

/**
 * @param {{ipcMain: import('electron').IpcMain, UI_URL: string, windows: any, inspector: any, profiles: any, confirmDestructive: (title: string, detail: string) => Promise<boolean>}} deps
 */
function createIpc(deps) {
  const { ipcMain, UI_URL, windows, inspector, profiles, confirmDestructive } = deps;
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

  /** Check the public address seen by this account's own session. Never persisted. */
  async function checkAccountIP(id) {
    const account = getAccount(id);
    const group = sessions.get(id);
    if (!group) throw new Error('Open this account window before checking its IP.');
    if (group.network && group.network.status === 'checking') return;
    group.network = { status: 'checking' };
    publish();
    try {
      const result = await checkPublicIP(group.session);
      if (sessions.get(id) !== group) return;
      group.network = { status: 'checked', ...result };
      log(`${account.name}: public IP checked using this session. This does not verify game routing or location.`);
    } catch (error) {
      if (sessions.get(id) !== group) return;
      group.network = { status: 'error' };
      log(`${account.name}: ${messageOf(error)}`, 'warning');
      throw error;
    }
  }

  function register() {
    handle('workspace:get', () => snapshot());
    handle('account:add', input => {
      const account = model.account(input, activeAccounts());
      save({ ...workspace.data, accounts: [...workspace.data.accounts, account] });
      log(`${account.name}: account slot created.`);
    });
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
    handle('diagnostics:preview', () => {
      // The only thing the dashboard can ask for that is shaped like something leaving the machine, so it is
      // cleaned and then *scanned*, and a payload that fails its own scan is refused rather than returned with a
      // warning. ADR-0010 commits M4 to a bundle that is provably clean; a caller that has to remember to check
      // is not a guarantee.
      const current = snapshot();
      const payload = telemetryRedaction.exportLayer(current.telemetry);
      payload.timeline = timelineTransfer.redact(current.timeline.entries, /** @type {any[]} */ (current.accounts)).entries.map(entry => ({
        ...entry,
        message: entry.message ? telemetryRedaction.stripSecretShapes(entry.message) : entry.message
      }));
      const forbidden = /** @type {any[]} */ (current.accounts).map(account => account.name);
      const findings = telemetryRedaction.findSecrets(payload, { forbidden });
      if (findings.length) {
        throw new Error(
          `The diagnostics payload was refused: it still carries ${findings.length} item(s) that must not leave this machine (${findings
            .map(item => `${item.path} [${item.kind}]`)
            .join(', ')}).`
        );
      }
      return { payload, entries: payload.timeline.length, clean: true };
    });
    handle('account:return-game', id => windows.returnToGame(id));
    handle('account:inspect', id => inspector.inspectGame(id));
    handle('account:archive', id => {
      const account = getAccount(id);
      if (sessions.has(id)) throw new Error('Close this session before archiving it.');
      save({ ...workspace.data, accounts: workspace.data.accounts.map(a => (a.id === id ? { ...a, archived: true } : a)) });
      log(`${account.name}: account slot archived.`);
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
