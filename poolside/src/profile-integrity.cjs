// Integrity checking for an account's carry-over file.
//
// The Chromium profile owns every cookie (ADR-0004); this file carries only the session cookies
// Chromium drops. So damage here is recoverable and *narrow*: the profile still has everything that
// mattered, and the worst honest outcome is that the next sign-in is needed. Repair lives in
// profile-repair.cjs and quarantines rather than rebuilds — the file is evidence, and nothing it holds
// is irreplaceable.
//
// What "corruption" means is deliberately specific, because a vague verdict is not actionable. The
// classes detected are, in the order they are checked: unreadable, no payload, wrong account, wrong
// format, undecryptable on this machine, not JSON, unsupported payload version, and a header that
// disagrees with the payload it wraps. A v1 payload is **not** corruption — it is legacy, it is
// narrowed on read (never rejected), and the next save rewrites it as v2.
//
// `crypto` is injected rather than imported, which is what keeps this testable without Electron.
// No Electron import: enforced by test/architecture.test.cjs.

const fs = require('node:fs');
const { readEncryptedPayload, readStringField, readIntegerField } = require('./plist.cjs');
const { parsePayload, PAYLOAD_VERSION, SCOPE } = require('./session-cookies.cjs');
const { carryOverFile } = require('./profile-paths.cjs');
const { messageOf } = require('./errors.cjs');

const FORMAT = 'Poolside Windows Session v2';

/**
 * Severity decides what the dashboard shouts about. A missing file is normal, not a fault; `suspect`
 * means "readable and usable, but something inside it disagrees with itself".
 */
const SEVERITY = { ok: 0, missing: 0, suspect: 1, legacy: 1, unverifiable: 2, corrupt: 3 };

/**
 * An empty verdict, so every return path has the same shape.
 * @param {string} id
 */
function verdict(id) {
  return {
    id,
    state: /** @type {'ok'|'missing'|'suspect'|'legacy'|'unverifiable'|'corrupt'} */ ('ok'),
    severity: 0,
    issues: /** @type {string[]} */ ([]),
    cookies: /** @type {number|null} */ (null),
    payloadVersion: /** @type {number|null} */ (null),
    bytes: /** @type {number|null} */ (null),
    savedAt: /** @type {string|null} */ (null)
  };
}

/** @param {ReturnType<typeof verdict>} result @param {'ok'|'missing'|'suspect'|'legacy'|'unverifiable'|'corrupt'} state @param {string} why */
function fail(result, state, why) {
  result.state = state;
  result.severity = SEVERITY[state];
  result.issues.push(why);
  return result;
}

/**
 * Examine one account's carry-over file without changing anything on disk.
 *
 * @param {string} root the Poolside data directory
 * @param {string} id
 * @param {{isEncryptionAvailable: () => boolean, decryptString: (value: Buffer) => string}} crypto safeStorage
 * @returns {ReturnType<typeof verdict>}
 */
function inspect(root, id, crypto) {
  const result = verdict(id);
  /** @type {string} */
  let file;
  try {
    file = carryOverFile(root, id);
  } catch (error) {
    return fail(result, 'corrupt', `the account record cannot be used to locate a profile (${messageOf(error)})`);
  }

  if (!fs.existsSync(file)) {
    return fail(result, 'missing', 'no carry-over file yet: this session has not been saved');
  }

  /** @type {string} */
  let xml;
  try {
    result.bytes = fs.statSync(file).size;
    xml = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return fail(result, 'corrupt', `the file could not be read (${messageOf(error)})`);
  }

  const headerAccount = readStringField(xml, 'AccountID');
  if (headerAccount && headerAccount !== id) {
    return fail(result, 'corrupt', 'the file names a different account than the one it is stored under');
  }
  const headerFormat = readStringField(xml, 'Format');
  if (headerFormat && headerFormat !== FORMAT) {
    result.issues.push(`the file declares an unfamiliar format (${headerFormat})`);
  }
  const declared = readIntegerField(xml, 'CookieCount');
  const savedAt = readStringField(xml, 'SavedAt');

  const encoded = readEncryptedPayload(xml);
  if (!encoded) return fail(result, 'corrupt', 'the file has no encrypted session payload');

  if (!crypto.isEncryptionAvailable()) {
    return fail(result, 'unverifiable', 'session encryption is unavailable on this machine, so the payload cannot be checked');
  }

  /** @type {any} */
  let payload;
  try {
    payload = JSON.parse(crypto.decryptString(Buffer.from(encoded, 'base64')));
  } catch (error) {
    return fail(result, 'corrupt', `the payload could not be decrypted or is not JSON (${messageOf(error)})`);
  }

  // The version is checked before the payload is parsed, so an unknown version reports itself rather
  // than surfacing as a generic rejection from the parser.
  const version = Number(payload.version);
  if (version !== 1 && version !== PAYLOAD_VERSION) {
    return fail(result, 'corrupt', `the payload declares version ${String(payload.version)}, which this build does not understand`);
  }

  /** @type {any[]} */
  let cookies;
  try {
    cookies = parsePayload(payload, id);
  } catch (error) {
    return fail(result, 'corrupt', `the payload was rejected: ${messageOf(error)}`);
  }

  result.payloadVersion = version;
  result.cookies = cookies.length;
  result.savedAt = typeof payload.savedAt === 'string' ? payload.savedAt : savedAt;
  if (payload.scope !== undefined && payload.scope !== SCOPE) {
    result.issues.push(`the payload declares an unexpected scope (${String(payload.scope)})`);
  }
  // A header that disagrees with the payload it wraps means something truncated or hand-edited the
  // file. The payload is still usable, so this is a warning rather than corruption.
  if (declared !== null && declared !== cookies.length) {
    result.issues.push(`the header claims ${declared} cookies but the payload holds ${cookies.length}`);
  }

  if (version === 1) {
    return fail(result, 'legacy', 'a v1 payload: still valid, narrowed on read, and rewritten as v2 on the next save');
  }
  // Usable, but something inside it disagrees with itself: worth showing, not worth blocking on.
  if (result.issues.length) {
    result.state = 'suspect';
    result.severity = SEVERITY.suspect;
  }
  return result;
}

/** Counts by state, for one log line instead of one per account. */
function summarise(verdicts) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const item of verdicts) counts[item.state] = (counts[item.state] || 0) + 1;
  return counts;
}

module.exports = { inspect, summarise, SEVERITY, FORMAT };
