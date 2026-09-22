const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  readIpFromBody,
  describeSuccess,
  describeFailure,
  describeNotAnAddress,
  formatMs,
  SLOW_ROUTE_MS
} = require('../src/route-probe-format.cjs');

test('the address is read out of a plain or JSON answer', () => {
  assert.equal(readIpFromBody('{"ip":"198.105.121.200"}'), '198.105.121.200');
  assert.equal(readIpFromBody('198.105.121.200'), '198.105.121.200');
  assert.equal(readIpFromBody('<html>nope</html>'), null);
  assert.equal(readIpFromBody(undefined), null);
});

test('the operator is told what happened, in words', () => {
  assert.equal(describeSuccess({ ip: '198.105.121.200' }), 'Works. Requests through this address leave as 198.105.121.200.');
  assert.match(describeSuccess({ ip: '198.105.121.200', ms: 340 }), /It answered in 340 ms/);
  assert.match(describeFailure('net::ERR_TIMED_OUT loading'), /No answer within 25 seconds/);
  assert.match(describeFailure('407 Proxy Authentication Required'), /asked for a username and password/);
  assert.match(
    describeFailure('407 Proxy Authentication Required', { credentials: { username: 'a', password: 'b' } }),
    /refused the username and password/
  );
  assert.match(describeFailure('net::ERR_TUNNEL_CONNECTION_FAILED'), /Check the host and port/);
  assert.equal(describeFailure(''), 'Did not work, and no reason was reported.');
});

test('a working address says how long it took, and calls a slow one slow', () => {
  assert.equal(formatMs(0), '0 ms');
  assert.equal(formatMs(999), '999 ms');
  assert.equal(formatMs(1000), '1.0 seconds');
  assert.equal(formatMs(2345), '2.3 seconds');
  // The threshold, at its own edge: at the threshold it is quiet, above it it speaks.
  const quick = describeSuccess({ ip: '198.105.121.200', ms: SLOW_ROUTE_MS });
  assert.doesNotMatch(quick, /slow/i);
  const slow = describeSuccess({ ip: '31.59.20.176:6754', ms: SLOW_ROUTE_MS + 1 });
  assert.match(slow, /That is slow, and every request this session makes will carry that delay/);
  // A probe that could not be timed says nothing about time rather than saying zero.
  assert.equal(describeSuccess({ ip: '198.105.121.200', ms: null }), 'Works. Requests through this address leave as 198.105.121.200.');
});

test('the failures that are not reachability failures are named as what they are', () => {
  // Each of these is a different situation with different advice, and each used to arrive as the same
  // "check the host and port" — which is wrong the moment something did answer.
  assert.match(describeFailure('net::ERR_CERT_AUTHORITY_INVALID'), /certificate this machine will not accept/);
  assert.match(describeFailure('net::ERR_CERT_AUTHORITY_INVALID'), /do not continue past this warning/);
  assert.match(describeFailure('net::ERR_NAME_NOT_RESOLVED'), /host name could not be looked up/);
  assert.match(describeFailure('net::ERR_NAME_NOT_RESOLVED'), /numeric address instead/);
  assert.match(describeFailure('net::ERR_SSL_PROTOCOL_ERROR'), /often a sign-in page for the connection itself/);
  assert.match(describeFailure('net::ERR_SOCKS_CONNECTION_FAILED'), /Check the host and port/);
  assert.match(describeNotAnAddress(), /not with an address/);
  assert.match(describeNotAnAddress(), /shared network asking you to sign in/);
  // The order matters: a certificate failure that also mentions a connection is a certificate failure, because
  // that is the more specific truth and the one with different advice.
  assert.match(describeFailure('net::ERR_CERT_COMMON_NAME_INVALID (ERR_CONNECTION_FAILED)'), /certificate/);
});
