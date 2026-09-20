const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const requiredFiles = ['Poolside.exe', 'resources/app.asar'];

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

function main() {
  const releaseDirectory = process.argv[2] || path.join('release', 'Poolside-win32-x64');
  process.stdout.write(renderInspection(releaseDirectory));
}

if (require.main === module) main();

module.exports = { describeRelease, renderInspection, sha256 };
