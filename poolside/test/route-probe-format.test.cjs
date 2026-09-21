const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readIpFromBody, describeSuccess, describeFailure } = require('../src/route-probe-format.cjs');

test('the address is read out of a plain or JSON answer', () => {
  assert.equal(readIpFromBody('{"ip":"198.105.121.200"}'), '198.105.121.200');
  assert.equal(readIpFromBody('198.105.121.200'), '198.105.121.200');
  assert.equal(readIpFromBody('<html>nope</html>'), null);
  assert.equal(readIpFromBody(undefined), null);
});

test('the operator is told what happened, in words', () => {
  assert.equal(describeSuccess({ ip: '198.105.121.200' }), 'Works. Requests through this address leave as 198.105.121.200.');
  assert.match(describeFailure('net::ERR_TIMED_OUT loading'), /No answer within 25 seconds/);
  assert.match(describeFailure('407 Proxy Authentication Required'), /asked for a username and password/);
  assert.match(
    describeFailure('407 Proxy Authentication Required', { credentials: { username: 'a', password: 'b' } }),
    /refused the username and password/
  );
  assert.match(describeFailure('net::ERR_TUNNEL_CONNECTION_FAILED'), /Check the host and port/);
  assert.equal(describeFailure(''), 'Did not work, and no reason was reported.');
});
