const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createScreenReaderPool } = require('../src/screen-reader-pool.cjs');

// A fake reader factory keeps this suite independent of Tesseract while still exercising the
// real queueing, reuse and idle-retirement logic (defect D6: one worker per click, global lock).
function fakeFactory() {
  const created = [];
  const closed = [];
  const create = () => {
    const reader = { id: created.length + 1, inspect: async () => ({ state: 'lobby' }), close: async () => { closed.push(reader.id); } };
    created.push(reader);
    return Promise.resolve(reader);
  };
  return { create, created, closed };
}

test('serial work reuses one warm reader instead of rebuilding it per inspection', async () => {
  const { create, created, closed } = fakeFactory();
  const pool = createScreenReaderPool({ size: 1, idleMs: 0, create });
  for (let i = 0; i < 5; i++) {
    const entry = await pool.acquire();
    pool.release(entry);
  }
  assert.equal(created.length, 1, 'five inspections, one worker');
  assert.equal(closed.length, 0, 'nothing retired while idleMs is 0');
  await pool.closeAll();
  assert.deepEqual(closed, [1]);
});

test('concurrent work is spread across the pool up to its size', async () => {
  const { create, created } = fakeFactory();
  const pool = createScreenReaderPool({ size: 2, idleMs: 0, create });
  const first = await pool.acquire();
  const second = await pool.acquire();
  assert.equal(created.length, 2);
  assert.notEqual(first, second);
  assert.deepEqual(pool.stats(), { size: 2, created: 2, busy: 2, queued: 0, closed: false });
  pool.release(first);
  pool.release(second);
  await pool.closeAll();
});

test('work beyond the pool size queues and is served on release, not rejected', async () => {
  const { create, created } = fakeFactory();
  const pool = createScreenReaderPool({ size: 1, idleMs: 0, create });
  const held = await pool.acquire();
  let served = false;
  const queued = pool.acquire().then(entry => { served = true; return entry; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(served, false, 'queued work waits');
  assert.equal(created.length, 1, 'queueing does not spawn another worker');
  assert.equal(pool.stats().queued, 1);
  pool.release(held);
  const entry = await queued;
  assert.equal(served, true);
  assert.equal(entry, held, 'the same warm worker serves the queue');
  assert.equal(entry.uses, 2);
  pool.release(entry);
  await pool.closeAll();
});

test('an idle reader is retired, and a later acquire starts a fresh one', async () => {
  const { create, created, closed } = fakeFactory();
  const pool = createScreenReaderPool({ size: 1, idleMs: 25, create });
  const entry = await pool.acquire();
  pool.release(entry);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(closed, [1], 'idle worker closed');
  assert.equal(pool.stats().created, 0);
  const again = await pool.acquire();
  assert.equal(created.length, 2, 'a new worker is created after retirement');
  pool.release(again);
  await pool.closeAll();
});

test('a queued waiter is not starved by idle retirement', async () => {
  const { create, created } = fakeFactory();
  const pool = createScreenReaderPool({ size: 1, idleMs: 25, create });
  const held = await pool.acquire();
  const queued = pool.acquire();
  pool.release(held);
  const entry = await queued;
  assert.equal(created.length, 1);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(pool.stats().created, 1, 'the worker stayed alive to serve the queue and then idled');
  pool.release(entry);
  await pool.closeAll();
});

test('a failing factory does not poison the pool', async () => {
  let attempts = 0;
  const pool = createScreenReaderPool({ size: 1, idleMs: 0, create: () => { attempts++; return attempts === 1 ? Promise.reject(new Error('no language data')) : Promise.resolve({ close: async () => {} }); } });
  await assert.rejects(pool.acquire(), /no language data/);
  assert.equal(pool.stats().created, 0, 'the failed entry is not retained');
  const entry = await pool.acquire();
  assert.equal(attempts, 2);
  pool.release(entry);
  await pool.closeAll();
});

test('closeAll rejects queued work and closes every worker', async () => {
  const { create, closed } = fakeFactory();
  const pool = createScreenReaderPool({ size: 1, idleMs: 0, create });
  const held = await pool.acquire();
  const queued = pool.acquire();
  await pool.closeAll();
  await assert.rejects(queued, /closed/);
  assert.deepEqual(closed, [1]);
  await assert.rejects(pool.acquire(), /closed/);
  assert.equal(pool.stats().closed, true);
  pool.release(held);
});
