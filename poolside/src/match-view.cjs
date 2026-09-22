// The dashboard-safe projection of the match ledger.
//
// Split out of `match-coordination.cjs`, which owns what may happen to a match and had grown to carry the
// shape the dashboard reads as well. The rules about *when* a pairing may be judged, what a run may do and
// what a stop condition means all live in their own modules; this one only decides what a card is handed.

/** How many finished matches the dashboard shows. */
const VIEW_LIMIT = 8;

/**
 * @param {any} match
 * @returns {any}
 */
function matchView(match) {
  return {
    handle: match.handle,
    matchId: match.matchId,
    participants: match.participants.map(participant => ({ ...participant })),
    state: match.state,
    runId: match.runId || null,
    winnerId: match.winnerId,
    winnerName: match.winnerName,
    reason: match.reason,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    readiness: match.readiness ? { ...match.readiness } : null,
    pairing: match.pairing ? { ...match.pairing } : null,
    outcome: match.outcome ? { ...match.outcome, readings: (match.outcome.readings || []).map(entry => ({ ...entry })) } : null,
    history: match.history.slice(-4).map(item => ({ ...item }))
  };
}

/**
 * The dashboard-safe projection: counts, the matches in progress, and the most recent finished ones.
 * @param {any} state
 */
function dashboardView(state) {
  const ledger = state.matches;
  return {
    totals: {
      recorded: ledger.length,
      active: ledger.filter(match => match.state === 'active').length,
      completed: ledger.filter(match => match.state === 'completed').length,
      cancelled: ledger.filter(match => match.state === 'cancelled').length
    },
    active: ledger.filter(match => match.state === 'active').map(matchView),
    recent: ledger
      .filter(match => match.state !== 'active')
      .slice(0, VIEW_LIMIT)
      .map(matchView)
  };
}

module.exports = { matchView, dashboardView, VIEW_LIMIT };
