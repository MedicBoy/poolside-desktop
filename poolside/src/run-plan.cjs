// A run plan: how many matches this run is for, and what makes it stop.
//
// The coordinator can already pair two accounts and record a result. What it could not do is say when to
// stop, which put the whole burden on the operator watching a counter by hand. A plan is the answer, and
// this module is the only place that decides what a plan means: the limits it may carry, what the counters
// are, and the verdict that ends a run. It is pure arithmetic over the ledger — no clock, no ledger, no
// Electron — so every rule below is pinned by a test rather than by watching the app.
//
// Balance-based stops are deliberately absent. Poolside has no balance readings, and a plan field that
// could not be enforced would be a promise the program cannot keep. The card says so in words.

const { TABLES } = require('./table-list.cjs');

/** A bound of zero means "no bound", which is why the minimum is zero for two of the three. */
const BOUNDS = {
  matchLimit: { min: 1, max: 50 },
  stopAfterFailures: { min: 0, max: 25 },
  stopAfterMinutes: { min: 0, max: 600 }
};

const DEFAULTS = { matchLimit: 5, stopAfterFailures: 3, stopAfterMinutes: 90 };

/**
 * One whole number, inside its bound, or the fallback when the caller left it out.
 * @param {unknown} value @param {{min: number, max: number}} bound @param {number} fallback @param {string} label
 */
function whole(value, bound, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(number) || number < bound.min || number > bound.max)
    throw new Error(`${label} must be a whole number between ${bound.min} and ${bound.max}.`);
  return number;
}

/**
 * A submitted plan, typed and bounded. The target table is checked against the same list the rest of the
 * application uses, so a plan cannot aim at a table the program could not name.
 * @param {any} input
 * @returns {{table: string, matchLimit: number, stopAfterFailures: number, stopAfterMinutes: number}}
 */
function plan(input) {
  const source = input && typeof input === 'object' ? input : {};
  const table = typeof source.table === 'string' ? source.table.trim() : '';
  if (!TABLES.includes(table)) throw new Error('Choose the table this run is for.');
  return {
    table,
    matchLimit: whole(source.matchLimit, BOUNDS.matchLimit, DEFAULTS.matchLimit, 'The match limit'),
    stopAfterFailures: whole(
      source.stopAfterFailures,
      BOUNDS.stopAfterFailures,
      DEFAULTS.stopAfterFailures,
      'The number of matches in a row with no result'
    ),
    stopAfterMinutes: whole(source.stopAfterMinutes, BOUNDS.stopAfterMinutes, DEFAULTS.stopAfterMinutes, 'The time limit in minutes')
  };
}

/**
 * What has happened in this run so far, counted from the ledger rather than kept beside it: a counter that
 * is stored is a counter that can disagree with the matches it is counting.
 *
 * `consecutiveFailures` is the run of most recent matches that ended with no recorded result. The ledger is
 * newest first, so the count walks from the front and stops at the first match that a result was recorded
 * for. A match still in progress does not break the run: it has not failed yet.
 * @param {{matches: any[], runId: string, startedAt: number, now: number}} input
 */
function counters({ matches, runId, startedAt, now }) {
  const mine = (Array.isArray(matches) ? matches : []).filter(match => match && match.runId === runId);
  let consecutiveFailures = 0;
  for (const match of mine) {
    if (match.state === 'cancelled') consecutiveFailures++;
    else if (match.state === 'completed') break;
  }
  const completed = mine.filter(match => match.state === 'completed').length;
  const cancelled = mine.filter(match => match.state === 'cancelled').length;
  return {
    played: mine.length,
    completed,
    cancelled,
    active: mine.filter(match => match.state === 'active').length,
    consecutiveFailures,
    elapsedMs: Math.max(0, now - startedAt)
  };
}

function minutes(ms) {
  return Math.floor(ms / 60000);
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Whether this run may go on. The order is deliberate: a plan that reached its match limit has finished,
 * which is a better answer than reporting a time bound that happened to cross at the same moment; the
 * failure bound is a statement about the matches themselves; the clock is last.
 * @param {{table: string, matchLimit: number, stopAfterFailures: number, stopAfterMinutes: number}} value
 * @param {{completed: number, consecutiveFailures: number, elapsedMs: number}} counts
 * @returns {{continue: true} | {continue: false, outcome: 'limit'|'failures'|'duration', reason: string}}
 */
function verdict(value, counts) {
  if (counts.completed >= value.matchLimit)
    return {
      continue: false,
      outcome: 'limit',
      reason: `The plan was ${plural(value.matchLimit, 'match', 'matches')} with a recorded result, and ${counts.completed === value.matchLimit ? 'all of them are' : `${counts.completed} are`} recorded.`
    };
  if (value.stopAfterFailures > 0 && counts.consecutiveFailures >= value.stopAfterFailures)
    return {
      continue: false,
      outcome: 'failures',
      reason: `${plural(counts.consecutiveFailures, 'match', 'matches')} in a row ended with no result, and the plan stops after ${value.stopAfterFailures}.`
    };
  if (value.stopAfterMinutes > 0 && counts.elapsedMs >= value.stopAfterMinutes * 60000)
    return {
      continue: false,
      outcome: 'duration',
      reason: `The plan allowed ${plural(value.stopAfterMinutes, 'minute', 'minutes')}, and ${plural(minutes(counts.elapsedMs), 'minute has', 'minutes have')} passed.`
    };
  return { continue: true };
}

/** The plan in one sentence, for the card and the activity log. */
function describe(value) {
  const stops = [];
  if (value.stopAfterFailures > 0) stops.push(`after ${plural(value.stopAfterFailures, 'match', 'matches')} in a row with no result`);
  if (value.stopAfterMinutes > 0) stops.push(`after ${plural(value.stopAfterMinutes, 'minute', 'minutes')}`);
  return [
    `Up to ${plural(value.matchLimit, 'match', 'matches')} with a recorded result on ${value.table}`,
    stops.length ? `stopping ${stops.join(' or ')}` : 'with no other stop condition'
  ].join(', ');
}

/** The same plan as short lines for the card, so nothing has to be read out of a sentence. */
function bounds(value) {
  return [
    `${plural(value.matchLimit, 'match', 'matches')} with a recorded result`,
    value.stopAfterFailures > 0
      ? `stop after ${plural(value.stopAfterFailures, 'match', 'matches')} in a row with no result`
      : 'no limit on matches in a row with no result',
    value.stopAfterMinutes > 0 ? `stop after ${plural(value.stopAfterMinutes, 'minute', 'minutes')}` : 'no time limit'
  ];
}

/** What ended a run, in the words the card uses. */
const OUTCOMES = {
  limit: 'Match limit reached',
  failures: 'Stopped: a run of matches with no result',
  duration: 'Stopped: the time limit was reached',
  stopped: 'Stopped by the operator',
  participants: 'Stopped: a participant left the workspace'
};

module.exports = { plan, counters, verdict, describe, bounds, OUTCOMES, BOUNDS, DEFAULTS };
