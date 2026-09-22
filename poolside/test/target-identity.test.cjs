// Applying the target half of an identity: what happens when the browser refuses one of the values.
//
// Reported by the operator: they added identity values (language, time zone), a session then behaved as though
// it had not loaded, and nothing said which control to clear. A refused value must not take the rest of the
// identity with it, and it must be reported by the field it belongs to.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { applyTargetFootprint } = require('../src/target-identity.cjs');
const { resolveIdentity } = require('../src/identity.cjs');

const IDENTITY = {
  userAgent: 'PoolsideFixture/1.0',
  acceptLanguages: 'en-GB,en',
  locale: 'en-GB',
  timezone: 'Europe/London',
  viewport: { width: 800, height: 600 },
  colorScheme: 'dark'
};

/**
 * A stand-in for a window whose debugger answers every command except the ones named.
 * @param {string[]} [refuse]
 */
function fakeTarget(refuse = []) {
  const sent = [];
  const refused = [];
  const webContents = /** @type {any} */ (new EventEmitter());
  webContents.getURL = () => 'https://example.test/';
  webContents.isDestroyed = () => false;
  webContents.debugger = {
    isAttached: () => true,
    attach() {},
    sendCommand: async (method, params) => {
      sent.push({ method, params });
      if (refuse.includes(method)) {
        refused.push(method);
        throw new Error(`CDP refused ${method}`);
      }
      return {};
    }
  };
  return { webContents, sent, refused };
}

const log = () => {};

test('every configured override is applied and named by its field', async () => {
  const { identity } = resolveIdentity({ identity: IDENTITY }, {});
  const target = fakeTarget();
  const result = /** @type {any} */ (await applyTargetFootprint(target.webContents, { identity }, log));
  assert.deepEqual(result.applied, ['User agent', 'Language (locale)', 'Time zone', 'Window size', 'Colour scheme']);
  assert.deepEqual(result.refused, []);
  assert.equal(result.attached, true);
  assert.equal(target.sent.length, 5);
});

test('a refused value names its field, and the rest of the identity still applies', async () => {
  const { identity } = resolveIdentity({ identity: IDENTITY }, {});
  const messages = [];
  const target = fakeTarget(['Emulation.setTimezoneOverride']);
  const result = /** @type {any} */ (
    await applyTargetFootprint(target.webContents, { identity }, (message, kind) => messages.push({ message, kind }))
  );
  assert.equal(result.attached, true, 'the session still opens');
  assert.deepEqual(result.refused, [{ field: 'Time zone', value: 'Europe/London', error: 'CDP refused Emulation.setTimezoneOverride' }]);
  // Everything else landed: one bad field must not cost the operator the other four.
  assert.deepEqual(result.applied, ['User agent', 'Language (locale)', 'Window size', 'Colour scheme']);
  const warning = messages.find(entry => entry.kind === 'warning');
  assert.ok(warning, 'the refusal is reported as a warning');
  assert.match(
    warning.message,
    /^Time zone "Europe\/London" was refused by the browser \(CDP refused Emulation\.setTimezoneOverride\)\. The rest of this session's identity still applies; clear or correct that field in Settings, or in this account's preferences\.$/
  );
  assert.equal(result.error, undefined, 'a refused field is not a failed footprint');
});

test('a window that is gone before its overrides is reported without pretending they applied', async () => {
  const { identity } = resolveIdentity({ identity: IDENTITY }, {});
  const webContents = fakeTarget().webContents;
  webContents.isDestroyed = () => true;
  const result = /** @type {any} */ (await applyTargetFootprint(webContents, { identity }, log));
  assert.deepEqual(result.applied, []);
  assert.match(result.error, /the window closed before its overrides were applied/);
});

test('an identity with nothing target-level to apply attaches no debugger', async () => {
  const { identity } = resolveIdentity({ identity: { quotaBytes: 4096 } }, {});
  const webContents = fakeTarget().webContents;
  const result = /** @type {any} */ (await applyTargetFootprint(webContents, { identity }, log));
  assert.deepEqual(result.applied, []);
  assert.equal(result.attached, false);
  assert.match(result.skipped, /no target-level overrides configured/);
});
