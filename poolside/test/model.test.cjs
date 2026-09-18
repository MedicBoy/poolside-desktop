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
