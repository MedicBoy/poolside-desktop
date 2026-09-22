// Which WebRTC policy one session gets.
//
// A session that is configured to leave through a route does not quite do that: WebRTC's own traffic
// (STUN and the candidate addresses it gathers) does not travel through a proxy. Without a policy, a
// session using a carefully chosen route still hands out the machine's real network to anything that
// asks — which makes "this session leaves from there" only half true.
//
// `disable_non_proxied_udp` is the setting that stops it: WebRTC may still be used, but not in a way that
// bypasses the route. It is applied only when a route is configured, because an account with no route has
// nothing to protect and changing an unconfigured session's behaviour would be a change nobody asked for.
//
// Pure: route in, policy out.

const POLICY = 'disable_non_proxied_udp';

/** @param {{configured?: boolean, [key: string]: any}|null|undefined} route */
function webRTCPolicyFor(route) {
  return route && route.configured === true ? POLICY : 'default';
}

module.exports = { webRTCPolicyFor, POLICY };
