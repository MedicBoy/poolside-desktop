const routePresets = require('./route-presets.cjs');
const { publicRoutePreset } = require('./proxy-public.cjs');

/** @param {{handle: (name: string, fn: (input: any) => any) => void, workspace: any, save: (value: any) => void, log: (message: string) => void, sessions?: Map<string, any>}} deps */
function registerRoutePresetIpc({ handle, workspace, save, log, sessions }) {
  handle('route-preset:add', input => {
    const preset = routePresets.create(input, workspace.data.routePresets || []);
    save({ ...workspace.data, routePresets: [...(workspace.data.routePresets || []), preset] });
    log(`Route preset ${preset.name} saved.`);
    return publicRoutePreset(preset);
  });
  // Ticking an account in the settings list: the whole point is that assigning a location is one click
  // rather than a trip through that account's preferences dialog. A window that is already open keeps
  // the route it was launched with, so the change is refused while it runs — otherwise the row would
  // claim a location the live session is not actually using.
  handle('route-preset:assign', input => {
    const id = input && typeof input.id === 'string' ? input.id : '';
    const account = (workspace.data.accounts || []).find(candidate => candidate.id === id);
    if (!account) throw new Error('Account not found.');
    const presetId = input && typeof input.presetId === 'string' ? input.presetId : '';
    const preset = presetId ? (workspace.data.routePresets || []).find(item => item.id === presetId) : null;
    if (presetId && !preset) throw new Error('Choose a saved network location.');
    if (sessions && sessions.has(account.id)) throw new Error(`Close ${account.name} before changing where it connects from.`);
    const updated = { ...account };
    if (preset) updated.routePresetId = preset.id;
    else delete updated.routePresetId;
    save({
      ...workspace.data,
      accounts: (workspace.data.accounts || []).map(candidate => (candidate.id === account.id ? updated : candidate))
    });
    log(preset ? `${account.name}: now connects from ${preset.name}.` : `${account.name}: uses the workspace location again.`);
  });
  handle('route-preset:delete', id => {
    const preset = (workspace.data.routePresets || []).find(item => item.id === id);
    if (!preset) throw new Error('Route preset not found.');
    const used = workspace.data.accounts.filter(account => account.routePresetId === id);
    if (used.length) throw new Error(`Remove this preset from ${used.length} account(s) before deleting it.`);
    save({ ...workspace.data, routePresets: (workspace.data.routePresets || []).filter(item => item.id !== id) });
    log(`Route preset ${preset.name} removed.`);
  });
}

module.exports = { registerRoutePresetIpc };
