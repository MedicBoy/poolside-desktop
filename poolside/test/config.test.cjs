// The configuration schema's parity guard.
//
// `src/config-schema.cjs` declares what exists; three other modules own the rules — `model.cjs` for the
// document's shape, `identity-fields.cjs` for the identity grammar, `proxy.cjs` for routes. A declaration
// that drifts from those implementations is worse than no declaration, because it would be believed.
//
// Every test here cross-references the declaration against the structure that is actually stored and
// executed: the field lists, the decode round trip, and — for settings — verdict-for-verdict agreement with
// the hand-written validator that predates it. If a field is added to one without the other, this suite goes
// red, and that is the entire point of M2's exit gate.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/config-schema.cjs');
const validator = require('../src/config-validator.cjs');
const model = require('../src/model.cjs');
const { IDENTITY_FIELDS, validateField } = require('../src/identity-fields.cjs');
const { parseProxySpec } = require('../src/proxy.cjs');

/** A usable value for every declared identity field. Compared against IDENTITY_FIELDS below. */
const VALID_IDENTITY = {
  userAgent: 'Poolside/1.0 (Parity)',
  acceptLanguages: 'en-GB,en',
  locale: 'en-GB',
  timezone: 'Europe/London',
  viewport: { width: 1024, height: 768 },
  colorScheme: 'dark',
  quotaBytes: 1048576
};

const VALID_PROXY = { enabled: true, spec: 'socks5://127.0.0.1:1080', bypass: ['8ballpool.com'] };

function workspaceWith(settings, accountConfig) {
  const receiver = { ...model.account({ name: 'Main', role: 'receiver' }), ...(accountConfig || {}) };
  const sender = model.account({ name: 'Second', role: 'sender' });
  return { version: 1, accounts: [receiver, sender], settings };
}

test('the schema declares exactly the fields the grammar and the storage layer know', () => {
  assert.deepEqual(schema.fields(schema.IDENTITY).sort(), [...IDENTITY_FIELDS].sort());
  assert.deepEqual(
    Object.keys(VALID_IDENTITY).sort(),
    [...IDENTITY_FIELDS].sort(),
    'this fixture must carry a value for every identity field, or the round-trip tests silently stop covering one'
  );
  assert.deepEqual(schema.fields(schema.PROXY), model.PROXY_FIELDS);
  assert.deepEqual(schema.TABLES, model.TABLES, 'the venue list must live in exactly one place');
  assert.deepEqual(schema.fields(schema.SETTINGS), ['table', 'limit', 'identity', 'proxy']);
  assert.deepEqual(schema.fields(schema.ACCOUNT), ['identity', 'proxy']);
});

test('every declared field has a working rule and a label', () => {
  for (const field of IDENTITY_FIELDS) {
    assert.equal(validateField(field, VALID_IDENTITY[field]).ok, true, `${field} has no working grammar rule`);
  }
  const all = { ...schema.SETTINGS, ...schema.ACCOUNT, ...schema.IDENTITY, ...schema.PROXY };
  for (const [key, spec] of Object.entries(all)) {
    assert.ok(spec.label, `${key} is declared without a label, so an error or a form cannot name it`);
  }
});

test('a document carrying every declared field survives decode unchanged', () => {
  const settings = { table: 'Bangkok', limit: 10, identity: { ...VALID_IDENTITY }, proxy: { ...VALID_PROXY } };
  const decoded = model.decode(workspaceWith(settings, { identity: { ...VALID_IDENTITY }, proxy: { ...VALID_PROXY } }));
  assert.deepEqual(decoded.settings, settings, 'a field the schema declares but decode drops is silent data loss');
  assert.deepEqual(decoded.accounts[0].identity, VALID_IDENTITY, 'an account identity is stored the same way');
  assert.deepEqual(decoded.accounts[0].proxy, VALID_PROXY);
});

test('the validator emits a shape the storage layer keeps', () => {
  const validated = validator.validateSettings({
    table: 'Bangkok',
    limit: 10,
    identity: { ...VALID_IDENTITY },
    proxy: { ...VALID_PROXY }
  });
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.errors, []);
  assert.deepEqual(validator.validateAccountConfig({ identity: { ...VALID_IDENTITY }, proxy: { ...VALID_PROXY } }).errors, []);
  const decoded = model.decode(workspaceWith(validated.value));
  assert.deepEqual(decoded.settings, validated.value, 'a validated value that decode would drop is validated output nobody can store');
});

test('the validator and the hand-written settings validator agree on every supplied value', () => {
  // `undefined` is excluded deliberately: it means "no settings supplied", which is not the same thing as a
  // settings value. Everything else here is a value, and the two validators must reach the same verdict.
  const supplied = [
    { table: 'Bangkok', limit: 10 },
    { table: 'Bangkok', limit: 1 },
    { table: 'Bangkok', limit: 100 },
    { table: 'Bangkok', limit: 10, identity: { timezone: 'Asia/Tokyo' } },
    { table: 'Bangkok', limit: 10, identity: { timezone: 'Nowhere/Nothing' } },
    { table: 'Bangkok', limit: 10, identity: 'not an object' },
    { table: 'Bangkok', limit: 10, proxy: { enabled: true, spec: 'socks5://10.0.0.9:1080' } },
    { table: 'Bangkok', limit: 10, proxy: { spec: 'nonsense' } },
    { table: 'Bangkok', limit: 10, junk: 'ignored by both' },
    { table: 'Paris', limit: 10 },
    { table: '', limit: 10 },
    { table: 'Bangkok', limit: 0 },
    { table: 'Bangkok', limit: 101 },
    { table: 'Bangkok', limit: 1.5 },
    { table: 'Bangkok', limit: '10' },
    { table: 'Bangkok' },
    { limit: 10 },
    {},
    'not an object',
    5,
    []
  ];
  for (const input of supplied) {
    const verdict = validator.validateSettings(input);
    let threw = false;
    try {
      model.settings(input);
    } catch {
      threw = true;
    }
    assert.equal(
      verdict.ok,
      !threw,
      `disagreement on ${JSON.stringify(input)}: the schema validator says ${verdict.ok ? 'usable' : 'unusable'}, model.settings ${threw ? 'refuses' : 'accepts'} it`
    );
  }
});

test('an absent settings value is not a rejected one', () => {
  // The one input the agreement above excludes, stated explicitly so the difference cannot be lost.
  assert.equal(validator.validateSettings(undefined).ok, true);
  assert.equal(validator.validateSettings(null).ok, true);
  assert.throws(() => model.settings(null), /supported table/, 'the document validator refuses it, because a document always has settings');
});

test('routes are validated by the parser that will apply them, not by a second pattern', () => {
  const accepted = ['DIRECT', 'direct', '10.0.0.9:8080', 'http://10.0.0.9:8080', 'socks5://127.0.0.1:1080', 'https://10.0.0.9:8443'];
  const refused = ['', 'not a route', 'socks5://', 'http://10.0.0.9', 'ftp://10.0.0.9:21'];
  for (const spec of accepted) {
    assert.equal(parseProxySpec(spec).ok, true, `${spec} should parse`);
    const result = validator.validateSettings({ table: 'Bangkok', limit: 10, proxy: { spec } });
    assert.deepEqual(result.dropped, [], `${spec} parsed but the schema rejected it`);
    assert.equal(result.value.proxy.spec, spec.trim(), 'the stored value is what the user wrote');
  }
  for (const spec of refused) {
    const parsed = parseProxySpec(spec);
    assert.equal(parsed.ok, false, `${spec} should not parse`);
    // An empty string is treated as "not set" by both, so only the non-empty refusals are reported.
    if (!spec) continue;
    const result = validator.validateSettings({ table: 'Bangkok', limit: 10, proxy: { spec } });
    const dropped = result.dropped.map(item => item.path);
    assert.deepEqual(dropped, ['settings.proxy.spec'], `${spec} should be reported as dropped`);
    assert.match(result.dropped[0].message, new RegExp(parsed.ok ? '' : parsed.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('bypass entries go through the same normaliser the runtime uses', () => {
  const result = validator.validateSettings({
    table: 'Bangkok',
    limit: 10,
    proxy: { enabled: true, spec: 'DIRECT', bypass: [' 8ballpool.com ', '10.0.0.0/8'] }
  });
  assert.deepEqual(result.dropped, []);
  assert.equal(result.value.proxy.bypass, '8ballpool.com,10.0.0.0/8', 'normalised to the string Electron wants');
  const bad = validator.validateSettings({ table: 'Bangkok', limit: 10, proxy: { bypass: ['not a host!'] } });
  assert.deepEqual(
    bad.dropped.map(item => item.path),
    ['settings.proxy.bypass']
  );
});

test('a dropped field is reported by path and the rest of the configuration survives', () => {
  const result = validator.validateSettings({
    table: 'Rome',
    limit: 25,
    identity: { timezone: 'Nowhere/Nothing', locale: 'en-GB', userAgent: 'Poolside/1.0' },
    proxy: { enabled: true, spec: 'socks5://10.0.0.9:1080' }
  });
  assert.equal(result.ok, true, 'an unusable optional value must not be fatal');
  assert.deepEqual(
    result.dropped.map(item => item.path),
    ['settings.identity.timezone']
  );
  assert.match(result.dropped[0].message, /Time zone/);
  assert.deepEqual(result.value.identity, { locale: 'en-GB', userAgent: 'Poolside/1.0' }, 'the usable fields are kept');
  assert.equal(result.value.table, 'Rome');
  assert.equal(result.value.limit, 25);
});

test('a structural error is fatal, and every problem is reported at once', () => {
  const result = validator.validateSettings({ table: 'Paris', limit: 500, junk: true });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(item => item.path).sort(), ['settings.limit', 'settings.table']);
  assert.deepEqual(
    result.dropped.map(item => item.path),
    ['settings.junk'],
    'an unknown key is reported, never dropped in silence'
  );
  assert.match(validator.describeProblems(result) || '', /Preferred table must be one of Bangkok, Rome, Seoul/);
});

test('an unknown key is reported rather than discarded in silence', () => {
  const result = validator.validateAccountConfig({ identity: { timezones: 'Europe/London' }, proxy: { routes: 'x' } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.dropped.map(item => item.path).sort(), ['account.identity.timezones', 'account.proxy.routes']);
  for (const item of result.dropped) assert.equal(item.message, 'is not a known setting');
});

test('required fields are required in validation and supplied by applyDefaults, which are different operations', () => {
  const missing = validator.validateSettings({});
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.errors.map(item => item.path).sort(), ['settings.limit', 'settings.table']);
  const filled = validator.applySettingsDefaults({ identity: { timezone: 'Asia/Tokyo' } });
  assert.deepEqual(filled, { table: 'Bangkok', limit: 10, identity: { timezone: 'Asia/Tokyo' } });
  assert.equal(validator.validateSettings(filled).ok, true, 'defaults produce something that validates');
});

test('there are no cross-field rules, so the resolver stays the only authority on precedence', () => {
  // A route enabled with no spec is the resolver's question, not the validator's. Asserted so that adding a
  // rule here is a deliberate change to the decision rather than an accident.
  const result = validator.validateSettings({ table: 'Bangkok', limit: 10, proxy: { enabled: true } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(result.value.proxy, { enabled: true });
});

test('the boundary check validates sections separately and never merges them', () => {
  const profile = validator.validateSessionProfile({
    settings: { table: 'Bangkok', limit: 10, identity: { timezone: 'Europe/London' } },
    account: { identity: { timezone: 'Asia/Tokyo' } }
  });
  assert.equal(profile.ok, true);
  assert.deepEqual(Object.keys(profile.value).sort(), ['account', 'settings']);
  assert.equal(profile.value.settings.identity.timezone, 'Europe/London');
  assert.equal(profile.value.account.identity.timezone, 'Asia/Tokyo', 'precedence belongs to identity.cjs, not here');
  const bad = validator.validateSessionProfile({ account: { identity: { viewport: { width: 10, height: 10 } } } });
  assert.equal(bad.ok, true);
  assert.deepEqual(
    bad.dropped.map(item => item.path),
    ['account.identity.viewport'],
    'paths are prefixed by the section they came from'
  );
});

test('nothing here throws, whatever it is handed', () => {
  const junk = [undefined, null, 0, 1, -1, NaN, Infinity, '', 'x', true, false, [], [1, 2], {}, { table: {} }, { settings: [] }];
  for (const value of junk) {
    assert.doesNotThrow(() => validator.validateSettings(value));
    assert.doesNotThrow(() => validator.validateAccountConfig(value));
    assert.doesNotThrow(() => validator.validateSessionProfile(/** @type {any} */ (value)));
    assert.doesNotThrow(() => validator.describeProblems(validator.validateSettings(value)));
    assert.doesNotThrow(() => validator.applySettingsDefaults(value));
  }
});

test('describeProblems is null when there is nothing to say', () => {
  const clean = validator.validateSettings({ table: 'Bangkok', limit: 10 });
  assert.equal(validator.describeProblems(clean), null);
  assert.equal(clean.dropped.length, 0);
});
