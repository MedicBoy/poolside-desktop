// Restore a Poolside backup through preflight, staging and a bounded commit.

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const manifest = require('./backup-manifest.cjs');
const { ACCOUNTS_DIR, PARTITIONS_DIR, isInside, partitionName } = require('./profile-paths.cjs');
const { scanProfile } = require('./backup-profile-integrity.cjs');

const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** @param {{root: string, source: string, existing: any[], commit?: (accounts: any[]) => void}} input */
function restore({ root, source, existing, commit = () => {} }) {
  const manifestFile = path.join(source, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('This folder is not a Poolside backup.');
  const document = manifest.parse(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
  const realSource = fs.realpathSync(source);
  for (const entry of document.files) {
    const file = path.join(source, entry.path);
    if (!isInside(source, file)) throw new Error('This backup lists a file outside its own folder.');
    if (!fs.existsSync(file)) throw new Error(`This backup is incomplete: ${entry.path} is missing.`);
    if (!fs.lstatSync(file).isFile() || !isInside(realSource, fs.realpathSync(file)))
      throw new Error('This backup contains a linked or unsupported file.');
    if (fs.statSync(file).size !== entry.bytes) throw new Error(`This backup is damaged: ${entry.path} does not match its recorded size.`);
    if (entry.sha256 && sha256(file) !== entry.sha256)
      throw new Error(`This backup is damaged: ${entry.path} does not match its recorded checksum.`);
  }
  for (const entry of document.profiles) {
    const directory = path.join(source, entry.path);
    if (!isInside(source, directory) || !fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory())
      throw new Error(`This backup is incomplete: ${entry.path} is missing.`);
    if (!isInside(realSource, fs.realpathSync(directory))) throw new Error('This backup contains a linked profile.');
    const actual = scanProfile(directory);
    if (actual.files !== entry.files || actual.bytes !== entry.bytes)
      throw new Error(`This backup is damaged: ${entry.path} does not match its recorded size.`);
    if (entry.sha256 && actual.sha256 !== entry.sha256)
      throw new Error(`This backup is damaged: ${entry.path} does not match its recorded checksum.`);
  }

  const decision = manifest.plan(document, existing);
  const listedFiles = new Set(document.files.map(entry => entry.path));
  const listedProfiles = new Map(document.profiles.map(entry => [entry.path, entry]));
  const items = [];
  for (const account of decision.importable) {
    const name = partitionName(account.id);
    const sourceProfile = path.join(source, 'profiles', name);
    const sourceSession = path.join(source, 'sessions', `${account.id}.plist`);
    const targetProfile = path.join(root, PARTITIONS_DIR, name);
    const targetSession = path.join(root, ACCOUNTS_DIR, `${account.id}.plist`);
    if (!isInside(root, targetProfile) || !isInside(root, targetSession))
      throw new Error('Refusing to write outside the Poolside data directory.');
    if (fs.existsSync(targetProfile))
      throw new Error(`This PC already has saved browser storage for ${account.name}. Restore was stopped.`);
    if (fs.existsSync(targetSession)) throw new Error(`This PC already has a saved session for ${account.name}. Restore was stopped.`);
    if (fs.existsSync(sourceProfile)) {
      if (!listedProfiles.has(`profiles/${name}`)) throw new Error('This backup has an unlisted browser profile.');
      items.push({ source: sourceProfile, target: targetProfile, directory: true });
    }
    if (fs.existsSync(sourceSession)) {
      if (!listedFiles.has(`sessions/${account.id}.plist`)) throw new Error('This backup has an unlisted session file.');
      items.push({ source: sourceSession, target: targetSession, directory: false });
    }
  }

  if (decision.importable.length) {
    fs.mkdirSync(root, { recursive: true });
    const staging = path.join(root, `.restore-${randomUUID()}`);
    fs.mkdirSync(staging);
    const published = [];
    try {
      for (const [index, item] of items.entries()) {
        const staged = path.join(staging, String(index));
        if (item.directory) fs.cpSync(item.source, staged, { recursive: true, errorOnExist: true });
        else fs.copyFileSync(item.source, staged, fs.constants.COPYFILE_EXCL);
        if (item.directory) {
          const expected = listedProfiles.get(path.posix.join('profiles', path.basename(item.source)));
          const actual = scanProfile(staged);
          if (
            !expected ||
            actual.files !== expected.files ||
            actual.bytes !== expected.bytes ||
            (expected.sha256 && actual.sha256 !== expected.sha256)
          )
            throw new Error('A browser profile changed while it was being staged. Close its window and make a new backup.');
        }
        item.staged = staged;
      }
      for (const item of items) {
        fs.mkdirSync(path.dirname(item.target), { recursive: true });
        if (fs.existsSync(item.target)) throw new Error('A restore target appeared during staging. Nothing was overwritten.');
        fs.renameSync(item.staged, item.target);
        published.push(item.target);
      }
      commit(decision.importable);
    } catch (error) {
      for (const target of published.reverse()) fs.rmSync(target, { recursive: true, force: true });
      throw error;
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  return {
    restored: decision.importable,
    present: decision.present,
    conflicts: decision.conflicts,
    exportedAt: document.exportedAt,
    appVersion: document.appVersion
  };
}

module.exports = { restore };
