// Reading a session's public address through its own route — including a route that needs a password.
//
// Electron's `session.fetch` cannot answer a proxy authentication challenge: measured on this machine, a
// fetch through an authenticated proxy ends with ERR_TUNNEL_CONNECTION_FAILED and no login event is emitted
// anywhere. `net.request` reports the challenge to whoever made the request, which is the only way a
// programmatic read can prove which address a routed session leaves from.
//
// Credentials are supplied for one endpoint only — the proxy this session is configured to use — so a
// challenge from anywhere else is left to fail, exactly as it would without this module.

const { checkPublicIP } = require('./network.cjs');

/**
 * @param {{session: any, credentials?: {username: string, password: string}|null, expectedTarget?: string|null, timeoutMs?: number|null, net?: any}} deps
 */
function createSessionIpReader({ session, credentials = null, expectedTarget = null, timeoutMs = null, net = null }) {
  const module = net || require('electron').net;
  const expected = expectedTarget ? String(expectedTarget).toLowerCase() : null;

  /** One request, resolving with the status and body rather than throwing on a refusal. */
  function request({ url, timeoutMs: asked, maxBody }) {
    return new Promise((resolve, reject) => {
      const client = module.request({ url, session, useSessionCookies: false });
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const deadline = timeoutMs ? Math.min(timeoutMs, asked) : asked;
      const timer = setTimeout(() => {
        client.abort();
        finish(null, { status: 0, body: '', timedOut: true });
      }, deadline);
      client.on('login', (authInfo, callback) => {
        if (!credentials) return;
        if (!authInfo || authInfo.isProxy !== true) return;
        if (expected && `${authInfo.host}:${authInfo.port}`.toLowerCase() !== expected) return;
        callback(credentials.username, credentials.password);
      });
      client.on('response', response => {
        let body = '';
        let oversized = false;
        response.on('data', chunk => {
          if (oversized) return;
          body += chunk.toString('utf8');
          if (body.length > maxBody) {
            oversized = true;
            client.abort();
            finish(null, { status: response.statusCode, body: body.slice(0, maxBody + 1) });
          }
        });
        response.on('end', () => finish(null, { status: response.statusCode, body }));
        response.on('error', () => finish(new Error('The IP service closed the connection.')));
      });
      client.on('error', error => finish(error instanceof Error ? error : new Error(String(error))));
      client.end();
    });
  }

  return () => checkPublicIP(request);
}

module.exports = { createSessionIpReader };
