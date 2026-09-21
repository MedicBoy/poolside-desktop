const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkPublicIP, MAX_BODY } = require('../src/network.cjs');

test('a readable answer becomes an address and the moment it was read', async () => {
  const asked = [];
  const result = await checkPublicIP(async options => {
    asked.push(options);
    return { status: 200, body: '{"ip":"203.0.113.10"}' };
  });
  assert.equal(result.ip, '203.0.113.10');
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  // The transport is told what to ask for, how long to wait and how much of an answer to accept.
  assert.equal(asked[0].url, 'https://api.ipify.org?format=json');
  assert.equal(asked[0].maxBody, MAX_BODY);
  assert.ok(asked[0].timeoutMs > 0);
});

test('every way a read can fail says which way it failed', async () => {
  /** @type {[any, RegExp][]} */
  const cases = [
    [{ status: 503, body: '' }, /IP service unavailable/],
    [{ status: 200, body: 'not json' }, /Unexpected response from IP service/],
    [{ status: 200, body: '{"ip":"<script>"}' }, /Unexpected response from IP service/],
    [{ status: 200, body: '{"ip":"not an address"}' }, /Unexpected response from IP service/],
    [{ status: 200, body: 'x'.repeat(MAX_BODY + 1) }, /Unexpected response from IP service/]
  ];
  for (const [answer, expected] of cases)
    await assert.rejects(
      checkPublicIP(async () => answer),
      expected
    );
  // A transport that throws is a failed check, and a transport that never answered is a timed-out one — the
  // distinction matters, because "check your connection" and "the service is unavailable" send the operator
  // to different places.
  await assert.rejects(
    checkPublicIP(async () => {
      throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
    }),
    /IP check failed\. Check your connection and retry\./
  );
  await assert.rejects(
    checkPublicIP(async () => ({ status: 0, body: '', timedOut: true })),
    /IP check timed out/
  );
});
