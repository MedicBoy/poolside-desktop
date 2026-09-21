// Renderer-safe proxy labels. Credentials stay in main-process configuration only.

const { parseProxySpec } = require('./proxy-spec.cjs');

/** @param {unknown} spec */
function publicProxySpec(spec) {
  const parsed = parseProxySpec(spec);
  if (parsed.ok && parsed.credentials) return `${parsed.label} · credentials set`;
  return typeof spec === 'string' ? spec : '';
}

/** @param {any} preset */
function publicRoutePreset(preset) {
  return {
    id: String(preset?.id || ''),
    name: String(preset?.name || ''),
    enabled: preset?.enabled !== false,
    spec: publicProxySpec(preset?.spec),
    bypass: typeof preset?.bypass === 'string' ? preset.bypass : ''
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
