const routePresets = require('./route-presets.cjs');
const { publicRoutePreset } = require('./proxy-public.cjs');

/** @param {{handle: (name: string, fn: (input: any) => any) => void, workspace: any, save: (value: any) => void, log: (message: string) => void}} deps */
function registerRoutePresetIpc({ handle, workspace, save, log }) {
  handle('route-preset:add', input => {
    const preset = routePresets.create(input, workspace.data.routePresets || []);
    save({ ...workspace.data, routePresets: [...(workspace.data.routePresets || []), preset] });
    log(`Route preset ${preset.name} saved.`);
    return publicRoutePreset(preset);
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
