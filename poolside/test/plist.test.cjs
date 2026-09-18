const { test } = require('node:test');
const assert = require('node:assert/strict');
const plist = require('../src/plist.cjs');

// The document is hand-built, so the escaping and the round trip are worth asserting directly
// rather than only through saved-session.cjs.

const FIELDS = {
  format: 'Poolside Windows Session v2',
  scope: 'session-cookies',
  accountId: '11111111-1111-4111-8111-111111111111',
  name: 'Main',
  role: 'receiver',
  browserProfile: 'persist:poolside-11111111-1111-4111-8111-111111111111',
  cookieCount: 2,
  savedAt: '2026-09-18T00:00:00.000Z',
  secret: 'QUJDRA=='
};

test('a document is well formed and carries every field', () => {
  const xml = plist.buildDocument(FIELDS);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  assert.ok(xml.includes('<plist version="1.0">'));
  assert.ok(xml.trimEnd().endsWith('</plist>'));
  assert.equal(plist.readStringField(xml, 'Scope'), 'session-cookies');
  assert.equal(plist.readStringField(xml, 'AccountID'), FIELDS.accountId);
  assert.equal(plist.readStringField(xml, 'BrowserProfile'), FIELDS.browserProfile);
  assert.ok(xml.includes('<key>CookieCount</key><integer>2</integer>'));
});

test('an account name cannot break out of the document', () => {
  const hostile = 'A </string><key>Injected</key><string>1';
  const xml = plist.buildDocument({ ...FIELDS, name: hostile });
  assert.ok(!xml.includes('<key>Injected</key>'), 'injected markup must be escaped');
  assert.equal(plist.readStringField(xml, 'Name'), 'A &lt;/string&gt;&lt;key&gt;Injected&lt;/key&gt;&lt;string&gt;1');
  assert.equal(plist.readStringField(xml, 'Role'), 'receiver', 'later fields stay intact');
});

test('the payload round-trips, including across line breaks', () => {
  const xml = plist.buildDocument(FIELDS);
  assert.equal(plist.readEncryptedPayload(xml), FIELDS.secret);
  const wrapped = plist.buildDocument({ ...FIELDS, secret: 'QUJD\nREVG\n' });
  assert.equal(plist.readEncryptedPayload(wrapped), 'QUJDREVG', 'whitespace is stripped from base64');
});

test('a document with no payload reads as null rather than throwing', () => {
  assert.equal(plist.readEncryptedPayload('<plist version="1.0"><dict></dict></plist>'), null);
  assert.equal(plist.readEncryptedPayload(''), null);
  assert.equal(plist.readEncryptedPayload(undefined), null);
  assert.equal(plist.readEncryptedPayload(42), null);
});

test('a missing field reads as null, and a key substring is not matched', () => {
  const xml = plist.buildDocument(FIELDS);
  assert.equal(plist.readStringField(xml, 'Absent'), null);
  assert.equal(plist.readStringField(xml, 'ScopeExtra'), null);
  assert.equal(plist.readStringField(undefined, 'Scope'), null);
});

test('escaping covers every entity that could alter the document', () => {
  assert.equal(plist.escapeXml(`<>&"'`), '&lt;&gt;&amp;&quot;&apos;');
  assert.equal(plist.escapeXml('plain'), 'plain');
  assert.equal(plist.escapeXml(undefined), 'undefined');
});
