// What a session actually did, recorded against the saved location it was told to use.
//
// Two things measure a route: the operator's own test of an address, and a live session's exit address being
// read when it opens. The second is the stronger evidence — it is the session that really ran — and it used to
// be reported once, in the activity feed, and then forgotten. This puts it on the saved location, where the next
// decision is made.
//
// It records only what was measured. A session with no saved location records nothing, an account whose route is
// the workspace default records nothing (there is no saved location to blame), and a read that could not be made
// is recorded as "not read" rather than as a failure of the address.

const routePresets = require('./route-presets.cjs');

/**
 * @param {{workspace: any, save: (value: any) => void, log: (message: string, level?: 'info'|'warning') => void, account: {id: string, name: string, routePresetId?: string}, verified: any, at?: number}} input
 */
function noteVerification({ workspace, save, log, account, verified, at = Date.now() }) {
  const presetId = account && typeof account.routePresetId === 'string' ? account.routePresetId : '';
  if (!presetId) return null;
  const presets = Array.isArray(workspace?.data?.routePresets) ? workspace.data.routePresets : [];
  const preset = presets.find(item => item.id === presetId);
  if (!preset) return null;
  const ok = verified?.ok === true;
  const matches = ok && verified.matches === true;
  const label = verified?.route?.label ? String(verified.route.label) : 'a different address';
  const message = !ok
    ? 'the exit address could not be read from this session'
    : matches
      ? `the session left through it (${label})`
      : `the session reported ${label} instead`;
  const updated = routePresets.recordCheck(preset, { at, ok: matches, message });
  save({ ...workspace.data, routePresets: presets.map(item => (item.id === presetId ? updated : item)) });
  // Only the bad outcome is logged: a confirmation on every window open would bury the line that matters, and
  // the row already says it worked.
  if (!matches) log(`${account.name}: ${preset.name} — ${message}.`, 'warning');
  return { presetId, name: preset.name, ok: matches, message };
}

module.exports = { noteVerification };
