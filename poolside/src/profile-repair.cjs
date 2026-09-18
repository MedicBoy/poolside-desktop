// Repair for a damaged carry-over file.
//
// The only repair this application performs is to move a file aside. Nothing is deleted and nothing is
// rebuilt: the Chromium profile is authoritative and still holds every persistent cookie, so the worst
// honest outcome of losing this file is that the next sign-in is needed. The damaged file is kept under a
// `.corrupt-<timestamp>` name, which stops a scan-and-fail loop and leaves the evidence in place.
//
// The verdict is taken again here rather than trusted from the caller. A repair that could be talked into
// moving a *healthy* file would be a worse bug than the corruption it treats.
//
// `crypto` is injected rather than imported, which is what keeps this testable without Electron.
// No Electron import: enforced by test/architecture.test.cjs.

const fs = require('node:fs');
const { inspect } = require('./profile-integrity.cjs');
const { assertRemovable, carryOverFile, quarantineFile } = require('./profile-paths.cjs');
const { messageOf } = require('./errors.cjs');

/**
 * @param {string} root the Poolside data directory
 * @param {string} id
 * @param {{isEncryptionAvailable: () => boolean, decryptString: (value: Buffer) => string}} crypto
 * @param {number} [at] the moment to record in the quarantined name, for a reproducible test
 * @returns {{repaired: boolean, action: string, quarantined: string|null, note: string}}
 */
function repair(root, id, crypto, at = Date.now()) {
  const checked = inspect(root, id, crypto);
  if (checked.state === 'missing') {
    return { repaired: false, action: 'none', quarantined: null, note: 'there was no carry-over file to repair' };
  }
  if (checked.state !== 'corrupt') {
    return {
      repaired: false,
      action: 'none',
      quarantined: null,
      note: `the file is usable (${checked.state}), so it was left exactly as it is`
    };
  }
  try {
    const destination = assertRemovable(root, quarantineFile(root, id, at));
    fs.renameSync(carryOverFile(root, id), destination);
    return {
      repaired: true,
      action: 'quarantined',
      quarantined: destination,
      note: 'the damaged file was kept for diagnosis under its .corrupt- name; the profile still holds every persistent cookie, so a sign-in may be needed for the session itself'
    };
  } catch (error) {
    return {
      repaired: false,
      action: 'failed',
      quarantined: null,
      note: `the damaged file could not be moved aside (${messageOf(error)})`
    };
  }
}

module.exports = { repair };
