// A dashboard-safe account summary.
//
// The renderer needs a useful account-management view, but it must not receive cookies, tokens,
// profile paths, or other session secrets. This pure module selects only the configuration Poolside
// itself owns and turns live session facts into plain labels. Keeping that boundary here makes the
// snapshot contract easy to test.

const { describeIdentity, resolveIdentity } = require('./identity.cjs');
const { resolveProxyRoute } = require('./proxy.cjs');
const { partitionName } = require('./profile-paths.cjs');

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {unknown} value */
function viewport(value) {
  if (!value || typeof value !== 'object') return null;
  const width = /** @type {any} */ (value).width;
  const height = /** @type {any} */ (value).height;
  return Number.isInteger(width) && Number.isInteger(height) ? `${width} × ${height}` : null;
}

/**
 * Values that are safe to render or copy from the dashboard. Deliberately excludes account profile
 * paths, cookies, credentials, and any browser-originated page data.
 * @param {{id: string, identity?: unknown, proxy?: unknown, routePresetId?: string, profile?: {established?: boolean}}} account
 * @param {{identity?: unknown, proxy?: unknown, routePresets?: any[]}} settings
 * @param {any} group
 */
function buildAccountOverview(account, settings = {}, group = null) {
  const resolved = group?.footprint?.identity ? { identity: group.footprint.identity, warnings: [] } : resolveIdentity(account, settings);
  const identity = resolved.identity;
  const route = group?.footprint?.route || resolveProxyRoute(account, settings);
  const preset = Array.isArray(settings.routePresets) ? settings.routePresets.find(item => item?.id === account.routePresetId) : null;
  const verified = group?.footprint?.verified || null;
  return {
    session: {
      open: Boolean(group),
      state: group?.fsm?.state || 'closed',
      reason: text(group?.fsm?.reason),
      partition: partitionName(account.id),
      persistence: group?.lastPersistedAt
        ? `Session saved ${group.lastPersistedAt}`
        : account.profile?.established
          ? 'Saved browser profile established'
          : 'Profile will be established when opened'
    },
    identity: {
      summary: describeIdentity(identity),
      userAgent: text(identity.userAgent),
      acceptLanguages: text(identity.acceptLanguages),
      locale: text(identity.locale),
      timezone: text(identity.timezone),
      viewport: viewport(identity.viewport),
      colorScheme: text(identity.colorScheme),
      quotaBytes: Number.isInteger(identity.quotaBytes) ? identity.quotaBytes : null,
      warnings: resolved.warnings
    },
    route: {
      configured: route.configured,
      label: route.label,
      mode: route.mode,
      presetName: text(preset?.name),
      rules: text(route.proxyRules),
      bypass: text(route.bypassRules),
      verifiedAt: text(verified?.at),
      verifiedRoute: text(verified?.route?.label),
      matches: typeof verified?.matches === 'boolean' ? verified.matches : null,
      publicIp: text(group?.network?.status === 'checked' ? group.network.ip : null),
      publicIpCheckedAt: text(group?.network?.status === 'checked' ? group.network.checkedAt : null)
    }
  };
}

module.exports = { buildAccountOverview, viewport };
