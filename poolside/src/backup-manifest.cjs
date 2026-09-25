// The document that describes a Poolside backup, and the decision about what a restore may touch.
//
// A backup folder is the one thing Poolside writes outside its own data directory, and it is also the
// one thing it will read back from. Both directions are decided here as plain data, so the file layout
// can be tested without copying anything and a foreign folder is refused before a single byte moves.
//
// The format is Poolside's own. It is deliberately not a Chromium profile export and not a cookie
// format: the encrypted session files it carries only decrypt for the Windows account that wrote them.
//
// Pure module: no filesystem, no Electron. Enforced by test/architecture.test.cjs.

const FORMAT = 'poolside-backup/v1';
const IDENTIFIER = /^[a-f0-9-]{36}$/i;
const MAX_ACCOUNTS = 100;
const HASH = /^[a-f0-9]{64}$/i;
const pathModule = require('node:path');

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * The manifest written next to a backup's contents. Profile hashes cover every copied file.
 * @param {{appVersion: string, exportedAt: string, accounts: any[], files: {path: string, bytes: number, sha256: string}[], profiles: {path: string, files: number, bytes: number, sha256?: string}[]}} input
 */
function build(input) {
  return {
    format: FORMAT,
    application: 'Poolside',
    appVersion: text(input.appVersion),
    exportedAt: text(input.exportedAt),
    note: 'Poolside session backup. The encrypted session files restore only for the same Windows account that wrote them.',
    accounts: input.accounts,
    files: input.files,
    profiles: input.profiles
  };
}

/**
 * Read a manifest back, refusing anything that is not one of ours with a sentence a person can act on.
 * @param {unknown} value
 */
function parse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('This folder is not a Poolside backup.');
  const source = /** @type {any} */ (value);
  if (source.format !== FORMAT) {
    const found = text(source.format);
    throw new Error(
      found
        ? `This folder is a ${found} file, which Poolside cannot read. Poolside only restores its own backups.`
        : 'This folder is not a Poolside backup.'
    );
  }
  const accounts = Array.isArray(source.accounts) ? source.accounts : [];
  if (!accounts.length) throw new Error('This backup does not contain any accounts.');
  if (accounts.length > MAX_ACCOUNTS)
    throw new Error(`This backup lists ${accounts.length} accounts, more than Poolside will restore at once.`);
  /** @type {{id: string, name: string, role: string, archived: boolean, createdAt: string}[]} */
  const clean = [];
  for (const entry of accounts) {
    const id = text(entry && entry.id);
    const name = text(entry && entry.name);
    const role = text(entry && entry.role);
    if (!IDENTIFIER.test(id)) throw new Error('This backup lists an account with an identifier Poolside did not issue.');
    if (!name || name.length > 40) throw new Error('This backup lists an account without a usable name.');
    if (!['receiver', 'sender'].includes(role)) throw new Error('This backup lists an account with an unknown role.');
    if (clean.some(candidate => candidate.id === id)) throw new Error('This backup lists the same account twice.');
    clean.push({ id, name, role, archived: entry.archived === true, createdAt: text(entry.createdAt) });
  }
  const accountIds = new Set(clean.map(account => account.id.toLowerCase()));
  const seen = new Set();
  /** @param {unknown} value */
  const safePath = value => {
    const name = text(value);
    if (!name || pathModule.win32.isAbsolute(name) || pathModule.posix.isAbsolute(name) || name.split(/[\\/]/).includes('..'))
      throw new Error('This backup lists a path outside its own folder.');
    if (seen.has(name)) throw new Error('This backup lists the same path twice.');
    seen.add(name);
    return name;
  };
  const files = (Array.isArray(source.files) ? source.files : []).map(entry => {
    const path = safePath(entry && entry.path);
    const session = /^sessions\/([a-f0-9-]{36})\.plist$/i.exec(path);
    if (path !== 'workspace.json' && (!session || !accountIds.has(session[1].toLowerCase())))
      throw new Error('This backup lists a file outside its own account data.');
    const bytes = entry.bytes;
    const sha256 = text(entry.sha256);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !HASH.test(sha256))
      throw new Error('This backup has an invalid file size or checksum.');
    return { path, bytes, sha256 };
  });
  const profiles = (Array.isArray(source.profiles) ? source.profiles : []).map(entry => {
    const path = safePath(entry && entry.path);
    const profile = /^profiles\/poolside-([a-f0-9-]{36})$/i.exec(path);
    if (!profile || !accountIds.has(profile[1].toLowerCase())) throw new Error('This backup lists a profile outside its own account data.');
    const files = entry.files;
    const bytes = entry.bytes;
    const sha256 = text(entry.sha256);
    if (!Number.isSafeInteger(files) || files < 0 || !Number.isSafeInteger(bytes) || bytes < 0 || (sha256 && !HASH.test(sha256)))
      throw new Error('This backup has an invalid profile size or checksum.');
    return { path, files, bytes, ...(sha256 ? { sha256 } : {}) };
  });
  return { format: FORMAT, appVersion: text(source.appVersion), exportedAt: text(source.exportedAt), accounts: clean, files, profiles };
}

/**
 * What a restore would do, decided before anything is written. An account that is already in this
 * workspace is reported as present rather than overwritten: a restore adds what is missing and never
 * replaces a slot, its notes, or its saved sign-in state.
 * @param {{accounts: {id: string, name: string, role: string}[]}} manifest
 * @param {{id: string, name: string, role?: string, archived?: boolean}[]} existing
 */
function plan(manifest, existing) {
  const workspace = Array.isArray(existing) ? existing : [];
  const known = new Set(workspace.map(account => account.id));
  const taken = new Set(workspace.map(account => String(account.name).toLowerCase()));
  // The workspace allows one receiving account, and the restored slot has to obey the same rule the Add
  // account form does. A second one is reported rather than quietly demoted to a different role.
  let receiverTaken = workspace.some(account => account.role === 'receiver' && account.archived !== true);
  /** @type {any[]} */
  const importable = [];
  /** @type {string[]} */
  const present = [];
  /** @type {{name: string, reason: string}[]} */
  const conflicts = [];
  for (const account of manifest.accounts) {
    if (known.has(account.id)) {
      present.push(account.name);
      continue;
    }
    if (account.role === 'receiver') {
      if (receiverTaken) {
        conflicts.push({ name: account.name, reason: 'this workspace already has a receiving account' });
        continue;
      }
      receiverTaken = true;
    }
    // A name is unique inside a workspace, so a restored account whose name is taken is renamed rather
    // than allowed to collide with the slot that already owns it.
    let name = account.name;
    if (taken.has(name.toLowerCase())) {
      let suffix = 2;
      while (taken.has(`${account.name} (${suffix})`.toLowerCase())) suffix += 1;
      name = `${account.name} (${suffix})`.slice(0, 40);
    }
    taken.add(name.toLowerCase());
    importable.push({ ...account, name });
  }
  return { importable, present, conflicts };
}

module.exports = { FORMAT, MAX_ACCOUNTS, build, parse, plan };
