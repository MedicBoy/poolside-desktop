// What a match did to the balances, recorded from the sessions' own readings.
//
// The roadmap asks for a snapshot of the balances before and after a match, with its source, confidence and
// observation age, and for each record to be marked confirmed, uncertain, contradicted or incomplete. This
// module does the honest half of that: it reads what the two sessions showed, compares it, and says plainly
// what it saw — and it does **not** claim a reconciliation, because Poolside has no table of entry fees or
// prizes to check a change against. "Coins fell by 50 on both accounts" is evidence; "the entry fee was paid"
// would be a conclusion this program is not equipped to draw.
//
// Pure: no Electron, no fs, no clock of its own. Readings and a timestamp arrive as arguments.

const { readingStatus } = require('./reading-status.cjs');

const CURRENCIES = [
  { key: 'coins', label: 'Coins' },
  { key: 'cash', label: 'Cash' }
];

/** `1234` -> `1,234`. Balances are whole numbers; grouping them is for reading, not for arithmetic. */
function amount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

/**
 * One session's balances at a moment, as data rather than a claim. A value whose reader was unsure, or which
 * is older than the staleness floor, is kept with that status rather than thrown away: the difference between
 * "not read" and "read, but not confidently" is the difference between incomplete and uncertain.
 * @param {Record<string, any>|null} readings @param {number} now
 */
function snapshot(readings, now = Date.now()) {
  const source = readings && typeof readings === 'object' ? readings : {};
  const currencies = {};
  for (const { key } of CURRENCIES) {
    const reading = source[key];
    currencies[key] =
      reading && Number.isFinite(reading.value)
        ? {
            value: reading.value,
            exact: reading.exact !== false,
            status: readingStatus(reading, now),
            observedAt: typeof reading.observedAt === 'string' ? reading.observedAt : null
          }
        : null;
  }
  const usable = CURRENCIES.some(({ key }) => currencies[key]);
  return { usable, currencies };
}

/**
 * Compare two snapshots of one account.
 * @param {{currencies: Record<string, any>}} before @param {{currencies: Record<string, any>}} after
 */
function compare(before, after) {
  const changes = [];
  let unsure = 0;
  for (const { key, label } of CURRENCIES) {
    const from = before?.currencies?.[key] || null;
    const to = after?.currencies?.[key] || null;
    if (!from || !to) {
      continue;
    }
    changes.push({
      currency: key,
      label,
      from: from.value,
      to: to.value,
      delta: to.value - from.value,
      exact: from.exact !== false && to.exact !== false,
      fromStatus: from.status,
      toStatus: to.status
    });
    if (from.status !== 'current' || to.status !== 'current') unsure += 1;
  }
  const moved = changes.filter(change => change.delta !== 0);
  const verdict = !changes.length ? 'unread' : !moved.length ? (unsure ? 'under-read' : 'unchanged') : unsure ? 'under-read' : 'observed';
  return { changes, verdict };
}

/** One account's line: what moved, by how much, and how confident the readings were. */
function describeChange(name, comparison) {
  if (!comparison.changes.length) return `${name}: no balance reading before or after.`;
  const moved = comparison.changes.filter(change => change.delta !== 0);
  const describe = change =>
    `${change.label} ${amount(change.from)} → ${amount(change.to)} (${change.delta > 0 ? '+' : ''}${amount(change.delta)}${change.exact ? '' : ', approximate'})`;
  if (!moved.length)
    return `${name}: ${comparison.changes.map(change => `${change.label} ${amount(change.to)} unchanged`).join(', ')}${
      comparison.changes.some(change => change.fromStatus !== 'current' || change.toStatus !== 'current')
        ? ' — read, but not confidently'
        : ''
    }.`;
  return `${name}: ${moved.map(describe).join(', ')}.`;
}

/**
 * The whole match: one line per account and a verdict that says how much the evidence is worth.
 * @param {{participants: {name: string, before: any, after: any}[], now?: number}} input
 */
function outcome({ participants }) {
  const described = (participants || []).map(entry => ({
    name: entry.name,
    comparison: compare(entry.before, entry.after)
  }));
  const lines = described.map(entry => describeChange(entry.name, entry.comparison));
  const anyUnread = described.some(entry => entry.comparison.verdict === 'unread');
  const anyUnderRead = described.some(entry => entry.comparison.verdict === 'under-read');
  const anyMoved = described.some(entry => entry.comparison.verdict === 'observed');
  const verdict = anyUnread ? 'incomplete' : anyUnderRead ? 'uncertain' : anyMoved ? 'observed' : 'unchanged';
  const closing = {
    incomplete: 'Recorded, not reconciled: a balance was not read, so nothing can be said about it.',
    uncertain: 'Recorded, not reconciled: a reading was uncertain or old when it was taken.',
    observed: 'Recorded, not reconciled: Poolside has no table of entry fees or prizes to check a change against.',
    unchanged: 'Recorded, not reconciled: no change was observed in the readings that were taken.'
  };
  return {
    verdict,
    reason: `${lines.join(' ')} ${closing[verdict]}`,
    readings: described.flatMap((entry, index) =>
      entry.comparison.changes.map(change => ({
        name: entry.name,
        currency: change.currency,
        from: change.from,
        to: change.to,
        delta: change.delta,
        exact: change.exact,
        status: [change.fromStatus, change.toStatus].includes('stale')
          ? 'stale'
          : [change.fromStatus, change.toStatus].includes('uncertain')
            ? 'uncertain'
            : 'current',
        position: index
      }))
    )
  };
}

const VERDICTS = {
  observed: 'Balances recorded before and after',
  unchanged: 'Balances recorded, nothing moved',
  uncertain: 'Balances recorded, but not confidently',
  incomplete: 'Balances not read'
};

module.exports = { snapshot, compare, outcome, describeChange, VERDICTS, CURRENCIES };
