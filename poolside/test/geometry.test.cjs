const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoreBounds, normaliseRemembered, rememberBounds, describeRestore } = require('../src/geometry.cjs');
const { pickDisplay } = require('../src/display-geometry.cjs');

const PRIMARY = { id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const SECOND = { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
const SOUND = { x: 100, y: 100, width: 1060, height: 800, maximized: false };

test('nothing remembered is a first run, not an error', () => {
  const result = restoreBounds(null, [PRIMARY]);
  assert.equal(result.bounds, null, 'the caller falls back to its own default');
  assert.equal(result.adjusted, false);
  assert.match(String(result.reason), /nothing usable was remembered/);
  assert.deepEqual(result.minimum, { width: 660, height: 560 });
});

test('a sound record is restored exactly, with no adjustment claimed', () => {
  const result = restoreBounds(SOUND, [PRIMARY]);
  assert.deepEqual(result.bounds, { x: 100, y: 100, width: 1060, height: 800 });
  assert.equal(result.displayId, 1);
  assert.equal(result.adjusted, false);
  assert.equal(result.reason, null);
  assert.equal(result.maximized, false);
});

test('corrupt records degrade to nothing remembered instead of throwing or opening a broken window', () => {
  assert.equal(normaliseRemembered(null), null);
  assert.equal(normaliseRemembered([1, 2, 3]), null);
  assert.equal(normaliseRemembered({ x: 'a', y: 0, width: 800, height: 600 }), null);
  assert.equal(normaliseRemembered({ x: 0, y: 0, width: -800, height: 600 }), null);
  assert.equal(normaliseRemembered({ x: 0, y: 0, width: 100, height: 600 }), null, 'below the sane floor');
  assert.equal(normaliseRemembered({ x: 0, y: 0, width: 20000, height: 600 }), null, 'above the sane ceiling');
  assert.equal(normaliseRemembered({ x: 0, y: 0, width: 800.5, height: 600 }), null, 'non-integer');
  assert.equal(normaliseRemembered({ x: 0, y: 0, width: 800, height: 600 })?.maximized, false, 'defaulted');
});

test('a remembered size below the minimum is grown, not applied', () => {
  const result = restoreBounds({ x: 100, y: 100, width: 400, height: 300 }, [PRIMARY]);
  assert.deepEqual(result.bounds, { x: 100, y: 100, width: 660, height: 560 });
  assert.equal(result.adjusted, true);
  assert.match(String(result.reason), /width raised to the 660px minimum/);
  assert.match(String(result.reason), /height raised to the 560px minimum/);
});

test('a window larger than the current display is fitted to it', () => {
  const small = { id: 3, primary: true, workArea: { x: 0, y: 0, width: 1024, height: 600 } };
  const result = restoreBounds({ x: 100, y: 100, width: 1060, height: 800 }, [small]);
  assert.deepEqual(result.bounds, { x: 100, y: 100, width: 1024, height: 600 });
  assert.equal(result.adjusted, true);
  assert.match(String(result.reason), /fitted to the 1024px display/);
});

test('a window on a display that is no longer attached is centred on the primary', () => {
  const result = restoreBounds({ x: 5000, y: 500, width: 1060, height: 800 }, [PRIMARY, SECOND]);
  assert.equal(result.displayId, 1, 'the primary, not the first in the list by luck');
  assert.deepEqual(result.bounds, { x: 430, y: 120, width: 1060, height: 800 });
  assert.equal(result.adjusted, true);
  assert.match(String(result.reason), /not attached/);
});

test('a window whose title bar is off the top is moved back inside the work area', () => {
  const result = restoreBounds({ x: 100, y: -100, width: 1060, height: 800 }, [PRIMARY]);
  assert.deepEqual(result.bounds, { x: 100, y: 0, width: 1060, height: 800 });
  assert.equal(result.adjusted, true);
  assert.match(String(result.reason), /moved back inside/);
});

test('a window the user deliberately left slightly off the edge is left alone', () => {
  const result = restoreBounds({ x: -40, y: 100, width: 1060, height: 800 }, [PRIMARY]);
  assert.deepEqual(result.bounds, { x: -40, y: 100, width: 1060, height: 800 });
  assert.equal(result.adjusted, false, 'the intent is preserved, the window is still reachable');
});

test('the display it overlaps most wins, so a second monitor is respected', () => {
  const bounds = { x: 2000, y: 100, width: 800, height: 600 };
  const display = pickDisplay(bounds, [PRIMARY, SECOND]);
  assert.ok(display, 'a display was chosen');
  assert.equal(display.id, 2);
  const result = restoreBounds(bounds, [PRIMARY, SECOND]);
  assert.equal(result.displayId, 2);
  assert.equal(result.adjusted, false);
});

test('with no display information the record is returned untouched', () => {
  const result = restoreBounds(SOUND, []);
  assert.deepEqual(result.bounds, { x: 100, y: 100, width: 1060, height: 800 });
  assert.equal(result.displayId, null);
  assert.equal(result.adjusted, false);
});

test('a maximized window remembers that it was maximized', () => {
  const result = restoreBounds({ ...SOUND, maximized: true }, [PRIMARY]);
  assert.equal(result.maximized, true);
});

test('rememberBounds rounds, stamps, and keeps the display it was on', () => {
  const remembered = rememberBounds({ x: 10.4, y: 20.6, width: 1060.2, height: 800.7 }, { maximized: true, displayId: 2, now: 0 });
  assert.deepEqual(remembered, {
    x: 10,
    y: 21,
    width: 1060,
    height: 801,
    maximized: true,
    displayId: 2,
    at: '1970-01-01T00:00:00.000Z'
  });
  assert.equal(rememberBounds(SOUND, {}).maximized, false);
  assert.equal(rememberBounds(SOUND, {}).displayId, null);
});

test('describeRestore explains what happened in one line', () => {
  assert.match(describeRestore(restoreBounds(null, [PRIMARY])), /no saved geometry yet/);
  assert.match(describeRestore(restoreBounds(SOUND, [PRIMARY])), /restored exactly/);
  assert.match(describeRestore(restoreBounds({ ...SOUND, x: 9000 }, [PRIMARY])), /restored with adjustments/);
});
