// Pairing evidence: the rules that decide whether two of your own accounts can be said to have met, and the
// claims they refuse to make. Every case here is a shape the game can actually produce.

const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../src/pairing-evidence.cjs');

const NOW = Date.parse('2026-09-21T12:10:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();
/** @param {number} value @param {number} at @param {any} extra */
const reading = (value, at = NOW - 1000, extra = {}) => ({
  label: 'Coins',
  value,
  exact: true,
  confidence: 0.95,
  observedAt: new Date(at).toISOString(),
  source: 'in-game header',
  ...extra
});
/** @param {string} state @param {any} options */
const screen = (state, { at = NOW - 5000, table = null, listed = [] } = {}) => ({
  state,
  observedAt: new Date(at).toISOString(),
  visibleTables: listed,
  tableMatch: table ? { table, method: 'local-evidence' } : null,
  readings: {}
});
/** @param {any[]} participants */
/** @param {any[]} participants */
const judge = participants => evidence.evaluate({ participants, now: NOW });

test('an observation keeps only what a pairing claim may use', () => {
  assert.deepEqual(evidence.observation(screen('table-selection', { table: 'Rome', listed: ['Rome', 'Tokyo', 'Atlantis'] })), {
    at: NOW - 5000,
    atIso: ago(5000),
    state: 'table-selection',
    table: 'Rome',
    listed: ['Rome', 'Tokyo']
  });
  assert.equal(evidence.observation(null), null);
  assert.equal(evidence.observation({ state: 'lobby' }), null, 'an observation without a time is no observation');
  assert.equal(evidence.observation({ state: 'lobby', observedAt: 'not a date' }), null);
});

test('the list of names on a screen is not an identification', () => {
  // A table-selection screen lists venues. Reading the list is not reading *which* table, so the observation
  // keeps it in its own field and the rules below never treat it as agreement.
  const observed = /** @type {any} */ (evidence.observation(screen('table-selection', { listed: ['Rome', 'Tokyo'] })));
  assert.equal(observed.table, null);
  assert.deepEqual(observed.listed, ['Rome', 'Tokyo']);
});

test('a paid entry is a fall in a drawn balance between two current, exact readings', () => {
  assert.deepEqual(evidence.drop({ coins: reading(5000) }, { coins: reading(4000) }, NOW), {
    currency: 'coins',
    amount: 1000,
    from: 5000,
    to: 4000
  });
  assert.equal(evidence.drop({ coins: reading(4000) }, { coins: reading(5000) }, NOW), null, 'a rise is not an entry');
  assert.equal(evidence.drop({ coins: reading(4000) }, { coins: reading(4000) }, NOW), null);
  assert.equal(evidence.drop(null, { coins: reading(4000) }, NOW), null, 'the first reading has nothing to compare with');
  assert.equal(
    evidence.drop({ coins: reading(5000, NOW - 1000, { confidence: 0.4 }) }, { coins: reading(4000) }, NOW),
    null,
    'an uncertain reading is not evidence'
  );
  assert.equal(
    evidence.drop({ coins: reading(5000) }, { coins: reading(4000, NOW - 1, { exact: false }) }, NOW),
    null,
    'an abbreviated figure cannot show a payment'
  );
  assert.equal(
    evidence.drop({ coins: reading(5000, NOW - 11 * 60000) }, { coins: reading(4000) }, NOW),
    null,
    'a reading older than the staleness floor is not evidence'
  );
  assert.equal(/** @type {any} */ (evidence.drop({ cash: reading(30) }, { cash: reading(20) }, NOW)).currency, 'cash');
});

test('two connecting screens are not a pairing, however many of them there are', () => {
  const verdict = judge([
    { name: 'Newfie', observation: evidence.observation(screen('connecting')) },
    { name: 'Gmail', observation: evidence.observation(screen('connecting')) }
  ]);
  assert.equal(verdict.verdict, 'incomplete');
  assert.equal(verdict.label, 'Not enough evidence yet');
  assert.match(verdict.reason, /Both screens are connecting\./);
  assert.match(verdict.reason, /does not say which match it is connecting to/);
});

test('the same table on both screens is agreement, and is labelled as agreement rather than proof', () => {
  const verdict = judge([
    { name: 'Newfie', observation: evidence.observation(screen('table-selection', { table: 'Rome' })) },
    { name: 'Gmail', observation: evidence.observation(screen('table-selection', { table: 'Rome' })) }
  ]);
  assert.equal(verdict.verdict, 'agreed');
  assert.equal(verdict.label, 'Same table on both screens — agreement, not proof');
  assert.equal(verdict.table, 'Rome');
  assert.match(verdict.reason, /this is agreement rather than proof of a pairing/);
});

test('the same entry paid by both accounts inside the window is the strongest local verdict', () => {
  const verdict = judge([
    {
      name: 'Newfie',
      observation: evidence.observation(screen('table-selection', { table: 'Rome' })),
      sighting: { currency: 'coins', amount: 1000, at: NOW - 30000 }
    },
    {
      name: 'Gmail',
      observation: evidence.observation(screen('table-selection', { table: 'Rome' })),
      sighting: { currency: 'coins', amount: 1000, at: NOW - 12000 }
    }
  ]);
  assert.equal(verdict.verdict, 'paired');
  assert.equal(verdict.label, 'Same entry seen on both accounts');
  assert.equal(verdict.amount, 1000);
  assert.equal(verdict.currency, 'coins');
  assert.equal(verdict.table, 'Rome');
  assert.match(verdict.reason, /Both accounts paid 1000 coins within 18 seconds, and both screens show Rome\./);
  assert.match(verdict.reason, /Nothing observed contradicts it\./);
});

test('a shared entry counts even without an identified table, and says so', () => {
  // The table name is the weaker half of the evidence, so it is reported when it exists and never invented.
  const verdict = judge([
    {
      name: 'Newfie',
      observation: evidence.observation(screen('table-selection')),
      sighting: { currency: 'cash', amount: 5, at: NOW - 4000 }
    },
    {
      name: 'Gmail',
      observation: evidence.observation(screen('table-selection')),
      sighting: { currency: 'cash', amount: 5, at: NOW - 2000 }
    }
  ]);
  assert.equal(verdict.verdict, 'paired');
  assert.equal(verdict.table, null);
  assert.equal(verdict.currency, 'cash');
  assert.equal(verdict.amount, 5);
  assert.doesNotMatch(verdict.reason, /both screens show/);
});

test('two accounts paying different amounts inside the window is not one shared entry', () => {
  const verdict = judge([
    {
      name: 'Newfie',
      observation: evidence.observation(screen('table-selection')),
      sighting: { currency: 'coins', amount: 500, at: NOW - 4000 }
    },
    {
      name: 'Gmail',
      observation: evidence.observation(screen('table-selection')),
      sighting: { currency: 'coins', amount: 1000, at: NOW - 2000 }
    }
  ]);
  assert.equal(verdict.verdict, 'mismatch');
  assert.match(verdict.reason, /Newfie paid 500 coins and Gmail paid 1000 coins\. Different amounts are not one shared entry\./);
});

test('two screens naming different tables are reported as disagreeing, not as missing evidence', () => {
  const verdict = judge([
    { name: 'Newfie', observation: evidence.observation(screen('table-selection', { table: 'Rome' })) },
    { name: 'Gmail', observation: evidence.observation(screen('table-selection', { table: 'Tokyo' })) }
  ]);
  assert.equal(verdict.verdict, 'mismatch');
  assert.equal(verdict.label, 'The two screens disagree');
  assert.match(verdict.reason, /Newfie shows Rome and Gmail shows Tokyo\. Those are two different tables\./);
});

test('an observation outside the window is asked for again rather than counted', () => {
  const verdict = judge([
    { name: 'Newfie', observation: evidence.observation(screen('table-selection', { table: 'Rome', at: NOW - 5000 })) },
    { name: 'Gmail', observation: evidence.observation(screen('table-selection', { table: 'Rome', at: NOW - 4 * 60000 })) }
  ]);
  assert.equal(verdict.verdict, 'incomplete');
  assert.match(verdict.reason, /The reading from Gmail is older than the 120 second window\. Look at that window again\./);
});

test('the reason names the participant that has said nothing yet', () => {
  const verdict = judge([
    { name: 'Newfie', observation: evidence.observation(screen('table-selection', { table: 'Rome' })) },
    { name: 'Gmail', observation: null }
  ]);
  assert.equal(verdict.verdict, 'incomplete');
  assert.equal(verdict.reason, 'No screen reading yet from Gmail.');
  assert.deepEqual(
    verdict.participants.map(entry => [entry.name, entry.state, entry.table]),
    [
      ['Newfie', 'table-selection', 'Rome'],
      ['Gmail', null, null]
    ]
  );
  assert.match(
    judge([
      { name: 'Newfie', observation: null },
      { name: 'Gmail', observation: null }
    ]).reason,
    /No screen reading yet from Newfie and Gmail/
  );
});

test('one account entering a table is not a pairing, and the reason says which one', () => {
  const verdict = judge([
    {
      name: 'Newfie',
      observation: evidence.observation(screen('table-selection')),
      sighting: { currency: 'coins', amount: 1000, at: NOW - 4000 }
    },
    { name: 'Gmail', observation: evidence.observation(screen('lobby')) }
  ]);
  assert.equal(verdict.verdict, 'incomplete');
  assert.equal(verdict.reason, 'Newfie paid an entry inside the window; Gmail did not. One account entering a table is not a pairing.');
});

test('a pairing is only judged from two participants, and every verdict carries the same shape', () => {
  const verdict = judge([{ name: 'Newfie', observation: evidence.observation(screen('lobby')) }]);
  assert.equal(verdict.verdict, 'incomplete');
  assert.equal(verdict.reason, 'A pairing needs two participants.');
  assert.deepEqual(Object.keys(verdict).sort(), [
    'amount',
    'checkedAt',
    'currency',
    'label',
    'participants',
    'reason',
    'table',
    'verdict',
    'windowMs'
  ]);
  assert.equal(verdict.windowMs, evidence.WINDOW_MS);
  assert.equal(verdict.checkedAt, new Date(NOW).toISOString());
});

test('the verdict has only the four values the record accepts', () => {
  assert.deepEqual(Object.keys(evidence.VERDICTS).sort(), ['agreed', 'incomplete', 'mismatch', 'paired']);
  assert.deepEqual(require('../src/match-record.cjs').PAIRING_VERDICTS, ['paired', 'agreed', 'mismatch', 'incomplete']);
});
