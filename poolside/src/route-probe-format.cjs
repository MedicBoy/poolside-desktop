// Turning a probe's raw answer into something worth reading.
//
// Pure, so the wording of "did this address work" is testable without launching a browser. The message is
// what the operator sees next to the address they pasted, so it says what happened and, when something
// went wrong, the most likely reason rather than an error code.

/**
 * A route slower than this is worth saying out loud.
 *
 * It is not a failure and it stops nothing — it is the delay the operator is choosing to add to every request that
 * session makes, including the ones a match depends on. The number is deliberately far larger than an ordinary
 * tunnel's overhead and far smaller than a timeout, so it fires on a route that crosses an ocean badly rather
 * than on one that is merely a few milliseconds slower than home.
 */
const SLOW_ROUTE_MS = 1500;

/** Milliseconds as a person would say them. @param {number} ms */
function formatMs(ms) {
  const value = Math.max(0, Math.round(ms));
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} seconds`;
}

/** @param {unknown} body @returns {string|null} */
function readIpFromBody(body) {
  if (typeof body !== 'string') return null;
  const json = /"ip"\s*:\s*"([^"]+)"/i.exec(body);
  if (json) return json[1].trim();
  const bare = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(body);
  return bare ? bare[1] : null;
}

/** @param {{ip: string, ms?: number|null}} reading */
function describeSuccess(reading) {
  const took = Number.isFinite(reading.ms) ? ` It answered in ${formatMs(Number(reading.ms))}` : '';
  const slow =
    Number.isFinite(reading.ms) && Number(reading.ms) > SLOW_ROUTE_MS
      ? ' That is slow, and every request this session makes will carry that delay.'
      : '';
  return `Works. Requests through this address leave as ${reading.ip}.${took}${slow}`;
}

/**
 * Words for "something answered and it was not an address".
 *
 * The probe cannot tell a captive portal from a login page with a proxy's filters in front of it; it can say which
 * situations produce this shape, and that is what it does.
 */
function describeNotAnAddress() {
  return 'Something answered, but not with an address, so this is not a proxy. A shared network asking you to sign in looks exactly like this.';
}

/**
 * @param {string} reason what the load reported
 * @param {{credentials?: unknown}|null} [route]
 */
function describeFailure(reason, route = null) {
  const detail = String(reason || '').trim();
  // A certificate problem is its own situation: something answered, and what it said cannot be trusted. The
  // advice is different from "check the host and port" — the host and port are working, which is why a page was
  // served at all.
  if (/ERR_CERT|CERT_|certificate/i.test(detail))
    return `Something answered with a certificate this machine will not accept: ${detail}. On a paid proxy that usually means the provider is intercepting the connection; do not continue past this warning.`;
  // The host name did not resolve, so nothing reached the proxy at all. If the operator pasted a numeric address
  // this cannot happen, which is worth saying rather than guessing at.
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|NXDOMAIN/i.test(detail))
    return `The host name could not be looked up: ${detail}. Check the spelling, or paste the provider's numeric address instead.`;
  // "Something answered and it was not the service" is what a guest network does, and it is not a proxy failure.
  if (/ERR_SSL_PROTOCOL_ERROR|ERR_SSL_VERSION|ERR_HTTP_RESPONSE_CODE_FAILURE/i.test(detail))
    return `Something answered, but not as the address should: ${detail}. On a shared or public network that is often a sign-in page for the connection itself.`;
  // Chromium reports ERR_TIMED_OUT, our own deadline says "timed out", and a proxy may say neither.
  if (/timed[_ ]?out|timeout/i.test(detail)) return 'No answer within 25 seconds. The address may be down, blocked, or wrong.';
  if (/407|authentication|credentials/i.test(detail))
    return route && route.credentials
      ? `The address refused the username and password: ${detail}`
      : 'The address asked for a username and password, and none were given. Paste the whole line from your provider, including them.';
  if (/ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION|ERR_ADDRESS|ERR_SOCKS/i.test(detail))
    return `Could not reach the address at all: ${detail}. Check the host and port.`;
  return detail ? `Did not work: ${detail}` : 'Did not work, and no reason was reported.';
}

module.exports = { readIpFromBody, describeSuccess, describeFailure, describeNotAnAddress, formatMs, SLOW_ROUTE_MS };
