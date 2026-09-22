const test = require('node:test');
const assert = require('node:assert/strict');
const { create, decode, update } = require('../src/route-presets.cjs');
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

test('editing a saved location keeps its identity and its accounts', () => {
  const preset = create({ name: 'London', spec: 'user:secret@198.105.121.200:6462', enabled: true, bypass: '' }, []);
  const edited = update({ id: preset.id, name: 'London-1', enabled: false }, [preset]);
  assert.equal(edited.id, preset.id, 'the saved location keeps its identity');
  assert.equal(edited.name, 'London-1');
  assert.equal(edited.enabled, false);
  // The address was not in the form, so the one that was saved is the one that stays. This is the whole reason
  // a blank field may not mean "clear it".
  assert.equal(edited.spec, preset.spec);
  assert.equal(decode([edited])[0].spec, preset.spec);
});

test('a typed address replaces the saved one, and only the address changes', () => {
  const preset = create({ name: 'London', spec: '198.105.121.200:6462', bypass: '<local>' }, []);
  const edited = update({ id: preset.id, spec: '31.59.20.176:6754' }, [preset]);
  assert.equal(edited.spec, '31.59.20.176:6754');
  assert.equal(edited.bypass, '<local>', 'a field the operator did not change is carried across');
  assert.equal(edited.name, 'London');
});

test('the masked label is refused rather than saved in place of an address', () => {
  // What the page actually holds for a location with credentials. If a form ever posts it back as the address,
  // the address would be replaced by the sentence describing it — and the operator could not tell.
  const preset = create({ name: 'London', spec: '198.105.121.200:6462', enabled: true }, []);
  assert.throws(() => update({ id: preset.id, spec: 'http proxy at 198.105.121.200:6462 · credentials set' }, [preset]), /masked label/);
  assert.throws(() => create({ name: 'Copy', spec: 'http proxy at 198.105.121.200:6462 · credentials set' }, []), /masked label/);
});

test('an edit cannot take another location name, or an identity that does not exist', () => {
  const london = create({ name: 'London', spec: '198.105.121.200:6462' }, []);
  const newfie = create({ name: 'Newfie', spec: '31.59.20.176:6754' }, [london]);
  assert.throws(() => update({ id: newfie.id, name: 'London' }, [london, newfie]), /already uses that name/);
  assert.throws(() => update({ id: 'f0e1d2c3-1111-4222-8333-444444444444', name: 'Elsewhere' }, [london]), /not found/);
  // Renaming a location to its own name is not a collision with itself.
  assert.equal(update({ id: london.id, name: 'London' }, [london]).name, 'London');
});
