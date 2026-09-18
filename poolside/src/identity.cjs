// Per-session identity configuration.
//
// Electron exposes this surface through exactly two mechanisms, and the split matters:
//
//   1. **Session level, real Electron API** — `session.setUserAgent(userAgent, acceptLanguages)`.
//      The docs are explicit that it "doesn't affect existing WebContents", so it must run *before*
//      the window is constructed. windows.cjs does that.
//   2. **Target level, CDP** — locale, timezone, viewport and colour scheme have no per-session
//      Electron API at all. They are applied to a live target through `webContents.debugger`, which is
//      the supported surface for them, and that is why they are opt-in: attaching a debugger to a game
//      window is a heavier act than setting a user agent, and a session with no target overrides never
//      attaches one.
//
// **Storage quota has no per-session API.** There is no `setQuota` or `storageQuota` anywhere in the
// Session API (checked against the current docs), so `quotaBytes` is a *monitored ceiling*: the runtime
// measures the session's cache against it and says so when it is exceeded. It is not described as
// browser-enforced because it is not.
//
// Invalid values are dropped with a warning rather than thrown: a mistyped timezone must never be able
// to stop a session opening, and it must never be able to lock the workspace (model.cjs rejects the
// whole document on a bad field, which is correct for account data and wrong for a fingerprint).
//
// Pure module: no Electron, no fs. Enforced by test/architecture.test.cjs.

const { emptyIdentity, pickIdentity, validateField, IDENTITY_FIELDS } = require('./identity-fields.cjs');

/**
 * The identity for one account: the workspace default, overridden field by field by the account's own
 * configuration. A field the account leaves undefined keeps the default, so an account can override
 * just its timezone.
 * @param {{identity?: unknown, name?: string}} [account]
 * @param {{identity?: unknown}} [settings]
 * @returns {{identity: ReturnType<typeof emptyIdentity>, warnings: string[], configured: boolean}}
 */
function resolveIdentity(account = {}, settings = {}) {
  const merged = { ...pickIdentity(settings.identity), ...pickIdentity(account.identity) };
  const identity = emptyIdentity();
  const warnings = [];
  for (const [field, value] of Object.entries(merged)) {
    const result = validateField(field, value);
    if (result.ok) {
      identity[/** @type {keyof ReturnType<typeof emptyIdentity>} */ (field)] = result.value;
    } else {
      warnings.push(`Identity ${field} ignored: ${JSON.stringify(value)} ${result.why}.`);
    }
  }
  return { identity, warnings, configured: IDENTITY_FIELDS.some(field => identity[/** @type {keyof typeof identity} */ (field)] !== null) };
}

/**
 * The CDP commands that realise the target-level part of an identity. Pure, so what a configuration
 * *means* can be asserted without a browser.
 *
 * The user agent goes through CDP as well as `session.setUserAgent`, and the reason is measured rather
 * than stylistic: in Electron 44.4.1 the session-level `acceptLanguages` argument does not reach the
 * renderer or the wire. `navigator.language` keeps the OS value and the outgoing request carries no
 * `Accept-Language` header at all, while `Emulation.setUserAgentOverride` sets
 * `navigator.language`/`navigator.languages` and sends the header. Both are applied; the target override
 * is what the page and the server actually see.
 * @param {ReturnType<typeof emptyIdentity>} identity
 */
function cdpOverrides(identity) {
  /** @type {{method: string, params: Record<string, unknown>}[]} */
  const commands = [];
  if (identity.userAgent || identity.acceptLanguages) {
    commands.push({
      method: 'Emulation.setUserAgentOverride',
      params: {
        ...(identity.userAgent ? { userAgent: identity.userAgent } : {}),
        ...(identity.acceptLanguages ? { acceptLanguage: identity.acceptLanguages } : {})
      }
    });
  }
  if (identity.locale) commands.push({ method: 'Emulation.setLocaleOverride', params: { locale: identity.locale } });
  if (identity.timezone) commands.push({ method: 'Emulation.setTimezoneOverride', params: { timezoneId: identity.timezone } });
  if (identity.viewport)
    commands.push({
      method: 'Emulation.setDeviceMetricsOverride',
      params: { width: identity.viewport.width, height: identity.viewport.height, deviceScaleFactor: 1, mobile: false }
    });
  if (identity.colorScheme)
    commands.push({
      method: 'Emulation.setEmulatedMedia',
      params: { media: 'screen', features: [{ name: 'prefers-color-scheme', value: identity.colorScheme }] }
    });
  return commands;
}

/** True when this identity needs a debugger attach at all. */
function needsTargetOverrides(identity) {
  return cdpOverrides(identity).length > 0;
}

/** A one-line summary for the activity feed and the dashboard card. */
function describeIdentity(identity) {
  const parts = [];
  if (identity.locale) parts.push(identity.locale);
  if (identity.timezone) parts.push(identity.timezone);
  if (identity.viewport) parts.push(`${identity.viewport.width}×${identity.viewport.height}`);
  if (identity.colorScheme) parts.push(identity.colorScheme);
  if (identity.quotaBytes) parts.push(`ceiling ${Math.round(identity.quotaBytes / 1024 / 1024)} MB`);
  if (identity.userAgent) parts.push('user agent set');
  if (identity.acceptLanguages) parts.push('languages set');
  return parts.length ? parts.join(' · ') : 'not configured';
}

/** @typedef {ReturnType<typeof emptyIdentity>} ResolvedIdentity */

module.exports = { resolveIdentity, cdpOverrides, needsTargetOverrides, describeIdentity };
