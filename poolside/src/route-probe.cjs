// Trying an address before saving it.
//
// The operator pastes an address; this answers "does it actually work, and where does it come out?" before
// anything is assigned to an account. It uses the application's own path — the same parser, the same proxy
// application, and the same credential handling as a real session — but on a throwaway in-memory profile, so
// testing an address cannot touch an account's own storage.

const { BrowserWindow, session } = require('electron');
const { parseProxySpec } = require('./proxy-spec.cjs');
const { attachProxyAuthentication } = require('./proxy-auth.cjs');
const { readIpFromBody, describeSuccess, describeFailure } = require('./route-probe-format.cjs');

const PROBE_ENDPOINT = 'https://api.ipify.org?format=json';
const PROBE_TIMEOUT_MS = 25000;

function withDeadline(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * @param {unknown} spec the address as the operator pasted it
 * @returns {Promise<{ok: true, ip: string, message: string}|{ok: false, message: string}>}
 */
async function probeRoute(spec) {
  const parsed = parseProxySpec(spec);
  if (!parsed.ok) return { ok: false, message: `That address is not usable: ${parsed.error}.` };
  const isolated = session.fromPartition(`route-probe-${Date.now()}`);
  await isolated.setProxy({ mode: parsed.mode, proxyRules: parsed.proxyRules });
  const window = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true } });
  // The parsed spec and the resolved route are the same shape at runtime; the parser's narrower type is
  // what the type checker follows, so the cast says which one is being passed and why.
  attachProxyAuthentication(window.webContents, /** @type {any} */ (parsed));
  try {
    const body = await withDeadline(
      window.loadURL(PROBE_ENDPOINT).then(() => window.webContents.executeJavaScript('document.body.innerText')),
      PROBE_TIMEOUT_MS
    );
    const ip = readIpFromBody(body);
    if (!ip) return { ok: false, message: 'Something answered, but not with an address, so this is not a proxy.' };
    return { ok: true, ip, message: describeSuccess({ ip }) };
  } catch (error) {
    return { ok: false, message: describeFailure(error instanceof Error ? error.message : String(error), parsed) };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

module.exports = { probeRoute, PROBE_ENDPOINT, PROBE_TIMEOUT_MS };
