// Parse one proxy route without exposing credentials to Chromium's proxyRules grammar.

const PROXY_SCHEMES = { http: 'http://', https: 'https://', socks4: 'socks4://', socks5: 'socks5://' };

/**
 * @param {unknown} spec
 * @returns {{ok: true, mode: 'direct'|'fixed_servers', proxyRules: string, expectedTarget: string|null, label: string, credentials?: {username: string, password: string}} | {ok: false, error: string}}
 */
function parseProxySpec(spec) {
  if (typeof spec !== 'string') return { ok: false, error: 'a route must be given as a string' };
  const trimmed = spec.trim();
  if (!trimmed) return { ok: false, error: 'a route cannot be empty' };
  if (/^direct$/i.test(trimmed)) {
    return { ok: true, mode: 'direct', proxyRules: '', expectedTarget: null, label: 'Direct connection' };
  }
  const match = /^(?:([a-z0-9]+):\/\/)?(?:([^\s:@]+):([^\s@]+)@)?([^\s:/@]+)(?::(\d{1,5}))?$/i.exec(trimmed);
  if (!match) return { ok: false, error: 'a route is not host:port, user:pass@host:port, or one of those forms with a scheme' };
  const [, rawScheme, rawUsername, rawPassword, host, rawPort] = match;
  const scheme = rawScheme ? rawScheme.toLowerCase() : null;
  if (scheme && !PROXY_SCHEMES[scheme]) {
    return { ok: false, error: `"${scheme}" is not one of ${Object.keys(PROXY_SCHEMES).join(', ')}` };
  }
  if (rawPort === undefined) return { ok: false, error: 'the route has no port' };
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: `port ${rawPort} is out of range` };
  const target = `${host}:${port}`;
  /** @type {any} */
  const parsed = {
    ok: true,
    mode: 'fixed_servers',
    proxyRules: scheme ? `${PROXY_SCHEMES[scheme]}${target}` : target,
    expectedTarget: target,
    label: `${scheme || 'http'} proxy at ${target}`
  };
  if (rawUsername !== undefined) {
    try {
      parsed.credentials = { username: decodeURIComponent(rawUsername), password: decodeURIComponent(rawPassword) };
    } catch {
      return { ok: false, error: 'proxy credentials must use valid percent-encoding' };
    }
  }
  return parsed;
}

module.exports = { parseProxySpec, PROXY_SCHEMES };
