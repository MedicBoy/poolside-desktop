// The settings form's backend: one command in, one safe state out.
//
// A settings panel submits *strings from controls*, and those strings have to become a stored configuration
// without ever storing something the rest of the app cannot execute. Two layers do that, and only two:
//
//   `settings-form-mapper.cjs`   decides what the form *shows* — the controls, their labels and their bounds
//   `settings-form-values.cjs`   decides what a submitted string *is* — a number, a boolean, a listed value
//   `config-validator.cjs`       decides whether that value is *acceptable*, using the field's own grammar
//
// This module does the part neither of them can: it assembles the candidate document, and it decides what a
// refusal *means* to somebody looking at a form.
//
// That last point is the decision worth recording. `config-validator` follows ADR-0014: a grammar refusal is
// `dropped`, not fatal, because on the corruption boundary (reading a document a human did not just type) a
// mistyped time zone must never keep you out of your own account. A **form** is the opposite situation: the user
// is looking at the field, having just typed into it, and "saved, but your route was ignored" is a lie. So a
// `dropped` problem on a field this command submitted is promoted to an error and the save is refused. A
// `dropped` problem on a field the user did *not* touch keeps ADR-0014's meaning exactly: the stored value is
// left out and reported as ignored.
//
// The candidate is **merged first and validated second**, because requiredness is a property of the whole
// document: a patch that carries one field cannot be judged on its own (`table` and `limit` are required, and a
// command that only changes a time zone must not be refused for not repeating them).
//
// Nothing here throws. This runs on a keystroke's worth of user input, and a form that dies is a form that loses
// what somebody typed.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

const validator = require('./config-validator.cjs');
const mapper = require('./settings-form-mapper.cjs');
const values = require('./settings-form-values.cjs');
const walk = require('./config-walk.cjs');

/** @typedef {{path: string, message: string}} FieldProblem */
/** @typedef {{ok: boolean, errors: FieldProblem[], ignored: FieldProblem[], value: Record<string, any>|null, form: any}} Outcome */

/** The form for a section, including the current values. Returns null for a name that is not a form section. */
/** @param {string} name @param {unknown} current */
function form(name, current) {
  return mapper.buildForm(name, current);
}

/**
 * Merge a nested patch over the current document, one level deep inside a section.
 *
 * One level is deliberate: `identity` and `proxy` are flat sections, so a deeper merge would be code that
 * unwittingly supports nesting the schema does not have.
 * @param {Record<string, any>} current @param {Record<string, any>} patch
 */
function merge(current, patch) {
  const base = /** @type {Record<string, any>} */ (walk.isPlainObject(current) ? { ...current } : {});
  for (const [key, value] of Object.entries(patch || {})) {
    base[key] = walk.isPlainObject(value) && walk.isPlainObject(base[key]) ? { ...base[key], ...value } : value;
  }
  return base;
}

/** The form path for a problem the validator reported: `settings.identity.timezone` → `identity.timezone`. */
/** @param {string} path @param {string} prefix */
function toFormPath(path, prefix) {
  const text = String(path || '');
  if (text === prefix) return '';
  return text.startsWith(`${prefix}.`) ? text.slice(prefix.length + 1) : text;
}

/** Does a problem on `path` concern something this command submitted? A parent counts for a touched child. */
/** @param {Set<string>} touched @param {string} path */
function affects(touched, path) {
  if (touched.has(path)) return true;
  for (const item of touched) if (path && item.startsWith(`${path}.`)) return true;
  return false;
}

/** A refusal, always carrying the form so a caller can re-render with the current values and the errors. */
/** @param {FieldProblem[]} errors @param {FieldProblem[]} ignored @param {string} name @param {unknown} current @returns {Outcome} */
function refuse(errors, ignored, name, current) {
  return { ok: false, errors, ignored, value: null, form: form(name, current) };
}

/**
 * Run one edit command.
 *
 * `values` is what the form's controls hold, keyed by dotted path; a blank control is omitted by the reader, so
 * a command carries only what was edited. `clear` is the explicit request to remove fields, and `reset` returns
 * a section to its declared defaults (settings) or to nothing at all (account overrides).
 * @param {{section?: string, current?: unknown, values?: unknown, clear?: unknown, reset?: unknown}} [command]
 * @returns {Outcome}
 */
function route(command) {
  const source = /** @type {Record<string, any>} */ (walk.isPlainObject(command) ? command : {});
  const name = typeof source.section === 'string' && source.section ? source.section : 'settings';
  const target = mapper.FORM_SECTIONS[name];
  const current = walk.isPlainObject(source.current) ? source.current : {};
  if (!target) return refuse([{ path: '', message: `"${name}" is not a form section.` }], [], 'settings', current);

  const reset = source.reset === true;
  const read = reset ? { values: {}, errors: [], touched: /** @type {string[]} */ ([]) } : values.readForm(name, source.values);
  if (read.errors.length) return refuse(read.errors, [], name, current);

  const cleared = reset ? ['identity', 'proxy'] : Array.isArray(source.clear) ? source.clear.map(String) : [];
  const base = reset && name === 'settings' ? values.nest(validator.applySettingsDefaults({})) : current;
  const candidate = values.unset(merge(base, values.nest(read.values)), cleared);

  const checked = name === 'account' ? validator.validateAccountConfig(candidate) : validator.validateSettings(candidate);
  const touched = new Set(read.touched);
  /** @type {FieldProblem[]} */
  const errors = checked.errors.map(problem => ({ path: toFormPath(problem.path, target.prefix), message: problem.message }));
  /** @type {FieldProblem[]} */
  const ignored = [];
  for (const problem of checked.dropped) {
    const path = toFormPath(problem.path, target.prefix);
    // Promoted when the user submitted it; left as a drop when they did not (ADR-0014 keeps its meaning there).
    if (affects(touched, path)) errors.push({ path, message: problem.message });
    else ignored.push({ path, message: problem.message });
  }

  if (!checked.ok || errors.length) return refuse(errors, ignored, name, current);
  // The validated value, not the submitted one: what is stored is what the rest of the app has checked.
  return { ok: true, errors: [], ignored, value: checked.value, form: form(name, checked.value) };
}

/** One line for a log or a toast, or null when there is nothing to say. */
/** @param {Outcome} outcome */
function describe(outcome) {
  const parts = [...(outcome.errors || []), ...(outcome.ignored || [])].map(item => `${item.path || 'the form'} ${item.message}`);
  return parts.length ? parts.join('; ') : null;
}

module.exports = { route, form, merge, toFormPath, affects, describe };
