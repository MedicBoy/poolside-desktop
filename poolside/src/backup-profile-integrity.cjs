// Deterministic integrity record for a copied browser profile.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function hashFile(file) {
  const digest = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const chunk = Buffer.allocUnsafe(65536);
  try {
    let count;
    while ((count = fs.readSync(descriptor, chunk, 0, chunk.length, null)) > 0) digest.update(chunk.subarray(0, count));
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest('hex');
}

function scanProfile(directory) {
  const digest = createHash('sha256');
  let files = 0;
  let bytes = 0;
  function visit(current, relative) {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
        throw new Error('This browser profile contains an unsupported linked or special file.');
      if (entry.isDirectory()) {
        visit(full, name);
      } else {
        const size = fs.statSync(full).size;
        const fileHash = hashFile(full);
        digest.update(name).update('\0').update(String(size)).update('\0').update(fileHash).update('\n');
        files += 1;
        bytes += size;
      }
    }
  }
  visit(directory, '');
  return { files, bytes, sha256: digest.digest('hex') };
}

module.exports = { scanProfile };
