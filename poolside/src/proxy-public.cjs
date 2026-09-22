// Renderer-safe proxy labels. Credentials stay in main-process configuration only.

const { parseProxySpec } = require('./proxy-spec.cjs');
const { describeHealth } = require('./route-presets.cjs');

/** @param {unknown} spec */
function publicProxySpec(spec) {
  const parsed = parseProxySpec(spec);
  if (parsed.ok && parsed.credentials) return `${parsed.label} · credentials set`;
  return typeof spec === 'string' ? spec : '';
}

/**
 * What the dashboard may know about a saved location: its name, its masked address, and what the application
 * last learned about it — never the address itself.
 * @param {any} preset
 */
function publicRoutePreset(preset) {
  return {
    id: String(preset?.id || ''),
    name: String(preset?.name || ''),
    enabled: preset?.enabled !== false,
    spec: publicProxySpec(preset?.spec),
    bypass: typeof preset?.bypass === 'string' ? preset.bypass : '',
    // The sentence is built here rather than in the page, so the wording lives where the record does and the
    // renderer has nothing to compute and nothing to get wrong.
    health: describeHealth(preset)
  };
}

/** Remove authentication material while keeping a usable route target. */
function credentialFreeProxySpec(spec) {
  const parsed = parseProxySpec(spec);
  return parsed.ok && parsed.credentials ? parsed.proxyRules : spec;
}

/** @param {any} value */
function redactWorkspaceProxyCredentials(value) {
  const document = JSON.parse(JSON.stringify(value));
  const redact = proxy => {
    if (proxy && typeof proxy === 'object' && typeof proxy.spec === 'string') proxy.spec = credentialFreeProxySpec(proxy.spec);
  };
  redact(document?.settings?.proxy);
  for (const account of Array.isArray(document?.accounts) ? document.accounts : []) redact(account?.proxy);
  for (const preset of Array.isArray(document?.routePresets) ? document.routePresets : []) {
    if (typeof preset?.spec === 'string') preset.spec = credentialFreeProxySpec(preset.spec);
  }
  return document;
}

module.exports = { publicProxySpec, publicRoutePreset, credentialFreeProxySpec, redactWorkspaceProxyCredentials };
