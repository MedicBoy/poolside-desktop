const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveIdentity, cdpOverrides, needsTargetOverrides, describeIdentity } = require('../src/identity.cjs');
const { emptyIdentity, validateField, isValidTimezone, isValidLocale, isValidAcceptLanguages } = require('../src/identity-fields.cjs');

const FULL = {
  userAgent: 'PoolsideTest/1.0 (Windows NT 10.0; Win64; x64)',
  acceptLanguages: 'en-GB,en',
  locale: 'en-GB',
  timezone: 'Europe/London',
  viewport: { width: 1280, height: 720 },
  colorScheme: 'dark',
  quotaBytes: 256 * 1024 * 1024
};

test('nothing configured resolves to a complete, explicitly empty identity', () => {
  const { identity, warnings, configured } = resolveIdentity({}, {});
  assert.deepEqual(identity, emptyIdentity());
  assert.equal(warnings.length, 0);
  assert.equal(configured, false);
  assert.equal(needsTargetOverrides(identity), false);
  assert.equal(describeIdentity(identity), 'not configured');
});

test('an account overrides only the fields it sets and inherits the rest from the workspace default', () => {
  const { identity, warnings } = resolveIdentity({ identity: { timezone: 'Asia/Tokyo' } }, { identity: FULL });
  assert.equal(identity.timezone, 'Asia/Tokyo', 'the account wins');
  assert.equal(identity.locale, 'en-GB', 'the unset field keeps the default');
  assert.equal(identity.userAgent, FULL.userAgent);
  assert.equal(identity.acceptLanguages, 'en-GB,en');
  assert.equal(warnings.length, 0);
});

test('a full identity survives resolution unchanged', () => {
  const { identity, configured } = resolveIdentity({ identity: FULL }, {});
  assert.deepEqual(identity, FULL);
  assert.equal(configured, true);
});

test('an invalid time zone is dropped with a warning instead of being applied', () => {
  const { identity, warnings } = resolveIdentity({ identity: { timezone: 'Mars/Olympus_Mons', locale: 'en-GB' } }, {});
  assert.equal(identity.timezone, null);
  assert.equal(identity.locale, 'en-GB', 'the valid field is unaffected');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Identity timezone ignored/);
  assert.match(warnings[0], /not a known IANA time zone/);
});

test('an invalid locale is dropped, and a region-less one is accepted', () => {
  assert.equal(validateField('locale', 'not a locale!').ok, false);
  assert.equal(isValidLocale('en'), true);
  assert.equal(isValidLocale('en-GB'), true);
  assert.equal(isValidLocale('1223'), false);
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('Not/AZone'), false);
});

test('acceptLanguages must be a comma-separated list of real language tags', () => {
  assert.equal(isValidAcceptLanguages('en-US,fr,de,ko,zh-CN,ja'), true);
  assert.equal(isValidAcceptLanguages('en-GB;q=0.9,en'), true, 'a quality value is not a language');
  assert.equal(validateField('acceptLanguages', 'not a lang!').ok, false);
  assert.equal(validateField('acceptLanguages', 'en-US,,fr').ok, false);
  assert.equal(validateField('acceptLanguages', '').ok, false);
  // A 5-8 letter primary subtag is syntactically valid BCP-47, and Intl is the authority on syntax.
  // Rejecting "english" would mean inventing a rule the browser does not share.
  assert.equal(validateField('acceptLanguages', 'english').ok, true);
});

test('a viewport outside the sane range is refused at both ends', () => {
  assert.equal(validateField('viewport', { width: 1280, height: 720 }).ok, true);
  assert.equal(validateField('viewport', { width: 100, height: 720 }).ok, false);
  assert.equal(validateField('viewport', { width: 1280, height: 9000 }).ok, false);
  assert.equal(validateField('viewport', { width: 1280.5, height: 720 }).ok, false);
  assert.equal(validateField('viewport', [1280, 720]).ok, false);
  const { identity, warnings } = resolveIdentity({ identity: { viewport: { width: 'wide', height: 720 } } }, {});
  assert.equal(identity.viewport, null);
  assert.equal(warnings.length, 1);
});

test('a user agent carrying a line break is refused, because it could inject a header', () => {
  assert.equal(validateField('userAgent', 'Poolside/1.0\r\nX-Injected: 1').ok, false);
  assert.equal(validateField('userAgent', 'Poolside/1.0\nX-Injected: 1').ok, false);
  assert.equal(validateField('userAgent', '').ok, false);
  assert.equal(validateField('userAgent', 'A'.repeat(600)).ok, false, 'over the length ceiling');
  const trimmed = validateField('userAgent', '  Poolside/1.0  ');
  assert.equal(trimmed.ok, true);
  assert.equal(trimmed.ok && trimmed.value, 'Poolside/1.0', 'trimmed');
});

test('colour scheme accepts only the two values the media query understands', () => {
  assert.equal(validateField('colorScheme', 'dark').ok, true);
  assert.equal(validateField('colorScheme', 'light').ok, true);
  assert.equal(validateField('colorScheme', 'high-contrast').ok, false);
});

test('quotaBytes is reported data, so it must be a positive whole number or absent', () => {
  assert.equal(validateField('quotaBytes', 1024).ok, true);
  assert.equal(validateField('quotaBytes', null).ok, true);
  assert.equal(validateField('quotaBytes', -1).ok, false);
  assert.equal(validateField('quotaBytes', 1024.5).ok, false);
});

test('unknown keys in a hand-edited workspace file do not ride along', () => {
  const { identity, warnings } = resolveIdentity({ identity: { ...FULL, evil: 'payload', __proto__: 'x' } }, {});
  assert.equal(Object.hasOwn(identity, 'evil'), false);
  assert.deepEqual(Object.keys(identity).sort(), [
    'acceptLanguages',
    'colorScheme',
    'locale',
    'quotaBytes',
    'timezone',
    'userAgent',
    'viewport'
  ]);
  assert.equal(warnings.length, 0, 'an unrelated key is not a warning, it is simply not identity');
});

test('target overrides are exactly the CDP commands the identity implies', () => {
  const { identity } = resolveIdentity({ identity: FULL }, {});
  assert.deepEqual(cdpOverrides(identity), [
    // The user agent goes through CDP because the session-level acceptLanguages argument does not reach
    // the renderer or the wire in Electron 44.4.1 (measured; see the module header).
    {
      method: 'Emulation.setUserAgentOverride',
      params: { userAgent: FULL.userAgent, acceptLanguage: 'en-GB,en' },
      field: 'User agent',
      value: FULL.userAgent
    },
    { method: 'Emulation.setLocaleOverride', params: { locale: 'en-GB' }, field: 'Language (locale)', value: 'en-GB' },
    { method: 'Emulation.setTimezoneOverride', params: { timezoneId: 'Europe/London' }, field: 'Time zone', value: 'Europe/London' },
    {
      method: 'Emulation.setDeviceMetricsOverride',
      params: { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false },
      field: 'Window size',
      value: '1280×720'
    },
    {
      method: 'Emulation.setEmulatedMedia',
      params: { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'dark' }] },
      field: 'Colour scheme',
      value: 'dark'
    }
  ]);
});

test('a user agent without languages overrides only the user agent', () => {
  const { identity } = resolveIdentity({ identity: { userAgent: 'P/1.0' } }, {});
  assert.deepEqual(cdpOverrides(identity), [
    { method: 'Emulation.setUserAgentOverride', params: { userAgent: 'P/1.0' }, field: 'User agent', value: 'P/1.0' }
  ]);
});

test('a quota ceiling alone needs no debugger attach', () => {
  const { identity } = resolveIdentity({ identity: { quotaBytes: 4096 } }, {});
  assert.deepEqual(cdpOverrides(identity), [], 'the ceiling is measured from the main process, not emulated');
  assert.equal(needsTargetOverrides(identity), false);
});

test('the summary names what is set and stays honest about what is not', () => {
  const { identity } = resolveIdentity({ identity: { timezone: 'Asia/Tokyo', viewport: { width: 800, height: 600 } } }, {});
  assert.equal(describeIdentity(identity), 'Asia/Tokyo · 800×600');
});
