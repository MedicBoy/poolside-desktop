// Why the exit-address read fails while the game loads: the app answers a proxy challenge on the window's
// webContents, and `session.fetch` does not belong to a window. This probe runs the same request twice
// against the same proxy — once with no app-level handler, once with one — and prints which of them the
// network service can answer. Credentials are read from the provider export and never printed.
//
// Run: npx electron tools/proxy-fetch-probe.cjs

const fs = require('node:fs');
const { app, session, net } = require('electron');
const { createSessionIpReader } = require('../src/session-ip.cjs');

const EXPORT = 'C:/Users/nicho/Downloads/Webshare 10 proxies.txt';
const ENDPOINT = 'https://api.ipify.org?format=json';

function routeFrom(file, host) {
  const line = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find(candidate => candidate.trim().startsWith(host));
  if (!line) throw new Error(`${host} is not in the provider export`);
  const [hostname, port, username, password] = line.trim().split(':');
  return { host: hostname, port, username, password };
}

async function fetchAttempt(browserSession) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const response = await browserSession.fetch(ENDPOINT, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    clearTimeout(timer);
    const body = await response.text();
    return `HTTP ${response.status} ${response.ok ? body.slice(0, 40) : '(challenge refused)'}`;
  } catch (error) {
    return `threw: ${error && error.message ? error.message : String(error)}`;
  }
}

/** The same request through Electron's net module, which reports a proxy challenge directly to the caller. */
function requestAttempt(browserSession, route) {
  return new Promise(resolve => {
    const request = net.request({ url: ENDPOINT, session: browserSession, useSessionCookies: false });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      request.abort();
      finish('threw: timed out');
    }, 12000);
    request.on('login', (authInfo, callback) => {
      console.log(`  (net.request saw a proxy challenge at ${authInfo.host}:${authInfo.port})`);
      if (`${authInfo.host}:${authInfo.port}`.toLowerCase() !== `${route.host}:${route.port}`.toLowerCase()) return;
      callback(route.username, route.password);
    });
    request.on('response', response => {
      let body = '';
      response.on('data', chunk => (body += chunk));
      response.on('end', () => {
        clearTimeout(timer);
        finish(`HTTP ${response.statusCode} ${response.statusCode === 200 ? body.slice(0, 40) : '(challenge refused)'}`);
      });
    });
    request.on('error', error => {
      clearTimeout(timer);
      finish(`threw: ${error && error.message ? error.message : String(error)}`);
    });
    request.end();
  });
}

app.whenReady().then(async () => {
  const route = routeFrom(EXPORT, process.argv[2] || '198.105.121.200');
  const probe = session.fromPartition('persist:proxy-probe');
  await probe.setProxy({ proxyRules: `http://${route.host}:${route.port}`, proxyBypassRules: '<local>' });

  let appLogins = 0;
  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    appLogins++;
    console.log(`  (app login event at ${authInfo.host}:${authInfo.port}, isProxy=${authInfo.isProxy})`);
    if (!authInfo.isProxy) return;
    if (`${authInfo.host}:${authInfo.port}`.toLowerCase() !== `${route.host}:${route.port}`.toLowerCase()) return;
    event.preventDefault();
    callback(route.username, route.password);
  });

  console.log(`proxy-configured session fetch at ${route.host}:${route.port}`);
  console.log(`  session.fetch      : ${await fetchAttempt(probe)}   (app login events: ${appLogins})`);
  console.log(`  net.request        : ${await requestAttempt(probe, route)}   (app login events: ${appLogins})`);
  // And the module the application actually ships, on the same session and route.
  try {
    const read = await createSessionIpReader({
      session: probe,
      credentials: { username: route.username, password: route.password },
      expectedTarget: `${route.host}:${route.port}`,
      timeoutMs: 15000
    })();
    console.log(`  session-ip.cjs     : OK ${read.ip} at ${read.checkedAt}`);
  } catch (error) {
    console.log(`  session-ip.cjs     : threw: ${error && error.message ? error.message : String(error)}`);
  }
  app.exit(0);
});
