const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseProxySpec, normaliseBypass, resolveProxyRoute, describeResolvedRoute, routeMatches } = require('../src/proxy.cjs');

// Parsing returns a discriminated union, so a test that wants the success branch has to say so. These
// helpers assert the branch *and* narrow it, which also means every call site checks `ok` explicitly.
function parsed(spec) {
  const result = parseProxySpec(spec);
  assert.equal(result.ok, true, `expected ${JSON.stringify(spec)} to parse`);
  return /** @type {any} */ (result);
}
function refused(spec) {
  const result = parseProxySpec(spec);
  assert.equal(result.ok, false, `expected ${JSON.stringify(spec)} to be refused`);
  return /** @type {any} */ (result);
}
function bypassOf(value) {
  const result = normaliseBypass(value);
  assert.equal(result.ok, true, `expected ${JSON.stringify(value)} to be usable`);
  return /** @type {any} */ (result);
}
function bypassRefused(value) {
  const result = normaliseBypass(value);
  assert.equal(result.ok, false, `expected ${JSON.stringify(value)} to be refused`);
  return /** @type {any} */ (result);
}

test('a bare host:port applies to every scheme', () => {
  assert.deepEqual(parseProxySpec('127.0.0.1:8080'), {
    ok: true,
    mode: 'fixed_servers',
    proxyRules: '127.0.0.1:8080',
    expectedTarget: '127.0.0.1:8080',
    label: 'http proxy at 127.0.0.1:8080'
  });
});

test('a scheme prefix is preserved, including SOCKS', () => {
  assert.equal(parsed('socks5://10.0.0.9:1080').proxyRules, 'socks5://10.0.0.9:1080');
  assert.equal(parsed('socks5://10.0.0.9:1080').label, 'socks5 proxy at 10.0.0.9:1080');
  assert.equal(parsed('https://proxy.example:443').proxyRules, 'https://proxy.example:443');
  assert.equal(parsed('  Proxy.Example:3128  ').proxyRules, 'Proxy.Example:3128', 'trimmed');
});

test('DIRECT is a route, not an error', () => {
  assert.deepEqual(parseProxySpec('DIRECT'), {
    ok: true,
    mode: 'direct',
    proxyRules: '',
    expectedTarget: null,
    label: 'Direct connection'
  });
});

test('a route without a port, a bad port, or an unknown scheme is refused with a reason', () => {
  assert.match(refused('127.0.0.1').error, /has no port/);
  assert.match(refused('127.0.0.1:0').error, /out of range/);
  assert.match(refused('127.0.0.1:70000').error, /out of range/);
  assert.match(refused('ftp://host:21').error, /is not one of/);
  assert.match(refused('http://a b:1').error, /is not host:port/);
  assert.match(refused('').error, /cannot be empty/);
  assert.match(refused(42).error, /must be given as a string/);
});

test('bypass rules accept hostnames, wildcards, CIDR and <local>, and refuse anything else', () => {
  assert.equal(bypassOf(['example.com', '*.internal']).value, 'example.com,*.internal');
  assert.equal(bypassOf('example.com, 10.0.0.0/8 ,<local>').value, 'example.com,10.0.0.0/8,<local>');
  assert.equal(bypassOf(undefined).value, '');
  assert.equal(bypassOf('').value, '');
  // A bypass entry that silently does nothing is the same false belief as an unapplied proxy.
  assert.match(bypassRefused('hxxp://not-a-host').error, /is not a hostname/);
  assert.match(bypassRefused(new Array(51).fill('a.com')).error, /at most 50/);
});

test('an unconfigured session is left alone, which is not the same as forcing direct', () => {
  const route = resolveProxyRoute({}, {});
  assert.equal(route.configured, false);
  assert.equal(route.mode, 'unconfigured');
  assert.equal(route.label, 'No route configured');
  // configured:false is the signal for the runtime to skip setProxy entirely.
});

test('a route that is switched off is reported as disabled rather than applied', () => {
  const route = resolveProxyRoute({ proxy: { enabled: false, spec: '10.0.0.1:8080' } }, {});
  assert.equal(route.configured, false);
  assert.equal(route.mode, 'disabled');
  assert.equal(route.label, 'Route configured but switched off');
});

test('an unusable route is reported rather than half-applied', () => {
  const route = resolveProxyRoute({ proxy: { spec: 'not a route at all' } }, {});
  assert.equal(route.configured, false);
  assert.equal(route.mode, 'invalid');
  assert.match(String(route.error), /is not host:port/);
});

test('a valid route carries the rules Electron needs, and the target to check against', () => {
  const route = resolveProxyRoute({ proxy: { spec: 'socks5://10.0.0.9:1080', bypass: ['8ballpool.com'] } }, {});
  assert.equal(route.configured, true);
  assert.equal(route.mode, 'fixed_servers');
  assert.equal(route.proxyRules, 'socks5://10.0.0.9:1080');
  assert.equal(route.bypassRules, '8ballpool.com');
  assert.equal(route.expectedTarget, '10.0.0.9:1080');
});

test('an account route overrides the workspace route', () => {
  const settings = { proxy: { spec: '10.0.0.1:8080' } };
  assert.equal(resolveProxyRoute({}, settings).expectedTarget, '10.0.0.1:8080', 'default applies');
  assert.equal(resolveProxyRoute({ proxy: { spec: '10.0.0.2:9090' } }, settings).expectedTarget, '10.0.0.2:9090');
});

test("describeResolvedRoute reads Chromium's own answer", () => {
  assert.equal(describeResolvedRoute('DIRECT').kind, 'direct');
  assert.equal(describeResolvedRoute('direct').kind, 'direct');
  const proxy = describeResolvedRoute('PROXY 10.0.0.1:8080');
  assert.equal(proxy.kind, 'proxy');
  assert.equal(proxy.protocol, 'http', 'Chromium says PROXY, the protocol is HTTP');
  assert.equal(proxy.target, '10.0.0.1:8080');
  const socks = describeResolvedRoute('SOCKS5 10.0.0.9:1080;SOCKS 10.0.0.9:1080');
  assert.equal(socks.protocol, 'socks5');
  assert.match(socks.label, /one of several/, 'a multi-hop answer says so rather than picking one');
  assert.equal(describeResolvedRoute('').kind, 'unknown');
  assert.equal(describeResolvedRoute('WEIRD').kind, 'unknown');
});

test('routeMatches is the honesty check: what is configured against what will be used', () => {
  const route = resolveProxyRoute({ proxy: { spec: '10.0.0.9:1080' } }, {});
  assert.equal(routeMatches(route, 'PROXY 10.0.0.9:1080'), true);
  assert.equal(routeMatches(route, 'PROXY 10.0.0.9:1081'), false, 'a different port is a different route');
  // The case the module exists for: a proxy that is configured but silently never applies.
  assert.equal(routeMatches(route, 'DIRECT'), false);
  assert.equal(routeMatches(route, ''), false);

  const direct = resolveProxyRoute({ proxy: { spec: 'DIRECT' } }, {});
  assert.equal(routeMatches(direct, 'DIRECT'), true);
  assert.equal(routeMatches(direct, 'PROXY 10.0.0.9:1080'), false);

  // An unconfigured session reports whatever Chromium decides without being called a mismatch.
  const none = resolveProxyRoute({}, {});
  assert.equal(routeMatches(none, 'DIRECT'), true);
  assert.equal(routeMatches(none, 'PROXY 10.0.0.1:8080'), true, 'a system proxy is not a mismatch');
});
