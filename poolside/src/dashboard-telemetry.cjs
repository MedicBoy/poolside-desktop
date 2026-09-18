// The dashboard's metrics, collated into layers.
//
// Four subsystems already measure something about a profile or a session, and each lives somewhere different in
// the snapshot:
//
//   - `profile-diagnostics.cjs` measures size: `directoryBytes`, `quotaBytes`, `overQuota`, `truncated`, `unreadable`
//   - the profile manager counts `generation` and records `corruption` history
//   - `recovery-policy.cjs`'s health record flags crashes: `failures`, `attempts`, `exhausted`, `lastFailureReason`
//   - `session-fsm.cjs` knows the session's state and why it got there
//
// A dashboard that reads all four separately re-derives the same joins four times. This collates them once, into
// layers that differ by **sensitivity** as well as by subject:
//
//   summary   counts, for the header
//   sessions  per account: state, why, and the crash flags
//   storage   per account: the generation, the ceiling and what was measured against it
//   export    the anonymised projection — the only layer permitted to leave the machine (ADR-0010)
//
// The `export` layer is not a formatting nicety. ADR-0010 commits M4 to a diagnostics bundle that carries no
// cookies, credentials, IP addresses or account names, verified by an automated scanner. `findSecrets` is that
// scanner, and it is deliberately usable against *any* layer so a test can prove it finds a planted secret
// before asserting it finds none in the export.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

/** The layers, most sensitive first. `export` is the only one that may leave the machine. */
const LAYERS = ['summary', 'sessions', 'storage', 'export'];

/** @param {unknown} value */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The account records in a payload, with anything that is not a record dropped.
 *
 * Every layer starts here rather than mapping the raw array: a `null` in the list is not an account, and letting
 * it through meant `account.id` on `null` — a crash in the one module whose whole job is to be readable when
 * something else has already gone wrong.
 * @param {unknown} accounts
 */
function records(accounts) {
  return (Array.isArray(accounts) ? accounts : []).filter(isPlainObject);
}

/** @param {unknown} value @returns {number|null} */
function readNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Counts for the header. Nothing here is per-account, so nothing here can name one. */
/** @param {any[]} accounts */
function summarise(accounts) {
  const list = records(accounts);
  let open = 0;
  let degraded = 0;
  let crashed = 0;
  let overQuota = 0;
  let corrupted = 0;
  for (const account of list) {
    const state = account && account.status;
    if (state && state !== 'closed') open += 1;
    if (state === 'degraded') degraded += 1;
    const health = account && account.health;
    if (health && (health.failures > 0 || health.exhausted)) crashed += 1;
    const profile = account && account.profile;
    if (profile && profile.overQuota) overQuota += 1;
    if (profile && profile.corruption && profile.corruption.count > 0) corrupted += 1;
  }
  return { accounts: list.length, open, degraded, crashed, overQuota, corrupted };
}

/**
 * Per account: what state the session is in, why, and the crash flags.
 * @param {any[]} accounts
 */
function sessionLayer(accounts) {
  return records(accounts).map(account => {
    const health = isPlainObject(account && account.health) ? account.health : null;
    return {
      id: String(account.id),
      name: account.name,
      state: account.status === undefined ? 'closed' : account.status,
      reason: account.statusReason === undefined ? null : account.statusReason,
      crash: health
        ? {
            failures: readNumber(health.failures) || 0,
            recoveries: readNumber(health.recoveries) || 0,
            attempts: readNumber(health.attempts) || 0,
            exhausted: health.exhausted === true,
            lastFailureAt: health.lastFailureAt || null,
            lastFailureReason: health.lastFailureReason || null
          }
        : null
    };
  });
}

/**
 * Per account: the generation counter, the configured ceiling, and what was measured against it.
 * @param {any[]} accounts
 */
function storageLayer(accounts) {
  return records(accounts).map(account => {
    const profile = isPlainObject(account && account.profile) ? account.profile : {};
    const corruption = isPlainObject(profile.corruption) ? profile.corruption : null;
    return {
      id: String(account.id),
      name: account.name,
      generation: readNumber(profile.generation) || 0,
      established: profile.established === true,
      // `null` and not `0` when nothing has been measured: an unmeasured profile is unknown, not empty.
      directoryBytes: readNumber(profile.directoryBytes),
      fileCount: readNumber(profile.fileCount),
      quotaBytes: readNumber(profile.quotaBytes),
      overQuota: profile.overQuota === true,
      truncated: profile.truncated === true,
      unreadable: profile.unreadable === true || Number(profile.unreadable) > 0,
      measuredAt: profile.checkedAt || null,
      corruption: corruption ? { count: readNumber(corruption.count) || 0, lastAt: corruption.lastAt || null } : null
    };
  });
}

/**
 * The whole dashboard payload.
 * @param {any[]} accounts the snapshot's account views
 * @param {{version?: string, timeline?: any, now?: number}} [options]
 */
function build(accounts, options = {}) {
  return {
    generatedAt: new Date(options.now === undefined ? Date.now() : options.now).toISOString(),
    version: options.version || null,
    summary: summarise(accounts),
    sessions: sessionLayer(accounts),
    storage: storageLayer(accounts),
    timelineSummary: isPlainObject(options.timeline) && isPlainObject(options.timeline.summary) ? options.timeline.summary : null
  };
}

/**
 * The projections each layer exposes, by name. `export` is the anonymised one.
 * @param {string} layer
 */
function describeLayer(layer) {
  const descriptions = {
    summary: 'counts only — no identifier appears in it',
    sessions: 'per account: state, reason, crash flags',
    storage: 'per account: generation, measured size, ceiling, corruption history',
    export: 'anonymised: sequential account references, no names, no paths — the only layer that may leave the machine'
  };
  return descriptions[layer] || 'not a declared layer';
}

module.exports = { build, summarise, sessionLayer, storageLayer, describeLayer, records, LAYERS };
