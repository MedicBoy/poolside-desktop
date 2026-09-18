const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkPublicIP } = require('../src/network.cjs');

test('IP check uses the supplied session and omits credentials', async () => {
  const session = {
    async fetch(url, options) {
      assert.equal(this, session);
      assert.equal(url, 'https://api.ipify.org?format=json');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      return new Response('{"ip":"203.0.113.10"}');
    }
  };
  const result = await checkPublicIP(session);
  assert.equal(result.ip, '203.0.113.10');
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
});

test('IP check rejects service errors, malformed addresses and oversized responses', async () => {
  for (const response of [
    new Response('', { status: 503 }),
    new Response('{"ip":"<script>"}'),
    new Response('x'.repeat(1025)),
    new Response('not json')
  ]) {
    await assert.rejects(checkPublicIP({ fetch: async () => response }), /IP check failed/);
  }
});
