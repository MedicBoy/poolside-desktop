// The configuration surface, declared once.
//
// Three modules already own pieces of this: `model.cjs` validates the document's shape, `identity-fields.cjs`
// owns the identity value grammar, and `proxy.cjs` owns route parsing. What none of them owned was a single
// statement of *what exists* — which fields there are, which sections are optional, what a field defaults to.
// That statement lived implicitly in `pickKnown(..., IDENTITY_FIELDS)` call sites, where an unrecognised key
// was dropped in silence.
//
// So this module declares the field lists, the section nesting and the defaults, and delegates every
// individual rule to the module that already implements it. No check is re-implemented here: there is one
// implementation of each rule, and this is the one place that says which rules exist. `test/config.test.cjs`
// holds the two together.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

const { validateField, IDENTITY_FIELDS } = require('./identity-fields.cjs');
const { parseProxySpec, normaliseBypass } = require('./proxy.cjs');

/** The configuration shape's own version, independent of the workspace document version. */
const SCHEMA_VERSION = 1;

const { TABLES } = require('./table-list.cjs');
const { RECOVERY, RECOVERY_FIELDS } = require('./recovery-settings.cjs');

const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 10;

/** Human labels, so an error message and (in M5) a generated form cannot describe a field differently. */
const LABELS = {
  table: 'Preferred table',
  limit: 'Match limit',
  identity: 'Session identity',
  proxy: 'Network location (VPN or proxy)',
  userAgent: 'User agent',
  acceptLanguages: 'Accepted languages',
  locale: 'Locale',
  timezone: 'Time zone',
  viewport: 'Viewport',
  colorScheme: 'Colour scheme',
  quotaBytes: 'Storage ceiling',
  enabled: 'Use this location for every account',
  spec: 'Address your provider gave you',
  bypass: 'Addresses that should skip it',
  recovery: 'Reliability',
  shopReturnDelaySeconds: 'Shop return delay',
  backgroundThrottling: 'Keep background page active',
  repaintMitigation: 'Refresh display after loading'
};

/**
 * One declared field.
 * @typedef {object} FieldSpec
 * @property {'enum'|'integer'|'boolean'|'value'|'section'} kind `section` nests another declared section
 * @property {boolean} [required] must be present in the validated output
 * @property {any} [default] supplies a missing optional field; see `applyDefaults`, which is deliberately a
 *   separate operation from validation
 * @property {string} label
 * @property {any[]} [values] for `kind: 'enum'`
 * @property {number} [min] for `kind: 'integer'`
 * @property {number} [max] for `kind: 'integer'`
 * @property {string} [section] for `kind: 'section'`
 * @property {(value: unknown) => {ok: true, value: any} | {ok: false, why: string}} [check] for `kind: 'value'`
 */

/**
 * Identity fields. Each field's rule is the grammar's own `validateField`, so a field added to
 * `IDENTITY_FIELDS` is declared here automatically and cannot be declared-but-unchecked.
 * @type {Record<string, FieldSpec>}
 */
const IDENTITY = Object.fromEntries(
  IDENTITY_FIELDS.map(field => [
    field,
    {
      kind: /** @type {'value'} */ ('value'),
      label: LABELS[field] || field,
      check: value => validateField(field, value)
    }
  ])
);

/**
 * Route fields. `spec` is checked by the parser that will later apply it, never by a second pattern, and the
 * validated value is the trimmed spec rather than the parser's internal shape — what is stored must be what
 * the user wrote.
 * @type {Record<string, FieldSpec>}
 */
const PROXY = {
  enabled: { kind: /** @type {'boolean'} */ ('boolean'), label: LABELS.enabled, default: false },
  spec: {
    kind: /** @type {'value'} */ ('value'),
    label: LABELS.spec,
    check: value => {
      const parsed = parseProxySpec(value);
      return parsed.ok
        ? { ok: /** @type {const} */ (true), value: String(value).trim() }
        : { ok: /** @type {const} */ (false), why: parsed.error };
    }
  },
  bypass: {
    kind: /** @type {'value'} */ ('value'),
    label: LABELS.bypass,
    check: value => {
      const normalised = normaliseBypass(value);
      return normalised.ok
        ? { ok: /** @type {const} */ (true), value: normalised.value }
        : { ok: /** @type {const} */ (false), why: normalised.error };
    }
  }
};

/** @type {Record<string, Record<string, FieldSpec>>} */
const SECTIONS = { identity: IDENTITY, proxy: PROXY, recovery: RECOVERY };

/**
 * Workspace-wide settings.
 *
 * `table` and `limit` are required and carry no default *in validation*: a settings object with no table is
 * the same defect to this module as it is to `model.settings`, which throws on it. Their defaults exist for
 * `applyDefaults`, because filling in a missing value and accepting an absent one are different operations.
 * @type {Record<string, FieldSpec>}
 */
const SETTINGS = {
  table: {
    kind: /** @type {'enum'} */ ('enum'),
    required: true,
    default: TABLES[0],
    values: [...TABLES],
    label: LABELS.table
  },
  limit: {
    kind: /** @type {'integer'} */ ('integer'),
    required: true,
    default: LIMIT_DEFAULT,
    min: LIMIT_MIN,
    max: LIMIT_MAX,
    label: LABELS.limit
  },
  identity: { kind: /** @type {'section'} */ ('section'), section: 'identity', label: LABELS.identity },
  proxy: { kind: /** @type {'section'} */ ('section'), section: 'proxy', label: LABELS.proxy }
};

/**
 * What an account may override. The same two sections, and nothing else — an account cannot carry a table or
 * a limit, because those are workspace-level by design.
 * @type {Record<string, FieldSpec>}
 */
const ACCOUNT = {
  identity: { kind: /** @type {'section'} */ ('section'), section: 'identity', label: LABELS.identity },
  proxy: { kind: /** @type {'section'} */ ('section'), section: 'proxy', label: LABELS.proxy },
  recovery: { kind: /** @type {'section'} */ ('section'), section: 'recovery', label: LABELS.recovery }
};

/** The declared names of one section, in declaration order. */
/** @param {Record<string, unknown>} section */
function fields(section) {
  return Object.keys(section);
}

/** Everything declared, for a test to compare against the storage structures and for M5's form to bind to. */
function describeSchema() {
  return {
    version: SCHEMA_VERSION,
    settings: fields(SETTINGS),
    account: fields(ACCOUNT),
    identity: fields(IDENTITY),
    proxy: fields(PROXY),
    recovery: [...RECOVERY_FIELDS],
    tables: [...TABLES],
    limit: { min: LIMIT_MIN, max: LIMIT_MAX, default: LIMIT_DEFAULT }
  };
}

module.exports = {
  SCHEMA_VERSION,
  TABLES,
  LIMIT_MIN,
  LIMIT_MAX,
  LIMIT_DEFAULT,
  LABELS,
  SETTINGS,
  ACCOUNT,
  IDENTITY,
  PROXY,
  RECOVERY,
  RECOVERY_FIELDS,
  SECTIONS,
  fields,
  describeSchema
};
