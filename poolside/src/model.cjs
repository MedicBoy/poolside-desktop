const { randomUUID } = require('node:crypto');
const { IDENTITY_FIELDS } = require('./identity-fields.cjs');
const { normaliseRemembered } = require('./geometry.cjs');

const TABLES = ['Bangkok', 'Rome', 'Seoul'];
const PROXY_FIELDS = ['enabled', 'spec', 'bypass'];

function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40)
    throw new Error('Use an account name between 1 and 40 characters.');
  return value.trim();
}

function account(input, existing = []) {
  const name = label(input.name);
  if (existing.some(a => a.name.toLowerCase() === name.toLowerCase())) throw new Error('An account with this name already exists.');
  if (!['receiver', 'sender'].includes(input.role)) throw new Error('Choose a valid account role.');
  if (input.role === 'receiver' && existing.some(a => a.role === 'receiver')) throw new Error('There is already a receiving account.');
  return { id: randomUUID(), name, role: input.role, createdAt: new Date().toISOString(), archived: false };
}

/**
 * Keep only known keys, so a hand-edited file cannot smuggle unrelated data into the workspace.
 * Returns `undefined` when nothing is set, which keeps an untouched file byte-for-byte unchanged.
 * @param {unknown} input
 * @param {string[]} fields
 */
function pickKnown(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const source = /** @type {Record<string, unknown>} */ (input);
  /** @type {Record<string, unknown>} */
  const picked = {};
  let any = false;
  for (const field of fields) {
    if (source[field] !== undefined) {
      picked[field] = source[field];
      any = true;
    }
  }
  return any ? picked : undefined;
}

function settings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a supported table.');
  if (!TABLES.includes(input.table)) throw new Error('Choose a supported table.');
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error('Match limit must be between 1 and 100.');
  /** @type {{table: string, limit: number, identity?: object, proxy?: object}} */
  const result = { table: input.table, limit: input.limit };
  const identity = pickKnown(input.identity, IDENTITY_FIELDS);
  if (identity) result.identity = identity;
  const proxy = pickKnown(input.proxy, PROXY_FIELDS);
  if (proxy) result.proxy = proxy;
  return result;
}

/**
 * Remembered window geometry, keyed by account id.
 *
 * This is **disposable** data. Unlike an account, a damaged geometry entry costs the user nothing, so it
 * is dropped rather than being allowed to make the workspace unreadable — a corrupt rectangle must never
 * cost anyone their account list. `geometry.cjs` owns the definition of a usable record, so "usable"
 * means the same thing here as it does when a window is restored.
 * @param {unknown} input
 * @param {Set<string>} ids
 */
function windowGeometry(input, ids) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  /** @type {Record<string, object>} */
  const result = {};
  for (const [id, value] of Object.entries(/** @type {Record<string, unknown>} */ (input))) {
    if (!ids.has(id)) continue;
    const clean = normaliseRemembered(value);
    if (!clean) continue;
    const raw = /** @type {Record<string, unknown>} */ (value);
    result[id] = {
      ...clean,
      displayId: Number.isInteger(raw.displayId) ? raw.displayId : null,
      at: typeof raw.at === 'string' ? raw.at : null
    };
  }
  return result;
}

/**
 * Rebuild a workspace document from stored JSON. Every field it keeps must survive a round trip, or a
 * setting silently vanishes on the next save (the D3 defect).
 * @param {any} value
 * @returns {{version: number, accounts: any[], settings: any, windows?: Record<string, object>}}
 */
function decode(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.accounts)) throw new Error('Unsupported workspace data.');
  const ids = new Set();
  const active = [];
  const accounts = value.accounts.map(a => {
    if (!a || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id) || ids.has(a.id))
      throw new Error('Invalid account identifier.');
    ids.add(a.id);
    label(a.name);
    if (!['receiver', 'sender'].includes(a.role) || typeof a.archived !== 'boolean') throw new Error('Invalid account data.');
    if (!a.archived) {
      account(a, active);
      active.push(a);
    }
    /** @type {Record<string, unknown>} */
    const kept = { id: a.id, name: a.name, role: a.role, archived: a.archived, createdAt: String(a.createdAt) };
    const identity = pickKnown(a.identity, IDENTITY_FIELDS);
    if (identity) kept.identity = identity;
    const proxy = pickKnown(a.proxy, PROXY_FIELDS);
    if (proxy) kept.proxy = proxy;
    return kept;
  });
  /** @type {{version: number, accounts: any[], settings: any, windows?: Record<string, object>}} */
  const document = { version: 1, accounts, settings: settings(value.settings) };
  // Omitted rather than written as `{}`, so a decode of a document without geometry is that document
  // exactly — and an existing workspace file does not gain an empty key on its next save.
  const geometry = windowGeometry(value.windows, ids);
  if (Object.keys(geometry).length) document.windows = geometry;
  return document;
}

module.exports = { account, settings, decode, windowGeometry, pickKnown, PROXY_FIELDS, TABLES };
