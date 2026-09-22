// One list for everything that needs the operator's attention. Every rule here is a fact the snapshot already
// holds; the list exists because the panel holding that fact was often not the one being looked at.

const test = require('node:test');
const assert = require('node:assert/strict');
const attention = require('../src/attention.cjs');

const account = overrides => ({
  id: 'a',
  name: 'Newfie',
  status: 'ready',
  statusReason: null,
  footprint: null,
  profile: null,
  screenAttention: null,
  ...overrides
});

test('an account with nothing wrong contributes nothing', () => {
  assert.deepEqual(attention.items({ accounts: [account({})] }), []);
  assert.equal(attention.summary([]), 'Nothing needs your attention.');
});

test('a session that failed to load says so, with what to do about it', () => {
  const list = attention.items({ accounts: [account({ status: 'failed', statusReason: 'Configuration refused: timezone' })] });
  assert.equal(list.length, 1);
  assert.equal(list[0].code, 'session-failed');
  assert.equal(list[0].level, 'warning');
  assert.equal(list[0].title, 'Newfie did not load');
  assert.equal(list[0].detail, 'Configuration refused: timezone');
  assert.match(list[0].action, /Open Newfie again, and check the address it is set to leave by\./);
});

test('an identity value the browser refused is named, and so is the control that fixes it', () => {
  const list = attention.items({
    accounts: [
      account({
        footprint: { refused: [{ field: 'Time zone', value: 'Mars/Phobos', error: 'CDP refused it' }] }
      })
    ]
  });
  assert.equal(list[0].code, 'identity-refused');
  assert.equal(list[0].title, 'Newfie: the browser refused a setting');
  assert.match(list[0].detail, /Time zone "Mars\/Phobos" was refused \(CDP refused it\)\./);
  assert.match(list[0].action, /Clear or correct Time zone in Settings, or in Newfie's account preferences\./);
});

test('a route that is not in use, a storage ceiling and a screen worth looking at are all listed', () => {
  const list = attention.items({
    accounts: [
      account({
        footprint: { verified: { ok: true, matches: false, route: { label: 'Proxy 127.0.0.1:9' } } },
        profile: { overQuota: true },
        screenAttention: { message: 'The screen has not changed in ten minutes.' }
      })
    ]
  });
  assert.deepEqual(
    list.map(entry => [entry.code, entry.level]),
    [
      ['route-not-in-use', 'warning'],
      ['storage-over-ceiling', 'info'],
      ['screen-attention', 'info']
    ]
  );
  assert.match(list[0].detail, /The session reports Proxy 127\.0\.0\.1:9 instead\./);
});

test('a workspace that cannot be saved outranks everything else', () => {
  const list = attention.items({ accounts: [account({ status: 'failed', statusReason: 'no' })], readOnly: true });
  assert.equal(list[0].code, 'workspace-read-only');
  assert.equal(list[0].level, 'warning');
  assert.match(list[0].action, /Settings → Recover earlier data/);
  assert.equal(list[1].code, 'session-failed');
});

test('a match in progress with nothing open is listed, because it locks the accounts out', () => {
  const list = attention.items({
    accounts: [],
    matches: {
      active: [
        {
          handle: 'm5',
          participants: [
            { name: 'Newfie', open: false },
            { name: 'Gmail', open: false }
          ]
        },
        {
          handle: 'm6',
          participants: [
            { name: 'Newfie', open: true },
            { name: 'Gmail', open: false }
          ]
        }
      ]
    }
  });
  assert.equal(list.length, 1, 'only the match with no window at all is a problem');
  assert.equal(list[0].code, 'match-without-session');
  assert.equal(list[0].title, 'm5 is in progress with nothing open');
  assert.match(list[0].detail, /Newfie and Gmail have no window, so that match cannot be played\./);
  assert.match(list[0].action, /Cancel m5 on the match card to free the accounts/);
});

test('the summary counts what has to be fixed separately from what is worth a look', () => {
  assert.equal(attention.summary([{ level: 'warning' }, { level: 'info' }]), '1 thing to fix · 1 to look at');
  assert.equal(attention.summary([{ level: 'info' }, { level: 'info' }]), '2 to look at');
  assert.equal(attention.summary([{ level: 'warning' }]), '1 thing to fix');
});

test('an account with a status reason but no failure is not a problem on its own', () => {
  assert.deepEqual(attention.items({ accounts: [account({ status: 'ready', statusReason: 'Signed in' })] }), []);
});
