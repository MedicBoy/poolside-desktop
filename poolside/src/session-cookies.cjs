// Cookie policy: which cookies this application is willing to carry between runs, and the shape of
// the payload it writes.
//
// AUTHORITY (ADR-004): the Chromium profile (`persist:poolside-<id>`) owns every cookie and all
// site storage. This policy exists for exactly one reason — Chromium drops *session* cookies
// (cookies with no expiry) when the browser closes, and the game's login state can depend on them.
//
// It deliberately does NOT mirror the persistent cookies the profile already stores. That was
// defect D3: two copies of the same secrets on disk, and a restore path that could resurrect
// cookies the game had already rotated or revoked.
//
// Pure module: no filesystem, no Electron, no crypto. Enforced by test/architecture.test.cjs.

/** Bumped when the stored payload changes shape. v1 stored the whole cookie jar. */
const PAYLOAD_VERSION = 2;
const SCOPE = 'session-cookies';
const SAME_SITE_VALUES = ['unspecified', 'no_restriction', 'lax', 'strict'];

/**
 * A cookie as Chromium hands it to us, or as a fixture hands us one. Deliberately loose: the whole
 * job of this policy is to validate untrusted input, so nothing here may assume a shape.
 * @typedef {{session?: boolean, name?: string, value?: string, domain?: string, path?: string, secure?: boolean, httpOnly?: boolean, sameSite?: string, hostOnly?: boolean, expirationDate?: number}} InputCookie
 */

/**
 * The normalised shape written to disk. There is no `session` field, because membership of this
 * list *is* the claim that the cookie is a session cookie — so reading a stored payload back must
 * never look for that flag. It did once, and silently restored nothing.
 * @typedef {object} StoredCookie
 * @property {string} name
 * @property {string} value
 * @property {string} domain
 * @property {string} path
 * @property {boolean} secure
 * @property {boolean} httpOnly
 * @property {'unspecified'|'no_restriction'|'lax'|'strict'} sameSite
 * @property {boolean} hostOnly
 */

/**
 * @param {unknown} value
 * @returns {'unspecified'|'no_restriction'|'lax'|'strict'}
 */
function normaliseSameSite(value) {
  return SAME_SITE_VALUES.includes(String(value)) ? /** @type {any} */ (value) : 'unspecified';
}

/**
 * Coerce one cookie into the stored shape, or reject it.
 * @param {InputCookie} cookie
 * @returns {StoredCookie|null}
 */
function normaliseStoredCookie(cookie) {
  if (!cookie || typeof cookie !== 'object') return null;
  if (typeof cookie.name !== 'string' || cookie.name.length === 0) return null;
  if (typeof cookie.value !== 'string') return null;
  if (typeof cookie.domain !== 'string' || cookie.domain.length === 0) return null;
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: typeof cookie.path === 'string' && cookie.path ? cookie.path : '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: normaliseSameSite(cookie.sameSite),
    hostOnly: cookie.hostOnly === true
  };
}

/**
 * The only cookies this policy is responsible for: the ones Chromium will not keep.
 * @param {any} cookies live cookies from Chromium, unvalidated
 * @returns {StoredCookie[]}
 */
function selectCarryOverCookies(cookies) {
  if (!Array.isArray(cookies)) return [];
  return /** @type {StoredCookie[]} */ (
    cookies
      .filter(cookie => cookie && cookie.session === true)
      .map(normaliseStoredCookie)
      .filter(cookie => cookie !== null)
  );
}

/**
 * @param {string} accountId
 * @param {any[]} cookies live cookies from Chromium
 */
function buildPayload(accountId, cookies) {
  return {
    version: PAYLOAD_VERSION,
    scope: SCOPE,
    accountId,
    savedAt: new Date().toISOString(),
    cookies: selectCarryOverCookies(cookies)
  };
}

/**
 * Validate a decrypted payload and return its carry-over cookies.
 *
 * A v1 file (whole cookie jar) is accepted and narrowed rather than rejected, so upgrading never
 * signs the user out; the next save rewrites it as v2 and the file shrinks. A v2 file is taken at
 * face value — its cookies are already carry-over cookies and are only re-normalised.
 * @param {any} value
 * @param {string} accountId
 * @returns {StoredCookie[]}
 */
function parsePayload(value, accountId) {
  if (!value || typeof value !== 'object') throw new Error('unsupported payload');
  if (value.version !== 1 && value.version !== PAYLOAD_VERSION) throw new Error('unsupported payload version');
  if (value.accountId !== accountId) throw new Error('payload belongs to another account');
  const cookies = Array.isArray(value.cookies) ? value.cookies : [];
  const narrowed = value.version === 1 ? cookies.filter(cookie => cookie && cookie.session === true) : cookies;
  return /** @type {StoredCookie[]} */ (narrowed.map(normaliseStoredCookie).filter(cookie => cookie !== null));
}

module.exports = {
  normaliseSameSite,
  normaliseStoredCookie,
  selectCarryOverCookies,
  buildPayload,
  parsePayload,
  PAYLOAD_VERSION,
  SCOPE
};
