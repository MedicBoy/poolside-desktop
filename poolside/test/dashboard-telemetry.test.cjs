// The dashboard telemetry payload, and the scanner that keeps the export honest.
//
// The most important test in this file is the negative control in `findSecrets finds planted secrets`: a scanner
// that reports nothing proves nothing unless it can be shown to report something. So a payload is built with an
// account name, an IP, a Windows path and an opaque token in it, the scanner is asserted to find all four, and
// only then is the export layer asserted clean.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const telemetry = require('../src/dashboard-telemetry.cjs');
const redaction = require('../src/telemetry-redaction.cjs');

const ACCOUNTS = [
  {
    id: '11111111-2222-4333-8444-555555555555',
    name: 'Main',
    status: 'ready',
    statusReason: null,
    health: { failures: 0, recoveries: 0, consecutive: 0, attempts: 0, exhausted: false, lastFailureAt: null, lastFailureReason: null },
    profile: {
      generation: 2,
      established: true,
      directoryBytes: 4096,
      fileCount: 12,
      quotaBytes: 1024,
      overQuota: true,
      truncated: false,
      unreadable: 0,
      checkedAt: '2026-09-18T12:00:00.000Z',
      corruption: { count: 1, lastAt: '2026-09-18T11:00:00.000Z', lastReason: 'no payload' }
    }
  },
  {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    name: 'Second',
    status: 'degraded',
    statusReason: 'renderer gone: crashed (exit 133)',
    health: {
      failures: 3,
      recoveries: 1,
      consecutive: 3,
      attempts: 3,
      exhausted: true,
      lastFailureAt: '2026-09-18T12:30:00.000Z',
      lastFailureReason: 'renderer gone: crashed (exit 133)'
    },
    profile: null
  },
  { id: 'ffffffff-0000-4000-8000-000000000000', name: 'Untouched', status: 'closed', statusReason: null, health: null, profile: null }
];

test('the summary counts what the header needs', () => {
  const summary = telemetry.summarise(ACCOUNTS);
  assert.deepEqual(summary, { accounts: 3, open: 2, degraded: 1, crashed: 1, overQuota: 1, corrupted: 1 });
  assert.deepEqual(telemetry.summarise([]), { accounts: 0, open: 0, degraded: 0, crashed: 0, overQuota: 0, corrupted: 0 });
  assert.deepEqual(telemetry.summarise(/** @type {any} */ (null)).accounts, 0);
});

test('the session layer carries state, reason and the crash flags', () => {
  const layer = telemetry.sessionLayer(ACCOUNTS);
  assert.equal(layer.length, 3);
  assert.deepEqual(layer[0].crash, {
    failures: 0,
    recoveries: 0,
    attempts: 0,
    exhausted: false,
    lastFailureAt: null,
    lastFailureReason: null
  });
  assert.equal(layer[1].state, 'degraded');
  assert.equal(layer[1].reason, 'renderer gone: crashed (exit 133)');
  assert.equal(layer[1].crash?.exhausted, true, 'the flag a user needs: recovery gave up');
  assert.equal(layer[1].crash?.attempts, 3);
  assert.equal(layer[2].crash, null, 'a session that never existed has no crash record, rather than a zeroed one');
  assert.equal(layer[2].state, 'closed');
});

test('the storage layer keeps unknown distinct from empty', () => {
  const layer = telemetry.storageLayer(ACCOUNTS);
  assert.deepEqual(layer[0], {
    id: ACCOUNTS[0].id,
    name: 'Main',
    generation: 2,
    established: true,
    directoryBytes: 4096,
    fileCount: 12,
    quotaBytes: 1024,
    overQuota: true,
    truncated: false,
    unreadable: false,
    measuredAt: '2026-09-18T12:00:00.000Z',
    corruption: { count: 1, lastAt: '2026-09-18T11:00:00.000Z' }
  });
  assert.equal(layer[1].directoryBytes, null, 'a profile that was never measured is unknown, not zero');
  assert.equal(layer[1].quotaBytes, null);
  assert.equal(layer[1].generation, 0, 'and it has no generation yet');
  assert.equal(layer[1].corruption, null);
  // An unreadable count and an unreadable flag both mean the same thing to a reader.
  const flagged = telemetry.storageLayer([{ id: 'x', name: 'X', status: 'closed', profile: { unreadable: 3 } }]);
  assert.equal(flagged[0].unreadable, true);
});

test('the payload is built from a fixed clock when asked', () => {
  const payload = telemetry.build(ACCOUNTS, { version: '0.1.0', now: Date.UTC(2026, 8, 18, 13, 0, 0) });
  assert.equal(payload.generatedAt, '2026-09-18T13:00:00.000Z');
  assert.equal(payload.version, '0.1.0');
  assert.equal(payload.summary.accounts, 3);
  assert.equal(payload.sessions.length, 3);
  assert.equal(payload.storage.length, 3);
  assert.equal(payload.timelineSummary, null);
  const withTimeline = telemetry.build(ACCOUNTS, { timeline: { summary: { total: 7 } } });
  assert.deepEqual(withTimeline.timelineSummary, { total: 7 });
});

test('findSecrets finds planted secrets in an unredacted payload', () => {
  // The negative control. Without this, "the export is clean" would only prove the scanner is quiet.
  const dirty = telemetry.build(ACCOUNTS, { version: '0.1.0' });
  dirty.sessions[0].reason = 'Main failed at C:\\Users\\nicho\\AppData\\Local\\Temp';
  /** @type {any} */ (dirty.storage[0]).note = 'checked from 192.168.1.44';
  /** @type {any} */ (dirty.storage[1]).token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9payloadpayloadpayload';
  const found = redaction.findSecrets(dirty, { forbidden: ['Main', 'Second'] });
  const kinds = found.map(item => item.kind);
  assert.ok(kinds.includes('account-name'), 'the account name is caught by literal');
  assert.ok(kinds.includes('path'), 'the Windows path is caught by shape');
  assert.ok(kinds.includes('ipv4'), 'the address is caught by shape');
  assert.ok(kinds.includes('opaque'), 'the token is caught by shape');
  for (const item of found) assert.ok(item.path.includes('.') || item.path.includes('['), 'every hit names where it was');
});

test('the export layer of the same payload is clean', () => {
  const payload = telemetry.build(ACCOUNTS, { version: '0.1.0' });
  payload.sessions[0].reason = 'Main failed at C:\\Users\\nicho\\AppData\\Local\\Temp';
  const exported = redaction.exportLayer(payload);
  const serialised = JSON.stringify(exported);
  const found = redaction.findSecrets(exported, { forbidden: ['Main', 'Second', 'Untouched'] });
  assert.deepEqual(found, [], JSON.stringify(found));
  assert.equal(serialised.includes('Main'), false);
  assert.equal(serialised.includes('C:\\\\Users'), false, 'the filesystem path is gone');
  assert.equal(serialised.includes('"name"'), false, 'no name field survives at all');
  assert.equal(serialised.includes('11111111'), false, 'and no raw identifier');
  // Cleaned, not blanked: the reason still says what happened and what was removed from it.
  assert.equal(exported.sessions[0].reason, 'account 1 failed at [redacted:path]');
  assert.deepEqual(exported.redactions, [
    'account names replaced by references',
    'paths, addresses and token shapes replaced by [redacted:kind]'
  ]);
});

test('the export layer keeps the accounts correlated without identifying them', () => {
  const exported = redaction.exportLayer(telemetry.build(ACCOUNTS, { version: '0.1.0' }));
  assert.deepEqual(
    exported.sessions.map(entry => entry.ref),
    ['account 1', 'account 2', 'account 3']
  );
  assert.deepEqual(
    exported.storage.map(entry => entry.ref),
    ['account 1', 'account 2', 'account 3'],
    'the same account has the same reference in every layer'
  );
  assert.equal(exported.sessions[1].state, 'degraded', 'the facts survive; only the identity does not');
  assert.equal(exported.sessions[1].crash.exhausted, true);
  assert.equal(exported.storage[0].generation, 2);
  assert.equal(exported.storage[0].overQuota, true);
  assert.deepEqual(exported.layers, telemetry.LAYERS);
});

test('the scanner does not cry wolf on the shapes this payload legitimately contains', () => {
  const payload = telemetry.build(ACCOUNTS, { version: '0.1.0', now: Date.UTC(2026, 8, 18, 13, 0, 0) });
  const found = redaction.findSecrets(payload, { forbidden: [] });
  // A UUID is 36 characters and an ISO timestamp 24: neither may trip the opaque-token heuristic, or every
  // honest payload would be reported as leaking and the check would be ignored.
  assert.deepEqual(found, [], JSON.stringify(found));
  assert.equal(redaction.findSecrets({ when: '2026-09-18T13:00:00.000Z' }).length, 0);
  assert.equal(redaction.findSecrets({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }).length, 0);
  assert.equal(redaction.findSecrets({ version: '0.1.0' }).length, 0);
});

test('a route credential is a secret shape, in both forms a provider hands out', () => {
  // The scanner could already catch an address, a path and a token. It could not catch a *credential*, which is
  // what a route with authentication carries and what the run report is screened for — and a domain-hosted route
  // (`user:pass@proxy.example.com:8080`) carried no shape the scanner knew, so it would have crossed unseen.
  const credential = 'user:password@proxy.example.com:8080';
  const providerLine = 'proxy.example.com:8080:user:password';
  for (const spec of [credential, providerLine]) {
    const found = redaction.findSecrets({ route: spec });
    assert.deepEqual(
      found.map(item => item.kind),
      ['credential'],
      `${spec} must be caught by the credential shape`
    );
    // Caught *and* removable: the cleaner is built from the same declaration, so the two cannot drift.
    assert.match(redaction.stripSecretShapes(`route ${spec} failed`), /\[redacted:credential\]/);
  }
});

test('a route target without credentials is not a secret, and neither is an ordinary clock reading', () => {
  // The other half of the same decision. A bare `host:port` is a target the operator typed; flagging it would
  // make the scan noisy, and a scan that fires on an ordinary payload is a scan that gets switched off.
  for (const innocent of ['proxy.example.com:8080', 'http://proxy.example.com', '12:30:45', '0.1.0']) {
    assert.deepEqual(redaction.findSecrets({ route: innocent }), [], `${innocent} must not be reported`);
  }
  // Recorded rather than hidden: a clock reading with seconds *and* hundredths is four colon-separated groups,
  // which the older IPv6 heuristic reads as an address. It predates the credential shape, it errs towards
  // refusing rather than towards leaking, and it was left alone deliberately — tightening the IPv6 shape enough
  // to stop it would weaken the shape that catches a real address.
  assert.deepEqual(
    redaction.findSecrets({ at: '12:30:45:00' }).map(item => item.kind),
    ['ipv6'],
    'a known, recorded floor: the scan refuses rather than passing something it cannot read'
  );
});

test('every declared layer says what it may contain', () => {
  for (const layer of telemetry.LAYERS) {
    assert.notEqual(telemetry.describeLayer(layer), 'not a declared layer', `${layer} is declared but undescribed`);
  }
  assert.match(telemetry.describeLayer('export'), /only layer that may leave the machine/);
  assert.equal(telemetry.describeLayer('nope'), 'not a declared layer');
});

test('nothing here throws, whatever it is handed', () => {
  const junk = [undefined, null, 0, 'x', [], {}, [null], [3], [{ id: 5 }], { sessions: 'x' }];
  for (const value of junk) {
    assert.doesNotThrow(() => telemetry.summarise(/** @type {any} */ (value)));
    assert.doesNotThrow(() => telemetry.sessionLayer(/** @type {any} */ (value)));
    assert.doesNotThrow(() => telemetry.storageLayer(/** @type {any} */ (value)));
    assert.doesNotThrow(() => telemetry.build(/** @type {any} */ (value)));
    assert.doesNotThrow(() => redaction.exportLayer(/** @type {any} */ (value)));
    assert.doesNotThrow(() => redaction.findSecrets(value));
    assert.doesNotThrow(() => redaction.scalars(value));
  }
  assert.deepEqual(redaction.exportLayer(null).sessions, []);
  assert.deepEqual(redaction.findSecrets(null, { forbidden: ['x'] }), []);
});
