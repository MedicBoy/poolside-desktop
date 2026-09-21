// Copying a workspace out to a backup folder, and copying one back in.
//
// This is the safe substitute for importing somebody else's session file. Nothing here reads a foreign
// format, and nothing here writes into another application's storage: a backup is Poolside's own
// `workspace.json`, its DPAPI-encrypted carry-over files, and the Chromium profile folders it created.
//
// Restoring only ever adds. An account that already exists is reported and skipped, an existing profile
// directory is refused rather than merged, and no file outside the Poolside data directory is written.
// The encrypted session files decrypt only for the Windows account that wrote them, which is stated in
// the manifest and in the result rather than discovered later.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const manifest = require('./backup-manifest.cjs');
const { ACCOUNTS_DIR, PARTITIONS_DIR, isInside, partitionName } = require('./profile-paths.cjs');
const { redactWorkspaceProxyCredentials } = require('./proxy-public.cjs');

const WORKSPACE_FILE = 'workspace.json';
const MANIFEST_FILE = 'manifest.json';
const SESSIONS_DIR = 'sessions';
const PROFILES_DIR = 'profiles';

const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Files and bytes under a directory, following the same rules a copy would. */
function measureDirectory(directory) {
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = measureDirectory(full);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += fs.statSync(full).size;
    }
  }
  return { files, bytes };
}

/** A folder name that sorts in time order and is legal on Windows. */
function stamp(at) {
  return new Date(at)
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace('T', '-')
    .replaceAll(':', '');
}

/**
 * Write a backup of the given accounts into `destination`, in its own timestamped folder so two backups
 * never overwrite each other.
 * @param {{root: string, destination: string, accounts: any[], appVersion: string, at: number}} input
 */
function create(input) {
  const { root, destination, accounts, appVersion, at } = input;
  if (!fs.existsSync(destination) || !fs.statSync(destination).isDirectory()) throw new Error('Choose an existing folder for the backup.');
  const folder = path.join(destination, `Poolside-backup-${stamp(at)}`);
  if (!isInside(destination, folder)) throw new Error('Choose an existing folder for the backup.');
  fs.mkdirSync(folder, { recursive: true });
  /** @type {{path: string, bytes: number, sha256: string}[]} */
  const files = [];
  /** @type {{path: string, files: number, bytes: number}[]} */
  const profiles = [];
  const copyFile = (from, relative) => {
    const to = path.join(folder, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    files.push({ path: relative, bytes: fs.statSync(to).size, sha256: sha256(to) });
  };

  const workspaceFile = path.join(root, WORKSPACE_FILE);
  if (fs.existsSync(workspaceFile)) {
    const to = path.join(folder, WORKSPACE_FILE);
    let document;
    try {
      document = redactWorkspaceProxyCredentials(JSON.parse(fs.readFileSync(workspaceFile, 'utf8')));
    } catch {
      throw new Error('The workspace file could not be safely included in the backup.');
    }
    fs.writeFileSync(to, `${JSON.stringify(document, null, 2)}\n`);
    files.push({ path: WORKSPACE_FILE, bytes: fs.statSync(to).size, sha256: sha256(to) });
  }

  const listed = [];
  for (const account of accounts) {
    listed.push({
      id: account.id,
      name: account.name,
      role: account.role,
      archived: account.archived === true,
      createdAt: account.createdAt || ''
    });
    const carryOver = path.join(root, ACCOUNTS_DIR, `${account.id}.plist`);
    if (fs.existsSync(carryOver)) copyFile(carryOver, `${SESSIONS_DIR}/${account.id}.plist`);
    const name = partitionName(account.id);
    const profile = path.join(root, PARTITIONS_DIR, name);
    if (fs.existsSync(profile)) {
      const to = path.join(folder, PROFILES_DIR, name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(profile, to, { recursive: true });
      profiles.push({ path: `${PROFILES_DIR}/${name}`, ...measureDirectory(to) });
    }
  }

  const document = manifest.build({ appVersion, exportedAt: new Date(at).toISOString(), accounts: listed, files, profiles });
  fs.writeFileSync(path.join(folder, MANIFEST_FILE), `${JSON.stringify(document, null, 2)}\n`);
  const bytes = files.reduce((total, entry) => total + entry.bytes, 0) + profiles.reduce((total, entry) => total + entry.bytes, 0);
  // Deliberately not named `accounts`: the dashboard's call helper re-renders from any result that has an
  // `accounts` key, and a count is not a workspace snapshot.
  return {
    folder,
    accountCount: listed.length,
    sessionCount: files.length - (fs.existsSync(workspaceFile) ? 1 : 0),
    profileCount: profiles.length,
    bytes
  };
}

/**
 * Read a backup folder and copy in whatever it carries that this workspace does not already have.
 * @param {{root: string, source: string, existing: any[]}} input
 */
function restore(input) {
  const { root, source, existing } = input;
  const manifestFile = path.join(source, MANIFEST_FILE);
  if (!fs.existsSync(manifestFile)) throw new Error('This folder is not a Poolside backup.');
  const document = manifest.parse(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
  // Verify before writing anything: a truncated or edited backup is refused while the workspace is still
  // untouched, rather than half-restored.
  for (const entry of document.files) {
    const file = path.join(source, entry.path);
    if (!isInside(source, file)) throw new Error('This backup lists a file outside its own folder.');
    if (!fs.existsSync(file)) throw new Error(`This backup is incomplete: ${entry.path} is missing.`);
    if (entry.sha256 && sha256(file) !== entry.sha256)
      throw new Error(`This backup is damaged: ${entry.path} does not match its recorded checksum.`);
  }
  const decision = manifest.plan(document, existing);
  /** @type {any[]} */
  const restored = [];
  for (const account of decision.importable) {
    const name = partitionName(account.id);
    const targetProfile = path.join(root, PARTITIONS_DIR, name);
    if (!isInside(root, targetProfile)) throw new Error('Refusing to write outside the Poolside data directory.');
    if (fs.existsSync(targetProfile))
      throw new Error(`This PC already has saved browser storage for ${account.name}. Restore was stopped.`);
    const sourceProfile = path.join(source, PROFILES_DIR, name);
    if (fs.existsSync(sourceProfile)) fs.cpSync(sourceProfile, targetProfile, { recursive: true });
    const sourceSession = path.join(source, SESSIONS_DIR, `${account.id}.plist`);
    if (fs.existsSync(sourceSession)) {
      const targetSession = path.join(root, ACCOUNTS_DIR, `${account.id}.plist`);
      fs.mkdirSync(path.dirname(targetSession), { recursive: true });
      fs.copyFileSync(sourceSession, targetSession);
    }
    restored.push(account);
  }
  return {
    restored,
    present: decision.present,
    conflicts: decision.conflicts,
    exportedAt: document.exportedAt,
    appVersion: document.appVersion
  };
}

module.exports = { create, restore, measureDirectory, stamp, WORKSPACE_FILE, MANIFEST_FILE, SESSIONS_DIR, PROFILES_DIR };
