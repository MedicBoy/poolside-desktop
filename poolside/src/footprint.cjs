// Apply a session's configured footprint — identity (identity.cjs) and route (proxy.cjs) — and report
// back what actually took effect.
//
// The two halves run at different moments, and that is not a stylistic choice:
//
//   * `applySessionFootprint` must run **before** the BrowserWindow is constructed, because
//     `session.setUserAgent` explicitly "doesn't affect existing WebContents".
//   * `applyTargetFootprint` can only run once a WebContents exists, because locale, timezone,
//     viewport and colour scheme are applied to a live target over CDP.
//
// Reporting is the other half of the job. A configured route or identity that silently never applied is
// worse than none at all, because the user then believes something false about that session's
// footprint. Every function here returns what happened rather than assuming it worked.

const { resolveIdentity, describeIdentity } = require('./identity.cjs');
const { describeResolvedRoute, routeMatches, resolveProxyRoute } = require('./proxy.cjs');
const { messageOf } = require('./errors.cjs');

/**
 * The session-level half: user agent and accepted languages. Safe to call with an empty identity, and
 * a no-op when nothing is configured, so the default path stays exactly as it was.
 * @param {import('electron').Session} session
 * @param {{identity: import('./identity.cjs').ResolvedIdentity, route?: import('./proxy.cjs').ProxyRoute}} footprint
 * @param {{log: import('./types.cjs').LogFn, baseUserAgent: string}} deps
 */
function applySessionFootprint(session, footprint, deps) {
  const { identity } = footprint;
  const { log, baseUserAgent } = deps;
  const notes = [];
  if (identity.userAgent || identity.acceptLanguages) {
    // The base only matters when languages are set without an explicit user agent.
    session.setUserAgent(identity.userAgent || baseUserAgent, identity.acceptLanguages || undefined);
    if (identity.userAgent) notes.push('user agent');
    if (identity.acceptLanguages) notes.push(`accepted languages (${identity.acceptLanguages})`);
  }
  if (footprint.route && footprint.route.configured) {
    notes.push(`route (${footprint.route.label})`);
  }
  if (notes.length) log(`Session footprint: ${notes.join(', ')}.`);
  return { applied: notes };
}

/**
 * The route half. Electron's default is deliberately left alone when no route is configured: forcing
 * `direct` would silently strip a system proxy the user did rely on.
 * @param {import('electron').Session} session
 * @param {import('./proxy.cjs').ProxyRoute} route
 * @param {import('./types.cjs').LogFn} log
 */
async function applyProxyRoute(session, route, log) {
  if (!route.configured) {
    if (route.mode === 'invalid') log(`Route not applied: ${route.error}.`, 'warning');
    return { applied: false, mode: route.mode };
  }
  try {
    await session.setProxy({
      mode: /** @type {'direct'|'fixed_servers'} */ (route.mode),
      proxyRules: route.proxyRules,
      proxyBypassRules: route.bypassRules
    });
    log(`Route applied: ${route.label}.`);
    return { applied: true, mode: route.mode };
  } catch (error) {
    log(`Route could not be applied: ${messageOf(error)}`, 'warning');
    return { applied: false, mode: route.mode, error: messageOf(error) };
  }
}

/**
 * Read the session's own usage against its configured ceiling.
 *
 * `cacheBytes` is the session's **HTTP disk cache** (`session.getCacheSize()`), not the origin's quota
 * usage — a page can read that for itself via `navigator.storage.estimate()`, which reports Chromium's
 * own ~1.5 GB allowance. Both are measurements.
 *
 * This is a **comparison**, not enforcement. Electron exposes no per-session storage quota — there is no
 * `setQuota` in the Session API — so the configured ceiling is reported and warned about rather than
 * imposed. Saying otherwise in the UI or the docs would be a false claim about the session's footprint.
 * @param {{getCacheSize: () => Promise<number>}} session only `getCacheSize` is used, which keeps this
 *   testable against a stub as well as a real session
 * @param {import('./identity.cjs').ResolvedIdentity} identity
 */
async function measureStorage(session, identity) {
  /** @type {number|null} */
  let cacheBytes = null;
  try {
    cacheBytes = await session.getCacheSize();
  } catch {
    cacheBytes = null;
  }
  const quotaBytes = identity.quotaBytes;
  const overQuota = quotaBytes !== null && cacheBytes !== null && cacheBytes > quotaBytes;
  return { cacheBytes, quotaBytes, overQuota, at: new Date().toISOString() };
}

/**
 * Ask Chromium what this session will really use, and compare it with what was configured.
 * @param {import('electron').Session} session
 * @param {import('./proxy.cjs').ProxyRoute} route
 * @param {string} url a URL to resolve the route for; the game page is the relevant one
 * @returns {Promise<{ok: true, resolved: string, route: import('./proxy.cjs').RouteDescription, matches: boolean, at: string} | {ok: false, error: string, at: string}>}
 */
async function verifyRoute(session, route, url) {
  try {
    const resolved = await session.resolveProxy(url);
    const described = describeResolvedRoute(resolved);
    return { ok: true, resolved: String(resolved), route: described, matches: routeMatches(route, resolved), at: new Date().toISOString() };
  } catch (error) {
    return { ok: false, error: messageOf(error), at: new Date().toISOString() };
  }
}

/**
 * The whole session-level footprint for one account: resolve its configuration, apply the half Electron
 * allows before a window exists, and report what was applied.
 *
 * The summary is computed here rather than in the dashboard: the dashboard is a sandboxed page with no
 * access to the identity module, and two definitions of "what this identity is" would drift.
 * @param {import('electron').Session} session
 * @param {{name?: string, identity?: unknown, proxy?: unknown}} account
 * @param {{identity?: unknown, proxy?: unknown}} settings
 * @param {{log: import('./types.cjs').LogFn, baseUserAgent: string}} deps
 */
async function resolveAndApplyFootprint(session, account, settings, deps) {
  const { log, baseUserAgent } = deps;
  const name = account.name || 'session';
  const { identity, warnings } = resolveIdentity(account, settings);
  for (const warning of warnings) log(`${name}: ${warning}`, 'warning');
  const route = resolveProxyRoute(account, settings);
  applySessionFootprint(session, { identity, route }, { log, baseUserAgent });
  const routeStatus = await applyProxyRoute(session, route, log);
  return { identity, summary: describeIdentity(identity), route, routeStatus, target: null, storage: null, verified: null };
}

/**
 * Report what a session is really using: the route Chromium will take, and its storage against any
 * configured ceiling. A configured route that is not in use is worse than none at all, because the user
 * then believes something false about that session's footprint.
 * @param {{footprint: any}} group
 * @param {import('electron').Session} session
 * @param {{log: import('./types.cjs').LogFn, accountName: string, gameUrl: string, publish: () => void, onRouteVerified?: ((verified: any) => void)|null}} deps
 */
async function reportFootprint(group, session, deps) {
  const { log, accountName, gameUrl, publish, onRouteVerified = null } = deps;
  const { route, identity } = group.footprint;
  if (route.configured) {
    const verified = await verifyRoute(session, route, gameUrl);
    group.footprint.verified = verified;
    if (verified.ok && !verified.matches)
      log(`${accountName}: the session is NOT using the configured route (it reports ${verified.route.label}).`, 'warning');
    else if (verified.ok) log(`${accountName}: route confirmed — ${verified.route.label}.`);
    // The measurement is handed on so it can be recorded against the saved location it was about, rather than
    // being reported once and forgotten. A caller that does not care simply omits the callback.
    if (typeof onRouteVerified === 'function') {
      try {
        onRouteVerified(verified);
      } catch (error) {
        log(`${accountName}: the route result could not be noted (${messageOf(error)}).`, 'warning');
      }
    }
  }
  group.footprint.storage = await measureStorage(session, identity);
  if (group.footprint.storage.overQuota)
    log(
      `${accountName}: the session cache is over its configured ceiling. That ceiling is measured and reported, not enforced by Chromium.`,
      'warning'
    );
  publish();
}

module.exports = {
  applySessionFootprint,
  applyProxyRoute,
  measureStorage,
  verifyRoute,
  reportFootprint,
  resolveAndApplyFootprint
};
