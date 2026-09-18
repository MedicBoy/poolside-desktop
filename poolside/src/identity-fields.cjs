// The identity field grammar: which values are usable, and what a usable value looks like.
//
// Split from identity.cjs so "what may this field contain" is a separate question from "what does this
// identity resolve to". Validation is per-field and total: every field is either usable or dropped with
// a reason, and nothing here throws — a mistyped time zone must never be able to stop a session opening.
//
// Pure module: no Electron, no fs. Enforced by test/architecture.test.cjs.

const COLOR_SCHEMES = ['light', 'dark'];
const VIEWPORT_MIN_WIDTH = 320;
const VIEWPORT_MIN_HEIGHT = 240;
const VIEWPORT_MAX_WIDTH = 7680;
const VIEWPORT_MAX_HEIGHT = 4320;
const MAX_USER_AGENT = 512;

const IDENTITY_FIELDS = ['userAgent', 'acceptLanguages', 'locale', 'timezone', 'viewport', 'colorScheme', 'quotaBytes'];

/** @param {string} value */
function isValidTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} value */
function isValidLocale(value) {
  try {
    return Intl.getCanonicalLocales(value).length > 0;
  } catch {
    return false;
  }
}

/** @param {string} value */
function isValidAcceptLanguages(value) {
  return value
    .split(',')
    .map(part => part.trim().split(';')[0].trim())
    .every(part => part.length > 0 && isValidLocale(part));
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The shape a fully unconfigured identity has: every field explicitly null. */
function emptyIdentity() {
  return {
    userAgent: /** @type {string|null} */ (null),
    acceptLanguages: /** @type {string|null} */ (null),
    locale: /** @type {string|null} */ (null),
    timezone: /** @type {string|null} */ (null),
    viewport: /** @type {{width: number, height: number}|null} */ (null),
    colorScheme: /** @type {'light'|'dark'|null} */ (null),
    quotaBytes: /** @type {number|null} */ (null)
  };
}

/**
 * Keep only the known identity fields, so an unrelated key in a hand-edited workspace file does not
 * ride along into the resolved config.
 * @param {unknown} input
 */
function pickIdentity(input) {
  if (!isPlainObject(input)) return {};
  const source = /** @type {Record<string, unknown>} */ (input);
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const field of IDENTITY_FIELDS) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  return picked;
}

/**
 * Validate one field in isolation. Returns the usable value, or null with a reason.
 * @param {string} field
 * @param {unknown} value
 * @returns {{ok: true, value: any} | {ok: false, why: string}}
 */
function validateField(field, value) {
  if (field === 'userAgent') {
    if (typeof value !== 'string' || !value.trim()) return { ok: false, why: 'must be a non-empty string' };
    if (value.length > MAX_USER_AGENT) return { ok: false, why: `is longer than ${MAX_USER_AGENT} characters` };
    // A UA carrying a newline would let a config inject an extra header line.
    if (/[\r\n]/.test(value)) return { ok: false, why: 'must not contain a line break' };
    return { ok: true, value: value.trim() };
  }
  if (field === 'acceptLanguages') {
    if (typeof value !== 'string' || !value.trim()) return { ok: false, why: 'must be a non-empty string' };
    if (!isValidAcceptLanguages(value)) return { ok: false, why: 'must be a comma-separated list of language tags' };
    return { ok: true, value: value.trim() };
  }
  if (field === 'locale') {
    if (typeof value !== 'string' || !isValidLocale(value)) return { ok: false, why: 'is not a valid language tag' };
    return { ok: true, value: value.trim() };
  }
  if (field === 'timezone') {
    if (typeof value !== 'string' || !isValidTimezone(value)) return { ok: false, why: 'is not a known IANA time zone' };
    return { ok: true, value: value.trim() };
  }
  if (field === 'colorScheme') {
    if (typeof value !== 'string' || !COLOR_SCHEMES.includes(value))
      return { ok: false, why: `must be one of ${COLOR_SCHEMES.join(', ')}` };
    return { ok: true, value };
  }
  if (field === 'quotaBytes') {
    if (value === null) return { ok: true, value: null };
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
      return { ok: false, why: 'must be a positive whole number of bytes' };
    return { ok: true, value };
  }
  if (field === 'viewport') {
    if (!isPlainObject(value)) return { ok: false, why: 'must be {width, height}' };
    const { width, height } = value;
    if (!Number.isInteger(width) || width < VIEWPORT_MIN_WIDTH || width > VIEWPORT_MAX_WIDTH)
      return { ok: false, why: `width must be a whole number between ${VIEWPORT_MIN_WIDTH} and ${VIEWPORT_MAX_WIDTH}` };
    if (!Number.isInteger(height) || height < VIEWPORT_MIN_HEIGHT || height > VIEWPORT_MAX_HEIGHT)
      return { ok: false, why: `height must be a whole number between ${VIEWPORT_MIN_HEIGHT} and ${VIEWPORT_MAX_HEIGHT}` };
    return { ok: true, value: { width, height } };
  }
  return { ok: false, why: 'is not a known identity field' };
}

module.exports = {
  validateField,
  emptyIdentity,
  pickIdentity,
  isValidTimezone,
  isValidLocale,
  isValidAcceptLanguages,
  isPlainObject,
  IDENTITY_FIELDS,
  COLOR_SCHEMES,
  VIEWPORT_MIN_WIDTH,
  VIEWPORT_MIN_HEIGHT,
  VIEWPORT_MAX_WIDTH,
  VIEWPORT_MAX_HEIGHT,
  MAX_USER_AGENT
};
