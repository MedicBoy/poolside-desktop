// What the balances did around a match: what may be claimed from the readings, and what may not.
//
// The rule this pins: a change is recorded as evidence with its age and its confidence, and never as a
// reconciliation — Poolside has no table of entry fees to check a change against.

const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../src/outcome-evidence.cjs');

const NOW = Date.parse('2026-09-22T00:10:00.000Z');
const reading = (value, options = {}) => ({
  label: 'Coins',
  value,
  exact: options.exact !== false,
  confidence: options.confidence === undefined ? 0.95 : options.confidence,
  observedAt: new Date(options.at === undefined ? NOW - 5000 : options.at).toISOString(),
  source: 'in-game header'
});
const snapshot = readings => evidence.snapshot(readings, NOW);
const outcome = participants => evidence.outcome({ participants });

test('a snapshot keeps what was read, how confidently, and whether it was read at all', () => {
  const full = snapshot({ coins: reading(1000), cash: reading(30, { exact: false }) });
  assert.equal(full.usable, true);
  assert.deepEqual(full.currencies.coins, {
    value: 1000,
    exact: true,
    status: 'current',
    observedAt: new Date(NOW - 5000).toISOString()
  });
  assert.equal(full.currencies.cash.exact, false, 'an abbreviated figure is kept, and marked approximate');

  assert.equal(snapshot(null).usable, false);
  assert.deepEqual(snapshot({ coins: { label: 'Coins' } }).currencies.coins, null, 'a reading with no value is not a value');
  assert.equal(snapshot({ coins: reading(1000, { confidence: 0.4 }) }).currencies.coins.status, 'uncertain');
  assert.equal(
    snapshot({ coins: reading(1000, { at: NOW - 11 * 60000 }) }).currencies.coins.status,
    'stale',
    'older than the staleness floor'
  );
});

test('a change is described with both ends, the delta, and where the reading came from', () => {
  const comparison = evidence.compare(snapshot({ coins: reading(1000) }), snapshot({ coins: reading(950) }));
  assert.equal(comparison.verdict, 'observed');
  assert.deepEqual(comparison.changes, [
    {
      currency: 'coins',
      label: 'Coins',
      from: 1000,
      to: 950,
      delta: -50,
      exact: true,
      fromStatus: 'current',
      toStatus: 'current'
    }
  ]);
  assert.equal(evidence.describeChange('Newfie', comparison), 'Newfie: Coins 1,000 → 950 (-50).');
});

test('nothing moving, an unread balance and an unsure reading are three different answers', () => {
  const unchanged = evidence.compare(snapshot({ coins: reading(1000) }), snapshot({ coins: reading(1000) }));
  assert.equal(unchanged.verdict, 'unchanged');
  assert.equal(evidence.describeChange('Newfie', unchanged), 'Newfie: Coins 1,000 unchanged.');

  const unread = evidence.compare(snapshot(null), snapshot({ coins: reading(950) }));
  assert.equal(unread.verdict, 'unread');
  assert.equal(evidence.describeChange('Newfie', unread), 'Newfie: no balance reading before or after.');

  const unsure = evidence.compare(snapshot({ coins: reading(1000, { confidence: 0.4 }) }), snapshot({ coins: reading(950) }));
  assert.equal(unsure.verdict, 'under-read');
  assert.match(evidence.describeChange('Newfie', unsure), /Coins 1,000 → 950 \(-50\)\./);

  const unchangedButUnsure = evidence.compare(
    snapshot({ coins: reading(1000, { at: NOW - 11 * 60000 }) }),
    snapshot({ coins: reading(1000) })
  );
  assert.equal(unchangedButUnsure.verdict, 'under-read');
  assert.equal(evidence.describeChange('Newfie', unchangedButUnsure), 'Newfie: Coins 1,000 unchanged — read, but not confidently.');
});

test('an approximate reading makes the change approximate, and says so', () => {
  const comparison = evidence.compare(snapshot({ coins: reading(3230, { exact: false }) }), snapshot({ coins: reading(3180) }));
  assert.equal(comparison.changes[0].exact, false);
  assert.match(evidence.describeChange('Newfie', comparison), /\(-50, approximate\)/);
});

test('the whole match is reported with the verdict its evidence deserves', () => {
  const both = (before, after) => [
    { name: 'Newfie', before: snapshot(before), after: snapshot(after) },
    { name: 'Gmail', before: snapshot(before), after: snapshot(after) }
  ];
  const observed = outcome(both({ coins: reading(1000) }, { coins: reading(950) }));
  assert.equal(observed.verdict, 'observed');
  assert.equal(
    observed.reason,
    'Newfie: Coins 1,000 → 950 (-50). Gmail: Coins 1,000 → 950 (-50). Recorded, not reconciled: Poolside has no table of entry fees or prizes to check a change against.'
  );
  assert.equal(observed.readings.length, 2, 'both accounts, both ends of the change');
  assert.deepEqual(
    observed.readings.map(entry => [entry.name, entry.currency, entry.from, entry.to, entry.delta, entry.status]),
    [
      ['Newfie', 'coins', 1000, 950, -50, 'current'],
      ['Gmail', 'coins', 1000, 950, -50, 'current']
    ]
  );

  assert.equal(outcome(both({ coins: reading(1000) }, { coins: reading(1000) })).verdict, 'unchanged');
  assert.equal(outcome(both({ coins: reading(1000, { confidence: 0.4 }) }, { coins: reading(950) })).verdict, 'uncertain');
  assert.equal(outcome(both(null, null)).verdict, 'incomplete');
  assert.match(outcome(both(null, null)).reason, /a balance was not read, so nothing can be said about it/);
  // One account read and one not is incomplete, however confident the read one was.
  assert.equal(
    outcome([
      { name: 'Newfie', before: snapshot({ coins: reading(1000) }), after: snapshot({ coins: reading(950) }) },
      { name: 'Gmail', before: snapshot(null), after: snapshot(null) }
    ]).verdict,
    'incomplete'
  );
});

test('an old reading anywhere in a change marks the record uncertain, not observed', () => {
  const stale = outcome([
    {
      name: 'Newfie',
      before: snapshot({ coins: reading(1000, { at: NOW - 11 * 60000 }) }),
      after: snapshot({ coins: reading(950) })
    },
    { name: 'Gmail', before: snapshot({ coins: reading(1000) }), after: snapshot({ coins: reading(950) }) }
  ]);
  assert.equal(stale.verdict, 'uncertain');
  assert.equal(stale.readings[0].status, 'stale');
  assert.match(stale.reason, /a reading was uncertain or old when it was taken/);
});

test('the verdict labels are the four the record accepts', () => {
  assert.deepEqual(Object.keys(evidence.VERDICTS).sort(), ['incomplete', 'observed', 'uncertain', 'unchanged']);
  assert.deepEqual(require('../src/match-record.cjs').OUTCOME_VERDICTS, ['observed', 'unchanged', 'uncertain', 'incomplete']);
});
