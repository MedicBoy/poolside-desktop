const test = require('node:test');
const assert = require('node:assert/strict');
const { create, decode } = require('../src/route-presets.cjs');
const { resolveProxyRoute } = require('../src/proxy.cjs');
test('route presets validate, persist, and supply a selected account route', () => {
  const preset = create({ name: 'Private route', spec: 'socks5://127.0.0.1:1080', bypass: '<local>', enabled: true }, []);
  assert.equal(decode([preset])[0].name, 'Private route');
  const route = resolveProxyRoute({ routePresetId: preset.id }, { routePresets: [preset] });
  assert.equal(route.configured, true);
  assert.match(route.label, /socks5 proxy/);
});
test('an account-specific route override still takes precedence over a selected preset', () => {
  const preset = create({ name: 'Preset', spec: '127.0.0.1:8080', enabled: true }, []);
  const route = resolveProxyRoute({ routePresetId: preset.id, proxy: { spec: 'socks5://127.0.0.1:1080' } }, { routePresets: [preset] });
  assert.match(route.label, /socks5 proxy/);
});
