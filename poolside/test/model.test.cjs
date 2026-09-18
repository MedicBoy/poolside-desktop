const test = require('node:test');
const assert = require('node:assert/strict');
const { account, settings, decode } = require('../src/model.cjs');
test('account slots have distinct IDs and prevent ambiguous receiver or duplicate labels', () => {
  const main = account({ name: ' Main ', role: 'receiver' });
  const sender = account({ name: 'Sender', role: 'sender' }, [main]);
  assert.notEqual(main.id, sender.id);
  assert.equal(main.name, 'Main');
  assert.throws(() => account({ name: 'MAIN', role: 'sender' }, [main]));
  assert.throws(() => account({ name: 'Other', role: 'receiver' }, [main]));
  assert.throws(() => account({ name: '', role: 'sender' }));
  assert.throws(() => account({ name: 'Invalid', role: 'unknown' }));
});
test('workspace decoder rejects invalid paths, duplicate IDs, and malformed settings', () => {
  const a = account({ name: 'Main', role: 'receiver' });
  const valid = { version: 1, accounts: [a], settings: { table: 'Bangkok', limit: 10 } };
  assert.deepEqual(decode(valid), valid);
  assert.throws(() => decode({ ...valid, accounts: [{ ...a, id: '../../user' }] }));
  assert.throws(() => decode({ ...valid, accounts: [a, a] }));
  assert.throws(() => settings({ table: 'Bangkok', limit: 0 }));
  assert.throws(() => settings({ table: 'Bangkok', limit: 1.5 }));
  assert.throws(() => settings({ table: 'Unknown', limit: 10 }));
});

// The D3 defect was a decode that silently dropped a field on the way to disk, so the same shape of
// test is owed to every field added afterwards: what comes out of decode must go back in unchanged.
test('identity, route and remembered geometry survive a decode round trip', () => {
  const a = account({ name: 'Main', role: 'receiver' });
  const document = {
    version: 1,
    accounts: [
      {
        ...a,
        identity: { timezone: 'Asia/Tokyo', viewport: { width: 800, height: 600 } },
        proxy: { spec: 'socks5://10.0.0.9:1080', bypass: ['8ballpool.com'] },
        profile: {
          generation: 2,
          established: true,
          firstSeenAt: '2026-09-18T00:00:00.000Z',
          corruption: {
            count: 1,
            lastAt: '2026-09-18T01:00:00.000Z',
            lastReason: 'the file has no encrypted session payload',
            lastAction: 'quarantined'
          }
        }
      }
    ],
    settings: { table: 'Bangkok', limit: 10, identity: { locale: 'en-GB' }, proxy: { enabled: false, spec: '10.0.0.1:8080' } },
    windows: { [a.id]: { x: 10, y: 20, width: 1060, height: 800, maximized: false, displayId: 1, at: '2026-09-18T00:00:00.000Z' } }
  };
  const decoded = decode(document);
  assert.deepEqual(decoded, document, 'a decode must be lossless, or settings vanish on the next save');
  assert.deepEqual(decode(decoded), decoded, 'and idempotent, which is what save() relies on');
});

test('unusable geometry and unknown keys are dropped without costing the workspace', () => {
  const a = account({ name: 'Main', role: 'receiver' });
  const decoded = decode({
    version: 1,
    accounts: [{ ...a, identity: { timezone: 'Asia/Tokyo', junk: true }, proxy: { spec: '10.0.0.1:8080', junk: 1 } }],
    settings: { table: 'Bangkok', limit: 10 },
    windows: {
      [a.id]: { x: 1, y: 2, width: 10, height: 10 },
      'e5b1c1b3-0000-4000-8000-000000000000': { x: 0, y: 0, width: 800, height: 600 }
    }
  });
  assert.deepEqual(decoded.accounts[0].identity, { timezone: 'Asia/Tokyo' }, 'known keys are kept');
  assert.deepEqual(decoded.accounts[0].proxy, { spec: '10.0.0.1:8080' });
  assert.equal(Object.hasOwn(decoded, 'windows'), false, 'an unusable rectangle is dropped, and the account survives');
  assert.equal(decoded.accounts.length, 1);
});
