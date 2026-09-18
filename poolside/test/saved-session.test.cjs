const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const saved = require('../src/saved-session.cjs');

// These are the D3 / ADR-004 invariants, tested without Electron: this module never requires
// `electron`, so safeStorage is only present in the profile store that calls it.

function cookie(overrides = {}) {
  return {
    name: 'sid',
    value: 'abc',
    domain: '.8ballpool.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    hostOnly: false,
    session: true,
    ...overrides
  };
}

test('only session cookies are selected for carry-over', () => {
  const selected = saved.selectCarryOverCookies([
    cookie({ name: 'session-only', session: true }),
    cookie({ name: 'persistent', session: false, expirationDate: 9999999999 }),
    cookie({ name: 'also-persistent', session: false }),
    cookie({ name: 'no-flag', session: undefined })
  ]);
  assert.deepEqual(
    selected.map(c => c.name),
    ['session-only']
  );
});

test('malformed cookies are dropped rather than carried into the file', () => {
  const selected = saved.selectCarryOverCookies([
    cookie({ name: '' }),
    cookie({ value: undefined }),
    cookie({ domain: '' }),
    cookie({ domain: undefined, name: 'x' }),
    null,
    'not-a-cookie',
    cookie({ name: 'good' })
  ]);
  assert.deepEqual(
    selected.map(c => c.name),
    ['good']
  );
  assert.deepEqual(saved.selectCarryOverCookies(undefined), []);
  assert.deepEqual(saved.selectCarryOverCookies('nonsense'), []);
});

test('the stored shape is normalised, so a restore always has a usable path and sameSite', () => {
  const [stored] = saved.selectCarryOverCookies([
    cookie({ name: 'minimal', path: undefined, sameSite: undefined, secure: undefined, httpOnly: undefined, hostOnly: undefined })
  ]);
  assert.deepEqual(stored, {
    name: 'minimal',
    value: 'abc',
    domain: '.8ballpool.com',
    path: '/',
    secure: false,
    httpOnly: false,
    sameSite: 'unspecified',
    hostOnly: false
  });
});

test('a payload records its version, scope and account', () => {
  const payload = saved.buildPayload('11111111-1111-4111-8111-111111111111', [cookie(), cookie({ session: false })]);
  assert.equal(payload.version, saved.PAYLOAD_VERSION);
  assert.equal(payload.scope, 'session-cookies');
  assert.equal(payload.accountId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(
    payload.cookies.map(c => c.name),
    ['sid']
  );
  assert.ok(Number.isFinite(Date.parse(payload.savedAt)));
});

test('a payload for another account is rejected rather than restored', () => {
  const payload = saved.buildPayload('11111111-1111-4111-8111-111111111111', [cookie()]);
  assert.throws(() => saved.parsePayload(payload, '22222222-2222-4222-8222-222222222222'), /another account/);
});

test('unsupported or absent payloads are rejected', () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  for (const value of [null, undefined, 'string', 42, {}, { version: 99, accountId, cookies: [] }]) {
    assert.throws(() => saved.parsePayload(value, accountId), /unsupported payload/);
  }
});

test('a v1 payload (whole cookie jar) is narrowed, never rejected', () => {
  // Upgrading must not sign the user out: a v1 file still restores its session cookies, and the
  // next save rewrites it as v2.
  const accountId = '11111111-1111-4111-8111-111111111111';
  const legacy = {
    version: 1,
    accountId,
    cookies: [cookie({ name: 'session-cookie' }), cookie({ name: 'persistent-cookie', session: false })]
  };
  const restored = saved.parsePayload(legacy, accountId);
  assert.deepEqual(
    restored.map(c => c.name),
    ['session-cookie']
  );
  const rewritten = saved.buildPayload(accountId, legacy.cookies);
  assert.equal(rewritten.version, saved.PAYLOAD_VERSION);
  assert.ok(rewritten.cookies.every(c => c.name !== 'persistent-cookie'));
});

test('a payload round-trips: what is written is what is restored', () => {
  // The test that was missing when the double-filter bug shipped: build -> parse must return the
  // same cookies. Filtering and building were each tested, but not the hand-off between them.
  const accountId = '11111111-1111-4111-8111-111111111111';
  const live = [
    cookie({ name: 'session-a' }),
    cookie({ name: 'session-b', domain: 'example.test' }),
    cookie({ name: 'persistent', session: false })
  ];
  const payload = saved.buildPayload(accountId, live);
  const restored = saved.parsePayload(payload, accountId);
  assert.deepEqual(
    restored.map(c => c.name),
    ['session-a', 'session-b']
  );
  assert.deepEqual(restored, payload.cookies, 'a stored payload must survive the round trip unchanged');
  assert.ok(
    restored.every(c => c.value === 'abc'),
    'values survive, or the user is signed out'
  );
});

test('a storable list needs no session flag on the way back in', () => {
  // Regression guard: the stored shape deliberately has no `session` field, so re-filtering a v2
  // payload by that flag silently restored nothing. Asserting the exact key set is stronger than
  // reading the property, and it fails if anyone adds the flag back.
  const stored = saved.normaliseStoredCookie(cookie());
  assert.ok(stored, 'a well formed cookie normalises');
  assert.deepEqual(Object.keys(stored).sort(), ['domain', 'hostOnly', 'httpOnly', 'name', 'path', 'sameSite', 'secure', 'value']);
  const payload = { version: saved.PAYLOAD_VERSION, accountId: '11111111-1111-4111-8111-111111111111', cookies: [stored] };
  assert.equal(saved.parsePayload(payload, '11111111-1111-4111-8111-111111111111').length, 1);
});

test('session file names are derived from a validated identifier', () => {
  const root = path.join('C:', 'data');
  assert.equal(
    saved.fileFor(root, '11111111-1111-4111-8111-111111111111'),
    path.join(root, 'accounts', '11111111-1111-4111-8111-111111111111.plist')
  );
  assert.throws(() => saved.fileFor(root, '../../user'), /Invalid session identifier/);
  assert.throws(() => saved.fileFor(root, 'short'), /Invalid session identifier/);
});

test('the partition name matches the persisted profile the file belongs to', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(saved.partition(id), `persist:poolside-${id}`);
  assert.ok(saved.partition(id).startsWith('persist:'), 'a non-persistent partition would drop the profile on exit');
});
