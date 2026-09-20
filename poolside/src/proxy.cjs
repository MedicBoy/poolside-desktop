// Per-session proxy routes: storage shape, validation, and honest reporting.
//
// ADR-0011 §11.5 is the line this module must not cross. In scope: per-session proxy support as
// *infrastructure* — one session, one route, health-checked, honestly reported. Out of scope: choosing
// or shaping routes so a matchmaking pool shrinks or a specific opponent becomes likelier. Nothing here
// inspects accounts, balances or matches; a route is a static piece of configuration for one session.
//
// The second half of that sentence is the point of the module. A configured route is a *claim*;
// `session.resolveProxy()` is the *evidence*. `describeResolvedRoute` reports what the session will
// actually use, and `routeMatches` states plainly whether that is what was configured. A proxy that is
// configured but silently never applies is worse than no proxy, because the user believes something
// false about that session's footprint.
//
// Pure module: no Electron, no fs. Enforced by test/architecture.test.cjs.

const MAX_BYPASS_ENTRIES = 50;
const PROXY_SCHEMES = { http: 'http://', https: 'https://', socks4: 'socks4://', socks5: 'socks5://' };

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse one route specification into Chromium's `proxyRules` grammar.
 * Accepts `DIRECT`, `host:port`, and `scheme://host:port` for http/https/socks4/socks5.
 * @param {unknown} spec
 * @returns {{ok: true, mode: 'direct'|'fixed_servers', proxyRules: string, expectedTarget: string|null, label: string} | {ok: false, error: string}}
 */
function parseProxySpec(spec) {
  if (typeof spec !== 'string') return { ok: false, error: 'a route must be given as a string' };
  const trimmed = spec.trim();
  if (!trimmed) return { ok: false, error: 'a route cannot be empty' };
  if (/^direct$/i.test(trimmed)) {
    return { ok: true, mode: 'direct', proxyRules: '', expectedTarget: null, label: 'Direct connection' };
  }
  const match = /^(?:([a-z0-9]+):\/\/)?([^\s:/@]+)(?::(\d{1,5}))?$/i.exec(trimmed);
  if (!match) return { ok: false, error: `"${trimmed}" is not host:port or scheme://host:port` };
  const [, rawScheme, host, rawPort] = match;
  const scheme = rawScheme ? rawScheme.toLowerCase() : null;
  if (scheme && !PROXY_SCHEMES[scheme]) {
    return { ok: false, error: `"${scheme}" is not one of ${Object.keys(PROXY_SCHEMES).join(', ')}` };
  }
  if (rawPort === undefined) return { ok: false, error: `"${trimmed}" has no port` };
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: `port ${rawPort} is out of range` };
  const target = `${host}:${port}`;
  return {
    ok: true,
    mode: 'fixed_servers',
    // A bare host:port applies to every scheme, which is the honest reading of a bare spec.
    proxyRules: scheme ? `${PROXY_SCHEMES[scheme]}${target}` : target,
    expectedTarget: target,
    label: `${scheme || 'http'} proxy at ${target}`
  };
}

/**
 * Normalise bypass rules into the comma-separated string Electron wants.
 * @param {unknown} value
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
function normaliseBypass(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: '' };
  const entries = Array.isArray(value) ? value : String(value).split(',');
  const cleaned = entries.map(entry => String(entry).trim()).filter(entry => entry.length > 0);
  if (cleaned.length > MAX_BYPASS_ENTRIES) return { ok: false, error: `at most ${MAX_BYPASS_ENTRIES} bypass rules` };
  for (const entry of cleaned) {
    // Chromium's grammar is hostnames, wildcards and CIDR. Reject anything that is not: a bypass entry
    // that silently does nothing is the same class of false belief as an unapplied proxy.
    if (!/^(\*\.)?[a-z0-9][a-z0-9.-]*$|^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$|^<local>$/i.test(entry)) {
      return { ok: false, error: `"${entry}" is not a hostname, wildcard, CIDR block or <local>` };
    }
  }
  return { ok: true, value: cleaned.join(',') };
}

/**
 * The route for one account: the workspace default overridden by the account's own configuration.
 *
 * `configured: false` means **the runtime must not call `setProxy` at all** — it leaves Chromium on
 * Electron's default rather than forcing `direct`. Forcing direct would silently strip a user's system
 * proxy, which is a change of behaviour nobody asked for.
 * @param {{proxy?: unknown, routePresetId?: string}} [account]
 * @param {{proxy?: unknown, routePresets?: any[]}} [settings]
 */
function resolveProxyRoute(account = {}, settings = {}) {
  const preset = Array.isArray(settings.routePresets) ? settings.routePresets.find(item => item?.id === account.routePresetId) : null;
  const accountProxy = isPlainObject(account.proxy) ? account.proxy : preset || {};
  const settingsProxy = isPlainObject(settings.proxy) ? settings.proxy : {};
  const merged = { ...settingsProxy, ...accountProxy };
  const requested = String(merged.spec ?? '').trim();
  const enabled = merged.enabled !== false;
  if (!requested) {
    return { configured: false, mode: 'unconfigured', proxyRules: '', bypassRules: '', expectedTarget: null, label: 'No route configured' };
  }
  if (!enabled) {
    return {
      configured: false,
      mode: 'disabled',
      proxyRules: '',
      bypassRules: '',
      expectedTarget: null,
      label: 'Route configured but switched off'
    };
  }
  const parsed = parseProxySpec(requested);
  if (!parsed.ok) {
    return {
      configured: false,
      mode: 'invalid',
      proxyRules: '',
      bypassRules: '',
      expectedTarget: null,
      label: 'Route configuration is not usable',
      error: parsed.error
    };
  }
  const bypass = normaliseBypass(merged.bypass);
  if (!bypass.ok) {
    return {
      configured: false,
      mode: 'invalid',
      proxyRules: '',
      bypassRules: '',
      expectedTarget: null,
      label: 'Route configuration is not usable',
      error: bypass.error
    };
  }
  return {
    configured: true,
    mode: parsed.mode,
    proxyRules: parsed.proxyRules,
    bypassRules: bypass.value,
    expectedTarget: parsed.expectedTarget,
    label: parsed.label
  };
}

/**
 * Read Chromium's answer to "what will this session actually use for this URL".
 * `DIRECT`, `PROXY host:port`, `SOCKS5 host:port`, `HTTPS host:port`, or several separated by `;`.
 * @param {unknown} resolved
 */
function describeResolvedRoute(resolved) {
  const value = String(resolved ?? '').trim();
  if (!value) return { kind: /** @type {const} */ ('unknown'), protocol: null, target: null, label: 'No answer from the resolver' };
  if (/^direct$/i.test(value)) return { kind: /** @type {const} */ ('direct'), protocol: null, target: null, label: 'Direct connection' };
  const first = value.split(';')[0].trim();
  const match = /^([a-z0-9_]+)\s+(.+)$/i.exec(first);
  if (!match) return { kind: /** @type {const} */ ('unknown'), protocol: null, target: value, label: value };
  const keyword = match[1].toLowerCase();
  const target = match[2].trim();
  const protocol = keyword === 'proxy' ? 'http' : keyword;
  const multiple = value.includes(';');
  return {
    kind: /** @type {const} */ ('proxy'),
    protocol,
    target,
    label: `${protocol} proxy at ${target}${multiple ? ' (one of several)' : ''}`
  };
}

/**
 * Does the route the session will actually use match the one that was configured?
 * Only meaningful when a route is configured; an unconfigured session reports whatever Chromium
 * decides (system proxy or direct) without being called a mismatch.
 * @param {ReturnType<typeof resolveProxyRoute>} route
 * @param {unknown} resolved
 */
function routeMatches(route, resolved) {
  const described = describeResolvedRoute(resolved);
  if (!route || !route.configured) return described.kind !== 'unknown';
  if (route.mode === 'direct') return described.kind === 'direct';
  if (described.kind !== 'proxy') return false;
  return described.target.toLowerCase() === String(route.expectedTarget).toLowerCase();
}

/** @typedef {ReturnType<typeof resolveProxyRoute>} ProxyRoute */
/** @typedef {ReturnType<typeof describeResolvedRoute>} RouteDescription */

module.exports = {
  parseProxySpec,
  normaliseBypass,
  resolveProxyRoute,
  describeResolvedRoute,
  routeMatches,
  PROXY_SCHEMES,
  MAX_BYPASS_ENTRIES
};
