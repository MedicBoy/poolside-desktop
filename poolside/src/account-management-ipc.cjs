// Account-directory mutations live outside the general IPC wiring so the three account lifecycle
// operations stay together: archive preserves local storage, profile deletion clears storage, and
// removal clears both the slot and its local storage.

const settingsController = require('./settings-ui-controller.cjs');
const bulkPlan = require('./bulk-plan.cjs');

function registerAccountManagement({
  handle,
  model,
  workspace,
  sessions,
  windows,
  save,
  log,
  getAccount,
  profiles,
  confirmDestructive,
  activeAccounts
}) {
  const anyAccount = id => {
    const account = workspace.data.accounts.find(candidate => candidate.id === id);
    if (!account) throw new Error('Account not found.');
    return account;
  };
  const isOpen = account => sessions.has(account.id);

  handle('account:update', input => {
    const account = getAccount(input && input.id);
    if (sessions.has(account.id)) throw new Error('Close this session before changing its account details.');
    const updated = model.updateAccount(input, account, activeAccounts());
    save({ ...workspace.data, accounts: workspace.data.accounts.map(candidate => (candidate.id === account.id ? updated : candidate)) });
    log(`${account.name}: account details updated.`);
  });
  handle('account:preferences-form', id => ({
    ...settingsController.form('account', getAccount(id)),
    routePresetId: getAccount(id).routePresetId || '',
    routePresets: workspace.data.routePresets || []
  }));
  handle('account:preferences-save', input => {
    const account = getAccount(input && input.id);
    if (sessions.has(account.id)) throw new Error('Close this session before changing its session preferences.');
    const outcome = settingsController.route({ ...input, section: 'account', current: account });
    if (!outcome.ok) return { ...outcome, saved: false };
    // The controller deliberately returns only configuration fields. Rebuild the durable account from its
    // immutable fields plus that checked configuration so reset/clear actually removes an override.
    const { identity: _identity, proxy: _proxy, recovery: _recovery, routePresetId: _routePresetId, ...stable } = account;
    const requestedPreset = input && typeof input.routePresetId === 'string' ? input.routePresetId : '';
    if (requestedPreset && !(workspace.data.routePresets || []).some(preset => preset.id === requestedPreset))
      throw new Error('Choose a saved route preset or no preset.');
    const { proxy: _selectedOverride, ...withoutRouteOverride } = outcome.value || {};
    const updated = {
      ...stable,
      ...(requestedPreset ? withoutRouteOverride : outcome.value),
      ...(requestedPreset ? { routePresetId: requestedPreset } : {})
    };
    save({ ...workspace.data, accounts: workspace.data.accounts.map(candidate => (candidate.id === account.id ? updated : candidate)) });
    log(`${account.name}: session preferences updated.`);
    return { ...outcome, saved: true };
  });
  handle('account:archive', id => {
    const account = getAccount(id);
    if (sessions.has(id)) throw new Error('Close this session before archiving it.');
    save({
      ...workspace.data,
      accounts: workspace.data.accounts.map(candidate => (candidate.id === id ? { ...candidate, archived: true } : candidate))
    });
    log(`${account.name}: account slot archived.`);
  });
  handle('account:restore', id => {
    const account = anyAccount(id);
    if (!account.archived) throw new Error('This account is already in the workspace.');
    const restored = model.updateAccount({ name: account.name, role: account.role }, account, activeAccounts());
    save({
      ...workspace.data,
      accounts: workspace.data.accounts.map(candidate => (candidate.id === id ? { ...restored, archived: false } : candidate))
    });
    log(`${account.name}: account slot restored.`);
  });
  handle('account:delete', async id => {
    const account = anyAccount(id);
    if (sessions.has(id)) throw new Error('Close this session before removing the account.');
    const agreed = await confirmDestructive(
      `Remove ${account.name} from Poolside?`,
      'This permanently removes the account slot and its isolated browser profile, including cookies and saved session storage on this PC. Use Archive if you may want to restore it later.'
    );
    if (!agreed) throw new Error('Account removal was cancelled.');
    const outcome = await profiles.remove(account);
    if (outcome.failures.length)
      throw new Error(`The account was not removed because its profile could only be partly deleted: ${outcome.failures.join('; ')}`);
    const windows = { ...(workspace.data.windows || {}) };
    delete windows[id];
    const next = { ...workspace.data, accounts: workspace.data.accounts.filter(candidate => candidate.id !== id) };
    if (Object.keys(windows).length) next.windows = windows;
    else delete next.windows;
    save(next);
    log(`${account.name}: account slot and local profile removed.`);
    return outcome;
  });
  // One request for a whole selection, planned before anything is touched. Opening and closing are
  // ordinary window work; archiving and removal keep the single-account rule that an open session must
  // be closed first, and removal asks once for the whole selection rather than once per account.
  handle('account:bulk', async input => {
    const { action, accounts } = bulkPlan.selection(input, workspace.data.accounts);
    const outcome = bulkPlan.plan(action, accounts, isOpen);
    if (!outcome.ok) throw new Error(outcome.error);
    if (!outcome.ids.length) return { action, changed: 0, skipped: outcome.skipped };
    if (action === 'open') {
      for (const id of outcome.ids) await windows.openAccount(id);
    } else if (action === 'close') {
      for (const id of outcome.ids) windows.closeAccount(id);
    } else if (action === 'archive') {
      const selected = new Set(outcome.ids);
      save({
        ...workspace.data,
        accounts: workspace.data.accounts.map(candidate => (selected.has(candidate.id) ? { ...candidate, archived: true } : candidate))
      });
      log(`${outcome.ids.length} account slot${outcome.ids.length === 1 ? '' : 's'} archived.`);
    } else {
      const prompt = bulkPlan.removalPrompt(outcome.names);
      const agreed = await confirmDestructive(prompt.title, prompt.detail);
      if (!agreed) throw new Error('Account removal was cancelled.');
      const failures = [];
      const removed = new Set();
      for (const account of accounts) {
        const result = await profiles.remove(account);
        if (result.failures.length) failures.push(`${account.name}: ${result.failures.join('; ')}`);
        else removed.add(account.id);
      }
      // Whatever was genuinely destroyed is dropped from the workspace first, so a partly failed removal
      // leaves the list matching the disk instead of claiming accounts that are already gone.
      if (removed.size) {
        const windowsMap = { ...(workspace.data.windows || {}) };
        for (const id of removed) delete windowsMap[id];
        const next = { ...workspace.data, accounts: workspace.data.accounts.filter(candidate => !removed.has(candidate.id)) };
        if (Object.keys(windowsMap).length) next.windows = windowsMap;
        else delete next.windows;
        save(next);
        log(`${removed.size} account slot${removed.size === 1 ? '' : 's'} and local profile${removed.size === 1 ? '' : 's'} removed.`);
      }
      if (failures.length)
        throw new Error(
          `${removed.size} of ${accounts.length} accounts were removed; the rest could not be deleted: ${failures.join(' | ')}`
        );
    }
    return { action, changed: outcome.ids.length, skipped: outcome.skipped };
  });
}

module.exports = { registerAccountManagement };
