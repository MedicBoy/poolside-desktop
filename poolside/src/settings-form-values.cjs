// The values a form carries: what comes back from the controls.
//
// Split from `settings-form-mapper.cjs`, which decides what the *page shows*; this half decides what a
// submitted string *is*. The two are different jobs and the split is the same one the timeline uses — reading
// and writing have different failure modes, and a form that cannot tell them apart reports the wrong one.
//
// A conversion here is about type and nothing else: the field's own grammar decides acceptability, and
// `config-validator.cjs` is the only place that happens.

const walk = require('./config-walk.cjs');
const { buildForm, specAt } = require('./settings-form-mapper.cjs');

/**
 * Convert one submitted control value into the declared type.
 *
 * A blank control is **not** an instruction to clear a field: it means the user did not touch it, and the field
 * is omitted from the patch so whatever is stored survives. Clearing is an explicit request (`clear` on the
 * controller), because "empty means empty" is how a settings form wipes a route nobody meant to remove.
 * @param {import('./config-schema.cjs').FieldSpec} spec @param {unknown} raw
 * @returns {{value?: any, error?: string, skip?: boolean}}
 */
function convert(spec, raw) {
  // A message names its field: the same string is rendered under the control, in the status line, and in the
  // activity log, and only the first of those has a visible label beside it.
  const label = spec.label || 'This field';
  if (spec.kind === 'boolean') {
    const text = String(raw === undefined || raw === null ? '' : raw)
      .trim()
      .toLowerCase();
    if (text === '') return { skip: true };
    if (['true', 'on', '1', 'yes'].includes(text)) return { value: true };
    if (['false', 'off', '0', 'no'].includes(text)) return { value: false };
    return { error: `${label} must be on or off.` };
  }
  if (spec.kind === 'integer') {
    const text = String(raw === undefined || raw === null ? '' : raw).trim();
    if (text === '') return { skip: true };
    // `Number('1.5')` and `Number('ten')` are both usable answers to a box that asked for a whole number.
    if (!/^-?\d+$/.test(text)) return { error: `${label} must be a whole number.` };
    return { value: Number(text) };
  }
  if (spec.kind === 'enum') {
    const text = String(raw === undefined || raw === null ? '' : raw).trim();
    if (text === '') return { skip: true };
    const allowed = (spec.values || []).map(String);
    if (!allowed.includes(text)) return { error: `${label} must be one of: ${allowed.join(', ')}.` };
    return { value: text };
  }
  const text = String(raw === undefined || raw === null ? '' : raw);
  if (text.trim() === '') return { skip: true };
  return { value: text };
}

/**
 * Read a submitted form into a typed patch, keyed by dotted path.
 * @param {string} name @param {unknown} values
 * @returns {{values: Record<string, any>, errors: {path: string, message: string}[], touched: string[]}}
 */
function readForm(name, values) {
  const form = buildForm(name, {});
  if (!form) return { values: {}, errors: [{ path: '', message: `"${name}" is not a form section.` }], touched: [] };
  const input = /** @type {Record<string, any>} */ (walk.isPlainObject(values) ? values : {});
  /** @type {Record<string, any>} */
  const typed = {};
  /** @type {{path: string, message: string}[]} */
  const errors = [];
  /** @type {string[]} */
  const touched = [];
  for (const path of form.paths) {
    if (!Object.prototype.hasOwnProperty.call(input, path)) continue;
    const spec = specAt(name, path);
    if (!spec) continue;
    const outcome = convert(spec, input[path]);
    if (outcome.skip) continue;
    touched.push(path);
    if (outcome.error) {
      errors.push({ path, message: outcome.error });
      continue;
    }
    typed[path] = outcome.value;
  }
  return { values: typed, errors, touched };
}

/** Turn `{'identity.timezone': 'UTC'}` into `{identity: {timezone: 'UTC'}}` — the shape the schema validates. */
/** @param {Record<string, any>} flat @returns {Record<string, any>} */
function nest(flat) {
  /** @type {Record<string, any>} */
  const target = {};
  for (const [path, value] of Object.entries(flat || {})) {
    const parts = String(path).split('.');
    let cursor = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!walk.isPlainObject(cursor[parts[index]])) cursor[parts[index]] = {};
      cursor = cursor[parts[index]];
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return target;
}

/** Remove the named dotted paths from an object, in place. A whole section is removable by its own name. */
/** @param {Record<string, any>} target @param {string[]} paths */
function unset(target, paths) {
  for (const path of Array.isArray(paths) ? paths : []) {
    const parts = String(path).split('.');
    let cursor = target;
    let missing = false;
    for (let index = 0; index < parts.length - 1; index += 1) {
      cursor = cursor[parts[index]];
      if (!walk.isPlainObject(cursor)) {
        missing = true;
        break;
      }
    }
    if (!missing) delete cursor[parts[parts.length - 1]];
  }
  return target;
}

module.exports = { readForm, convert, nest, unset };
