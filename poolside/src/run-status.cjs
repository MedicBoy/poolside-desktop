// Where a run is, and what the operator should do about it.
//
// The card already says what the plan is and how far it has got. What it could not say is the thing a person
// actually needs while a run is going: *where is this now, and what do I do next?* That answer is a function
// of state that already exists — the run's own state and counters, the match in progress under it, the
// readiness barrier, the ages of the screen readings, and the plan's remaining bounds — so it is derived here
// rather than stored, and every branch of it is pinned by a test.
//
// Pure: no Electron, no fs, no clock of its own. `now` and a couple of milliseconds arrive as arguments.

/** How old a screen reading may be before it is worth mentioning that it is old. */
const STALE_OBSERVATION_MS = 120000;

/** `1234` -> `1.2 s`, `74000` -> `1 min 14 s`. Plain, and never more precise than the reading deserves. */
function duration(ms) {
  const value = Math.max(0, Math.round(ms));
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

function count(value, one, many) {
  return `${value} ${value === 1 ? one : many}`;
}

/** What would end this run next, in the operator's terms rather than the plan's field names. */
function nextStop(run) {
  const plan = run.plan;
  const progress = run.progress || {};
  const parts = [];
  const resultsLeft = plan.matchLimit - (progress.completed || 0);
  if (resultsLeft > 0) parts.push(`${count(resultsLeft, 'more result', 'more results')}`);
  if (plan.stopAfterFailures > 0) {
    const left = plan.stopAfterFailures - (progress.consecutiveFailures || 0);
    if (left > 0) parts.push(`${count(left, 'more match', 'more matches')} with no result`);
  }
  if (plan.stopAfterUnconfirmed > 0) {
    const left = plan.stopAfterUnconfirmed - (progress.consecutiveUnconfirmed || 0);
    if (left > 0) parts.push(`${count(left, 'more match', 'more matches')} without a confirmed pairing`);
  }
  if (plan.stopAfterMinutes > 0 && Number.isFinite(progress.remainingMs)) parts.push(`${duration(progress.remainingMs)} left`);
  return parts.length ? `Stops when: ${parts.join(', ')}.` : 'No stop condition is left, so this run will stop at the next one.';
}

/** The release state of the match in progress, in one line. */
function releaseLine(match) {
  if (!match) return { line: 'No match in progress.', skewMs: null };
  const readiness = match.readiness;
  if (!readiness) return { line: 'Release has not been requested yet.', skewMs: null };
  if (readiness.verdict === 'ready')
    return {
      line: `Released${Number.isFinite(readiness.skewMs) ? ` in ${duration(readiness.skewMs)}` : ''}${readiness.releasedAt ? ` (${new Date(readiness.releasedAt).toLocaleTimeString()})` : ''}.`,
      skewMs: Number.isFinite(readiness.skewMs) ? readiness.skewMs : null
    };
  if (readiness.verdict === 'blocked') return { line: `Release is blocked — ${readiness.reason}`, skewMs: null };
  const waiting = (match.participants || []).filter(participant => participant.releasable !== true);
  const why = waiting.map(participant => `${participant.name} — ${String(participant.detail || 'not ready').replace(/\.$/, '')}`);
  return {
    line: `Waiting to release: ${why.join('; ') || 'the profiles'}.`,
    skewMs: null
  };
}

/** How old each session's last screen reading is, which is what a pairing verdict is judged from. */
function observationLines(run, now) {
  return (run.participants || []).map(participant => {
    const at = participant.screen && participant.screen.observedAt ? Date.parse(participant.screen.observedAt) : NaN;
    if (!Number.isFinite(at))
      return { name: participant.name, ageMs: null, line: `${participant.name}: nothing read from the screen yet.` };
    const ageMs = Math.max(0, now - at);
    const shown = participant.screen.state
      ? ` (${participant.screen.state}${participant.screen.identified ? `, ${run.plan.table}` : ''})`
      : '';
    return {
      name: participant.name,
      ageMs,
      line: `${participant.name}: read ${duration(ageMs)} ago${shown}${ageMs > STALE_OBSERVATION_MS ? ' — that is old, look at that window again' : ''}.`
    };
  });
}

/**
 * The whole status of one run.
 * @param {{run: any, match?: any|null, now?: number}} input
 */
function statusFor({ run, match = null, now = Date.now() }) {
  const progress = run.progress || {};
  const participants = run.participants || [];
  const names = participants.map(participant => participant.name).join(' and ');
  const closed = participants.filter(participant => participant.open !== true);
  const observations = observationLines(run, now);
  const oldest = observations.map(entry => entry.ageMs).filter(value => Number.isFinite(value));
  const release = releaseLine(match);
  const pairing = match ? match.pairing : null;
  const attempt = { number: (progress.played || 0) + 1, planned: run.plan.matchLimit };
  const base = {
    attempt,
    release: release.line,
    skewMs: release.skewMs,
    observations,
    oldestObservationMs: oldest.length ? Math.max(...oldest) : null
  };

  if (run.state === 'ended') {
    return {
      ...base,
      stage: 'ended',
      stageLabel: 'Ended',
      attention: 'none',
      stop: { outcome: run.outcome, label: run.outcomeLabel, reason: run.reason },
      nextStop: null,
      nextAction: 'Nothing to do: this run is over. Start a new one when you want to.'
    };
  }

  if (run.state === 'paused') {
    return {
      ...base,
      stage: 'paused',
      stageLabel: 'Paused',
      attention: 'watch',
      stop: null,
      nextStop: nextStop(run),
      nextAction: match
        ? 'The match in progress is not affected. Finish it and record the result, then resume the run for the next one.'
        : 'Resume the run when you are ready: nothing new is started while it is paused.'
    };
  }

  if (!match) {
    return {
      ...base,
      stage: 'between-matches',
      stageLabel: 'Between matches',
      attention: 'act',
      stop: null,
      nextStop: nextStop(run),
      nextAction: `Start match to begin attempt ${attempt.number} of ${attempt.planned}; it will join this run and load both profiles.`
    };
  }

  const readiness = match.readiness ? match.readiness.verdict : null;
  if (readiness === 'blocked') {
    return {
      ...base,
      stage: 'blocked',
      stageLabel: 'Release blocked',
      attention: 'act',
      stop: null,
      nextStop: nextStop(run),
      nextAction: closed.length
        ? `Load both profiles from the match card, or cancel the match — ${closed.map(participant => participant.name).join(' and ')} ${closed.length === 1 ? 'has' : 'have'} no window open.`
        : 'Wait for the profile to finish loading, then press Load both profiles again, or cancel the match.'
    };
  }

  if (readiness === 'ready') {
    const pairingLine = pairing ? `${pairing.label}. ${pairing.reason}` : 'Pairing evidence has not been judged yet.';
    return {
      ...base,
      stage: 'released',
      stageLabel: 'Released — play it',
      attention: pairing && pairing.verdict === 'paired' ? 'none' : 'watch',
      pairing: { verdict: pairing ? pairing.verdict : null, label: pairing ? pairing.label : null, line: pairingLine },
      stop: null,
      nextStop: nextStop(run),
      nextAction:
        pairing && pairing.verdict === 'paired'
          ? 'Play this match, then record the result on the match card.'
          : 'Play this match and record the result. Then look at each window in turn and press Check pairing evidence.'
    };
  }

  return {
    ...base,
    stage: 'preparing',
    stageLabel: 'Getting both profiles ready',
    attention: 'watch',
    stop: null,
    nextStop: nextStop(run),
    nextAction: closed.length
      ? `Load both profiles from the match card — ${closed.map(participant => participant.name).join(' and ')} ${closed.length === 1 ? 'has' : 'have'} no window open yet.`
      : `Wait for ${names} to finish loading; release happens by itself, and the release and how long it took will appear here.`
  };
}

module.exports = { statusFor, duration, nextStop, STALE_OBSERVATION_MS };
