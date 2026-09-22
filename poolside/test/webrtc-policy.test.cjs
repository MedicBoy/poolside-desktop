const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webRTCPolicyFor, POLICY } = require('../src/webrtc-policy.cjs');

test('a session with a route does not leak the real network through WebRTC', () => {
  assert.equal(webRTCPolicyFor({ configured: true, label: 'http proxy at 198.105.121.200:6462' }), POLICY);
  assert.equal(POLICY, 'disable_non_proxied_udp');
});

test('a session with no route is left exactly as it was', () => {
  for (const route of [{ configured: false }, {}, null, undefined]) assert.equal(webRTCPolicyFor(route), 'default');
});
