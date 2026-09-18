// What may leave the machine.
//
// Split from `dashboard-telemetry.cjs`, which collates what the dashboard *shows*, because the two answer
// different questions. This module answers "may this be written to a file somebody else reads", and that is where
// ADR-0010's rules live: no account names, no addresses, no filesystem paths, no cookie-shaped strings.
//
// The important property is that the export is clean **by construction**, not merely scanned afterwards. A
// payload whose free-text reason happens to contain a path ("failed at C:\Users\…") produced an export with a
// path in it when the projection only copied fields across, and a scanner that finds it later is a scanner that
// has to be believed. So every string is rewritten, and `findSecrets` stays as the backstop that proves it.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

const { LAYERS } = require('./dashboard-telemetry.cjs');

/** Long enough to skip a UUID (36) and an ISO timestamp (24), short enough to catch a cookie or a key. */
const OPAQUE_MIN_LENGTH = 40;

/** @param {unknown} value */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The shapes ADR-0010 forbids in anything exportable.
 *
 * Each shape is declared once as a **pattern source**, and both the detector and the cleaner are built from it, so
 * a shape cannot be caught by one and missed by the other. The pattern is rebuilt per use rather than shared: a
 * `RegExp` with the `g` flag carries `lastIndex` between calls, which makes `.test()` return false on alternate
 * matches — the classic way a scanner quietly stops scanning.
 *
 * `opaque` is a length heuristic, not a proof: it catches the shape of a cookie or a key (40+ characters of
 * `[A-Za-z0-9_-]`) while ignoring a UUID and an ISO timestamp. A scanner can only prove the absence of what it
 * knows to look for, and ADR-0010 says exactly that — so this is a floor, not a guarantee.
 */
const SHAPES = [
  { kind: 'ipv4', source: '\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b' },
  { kind: 'ipv6', source: '\\b(?:[0-9a-f]{0,4}:){3,}[0-9a-f]{0,4}\\b' },
  { kind: 'path', source: '(?:[A-Za-z]:\\\\[^\\s]*|/(?:Users|home|tmp|var)/[^\\s]*)' },
  { kind: 'opaque', source: `\\b[A-Za-z0-9_-]{${OPAQUE_MIN_LENGTH},}\\b` }
];

/** Does this string contain a shape that must not leave the machine? @param {string} value */
function hasSecretShape(value) {
  return SHAPES.some(shape => new RegExp(shape.source, 'i').test(value));
}

/** Replace every shape in a string with a marker that says what was removed. @param {string} value */
function stripSecretShapes(value) {
  let text = String(value);
  for (const shape of SHAPES) text = text.replace(new RegExp(shape.source, 'gi'), `[redacted:${shape.kind}]`);
  return text;
}

/** Every scalar in a payload, with the path it was found at. @param {any} value @param {string} [prefix] @param {any[]} [out] */
function scalars(value, prefix = '', out = []) {
  if (typeof value === 'string' || typeof value === 'number') {
    out.push({ path: prefix || '(root)', value: String(value) });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scalars(item, `${prefix}[${index}]`, out));
    return out;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) scalars(item, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/**
 * Find anything in a payload that must not leave the machine.
 *
 * `forbidden` carries literals that cannot be recognised by shape — account names above all, since a name is
 * ordinary text. Checking uses `split`/`join` rather than a pattern, because a name is user input and can contain
 * any character a regex would treat as syntax.
 *
 * @param {any} payload
 * @param {{forbidden?: string[]}} [options]
 * @returns {{path: string, kind: string, sample: string}[]}
 */
function findSecrets(payload, options = {}) {
  const forbidden = (Array.isArray(options.forbidden) ? options.forbidden : []).filter(name => typeof name === 'string' && name.length > 0);
  /** @type {{path: string, kind: string, sample: string}[]} */
  const found = [];
  for (const item of scalars(payload)) {
    const value = item.value;
    for (const name of forbidden) {
      if (value.includes(name)) found.push({ path: item.path, kind: 'account-name', sample: name });
    }
    for (const shape of SHAPES) {
      if (new RegExp(shape.source, 'i').test(value)) found.push({ path: item.path, kind: shape.kind, sample: value.slice(0, 24) });
    }
  }
  return found;
}

/**
 * The anonymised projection: what a diagnostics payload is allowed to contain.
 *
 * Every string is rewritten — account names become their reference, forbidden shapes become `[redacted:<kind>]` —
 * while the useful part survives: `'Main failed at C:\Users\…'` becomes `'account 1 failed at [redacted:path]'`.
 * The profile's filesystem `path` is dropped entirely rather than cleaned, because it embeds the Windows user
 * name and nothing needs it.
 *
 * @param {any} payload a payload from `dashboard-telemetry.cjs`'s `build`
 */
function exportLayer(payload) {
  const source = isPlainObject(payload) ? payload : {};
  /** @type {Map<string, string>} */
  const refs = new Map();
  /** @type {Map<string, string>} */
  const names = new Map();
  /** @param {unknown} id @returns {string} */
  const ref = id => {
    const key = String(id);
    if (!refs.has(key)) refs.set(key, `account ${refs.size + 1}`);
    return /** @type {string} */ (refs.get(key));
  };
  // Sessions first, so references are numbered in the order a reader meets them and the same account keeps the
  // same reference in every layer.
  const sessionsSource = Array.isArray(source.sessions) ? source.sessions : [];
  for (const session of sessionsSource) {
    if (isPlainObject(session) && typeof session.name === 'string' && session.name) names.set(session.name, ref(session.id));
  }

  /** Rewrite one free-text field: names out, forbidden shapes out. */
  const clean = value => {
    if (typeof value !== 'string' || !value) return value === undefined ? null : value;
    let text = value;
    for (const [name, placeholder] of names) text = text.split(name).join(placeholder);
    return stripSecretShapes(text);
  };
  const cleanCrash = crash => (isPlainObject(crash) ? { ...crash, lastFailureReason: clean(crash.lastFailureReason) } : crash || null);

  return {
    generatedAt: source.generatedAt,
    version: clean(source.version),
    summary: source.summary,
    sessions: sessionsSource.map(session => ({
      ref: ref(session.id),
      state: session.state,
      reason: clean(session.reason),
      crash: cleanCrash(session.crash)
    })),
    storage: (Array.isArray(source.storage) ? source.storage : []).map(entry => ({
      ref: ref(entry.id),
      generation: entry.generation,
      established: entry.established,
      directoryBytes: entry.directoryBytes,
      fileCount: entry.fileCount,
      quotaBytes: entry.quotaBytes,
      overQuota: entry.overQuota,
      truncated: entry.truncated,
      unreadable: entry.unreadable,
      corruption: entry.corruption
    })),
    timelineSummary: source.timelineSummary,
    layers: [...LAYERS],
    // Stated in the payload itself, so whoever reads a bundle knows what was done to it.
    redactions: [
      ...(names.size ? ['account names replaced by references'] : []),
      'paths, addresses and token shapes replaced by [redacted:kind]'
    ]
  };
}

module.exports = { exportLayer, findSecrets, hasSecretShape, stripSecretShapes, scalars, SHAPES, OPAQUE_MIN_LENGTH };
