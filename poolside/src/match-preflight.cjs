// What has to be true about one participant before a match may be released.
//
// The readiness barrier used to ask one question: is this participant's window up and its session ready?
// That is not enough, and the gap is the expensive one to discover late. A session can load the game
// perfectly while Chromium is *not* using the route the account is configured for — a proxy that was
// never applied, a bypass that caught the game host, a route that failed to resolve. The page works, the
// barrier says ready, and the operator believes something false about that session's footprint.
//
// So a participant is releasable when all of these hold, and each is reported separately so a blocked
// match says which one failed rather than just "not ready":
//
//   session — the window exists and the session reached `ready`. That also carries reachability: the
//             game page loaded through this session's own route, because that is how it got there.
//   route   — when the account is configured to use a route, Chromium must resolve that session to it.
//             This is a local question (`session.resolveProxy`), answered at open, with no network call.
//
// Deliberately not gated: whether the page is the *game* rather than a challenge or consent screen. That
// is the recogniser's question, and the recogniser is registered as limited, so gating release on it
// would overstate it. The dashboard reports the last observed screen separately.
//
// Pure: no Electron, no fs. It takes the shape the session already reports and returns a verdict.

/**
 * @param {{route?: any, verified?: any}|null|undefined} footprint the session's reported footprint
 * @returns {{required: boolean, ok: boolean, detail: string}}
 */
function routeVerdict(footprint) {
  const route = footprint && footprint.route;
  if (!route || route.configured !== true) return { required: false, ok: true, detail: 'No route is configured for this account.' };
  const configured = route.label ? `the configured route (${route.label})` : 'the configured route';
  const verified = footprint && footprint.verified;
  if (!verified) return { required: true, ok: false, detail: `This session has not reported which route it uses.` };
  if (verified.ok !== true)
    return { required: true, ok: false, detail: `The route could not be read: ${verified.error || 'no reason was reported'}.` };
  if (verified.matches !== true) {
    const actual = verified.route && verified.route.label ? verified.route.label : 'a different route';
    return { required: true, ok: false, detail: `Chromium is using ${actual}, not ${configured}.` };
  }
  return { required: true, ok: true, detail: `Using ${configured}.` };
}

/**
 * The full verdict for one participant.
 * @param {{open: boolean, status: string, footprint?: any}} session
 */
function participantPreflight(session) {
  const open = Boolean(session && session.open);
  const status = session && typeof session.status === 'string' ? session.status : 'closed';
  const route = routeVerdict(session && session.footprint);
  const loaded = open && status === 'ready';
  const detail = !open
    ? 'The window is closed.'
    : status !== 'ready'
      ? `The session is ${status}.`
      : route.ok
        ? route.required
          ? 'Loaded on the configured route.'
          : 'Loaded with no route configured.'
        : route.detail;
  return { session: { open, status }, loaded, route, ok: loaded && route.ok, detail };
}

module.exports = { participantPreflight, routeVerdict };
