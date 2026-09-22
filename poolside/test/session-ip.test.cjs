// Reading a routed session's public address. This is the part `session.fetch` could not do: answer a proxy
// authentication challenge. The transport is Electron's `net`, faked here so the rules can be pinned without
// a network and without a proxy that asks for a password.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSessionIpReader } = require('../src/session-ip.cjs');

/**
 * A stand-in for Electron's `net`: each request is a small emitter whose `end()` schedules whatever the test
 * asked for — a challenge, a response, an error, or nothing at all.
 * @param {{status?: number, body?: string, challenge?: any, fail?: string, silent?: boolean}} [plan]
 */
function fakeNet(plan = {}) {
  /** @type {any[]} */
  const requests = [];
  return {
    requests,
    module: {
      request(/** @type {any} */ options) {
        const client = /** @type {any} */ (new EventEmitter());
        client.options = options;
        client.aborted = false;
        client.abort = () => {
          client.aborted = true;
        };
        client.end = () => {
          requests.push(client);
          setImmediate(() => {
            if (plan.fail) {
              client.emit('error', new Error(plan.fail));
              return;
            }
            if (plan.challenge) client.emit('login', plan.challenge.authInfo, plan.challenge.callback);
            if (plan.silent) return;
            const response = /** @type {any} */ (new EventEmitter());
            response.statusCode = plan.status === undefined ? 200 : plan.status;
            client.emit('response', response);
            setImmediate(() => {
              if (plan.body !== '') response.emit('data', Buffer.from(plan.body === undefined ? '{"ip":"203.0.113.7"}' : plan.body));
              response.emit('end');
            });
          });
        };
        return client;
      }
    }
  };
}

/**
 * A challenge that records whatever it is given, so a test can say whether it was answered.
 * @param {{isProxy: boolean, host: string, port: number}} authInfo
 */
function challenge(authInfo) {
  /** @type {[string, string][]} */
  const answered = [];
  return {
    authInfo,
    answered,
    callback: (/** @type {string} */ username, /** @type {string} */ password) => answered.push([username, password])
  };
}

test('a session without a route is read through its own session and reports the address', async () => {
  const net = fakeNet();
  const session = { name: 'a-session' };
  const ip = await createSessionIpReader({ session, net: net.module })();
  assert.equal(ip.ip, '203.0.113.7');
  assert.deepEqual(net.requests[0].options, {
    url: 'https://api.ipify.org?format=json',
    session,
    useSessionCookies: false
  });
});

test("a challenge from this session's own proxy endpoint is answered with its credentials", async () => {
  const asked = challenge({ isProxy: true, host: '198.105.121.200', port: 6462 });
  const ip = await createSessionIpReader({
    session: {},
    credentials: { username: 'user', password: 'secret' },
    expectedTarget: '198.105.121.200:6462',
    net: fakeNet({ challenge: asked }).module
  })();
  assert.deepEqual(asked.answered, [['user', 'secret']]);
  assert.equal(ip.ip, '203.0.113.7');
});

test('a challenge from anywhere else is left to fail', async () => {
  const elsewhere = challenge({ isProxy: true, host: '10.0.0.9', port: 8080 });
  await createSessionIpReader({
    session: {},
    credentials: { username: 'user', password: 'secret' },
    expectedTarget: '198.105.121.200:6462',
    net: fakeNet({ challenge: elsewhere }).module
  })();
  assert.deepEqual(elsewhere.answered, [], "a proxy that is not this session's route is not this session's to answer");
});

test('a challenge that is not from a proxy at all is left alone', async () => {
  const site = challenge({ isProxy: false, host: '198.105.121.200', port: 6462 });
  await createSessionIpReader({
    session: {},
    credentials: { username: 'user', password: 'secret' },
    expectedTarget: null,
    net: fakeNet({ challenge: site }).module
  })();
  assert.deepEqual(site.answered, []);
});

test('a session with no configured credentials answers nothing', async () => {
  const route = challenge({ isProxy: true, host: '198.105.121.200', port: 6462 });
  await createSessionIpReader({
    session: {},
    credentials: null,
    expectedTarget: '198.105.121.200:6462',
    net: fakeNet({ challenge: route }).module
  })();
  assert.deepEqual(route.answered, []);
});

test('a request that never answers times out, and is abandoned rather than left running', async () => {
  const net = fakeNet({ silent: true });
  await assert.rejects(
    createSessionIpReader({ session: {}, timeoutMs: 20, net: net.module })(),
    /IP check timed out\. Check your connection and retry\./
  );
  assert.equal(net.requests[0].aborted, true);
});

test('a service error and a transport error are reported as what they are', async () => {
  await assert.rejects(
    createSessionIpReader({ session: {}, net: fakeNet({ status: 503, body: '' }).module })(),
    /IP service unavailable\. Try again later\./
  );
  await assert.rejects(
    createSessionIpReader({ session: {}, net: fakeNet({ fail: 'net::ERR_TUNNEL_CONNECTION_FAILED' }).module })(),
    /IP check failed\. Check your connection and retry\./
  );
});

test('an oversized answer is cut off rather than read into memory', async () => {
  await assert.rejects(
    createSessionIpReader({ session: {}, net: fakeNet({ status: 200, body: 'x'.repeat(4096) }).module })(),
    /Unexpected response from IP service\./
  );
});
