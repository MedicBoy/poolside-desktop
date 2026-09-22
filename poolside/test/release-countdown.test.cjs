// The count-in's rules and wording: the phase a moment belongs to, the order to click in, and the gap two
// observations amount to.

const test = require('node:test');
const assert = require('node:assert/strict');
// The module's own types are checked in src; the tests exercise behaviour, so the surface is taken as it is.
const countdown = /** @type {any} */ (require('../src/release-countdown.cjs'));

const AT = Date.parse('2026-09-21T12:00:00.000Z');
const order = countdown.clickOrder(['Newfie', 'Gmail']);
const release = (overrides = {}) => ({
  goAt: AT + 5000,
  watchUntil: AT + 35000,
  order,
  observed: [],
  finished: false,
  cancelled: false,
  skewMs: null,
  skewLine: null,
  ...overrides
});

test('a count-in counts, calls GO, and then keeps watching', () => {
  assert.deepEqual(countdown.phaseAt({ goAt: AT + 5000, watchUntil: AT + 35000, now: AT }), { phase: 'counting', secondsLeft: 5 });
  assert.deepEqual(countdown.phaseAt({ goAt: AT + 5000, watchUntil: AT + 35000, now: AT + 4999 }), {
    phase: 'counting',
    secondsLeft: 1
  });
  assert.deepEqual(countdown.phaseAt({ goAt: AT + 5000, watchUntil: AT + 35000, now: AT + 5000 }), { phase: 'go', secondsLeft: 0 });
  assert.deepEqual(countdown.phaseAt({ goAt: AT + 5000, watchUntil: AT + 35000, now: AT + 12000 }), { phase: 'go', secondsLeft: 0 });
  assert.equal(countdown.phaseAt({ goAt: AT + 5000, watchUntil: AT + 35000, now: AT + 35001 }).phase, 'done');
  assert.equal(countdown.phaseAt({ goAt: AT + 5000, watchUntil: AT + 35000, now: AT + 6000, finished: true }).phase, 'done');
});

test('the count-in names the window to click first, because hands cannot click two at once', () => {
  assert.deepEqual(order, { first: 'Newfie', second: 'Gmail', line: "Click Newfie's Play button first, then Gmail's." });
  assert.equal(
    countdown.countingLine({ secondsLeft: 4, first: 'Newfie', second: 'Gmail' }),
    "4… click Newfie's Play button, then Gmail's."
  );
  assert.equal(countdown.goLine({ first: 'Newfie', second: 'Gmail' }), "GO — click Newfie's Play button, then Gmail's.");
});

test('the gap between the two screens moving is what the attempt actually achieved', () => {
  const measured = /** @type {any} */ (
    countdown.measuredSkew(
      [
        { name: 'Gmail', at: AT + 1100 },
        { name: 'Newfie', at: AT + 400 }
      ],
      AT
    )
  );
  assert.equal(measured.skewMs, 700);
  assert.deepEqual(
    measured.entries.map(entry => [entry.name, entry.deltaMs]),
    [
      ['Newfie', 400],
      ['Gmail', 1100]
    ]
  );
  assert.equal(measured.line, 'Newfie 0.4 s after GO, Gmail 1.1 s after GO — 0.7 s apart.');
  // One screen moving is not a measurement: it says the other never queued.
  assert.equal(countdown.measuredSkew([{ name: 'Newfie', at: AT + 400 }], AT), null);
  assert.equal(countdown.measuredSkew([], AT), null);
  assert.equal(countdown.measuredSkew(/** @type {any} */ (null), AT), null);
});

test('a screen that moved before GO is reported at zero rather than at a negative time', () => {
  const measured = /** @type {any} */ (
    countdown.measuredSkew(
      [
        { name: 'Newfie', at: AT - 500 },
        { name: 'Gmail', at: AT + 900 }
      ],
      AT
    )
  );
  assert.deepEqual(
    measured.entries.map(entry => entry.deltaMs),
    [0, 900]
  );
  assert.equal(measured.skewMs, 900);
});

test('what the card draws in each phase, including the two ways it can end', () => {
  assert.equal(countdown.viewFor(null, AT), null);
  assert.deepEqual(countdown.viewFor(release(), AT), {
    phase: 'counting',
    line: "5… click Newfie's Play button, then Gmail's.",
    skewMs: null
  });
  assert.deepEqual(countdown.viewFor(release(), AT + 6000), {
    phase: 'go',
    line: "GO — click Newfie's Play button, then Gmail's. Watching both screens…",
    skewMs: null
  });
  assert.deepEqual(countdown.viewFor(release({ skewLine: 'both moved together — 0.1 s apart.', skewMs: 100 }), AT + 9000), {
    phase: 'done',
    line: 'both moved together — 0.1 s apart.',
    skewMs: 100
  });
  assert.match(countdown.viewFor(release(), AT + 40000).line, /only 0 of 2 moved\. Queue both windows by hand and try again\./);
  assert.deepEqual(countdown.viewFor(release({ cancelled: true }), AT + 1000), {
    phase: 'cancelled',
    line: 'Count-in stopped. The clicks were yours to make; the app queues nothing.',
    skewMs: null
  });
});
