const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const requiredFiles = ['Poolside.exe', 'resources/app.asar'];
const requiredArchiveFiles = [
  '/docs/SBOM.cdx.json',
  '/docs/threat-model.md',
  '/docs/CAPABILITIES.md',
  '/docs/capabilities.json',
  '/docs/release-evidence/README.md'
];
const allowedArchiveRoots = new Set([
  '.editorconfig',
  '.gitignore',
  '.prettierignore',
  '.prettierrc.json',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'MASTER_ROADMAP.md',
  'README.md',
  'docs',
  'eslint.config.mjs',
  'node_modules',
  'package.json',
  'scripts',
  'src',
  'tsconfig.json'
]);

function archivePath(entry) {
  return entry.replace(/\\/g, '/');
}

function missingArchiveFiles(entries) {
  const normalized = new Set(entries.map(archivePath));
  return requiredArchiveFiles.filter(entry => !normalized.has(entry));
}

function unsafeArchiveFiles(entries) {
  const normalized = entries.map(archivePath);
  const unexpectedRoots = normalized.filter(entry => /^\/[^/]+$/.test(entry) && !allowedArchiveRoots.has(entry.slice(1)));
  const privatePaths = normalized.filter(
    entry =>
      !entry.startsWith('/node_modules/') &&
      (/\/(?:recognition-lab|diagnostics|accounts)\//i.test(entry) || /(?:workspace\.json|\.plist|\.(?:png|jpe?g|mp4|log))$/i.test(entry))
  );
  return [...new Set([...unexpectedRoots, ...privatePaths])];
}

async function inspectArchive(file) {
  const asar = await import('@electron/asar');
  const entries = asar.listPackage(file, { isPack: false });
  const missing = missingArchiveFiles(entries);
  if (missing.length) throw new Error(`Packaged app archive is missing ${missing.join(', ')}.`);
  const unsafe = unsafeArchiveFiles(entries);
  if (unsafe.length) throw new Error(`Packaged app archive contains unexpected or private paths: ${unsafe.join(', ')}.`);
  const packageVersion = JSON.parse(asar.extractFile(file, 'package.json').toString('utf8')).version;
  const capabilityVersion = JSON.parse(asar.extractFile(file, 'docs/capabilities.json').toString('utf8')).version;
  if (packageVersion !== capabilityVersion) throw new Error('Packaged capability report version does not match the application.');
  return { packageVersion, capabilityVersion, requiredArchiveFiles: requiredArchiveFiles.length };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function describeRelease(releaseDirectory) {
  const directory = path.resolve(releaseDirectory);
  const missing = requiredFiles.filter(file => !fs.statSync(path.join(directory, file), { throwIfNoEntry: false }));
  if (missing.length) {
    throw new Error(`Release folder is incomplete: missing ${missing.join(', ')}`);
  }

  const files = requiredFiles.map(relativePath => {
    const file = path.join(directory, relativePath);
    const stats = fs.statSync(file);
    if (!stats.isFile()) throw new Error(`Release item is not a file: ${relativePath}`);
    return { path: relativePath.replace(/\\/g, '/'), bytes: stats.size, sha256: sha256(file) };
  });

  return {
    format: 'poolside-release-inspection/v1',
    releaseDirectory: directory,
    application: 'Poolside',
    files
  };
}

function renderInspection(releaseDirectory) {
  return `${JSON.stringify(describeRelease(releaseDirectory), null, 2)}\n`;
}

async function main() {
  const releaseDirectory = process.argv[2] || path.join('release', 'Poolside-win32-x64');
  const inspection = {
    ...describeRelease(releaseDirectory),
    archive: await inspectArchive(path.join(releaseDirectory, 'resources', 'app.asar'))
  };
  process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
}

if (require.main === module)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

module.exports = { describeRelease, renderInspection, sha256, missingArchiveFiles, unsafeArchiveFiles, inspectArchive };
