// What the machine was doing when a support bundle was written.
//
// A bundle that carries only a redacted timeline answers "what happened" and not "in what state". Three of the
// problems reported by the operator were states: a workspace that could not be saved, identity values the
// browser refused, and a match in progress with nothing behind it. None of those need a name or a path to be
// diagnosable — a count, a flag and a set of field *names* are enough — so this module states them and leaves
// every value out.
//
// Pure: it reads the snapshot it is handed and nothing else.

/** The identity fields a session may override. Names only: the values are the operator's own. */
const IDENTITY_FIELDS = ['userAgent', 'acceptLanguages', 'locale', 'timezone', 'viewport', 'colorScheme', 'quotaBytes'];

/** @param {any[]} accounts */
function identityFieldsInUse(accounts) {
  const fields = new Set();
  for (const account of accounts) {
    const identity = account && account.overview ? account.overview.identity : null;
    if (!identity || typeof identity !== 'object') continue;
    for (const field of IDENTITY_FIELDS) if (identity[field]) fields.add(field);
  }
  return [...fields].sort();
}

/** A session is open unless it says otherwise; the status vocabulary is the only thing read here. */
function isOpen(account) {
  return !['closed', 'closing', undefined, null].includes(account && account.status);
}

/**
 * @param {any} snapshot
 * A note on what is deliberately absent: an earlier version carried a SHA-256 of the workspace file so two
 * bundles could be compared, and the application's own scanner **refused the payload** — a long opaque string is
 * exactly the shape it exists to stop. It was right. Size and last-written time answer the same question
 * ("was it the same file?") without needing a secret-looking value in a share-safe document.
 * @param {{workspaceBytes?: number|null, workspaceWrittenAt?: string|null, recoveryCandidates?: number}} [extra]
 */
function stateSummary(snapshot, extra = {}) {
  const current = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const accounts = Array.isArray(current.accounts) ? current.accounts : [];
  const archived = Array.isArray(current.archivedAccounts) ? current.archivedAccounts : [];
  const all = [...accounts, ...archived];
  const matches = current.matches && typeof current.matches === 'object' ? current.matches : {};
  const runs = matches.runs && typeof matches.runs === 'object' ? matches.runs : {};
  const attention = current.attention && Array.isArray(current.attention.items) ? current.attention.items : [];
  return {
    readOnly: current.readOnly === true,
    version: typeof current.version === 'string' ? current.version : null,
    accounts: {
      active: accounts.length,
      archived: archived.length,
      open: accounts.filter(isOpen).length
    },
    // Which identity fields are in use, never what they are set to: "a time zone override was configured" is
    // the fact that diagnoses the problem, and the value belongs to the person who typed it.
    identityFieldsInUse: identityFieldsInUse(all),
    routePresets: Array.isArray(current.routePresets) ? current.routePresets.length : 0,
    matches: matches.totals || {},
    runs: {
      active: Boolean(runs.active),
      paused: Boolean(runs.active && runs.active.paused),
      recent: Array.isArray(runs.recent) ? runs.recent.length : 0
    },
    // Codes and levels only. The items themselves name accounts, which a bundle must never carry.
    attention: attention.map(entry => ({ code: entry.code, level: entry.level })),
    recovery: { candidates: Number.isInteger(extra.recoveryCandidates) ? extra.recoveryCandidates : 0 },
    files: {
      workspaceBytes: Number.isInteger(extra.workspaceBytes) ? extra.workspaceBytes : null,
      workspaceWrittenAt: typeof extra.workspaceWrittenAt === 'string' ? extra.workspaceWrittenAt : null
    }
  };
}

module.exports = { stateSummary, IDENTITY_FIELDS };
