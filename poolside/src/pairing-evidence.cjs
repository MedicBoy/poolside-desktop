// Pairing evidence: what the two sessions actually showed, and whether that is enough to say they met.
//
// Gate 3 asks for proof that two of your own accounts reached the same match. Nothing in Poolside talks to
// the game, so the evidence has to come from what each session's own screen reader reported. These rules
// are deliberately hard to satisfy. A screen reading "connecting" says nothing about *which* match it is
// connecting to, so two of them say no more than one of them — that is the exact claim this module exists
// to refuse. What can be shown locally is agreement between the two screens, and, when the balances are
// read at all, the same entry paid by both accounts inside a window of time.
//
// Pure: no Electron, no fs, no clock of its own. Every input arrives as an argument, so each rule below is
// arithmetic a test can pin. The runtime that collects these inputs is `match-pairing.cjs`.

const { readingStatus } = require('./reading-status.cjs');
const { TABLES } = require('./table-list.cjs');

/** How long an observation stays usable as evidence. The operator focuses one window at a time, and the
 *  monitor samples the focused one, so a window has to be wide enough to cover looking at both. */
const WINDOW_MS = 120000;

/** The states a table name can be read from. */
const TABLE_STATES = ['table-selection'];
/** States that carry no information about a pairing, however many of them there are. */
const SILENT_STATES = ['connecting', 'loading'];

const CURRENCIES = ['coins', 'cash'];

/** The words the card and the activity log agree on. */
const VERDICTS = {
  paired: 'Same entry seen on both accounts',
  agreed: 'Same table on both screens — agreement, not proof',
  mismatch: 'The two screens disagree',
  incomplete: 'Not enough evidence yet'
};

/**
 * What one session's last reading says, reduced to what a pairing claim may use.
 * @param {{state?: unknown, observedAt?: unknown, visibleTables?: unknown, tableMatch?: any}|null} screen
 * @returns {{at: number, atIso: string, state: string, table: string|null, listed: string[]}|null}
 */
function observation(screen) {
  if (!screen || typeof screen !== 'object') return null;
  const atIso = typeof screen.observedAt === 'string' ? screen.observedAt : '';
  const at = Date.parse(atIso);
  if (!Number.isFinite(at) || typeof screen.state !== 'string') return null;
  // The identified table is the one the local visual matcher recognised from reviewed Evidence. The list of
  // names on the screen is not an answer: a table-selection screen lists venues, so "Rome appears" does not
  // mean Rome is the chosen one.
  const matched = screen.tableMatch && TABLES.includes(screen.tableMatch.table) ? screen.tableMatch.table : null;
  const listed = (Array.isArray(screen.visibleTables) ? screen.visibleTables : []).filter(table => TABLES.includes(table));
  return { at, atIso, state: screen.state, table: matched, listed };
}

/**
 * A drop in one balance between two readings, which is what paying an entry fee looks like.
 *
 * Both readings must be current — a value the reader was unsure of, or one older than the staleness floor,
 * is not evidence — and both must be exact, because an abbreviated figure (`3.23k`) cannot show a small
 * payment at all. A rise is not an entry, and only the currencies the game actually draws are considered.
 * @param {Record<string, any>|null} previous @param {Record<string, any>|null} current @param {number} now
 * @returns {{currency: string, amount: number, from: number, to: number}|null}
 */
function drop(previous, current, now) {
  if (!previous || !current || typeof previous !== 'object' || typeof current !== 'object') return null;
  for (const currency of CURRENCIES) {
    const before = previous[currency];
    const after = current[currency];
    if (!before || !after) continue;
    if (readingStatus(before, now) !== 'current' || readingStatus(after, now) !== 'current') continue;
    if (before.exact === false || after.exact === false) continue;
    if (!Number.isFinite(before.value) || !Number.isFinite(after.value)) continue;
    const amount = before.value - after.value;
    if (amount > 0) return { currency, amount, from: before.value, to: after.value };
  }
  return null;
}

/** @param {number} ms */
function seconds(ms) {
  return Math.round(ms / 1000);
}

/** @param {number} ms */
function minutes(ms) {
  const value = Math.round(ms / 60000);
  return value > 0 ? `${value} minute${value === 1 ? '' : 's'}` : `${seconds(ms)} seconds`;
}

/** @param {any} sighting @param {number} windowMs */
function sightingIn(sighting, now, windowMs) {
  return Boolean(sighting && Number.isFinite(sighting.at) && now - sighting.at <= windowMs && sighting.at <= now);
}

/**
 * What the evidence says about whether this pair met.
 *
 * The ladder, and the reason it is in this order:
 *   1. Contradicting evidence first. Two screens naming different tables, or two accounts paying out
 *      different amounts inside the window, are not a pairing — and saying so is more useful than reporting
 *      a missing reading.
 *   2. A shared entry. Both accounts paying the same amount of the same currency inside the window, with
 *      nothing contradicting it, is the strongest thing a local reader can show. The reason states exactly
 *      what was seen, so the claim never reads stronger than its evidence.
 *   3. Agreement. The same table identified on both screens is evidence they are looking at the same table,
 *      and it is labelled agreement rather than proof.
 *   4. Nothing usable, with the reason naming what is missing.
 * @param {{participants: {id?: string, name: string, observation: any, sighting?: any}[], windowMs?: number, now: number}} input
 */
function evaluate({ participants, windowMs = WINDOW_MS, now }) {
  const entries = (Array.isArray(participants) ? participants : []).map(entry => {
    const seen = entry && entry.observation && Number.isFinite(entry.observation.at) ? entry.observation : null;
    return {
      name: entry && entry.name ? String(entry.name) : 'An account',
      observation: seen,
      fresh: Boolean(seen && now - seen.at <= windowMs && seen.at <= now),
      sighting: entry && entry.sighting ? entry.sighting : null
    };
  });
  const names = entries.map(entry => entry.name).join(' and ');
  const detail = { table: null, currency: null, amount: null };

  if (entries.length < 2) return finish('incomplete', 'A pairing needs two participants.', detail, entries, windowMs, now);
  if (!entries.some(entry => entry.observation))
    return finish('incomplete', `No screen reading yet from ${names}.`, detail, entries, windowMs, now);

  const silent = entries.filter(entry => entry.fresh && SILENT_STATES.includes(entry.observation.state));
  if (silent.length === entries.length)
    return finish(
      'incomplete',
      `Both screens are ${[...new Set(silent.map(entry => entry.observation.state))].join(' and ')}. A ${silent[0].observation.state} screen does not say which match it is connecting to, so this is not evidence of pairing.`,
      detail,
      entries,
      windowMs,
      now
    );

  const stale = entries.filter(entry => entry.observation && !entry.fresh);
  if (stale.length === entries.length)
    return finish(
      'incomplete',
      `The last reading is ${minutes(now - Math.max(...entries.map(entry => entry.observation.at)))} old, which is outside the ${seconds(windowMs)} second window.`,
      detail,
      entries,
      windowMs,
      now
    );

  // 1. Contradictions.
  const tables = entries
    .filter(entry => entry.fresh && entry.observation.table)
    .map(entry => ({ name: entry.name, table: entry.observation.table }));
  if (tables.length === entries.length && new Set(tables.map(item => item.table)).size > 1)
    return finish(
      'mismatch',
      `${tables.map(item => `${item.name} shows ${item.table}`).join(' and ')}. Those are two different tables.`,
      { table: null, currency: null, amount: null },
      entries,
      windowMs,
      now
    );

  const paid = entries
    .map(entry => ({ name: entry.name, sighting: entry.sighting }))
    .filter(item => sightingIn(item.sighting, now, windowMs));
  if (paid.length === entries.length) {
    const first = paid[0].sighting;
    const spread = Math.max(...paid.map(item => item.sighting.at)) - Math.min(...paid.map(item => item.sighting.at));
    const same = paid.every(item => item.sighting.currency === first.currency && item.sighting.amount === first.amount);
    if (!same)
      return finish(
        'mismatch',
        `${paid.map(item => `${item.name} paid ${item.sighting.amount} ${item.sighting.currency}`).join(' and ')}. Different amounts are not one shared entry.`,
        detail,
        entries,
        windowMs,
        now
      );
    const shared = tables.length === entries.length && new Set(tables.map(item => item.table)).size === 1 ? tables[0].table : null;
    detail.table = shared;
    detail.currency = first.currency;
    detail.amount = first.amount;
    return finish(
      'paired',
      `Both accounts paid ${first.amount} ${first.currency} within ${seconds(Math.max(spread, 0))} seconds${shared ? `, and both screens show ${shared}` : ''}. Nothing observed contradicts it.`,
      detail,
      entries,
      windowMs,
      now
    );
  }

  // 2. Agreement on a table, without a shared entry.
  if (tables.length === entries.length && new Set(tables.map(item => item.table)).size === 1) {
    detail.table = tables[0].table;
    return finish(
      'agreed',
      `Both screens show ${tables[0].table}. The balances do not confirm a shared entry, so this is agreement rather than proof of a pairing.`,
      detail,
      entries,
      windowMs,
      now
    );
  }

  // 3. Say precisely what is missing, in the order the operator would check it.
  const missingReading = entries.filter(entry => !entry.observation).map(entry => entry.name);
  if (missingReading.length)
    return finish('incomplete', `No screen reading yet from ${missingReading.join(' and ')}.`, detail, entries, windowMs, now);
  const old = entries.filter(entry => !entry.fresh).map(entry => entry.name);
  if (old.length)
    return finish(
      'incomplete',
      `The reading from ${old.join(' and ')} is older than the ${seconds(windowMs)} second window. Look at that window again.`,
      detail,
      entries,
      windowMs,
      now
    );
  const paidNames = paid.map(item => item.name);
  const quiet = entries.filter(entry => !paidNames.includes(entry.name)).map(entry => entry.name);
  if (paidNames.length && quiet.length)
    return finish(
      'incomplete',
      `${paidNames.join(' and ')} paid an entry inside the window; ${quiet.join(' and ')} did not. One account entering a table is not a pairing.`,
      detail,
      entries,
      windowMs,
      now
    );
  const identified = entries.filter(entry => entry.observation.table);
  if (!identified.length)
    return finish(
      'incomplete',
      `Neither screen has been matched to a table from local evidence yet (last seen: ${entries.map(entry => `${entry.name} ${entry.observation.state}`).join(', ')}).`,
      detail,
      entries,
      windowMs,
      now
    );
  return finish(
    'incomplete',
    `Only ${identified.map(entry => entry.name).join(' and ')} has been matched to a table (${identified[0].observation.table}); the other screen has not shown a table yet.`,
    detail,
    entries,
    windowMs,
    now
  );
}

/** Every verdict carries the same shape, so a card never has to guess which fields exist. */
function finish(verdict, reason, detail, entries, windowMs, now) {
  return {
    verdict,
    label: VERDICTS[verdict],
    reason,
    table: detail.table,
    currency: detail.currency,
    amount: detail.amount,
    windowMs,
    checkedAt: new Date(now).toISOString(),
    participants: entries.map(entry => ({
      name: entry.name,
      state: entry.observation ? entry.observation.state : null,
      at: entry.observation ? entry.observation.atIso : null,
      table: entry.observation ? entry.observation.table : null,
      paid: entry.sighting ? { currency: entry.sighting.currency, amount: entry.sighting.amount } : null
    }))
  };
}

module.exports = { evaluate, observation, drop, VERDICTS, WINDOW_MS, TABLE_STATES, SILENT_STATES };
