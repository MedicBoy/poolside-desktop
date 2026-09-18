const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-restart-'));
for (const mode of ['seed', 'verify']) {
  execFileSync(
    /** @type {string} */ (/** @type {unknown} */ (require('electron'))),
    [path.join(__dirname, 'session-restart.cjs'), root, mode],
    { stdio: 'inherit', timeout: 30000, windowsHide: true }
  );
}
