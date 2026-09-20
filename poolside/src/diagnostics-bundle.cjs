// Local, share-safe diagnostics export.
//
// This module owns the boundary between an in-memory redacted payload and a durable file. It deliberately
// receives no account credentials, browser profile paths or renderer input: its filename and directory are derived
// by the trusted main process, and it refuses the file before writing whenever the existing secret scanner finds a
// name, address, path, or opaque token-shaped string.

const fs = require('node:fs');
const path = require('node:path');
const telemetryRedaction = require('./telemetry-redaction.cjs');
const timelineTransfer = require('./timeline-transfer.cjs');

/** @param {any} snapshot */
function prepare(snapshot) {
  const current = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const payload = telemetryRedaction.exportLayer(current.telemetry);
  const accounts = Array.isArray(current.accounts) ? current.accounts : [];
  const timeline = current.timeline && Array.isArray(current.timeline.entries) ? current.timeline.entries : [];
  payload.timeline = timelineTransfer.redact(timeline, accounts).entries.map(entry => ({
    ...entry,
    message: entry.message ? telemetryRedaction.stripSecretShapes(entry.message) : entry.message
  }));
  const forbidden = accounts.map(account => account && account.name).filter(name => typeof name === 'string');
  const findings = telemetryRedaction.findSecrets(payload, { forbidden });
  if (findings.length) {
    throw new Error(
      `The diagnostics payload was refused: it still carries ${findings.length} item(s) that must not leave this machine (${findings
        .map(item => `${item.path} [${item.kind}]`)
        .join(', ')}).`
    );
  }
  return { payload, entries: payload.timeline.length, clean: true };
}

/** Create and return the app-owned diagnostics directory. @param {string} root */
function directory(root) {
  if (typeof root !== 'string' || !root) throw new Error('Diagnostics directory is unavailable.');
  const target = path.join(root, 'diagnostics');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  return target;
}
/** @param {Date} now */
function fileName(now) {
  return `poolside-diagnostics-${now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}.json`;
}

/**
 * Write an already-screened diagnostics document using an atomic same-directory rename.
 * @param {string} root Electron's local user-data directory
 * @param {ReturnType<typeof prepare>} diagnostics
 * @param {{now?: Date}} [options]
 */
function write(root, diagnostics, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const outputDirectory = directory(root);
  const name = fileName(now);
  const target = path.join(outputDirectory, name);
  if (fs.existsSync(target)) throw new Error('A diagnostics file already exists for this exact second. Please try again.');
  const document = { format: 'poolside-diagnostics/v1', generatedAt: now.toISOString(), payload: diagnostics.payload };
  const encoded = JSON.stringify(document, null, 2) + '\n';
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, encoded, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  // Do not expose an absolute path to the renderer: the dashboard only needs to tell the user that a local file
  // exists, and revealing user-directory paths adds no support value.
  return { fileName: name, bytes: Buffer.byteLength(encoded), entries: diagnostics.entries, clean: true };
}

module.exports = { prepare, write, fileName, directory };
