// A small pool of screen readers.
//
// Defect history (D6): every Inspect click built and tore down a Tesseract worker, paying full
// language-data startup each time, and a single module-level `inspecting` flag in main.cjs meant
// one account's inspection blocked every other account. This pool keeps workers warm, reuses them
// across inspections, optionally closes them after an idle period, and queues work beyond the
// pool size instead of failing it. idleMs: 0 pins the reader until closeAll().
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
  /** @type {Promise<void> | null} */
  let warming = null;

  const cancelled = signal => (signal?.reason instanceof Error ? signal.reason : new Error('Screen reader acquisition cancelled.'));

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
    next.cleanup();
    entry.busy = true;
    entry.uses++;
    clearEntryTimer(entry);
    next.resolve(entry);
  }

  /** @param {{signal?: AbortSignal}} [options] */
  async function acquire({ signal } = {}) {
    if (closed) throw new Error('The screen reader pool is closed.');
    if (signal?.aborted) throw cancelled(signal);
    const free = entries.find(entry => !entry.busy);
    if (free) {
      free.busy = true;
      free.uses++;
      clearEntryTimer(free);
      return free;
    }
    if (entries.length < size) {
      const entry = { reader: create(), busy: true, ready: false, workers: 0, uses: 1, timer: null };
      entries.push(entry);
      try {
        const reader = await entry.reader;
        entry.workers = Math.max(1, Number(reader.workerCount) || 1);
      } catch (error) {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
        throw error;
      }
      if (closed) throw new Error('The screen reader pool is closed.');
      entry.ready = true;
      if (signal?.aborted) {
        release(entry);
        throw cancelled(signal);
      }
      return entry;
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', onAbort) };
      const onAbort = () => {
        const index = waiting.indexOf(waiter);
        if (index !== -1) waiting.splice(index, 1);
        waiter.cleanup();
        reject(cancelled(signal));
      };
      waiting.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  function release(entry) {
    if (closed || !entries.includes(entry) || !entry.busy) return;
    entry.busy = false;
    handOff(entry);
  }

  // Reserve and initialize one reader before the first inspection. Concurrent calls share the
  // same promise; if a ready reader is serving an inspection, no second reader is created.
  /** @returns {Promise<void>} */
  function prewarm() {
    if (closed) return Promise.reject(new Error('The screen reader pool is closed.'));
    if (entries.some(entry => entry.ready)) return Promise.resolve();
    if (warming) return warming;
    warming = (async () => {
      const entry = await acquire();
      release(entry);
    })().finally(() => {
      warming = null;
    });
    return warming;
  }

  async function closeAll() {
    closed = true;
    for (const waiter of waiting.splice(0)) {
      waiter.cleanup();
      waiter.reject(new Error('The screen reader pool is closed.'));
    }
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
    return {
      size,
      created: entries.length,
      workers: entries.reduce((total, entry) => total + (entry.ready ? entry.workers : 0), 0),
      busy: entries.filter(entry => entry.busy).length,
      queued: waiting.length,
      closed,
      warmed: !closed && entries.some(entry => entry.ready)
    };
  }

  return { acquire, release, prewarm, closeAll, stats };
}

module.exports = { createScreenReaderPool };
