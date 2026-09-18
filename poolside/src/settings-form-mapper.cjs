// The settings form, derived from the declaration instead of written by hand.
//
// The form this replaces was two hardcoded controls: a `<select>` with the three table names copied into the
// HTML, and a number input. A field added to `config-schema.cjs` therefore appeared nowhere, and the table list
// existed in two places that could disagree. The schema already says what exists, what each field is called and
// what it may contain — `describeSchema` names this form as its reason to exist — so this module turns the
// declaration into controls and turns submitted strings back into typed values.
//
// What it deliberately does **not** own:
//
//   * whether a value is *acceptable* — each field's own grammar decides that, through `config-validator.cjs`
//   * what a value *means* — precedence belongs to `identity.cjs` and `proxy.cjs`, not to a form
//
// So a conversion here is about **type** and nothing else: a number input that says "abc", a select whose value
// is not in its own list. Everything else is passed through untouched, because a second opinion about a route
// spec is how two modules come to disagree (ADR-0014).
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

const schema = require('./config-schema.cjs');
const walk = require('./config-walk.cjs');

/** The sections a form can be built for: the declared fields, the validator's path prefix, and a heading. */
const FORM_SECTIONS = {
  settings: { declared: schema.SETTINGS, prefix: 'settings', label: 'Workspace settings' },
  account: { declared: schema.ACCOUNT, prefix: 'account', label: 'Session overrides' }
};

/** One control per declared kind. `value` fields are text: their grammar, not a form, decides what fits. */
const CONTROL_BY_KIND = { enum: 'select', integer: 'number', boolean: 'checkbox', value: 'text' };

/**
 * The DOM id for a control, derived from the field's dotted path, so the binding cannot drift from the name.
 *
 * The dot becomes an underscore and every *other* run of punctuation becomes a hyphen. A plain
 * "non-alphanumeric becomes a hyphen" would fold `a.b-c` and `a-b.c` onto the same id, and two controls sharing
 * an id is a form that silently edits one field while marking another. No declared field has a dash in it today;
 * this is the difference between a scheme that is safe and one that happens to work.
 */
/** @param {string} path */
function controlId(path) {
  return `f-${String(path)
    .replace(/\./g, '_')
    .replace(/[^a-zA-Z0-9_]+/g, '-')}`;
}

/**
 * Is this stored value a credential that must not be handed to the page as plain text?
 *
 * A presentation rule, not a validation rule: a route spec may be `user:password@host:port`, and a masked
 * control is what stops a settings panel printing it. The descriptor for a masked field carries `value: null`
 * and `hasValue: true`, and because a patch contains only the fields a user actually edited, leaving it alone
 * cannot wipe it — the failure mode masked fields usually have.
 * @param {string} path @param {unknown} value
 */
function isSensitive(path, value) {
  return path.endsWith('spec') && typeof value === 'string' && /\S+:\S+@/.test(value);
}

/**
 * What a control should be given for the current value. `value` stays raw — the renderer decides how to place
 * it (`input.value`, `input.checked`) — and a boolean is presented as a boolean rather than as a string.
 * @param {import('./config-schema.cjs').FieldSpec} spec @param {unknown} value
 */
function presentable(spec, value) {
  if (value === undefined || value === null) return spec.kind === 'boolean' ? Boolean(spec.default) : '';
  if (spec.kind === 'boolean') return value === true;
  return value;
}

/**
 * One control's descriptor.
 * @param {string} path @param {import('./config-schema.cjs').FieldSpec} spec @param {unknown} value
 */
function describeField(path, spec, value) {
  const masked = isSensitive(path, value);
  /** @type {Record<string, any>} */
  const field = {
    path,
    id: controlId(path),
    label: spec.label || path,
    control: CONTROL_BY_KIND[/** @type {'enum'} */ (spec.kind)] || 'text',
    required: spec.required === true,
    value: masked ? null : presentable(spec, value)
  };
  if (spec.kind === 'enum') {
    field.options = (spec.values || []).map(option => ({
      value: String(option),
      selected: String(value) === String(option)
    }));
  }
  if (spec.kind === 'integer') {
    field.min = spec.min === undefined ? null : spec.min;
    field.max = spec.max === undefined ? null : spec.max;
    field.step = 1;
  }
  if (spec.default !== undefined) field.default = spec.default;
  if (masked) {
    field.masked = true;
    field.hasValue = true;
  }
  return field;
}

/** The declared spec for a form path. `identity.timezone` → the identity section's `timezone`. */
/** @param {string} name @param {string} path */
function specAt(name, path) {
  const target = FORM_SECTIONS[name];
  if (!target) return null;
  const parts = String(path).split('.');
  if (parts.length === 1) return target.declared[parts[0]] || null;
  const section = target.declared[parts[0]];
  if (!section || section.kind !== 'section') return null;
  const declared = schema.SECTIONS[/** @type {string} */ (section.section)];
  return declared ? declared[parts.slice(1).join('.')] || null : null;
}

/**
 * The form: groups of controls in declaration order. Scalars come first as one group, then one group per
 * declared section — a section is a group, a field is a control, and both names come from the schema.
 * @param {string} name @param {unknown} current
 */
function buildForm(name, current) {
  const target = FORM_SECTIONS[name];
  if (!target) return null;
  const source = /** @type {Record<string, any>} */ (walk.isPlainObject(current) ? current : {});
  /** @type {any[]} */
  const groups = [];
  /** @type {string[]} */
  const paths = [];
  const entries = Object.entries(target.declared);
  const addGroup = (groupName, label, fields) => {
    groups.push({ name: groupName, label, fields });
    paths.push(...fields.map(field => field.path));
  };
  const scalars = entries.filter(([, spec]) => spec.kind !== 'section');
  if (scalars.length) {
    addGroup(
      '',
      target.label,
      scalars.map(([field, spec]) => describeField(field, spec, source[field]))
    );
  }
  for (const [field, spec] of entries) {
    if (spec.kind !== 'section') continue;
    const declared = schema.SECTIONS[String(spec.section)] || {};
    const values = walk.isPlainObject(source[field]) ? source[field] : {};
    addGroup(
      field,
      spec.label,
      Object.entries(declared).map(([sub, subSpec]) => describeField(`${field}.${sub}`, subSpec, values[sub]))
    );
  }
  return { section: name, prefix: target.prefix, groups, paths };
}

module.exports = {
  buildForm,
  specAt,
  controlId,
  isSensitive,
  describeField,
  FORM_SECTIONS,
  CONTROL_BY_KIND
};
