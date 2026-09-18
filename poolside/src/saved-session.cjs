// On-disk persistence for one account's carry-over session cookies.
//
// This module owns the *file*: where it lives, how it is serialised, and how it is restored. What
// belongs in it is decided by session-cookies.cjs, and the plist format by plist.cjs.
//
// AUTHORITY (ADR-004): the Chromium profile (`persist:poolside-<id>`) owns every cookie and all site
// storage. This file only carries the session cookies Chromium drops on close. It must never grow
// into a second copy of the profile — that was defect D3.
//
// This module must stay free of an `electron` import. `safeStorage` is injected, which is what makes
// it unit testable (see test/saved-session.test.cjs) and is enforced by test/architecture.test.cjs.

const fs = require('node:fs');
const path = require('node:path');
const { buildDocument, readEncryptedPayload } = require('./plist.cjs');
const {
  buildPayload,
  parsePayload,
  selectCarryOverCookies,
  normaliseStoredCookie,
  PAYLOAD_VERSION,
  SCOPE
} = require('./session-cookies.cjs');

const FORMAT = 'Poolside Windows Session v2';
const IDENTIFIER = /^[a-f0-9-]{36}$/i;

/**
 * @param {string} id
 * @returns {string}
 */
function partition(id) {
  return `persist:poolside-${id}`;
}

/**
 * @param {string} root
 * @param {string} id
 * @returns {string}
 */
function fileFor(root, id) {
  if (!IDENTIFIER.test(id)) throw new Error('Invalid session identifier.');
  return path.join(root, 'accounts', `${id}.plist`);
}

/**
 * Persist one account's carry-over cookies, then make the profile's own store durable.
 * @param {string} root
 * @param {import('./types.cjs').Account} account
 * @param {import('electron').Session} browserSession
 * @param {any} crypto safeStorage
 */
async function saveSession(root, account, browserSession, crypto) {
  if (!crypto.isEncryptionAvailable()) throw new Error('Windows session encryption is unavailable.');
  const payload = buildPayload(account.id, await browserSession.cookies.get({}));
  const secret = crypto.encryptString(JSON.stringify(payload)).toString('base64');
  const xml = buildDocument({
    format: FORMAT,
    scope: SCOPE,
    accountId: account.id,
    name: account.name,
    role: account.role,
    browserProfile: partition(account.id),
    cookieCount: payload.cookies.length,
    savedAt: payload.savedAt,
    secret
  });
  const file = fileFor(root, account.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', xml, { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  // These two calls are what make the PROFILE authoritative: they commit the persistent cookies and
  // site storage that this file deliberately does not carry.
  await browserSession.cookies.flushStore();
  browserSession.flushStorageData();
}

/**
 * Reinstate carry-over cookies that a browser restart dropped. Never overwrites a cookie the profile
 * already has, so a rotated value always wins over this snapshot.
 * @param {string} root
 * @param {import('./types.cjs').Account} account
 * @param {import('electron').Session} browserSession
 * @param {any} crypto safeStorage
 */
async function restoreSession(root, account, browserSession, crypto) {
  const file = fileFor(root, account.id);
  if (!fs.existsSync(file)) return;
  try {
    const xml = fs.readFileSync(file, 'utf8');
    const encoded = readEncryptedPayload(xml);
    if (!encoded) throw new Error('no payload');
    const saved = parsePayload(JSON.parse(crypto.decryptString(Buffer.from(encoded, 'base64'))), account.id);
    const current = await browserSession.cookies.get({});
    for (const c of saved) {
      if (current.some(x => x.name === c.name && x.domain === c.domain && x.path === c.path)) continue;
      const cookie = {
        url: `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`,
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite
      };
      if (!c.hostOnly) cookie.domain = c.domain;
      await browserSession.cookies.set(cookie);
    }
  } catch (error) {
    throw new Error(
      `Saved session could not be restored. Its plist has been preserved (${error instanceof Error ? error.message : String(error)}).`
    );
  }
}

module.exports = {
  partition,
  fileFor,
  saveSession,
  restoreSession,
  selectCarryOverCookies,
  normaliseStoredCookie,
  buildPayload,
  parsePayload,
  PAYLOAD_VERSION,
  SCOPE,
  FORMAT
};
