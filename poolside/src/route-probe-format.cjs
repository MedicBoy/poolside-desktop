// Turning a probe's raw answer into something worth reading.
//
// Pure, so the wording of "did this address work" is testable without launching a browser. The message is
// what the operator sees next to the address they pasted, so it says what happened and, when something
// went wrong, the most likely reason rather than an error code.

/** @param {unknown} body @returns {string|null} */
function readIpFromBody(body) {
  if (typeof body !== 'string') return null;
  const json = /"ip"\s*:\s*"([^"]+)"/i.exec(body);
  if (json) return json[1].trim();
  const bare = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(body);
  return bare ? bare[1] : null;
}

/** @param {{ip: string}} reading */
function describeSuccess(reading) {
  return `Works. Requests through this address leave as ${reading.ip}.`;
}

/**
 * @param {string} reason what the load reported
 * @param {{credentials?: unknown}|null} [route]
 */
function describeFailure(reason, route = null) {
  const detail = String(reason || '').trim();
  // Chromium reports ERR_TIMED_OUT, our own deadline says "timed out", and a proxy may say neither.
  if (/timed[_ ]?out|timeout/i.test(detail)) return 'No answer within 25 seconds. The address may be down, blocked, or wrong.';
  if (/407|authentication|credentials/i.test(detail))
    return route && route.credentials
      ? `The address refused the username and password: ${detail}`
      : 'The address asked for a username and password, and none were given. Paste the whole line from your provider, including them.';
  if (/ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION/i.test(detail)) return `Could not reach the address at all: ${detail}. Check the host and port.`;
  return detail ? `Did not work: ${detail}` : 'Did not work, and no reason was reported.';
}

module.exports = { readIpFromBody, describeSuccess, describeFailure };
