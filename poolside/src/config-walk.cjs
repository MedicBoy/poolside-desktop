// Walking a declared configuration specification, generically.
//
// The mechanism behind `config-validator.cjs`: given a declaration from `config-schema.cjs` and an input,
// collect every problem and the usable value. The errors-versus-dropped rule is enforced here, once, so no
// entry point can apply a different one:
//
//   errors  — the declared *type* is wrong (an enum value not in the list, an integer out of range, a required
//             field missing). The document's own shape is broken.
//   dropped — the value has the right shape to ignore and the rest is usable. A grammar owned elsewhere
//             refused it (a time zone, a route), or it is a key nothing declares.
//
// Split from the validator so the two questions stay separate: this module knows how to walk a declaration,
// `config-validator.cjs` knows which declarations a session is made of. Pure: no Electron, no fs.

const schema = require('./config-schema.cjs');

/** @typedef {{path: string, message: string}} Problem */
/** @typedef {{ok: boolean, value: Record<string, any>, errors: Problem[], dropped: Problem[]}} Result */

/** @returns {Result} */
function emptyResult() {
  return { ok: true, value: {}, errors: [], dropped: [] };
}

/** @param {string} path @param {string} message @returns {Problem} */
function problem(path, message) {
  return { path, message };
}

/** @param {unknown} value */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate one leaf field against its declaration.
 * @param {import('./config-schema.cjs').FieldSpec} field
 * @param {string} key @param {unknown} value @param {string} path @param {Result} result
 */
function validateValue(field, key, value, path, result) {
  const label = field.label || key;
  if (value === undefined || value === null || value === '') {
    if (field.required) {
      result.ok = false;
      result.errors.push(problem(path, `${label} is required.`));
    }
    return;
  }
  if (field.kind === 'enum') {
    const values = field.values || [];
    if (!values.includes(value)) {
      result.ok = false;
      result.errors.push(problem(path, `${label} must be one of ${values.join(', ')}.`));
      return;
    }
    result.value[key] = value;
    return;
  }
  if (field.kind === 'integer') {
    const min = Number(field.min);
    const max = Number(field.max);
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
      result.ok = false;
      result.errors.push(problem(path, `${label} must be a whole number between ${min} and ${max}.`));
      return;
    }
    result.value[key] = value;
    return;
  }
  if (field.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      result.dropped.push(problem(path, `${label} must be true or false`));
      return;
    }
    result.value[key] = value;
    return;
  }
  const checked = field.check ? field.check(value) : { ok: /** @type {const} */ (false), why: 'has no rule' };
  if (!checked.ok) {
    result.dropped.push(problem(path, `is not usable: ${label} ${checked.why}`));
    return;
  }
  result.value[key] = checked.value;
}

/**
 * Walk a declared object: every declared field first, so a missing required field is caught, then the input's
 * own keys, so an undeclared one is reported rather than dropped in silence.
 * @param {Record<string, import('./config-schema.cjs').FieldSpec>} declared
 * @param {Record<string, unknown>} source @param {string} prefix @param {Result} result
 * @param {boolean} [ignoreUnknown] for a record carrying more than configuration: an account's own fields are
 *   validated by `model.decode`, so reporting them as unknown settings would be noise on every open. A
 *   mistyped configuration key still lives inside `identity`/`proxy`, where this check still runs.
 */
function validateObject(declared, source, prefix, result, ignoreUnknown = false) {
  for (const key of Object.keys(declared)) {
    const field = declared[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (field.kind === 'section') {
      const nested = validateSection(field.section || '', source[key], path);
      if (!nested.ok) result.ok = false;
      result.errors.push(...nested.errors);
      result.dropped.push(...nested.dropped);
      if (Object.keys(nested.value).length) result.value[key] = nested.value;
      continue;
    }
    validateValue(field, key, source[key], path, result);
  }
  if (ignoreUnknown) return;
  for (const key of Object.keys(source)) {
    if (declared[key]) continue;
    result.dropped.push(problem(prefix ? `${prefix}.${key}` : key, 'is not a known setting'));
  }
}

/**
 * Validate a nested section (`identity`, `proxy`).
 * @param {string} name @param {unknown} input @param {string} prefix
 * @returns {Result}
 */
function validateSection(name, input, prefix) {
  const declared = schema.SECTIONS[name];
  const result = emptyResult();
  if (input === undefined || input === null) return result;
  if (!declared) {
    result.ok = false;
    result.errors.push(problem(prefix, 'is not a declared configuration section'));
    return result;
  }
  if (!isPlainObject(input)) {
    // A nested section is optional content, so a malformed one is dropped rather than fatal — which is also
    // what `pickKnown` in model.cjs and the resolvers in identity.cjs/proxy.cjs already do with it. Calling it
    // an error here would make this module a second opinion, which is the thing it exists to prevent.
    result.dropped.push(problem(prefix, 'must be an object'));
    return result;
  }
  validateObject(declared, /** @type {Record<string, unknown>} */ (input), prefix, result);
  return result;
}

/**
 * Fill in declared defaults. Deliberately *not* part of validation: accepting an absent required field and
 * supplying one are different operations, and conflating them would make the validator disagree with
 * `model.settings`, which throws on a missing table. Used by import and by the generated form (M5).
 * @param {Record<string, import('./config-schema.cjs').FieldSpec>} declared @param {unknown} input
 */
function applyDefaults(declared, input) {
  const source = isPlainObject(input) ? /** @type {Record<string, any>} */ (input) : {};
  /** @type {Record<string, any>} */
  const value = { ...source };
  for (const [key, field] of Object.entries(declared)) {
    if (field.kind === 'section') {
      if (source[key] !== undefined) value[key] = applyDefaults(schema.SECTIONS[field.section || ''] || {}, source[key]);
      continue;
    }
    if (value[key] === undefined && field.default !== undefined) value[key] = field.default;
  }
  return value;
}

module.exports = { emptyResult, problem, isPlainObject, validateValue, validateObject, validateSection, applyDefaults };
