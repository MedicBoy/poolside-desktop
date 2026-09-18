// A small pool of screen readers.
//
// Defect history (D6): every Inspect click built and tore down a Tesseract worker, paying full
// language-data startup each time, and a single module-level `inspecting` flag in main.cjs meant
// one account's inspection blocked every other account. This pool keeps workers warm, reuses them
// across inspections, closes them after an idle period, and queues work beyond the pool size
// instead of failing it.
//
// The factory is injectable so the pool's queueing and idle behaviour can be unit tested without
// loading Tesseract (see test/screen-reader-pool.test.cjs).

const { createScreenReader } = require('./game-screen.cjs');

function createScreenReaderPool(options = {}) {
  const size = Math.max(1, Number(options.size) || 1);
  const idleMs = Math.max(0, Number(options.idleMs ?? 60000));
  const create = options.create || createScreenReader;

  const entries = [];
  const waiting = [];
  let closed = false;

  function clearEntryTimer(entry) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  function retire(entry) {
    const index = entries.indexOf(entry);
    if (index === -1) return Promise.resolve();
    entries.splice(index, 1);
    clearEntryTimer(entry);
    return Promise.resolve(entry.reader)
      .then(reader => reader.close())
      .catch(() => {});
  }

  function armIdle(entry) {
    clearEntryTimer(entry);
    if (idleMs === 0) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!entry.busy && !waiting.length) retire(entry);
    }, idleMs);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
  }

  function handOff(entry) {
    const next = waiting.shift();
    if (!next) {
      armIdle(entry);
      return;
    }
    entry.busy = true;
    entry.uses++;
    clearEntryTimer(entry);
    next.resolve(entry);
  }

  async function acquire() {
    if (closed) throw new Error('The screen reader pool is closed.');
    const free = entries.find(entry => !entry.busy);
    if (free) {
      free.busy = true;
      free.uses++;
      clearEntryTimer(free);
      return free;
    }
    if (entries.length < size) {
      const entry = { reader: create(), busy: true, uses: 1, timer: null };
      entries.push(entry);
      try {
        await entry.reader;
      } catch (error) {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
        throw error;
      }
      return entry;
    }
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  }

  function release(entry) {
    if (closed) return;
    entry.busy = false;
    handOff(entry);
  }

  async function closeAll() {
    closed = true;
    for (const waiter of waiting.splice(0)) waiter.reject(new Error('The screen reader pool is closed.'));
    await Promise.all(
      entries.splice(0).map(entry => {
        clearEntryTimer(entry);
        return Promise.resolve(entry.reader)
          .then(reader => reader.close())
          .catch(() => {});
      })
    );
  }

  function stats() {
    return { size, created: entries.length, busy: entries.filter(entry => entry.busy).length, queued: waiting.length, closed };
  }

  return { acquire, release, closeAll, stats };
}

module.exports = { createScreenReaderPool };
