const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAccountOverview } = require('../src/account-overview.cjs');

const account = {
  id: '11111111-1111-4111-8111-111111111111',
  identity: { locale: 'en-CA', timezone: 'America/St_Johns', viewport: { width: 1200, height: 800 } },
  proxy: { enabled: true, spec: 'socks5://example.test:1080', bypass: '<local>' },
  profile: { established: true }
};

test('account overview provides a dashboard-safe configuration summary without credentials or filesystem paths', () => {
  const view = buildAccountOverview(
    account,
    {},
    {
      fsm: { state: 'ready', reason: null },
      footprint: {
        identity: {
          userAgent: null,
          acceptLanguages: null,
          locale: 'en-CA',
          timezone: 'America/St_Johns',
          viewport: { width: 1200, height: 800 },
          colorScheme: null,
          quotaBytes: null
        },
        route: {
          configured: true,
          label: 'socks5 proxy at example.test:1080',
          mode: 'fixed_servers',
          proxyRules: 'socks5://example.test:1080',
          bypassRules: '<local>'
        },
        verified: { matches: true, route: { label: 'SOCKS5 example.test:1080' }, at: '2026-09-20T12:00:00.000Z' }
      },
      network: { status: 'checked', ip: '203.0.113.4', checkedAt: '2026-09-20T12:01:00.000Z' }
    }
  );
  assert.equal(view.session.partition, 'poolside-11111111-1111-4111-8111-111111111111');
  assert.equal(view.session.persistence, 'Saved browser profile established');
  assert.equal(view.identity.viewport, '1200 × 800');
  assert.equal(view.route.publicIp, '203.0.113.4');
  assert.equal(Object.hasOwn(view, 'cookies'), false);
  assert.equal(JSON.stringify(view).includes('C:\\'), false);
});

test('closed accounts receive an explicit closed-state overview and ordinary defaults', () => {
  const view = buildAccountOverview({ ...account, profile: undefined });
  assert.equal(view.session.state, 'closed');
  assert.equal(view.session.persistence, 'Profile will be established when opened');
  assert.equal(view.route.configured, true);
  assert.equal(view.identity.locale, 'en-CA');
});
