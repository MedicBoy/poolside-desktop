const { test } = require('node:test');
const assert = require('node:assert/strict');
const { participantPreflight, routeVerdict } = require('../src/match-preflight.cjs');

const CONFIGURED = { configured: true, label: 'Proxy 1.2.3.4:8080' };
const DIRECT = { configured: false, label: 'Direct connection' };
const matching = { ok: true, resolved: 'PROXY 1.2.3.4:8080', route: { label: 'Proxy 1.2.3.4:8080' }, matches: true, at: 'now' };
const mismatched = { ok: true, resolved: 'DIRECT', route: { label: 'Direct connection' }, matches: false, at: 'now' };

test('an account with no configured route has nothing to verify', () => {
  assert.deepEqual(routeVerdict({ route: DIRECT, verified: null }), {
    required: false,
    ok: true,
    detail: 'No route is configured for this account.'
  });
  assert.equal(routeVerdict(null).ok, true, 'a session that reported nothing is not treated as a failure');
});

test('a configured route must be the route Chromium actually uses', () => {
  const honoured = routeVerdict({ route: CONFIGURED, verified: matching });
  assert.equal(honoured.required, true);
  assert.equal(honoured.ok, true);
  assert.match(honoured.detail, /Using the configured route \(Proxy 1\.2\.3\.4:8080\)\./);

  const wrong = routeVerdict({ route: CONFIGURED, verified: mismatched });
  assert.equal(wrong.ok, false);
  assert.match(wrong.detail, /Chromium is using Direct connection, not the configured route \(Proxy 1\.2\.3\.4:8080\)\./);
});

test('a route that could not be read is not quietly treated as fine', () => {
  const missing = routeVerdict({ route: CONFIGURED, verified: null });
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /has not reported which route it uses/);

  const failed = routeVerdict({ route: CONFIGURED, verified: { ok: false, error: 'resolveProxy failed', at: 'now' } });
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /could not be read: resolveProxy failed/);
});

test('a participant is releasable only when the session loaded and the route holds', () => {
  const ready = participantPreflight(
    { open: true, status: 'ready', footprint: { route: CONFIGURED, verified: matching } },
    { checked: true, ip: '203.0.113.7' }
  );
  assert.equal(ready.ok, true);
  assert.equal(ready.detail, 'Loaded on the configured route and the exit was read.');

  const blockedByRoute = participantPreflight({ open: true, status: 'ready', footprint: { route: CONFIGURED, verified: mismatched } });
  assert.equal(blockedByRoute.ok, false, 'a loaded session on the wrong route must not be released');
  assert.match(blockedByRoute.detail, /Chromium is using/);

  const closed = participantPreflight({ open: false, status: 'closed', footprint: null });
  assert.equal(closed.ok, false);
  assert.equal(closed.detail, 'The window is closed.');

  const loading = participantPreflight({ open: true, status: 'loading', footprint: { route: DIRECT, verified: null } });
  assert.equal(loading.ok, false);
  assert.equal(loading.detail, 'The session is loading.');

  const noRoute = participantPreflight({ open: true, status: 'ready', footprint: { route: DIRECT, verified: null } });
  assert.equal(noRoute.ok, true, 'with no route configured there is nothing else to wait for');
  assert.equal(noRoute.detail, 'Loaded with no route configured.');
});

test('the verdict is stated as data, so a blocked match can name the failing check', () => {
  const verdict = participantPreflight({ open: true, status: 'ready', footprint: { route: CONFIGURED, verified: mismatched } });
  assert.deepEqual(Object.keys(verdict).sort(), ['detail', 'exit', 'loaded', 'ok', 'route', 'session']);
  assert.equal(verdict.loaded, true);
  assert.equal(verdict.route.required, true);
  assert.equal(verdict.route.ok, false);
});

test('a configured route is not released until the address it leaves through has been read', () => {
  const footprint = { route: CONFIGURED, verified: matching };
  const unread = participantPreflight({ open: true, status: 'ready', footprint });
  assert.equal(unread.ok, false, 'the route may be honoured and still leave nowhere useful');
  assert.match(unread.detail, /The exit address could not be read\./);
  assert.equal(unread.exit.required, true);
  assert.equal(unread.exit.checked, false);

  const failed = participantPreflight({ open: true, status: 'ready', footprint }, { checked: false, error: 'IP check failed.' });
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /could not be read: IP check failed\./);

  const read = participantPreflight({ open: true, status: 'ready', footprint }, { checked: true, ip: '203.0.113.9' });
  assert.equal(read.ok, true);
  assert.equal(read.exit.ip, '203.0.113.9', 'the address is available to show on the card');
  assert.equal(read.detail.includes('203.0.113.9'), false, 'the address must not appear in the text a blocked match records');
  // With no route configured nothing is requested, which is what keeps an offline check offline.
  const direct = participantPreflight({ open: true, status: 'ready', footprint: { route: DIRECT, verified: null } });
  assert.equal(direct.ok, true);
  assert.equal(direct.exit.required, false);
  assert.equal(direct.exit.ip, null);
});
