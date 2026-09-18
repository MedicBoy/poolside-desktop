// The configuration boundary: which declarations a session is made of, and what its problems mean.
//
// `config-walk.cjs` knows how to walk a declaration; this module knows which declarations exist at the
// boundary and composes them. Three entry points, in the order they matter:
//
//   validateSettings       — the workspace settings. An error here is refused before storage.
//   validateAccountConfig  — the configuration an account carries: identity and route overrides.
//   validateSessionProfile — both together: everything a session is about to execute, checked before it runs.
//
// The errors-versus-dropped rule is applied once, in the walk. What this module adds is position: which sections
// exist, what a path looks like (`settings.identity.timezone`), and three deliberate omissions:
//
//   * **No cross-field rules** ("a route is enabled but has no spec"). The resolver already answers that, and
//     answering it twice is how two modules come to disagree (ADR-0014).
//   * **No merging of the two sections.** Precedence belongs to `identity.cjs` and `proxy.cjs`; merging here
//     would silently discard one of two configured identities. It did, until the parity suite caught it.
//   * **Nothing throws.** A validator that throws is one callers wrap in try/catch and stop reading; this one
//     returns its verdict and is safe to call on whatever is on disk.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

const schema = require('./config-schema.cjs');
const walk = require('./config-walk.cjs');

/**
 * Validate workspace settings, reporting on every field rather than stopping at the first.
 * @param {unknown} input
 * @returns {import('./config-walk.cjs').Result}
 */
function validateSettings(input) {
  const result = walk.emptyResult();
  if (input === undefined || input === null) return result;
  if (!walk.isPlainObject(input)) {
    result.ok = false;
    result.errors.push(walk.problem('settings', 'Settings must be an object.'));
    return result;
  }
  walk.validateObject(schema.SETTINGS, /** @type {Record<string, unknown>} */ (input), 'settings', result);
  return result;
}

/**
 * Validate the configuration an account carries: its identity and route overrides, and nothing else.
 * @param {unknown} account
 * @returns {import('./config-walk.cjs').Result}
 */
function validateAccountConfig(account) {
  const result = walk.emptyResult();
  if (account === undefined || account === null) return result;
  if (!walk.isPlainObject(account)) {
    result.ok = false;
    result.errors.push(walk.problem('account', 'must be an object.'));
    return result;
  }
  // `ignoreUnknown`: an account record carries id/name/role/archived too, which model.decode owns.
  walk.validateObject(schema.ACCOUNT, /** @type {Record<string, unknown>} */ (account), 'account', result, true);
  return result;
}

/**
 * The boundary check: everything a session would execute, validated before it is executed.
 *
 * The two sections come back under their own keys.
 * @param {{settings?: unknown, account?: unknown}} [input]
 * @returns {import('./config-walk.cjs').Result}
 */
function validateSessionProfile(input = {}) {
  const result = walk.emptyResult();
  if (input === null || input === undefined) return result;
  if (!walk.isPlainObject(input)) {
    result.ok = false;
    result.errors.push(walk.problem('profile', 'must be an object.'));
    return result;
  }
  const source = /** @type {{settings?: unknown, account?: unknown}} */ (input);
  for (const key of ['settings', 'account']) {
    if (source[key] === undefined) continue;
    const part = key === 'settings' ? validateSettings(source[key]) : validateAccountConfig(source[key]);
    if (!part.ok) result.ok = false;
    result.errors.push(...part.errors);
    result.dropped.push(...part.dropped);
    result.value[key] = part.value;
  }
  return result;
}

/** Settings with declared defaults filled in. See `applyDefaults`: filling in and validating are different. */
/** @param {unknown} input */
function applySettingsDefaults(input) {
  return walk.applyDefaults(schema.SETTINGS, input);
}

/** One line for a log or a toast, or null when there is nothing to say. */
/** @param {import('./config-walk.cjs').Result} result */
function describeProblems(result) {
  const parts = [...result.errors, ...result.dropped].map(item => `${item.path} ${item.message}`);
  return parts.length ? parts.join('; ') : null;
}

module.exports = {
  validateSettings,
  validateAccountConfig,
  validateSessionProfile,
  validateSection: walk.validateSection,
  applySettingsDefaults,
  applyDefaults: walk.applyDefaults,
  describeProblems
};
