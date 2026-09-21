const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAccountOverview } = require('../src/account-overview.cjs');
const { footprintView, publicAccount, publicSettings, runScreenView } = require('../src/workspace-snapshot.cjs');
const { sessions } = require('../src/state.cjs');
const { publicRoutePreset } = require('../src/proxy-public.cjs');

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

test('the legacy footprint row receives no proxy credentials across IPC', () => {
  const view = footprintView({
    summary: 'not configured',
    route: {
      configured: true,
      label: 'http proxy at proxy.example:3128',
      proxyRules: 'http://proxy.example:3128',
      credentials: { username: 'nicho', password: 'hunter2' }
    },
    verified: { ok: true, matches: true, route: { label: 'http proxy at proxy.example:3128' } },
    storage: { cacheBytes: 1024, quotaBytes: 2048, overQuota: false }
  });
  assert.ok(view);
  assert.equal(JSON.stringify(view).includes('hunter2'), false);
  assert.deepEqual(view.route, { configured: true, label: 'http proxy at proxy.example:3128' });
});

test('workspace configuration and saved presets expose no proxy credentials across IPC', () => {
  const secret = 'http://nicho:hunter2@proxy.example:3128';
  const safeAccount = publicAccount({ ...account, proxy: { spec: secret } });
  const safeSettings = publicSettings({ table: 'Bangkok', limit: 10, proxy: { spec: secret } });
  const safePreset = publicRoutePreset({ id: 'route-1', name: 'Private', enabled: true, spec: secret, bypass: '<local>' });
  const serialised = JSON.stringify({ safeAccount, safeSettings, safePreset });
  assert.equal(serialised.includes('nicho'), false);
  assert.equal(serialised.includes('hunter2'), false);
  assert.equal(safePreset.spec, 'http proxy at proxy.example:3128 · credentials set');
});

test('the run card is told whether a table is identified, merely listed, or not seen at all', () => {
  // "Rome is one of the names on this screen" and "Rome is the table you are on" are different statements,
  // and a table-selection screen lists venues — so the weaker one is reported as its own field.
  const id = '22222222-2222-4222-8222-222222222222';
  /** @param {any} gameScreen */
  const screen = (gameScreen = null) => {
    sessions.set(id, /** @type {any} */ ({ window: { isDestroyed: () => false }, gameScreen }));
    return /** @type {any} */ (runScreenView(id, 'Rome'));
  };
  assert.equal(screen(null), null, 'a session with no reading is reported as no reading');
  assert.equal(screen({ state: 'inspecting' }).identified, false);
  const listed = screen({ state: 'table-selection', observedAt: '2026-09-21T12:00:00.000Z', visibleTables: ['Rome', 'Tokyo'] });
  assert.equal(listed.identified, false);
  assert.equal(listed.listed, true);
  const identified = screen({
    state: 'table-selection',
    observedAt: '2026-09-21T12:00:00.000Z',
    visibleTables: ['Rome', 'Tokyo'],
    tableMatch: { table: 'Rome', method: 'local-evidence' }
  });
  assert.equal(identified.identified, true);
  // And a different table being identified is not the target being on screen.
  const other = screen({ state: 'table-selection', observedAt: '2026-09-21T12:00:00.000Z', tableMatch: { table: 'Tokyo' } });
  assert.equal(other.identified, false);
  assert.equal(other.listed, false);
  sessions.delete(id);
});
