// A record of a run, written where the operator can find it and send it on.
//
// The ledger already holds everything a run produced: the plan, the people, each match with its readiness, its
// pairing verdict and what the balances did around it. What was missing was a way to *take it away* — sending a
// screenshot of a card is not a record, and a bundle assembled by hand goes stale the moment it is written.
//
// What this deliberately excludes, because the application's rule is that these never leave in a shareable
// document: route credentials, browser profiles, page text and images. It does include account names, which is
// stated in the file itself, because a record of "who played whom" without names is not a record.

/** The shape of the file, so a reader (or a later version) can tell what it is. */
const FORMAT = 'poolside-run-report/v1';

function stamp(now) {
  return new Date(now).toISOString();
}

/** One match, as recorded. */
function matchRecord(match) {
  return {
    handle: match.handle,
    state: match.state,
    participants: (match.participants || []).map(participant => participant.name),
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    winner: match.winnerName || null,
    reason: match.reason || null,
    readiness: match.readiness
      ? { verdict: match.readiness.verdict, reason: match.readiness.reason, skewMs: match.readiness.skewMs }
      : null,
    pairing: match.pairing
      ? { verdict: match.pairing.verdict, label: match.pairing.label, reason: match.pairing.reason, table: match.pairing.table }
      : null,
    outcome: match.outcome
      ? {
          verdict: match.outcome.verdict,
          reason: match.outcome.reason,
          readings: (match.outcome.readings || []).map(reading => ({ ...reading }))
        }
      : null
  };
}

/** One run, as recorded, with the matches that belong to it. */
function runRecord(run, matches) {
  return {
    handle: run.handle,
    state: run.state,
    paused: run.state === 'paused',
    participants: (run.participants || []).map(participant => ({ name: participant.name, role: participant.role })),
    plan: { ...run.plan },
    planInWords: run.describe,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    outcome: run.outcome || null,
    outcomeLabel: run.outcomeLabel || null,
    reason: run.reason || null,
    progress: { ...run.progress },
    matches: matches.filter(match => match.handle && match.runId === run.runId).map(matchRecord)
  };
}

/**
 * The whole report: every run with the matches it owns, and the matches that belong to no run.
 * @param {{matches: any}} matchesView the dashboard's match view, which is already free of credentials
 * @param {{now?: number}} [options]
 */
function build(matchesView, { now = Date.now() } = {}) {
  const view = matchesView && typeof matchesView === 'object' ? matchesView : {};
  const runs = view.runs && typeof view.runs === 'object' ? view.runs : { active: null, recent: [] };
  const allRuns = [runs.active, ...(Array.isArray(runs.recent) ? runs.recent : [])].filter(Boolean);
  // Every match the ledger still holds, including the ones the dashboard only counts: a report is not a
  // screenshot of a card that shows the last eight.
  const everyMatch = [...(Array.isArray(view.active) ? view.active : []), ...(Array.isArray(view.recent) ? view.recent : [])];
  return {
    format: FORMAT,
    generatedAt: stamp(now),
    note:
      'A local record of your own coordination. It contains your account names. It contains no passwords, no ' +
      'browser profiles, no screenshots and no page text. Balances are recorded as the sessions reported them, ' +
      'never reconciled against a fee table.',
    runs: allRuns.map(run => runRecord(run, everyMatch)),
    standaloneMatches: everyMatch.filter(match => !match.runId).map(matchRecord)
  };
}

/** @param {number} now */
function fileName(now) {
  return `poolside-run-report-${stamp(now).replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}.json`;
}

module.exports = { build, fileName, matchRecord, runRecord, FORMAT };
