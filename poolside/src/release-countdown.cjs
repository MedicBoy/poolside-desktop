// The count-in for queueing a pair by hand, and the measurement of what two hands actually achieve.
//
// Two accounts have to be queued close together for a service to consider pairing them, and a person clicking
// two windows cannot do that on a clock. What this can do is give one exact moment to aim at, say which window
// to click first, and then **measure** the gap from the game's own screens — which turns "I can't click them
// at the same time" from a complaint into a number. The gap it reports is evidence, never a correction: the
// countdown does not click anything.
//
// Pure: no Electron, no fs, no clock of its own. Every function here is arithmetic and wording over arguments.

/** How long the count-in runs. Long enough to see it, short enough not to be a wait. */
const LEAD_IN_MS = 5000;
/** How long to watch for both screens to move once GO has been called. */
const WATCH_MS = 30000;

/**
 * Which step a moment belongs to.
 * @param {{goAt: number, watchUntil: number, now: number, finished?: boolean}} input
 * @returns {{phase: 'counting'|'go'|'done', secondsLeft: number}}
 */
function phaseAt({ goAt, watchUntil, now, finished = false }) {
  if (finished || now > watchUntil) return { phase: 'done', secondsLeft: 0 };
  if (now < goAt) return { phase: 'counting', secondsLeft: Math.max(1, Math.ceil((goAt - now) / 1000)) };
  return { phase: 'go', secondsLeft: 0 };
}

/** Which window to click first: named, because "both at once" is not something hands can do. */
function clickOrder(names) {
  const [first, second] = names;
  return { first, second, line: `Click ${first}'s Play button first, then ${second}'s.` };
}

/** What the card says while the count-in runs. */
function countingLine({ secondsLeft, first, second }) {
  return `${secondsLeft}… click ${first}'s Play button, then ${second}'s.`;
}

/** What the card says at the moment to click. */
function goLine({ first, second }) {
  return `GO — click ${first}'s Play button, then ${second}'s.`;
}

/** @param {number} ms */
function seconds(ms) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/**
 * The gap between the two screens moving, from the observations each session's own reader produced.
 * @param {{name: string, at: number}[]} observed
 * @returns {{entries: {name: string, at: number, deltaMs: number}[], skewMs: number, line: string}|null}
 */
function measuredSkew(observed, goAt) {
  const entries = (Array.isArray(observed) ? observed : [])
    .filter(entry => entry && Number.isFinite(entry.at))
    .map(entry => ({ ...entry, deltaMs: Math.max(0, entry.at - goAt) }))
    .sort((left, right) => left.at - right.at);
  if (entries.length < 2) return null;
  const skewMs = entries[entries.length - 1].deltaMs - entries[0].deltaMs;
  const line = `${entries.map(entry => `${entry.name} ${seconds(entry.deltaMs)} after GO`).join(', ')} — ${seconds(skewMs)} apart.`;
  return { entries, skewMs, line };
}

/** Everything the card needs to draw the count-in, or null when there is nothing to draw. */
function viewFor(release, now) {
  if (!release) return null;
  const { phase, secondsLeft } = phaseAt({ goAt: release.goAt, watchUntil: release.watchUntil, now, finished: release.finished });
  if (release.cancelled)
    return { phase: 'cancelled', line: 'Count-in stopped. The clicks were yours to make; the app queues nothing.', skewMs: null };
  if (release.skewLine) return { phase: 'done', line: release.skewLine, skewMs: release.skewMs };
  if (phase === 'done')
    return {
      phase: 'done',
      line: `Watched both screens for ${Math.round((WATCH_MS + LEAD_IN_MS) / 1000)} seconds and only ${release.observed.length} of 2 moved. Queue both windows by hand and try again.`,
      skewMs: null
    };
  if (phase === 'counting') return { phase: 'counting', line: countingLine({ secondsLeft, ...release.order }), skewMs: null };
  return {
    phase: 'go',
    line: release.skewLine ? release.skewLine : `${goLine(release.order)} Watching both screens…`,
    skewMs: null
  };
}

module.exports = {
  phaseAt,
  clickOrder,
  countingLine,
  goLine,
  measuredSkew,
  viewFor,
  LEAD_IN_MS,
  WATCH_MS
};
