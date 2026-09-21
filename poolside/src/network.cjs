// The rules of reading a session's public address, and why the transport is not part of them.
//
// This used to call `session.fetch`. That cannot answer a proxy authentication challenge at all: measured on
// this machine, a fetch through an authenticated proxy fails with ERR_TUNNEL_CONNECTION_FAILED and **no**
// login event is emitted anywhere — not on the window, not on the app. The game pages were fine because
// their own window answers the challenge; the exit-address read was not, which is why a routed session could
// load the game perfectly and still be unable to prove where it leaves from.
//
// So the transport lives in `session-ip.cjs` (Electron's `net`, which reports the challenge to its caller)
// and the rules live here: what the endpoint is, what a usable answer looks like, what a refusal says, and
// how long to wait. Pure: no Electron, no fs.

const { isIP } = require('node:net');
const IP_ENDPOINT = 'https://api.ipify.org?format=json';
/** A response larger than this is not the answer to this question, whatever it is. */
const MAX_BODY = 1024;
const TIMEOUT_MS = 10000;

/**
 * Ask a session for its public address.
 * @param {(options: {url: string, timeoutMs: number, maxBody: number}) => Promise<{status: number, body: string, timedOut?: boolean}>} request
 * @returns {Promise<{ip: string, checkedAt: string}>}
 */
async function checkPublicIP(request) {
  let outcome;
  try {
    outcome = await request({ url: IP_ENDPOINT, timeoutMs: TIMEOUT_MS, maxBody: MAX_BODY });
  } catch {
    throw new Error('IP check failed. Check your connection and retry.');
  }
  if (outcome.timedOut) throw new Error('IP check timed out. Check your connection and retry.');
  if (outcome.status !== 200) throw new Error('IP service unavailable. Try again later.');
  if (typeof outcome.body !== 'string' || outcome.body.length > MAX_BODY) throw new Error('Unexpected response from IP service.');
  let ip;
  try {
    ip = JSON.parse(outcome.body).ip;
  } catch {
    throw new Error('Unexpected response from IP service.');
  }
  if (typeof ip !== 'string' || !isIP(ip)) throw new Error('Unexpected response from IP service.');
  return { ip, checkedAt: new Date().toISOString() };
}

module.exports = { checkPublicIP, IP_ENDPOINT, MAX_BODY, TIMEOUT_MS };
