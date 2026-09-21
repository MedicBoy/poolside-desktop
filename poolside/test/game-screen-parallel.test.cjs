const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createScreenReader } = require('../src/game-screen.cjs');

const frame = () =>
  sharp({ create: { width: 12, height: 12, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
const result = text => ({ data: { text, confidence: 100, blocks: [] } });

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('The expected OCR pass did not start.');
}

function pairedFactory() {
  const calls = [];
  const closed = [];
  /** @type {any} */
  const workerFactory = async () => {
    const index = calls.length;
    /** @type {any} */
    const call = { recognitions: 0, resolve: null };
    calls.push(call);
    return {
      setParameters: async () => {},
      recognize: () =>
        new Promise(resolve => {
          call.recognitions++;
          call.resolve = resolve;
        }),
      terminate: async () => closed.push(index)
    };
  };
  return { workerFactory, calls, closed };
}

test('color OCR and mask OCR run concurrently on a warm pair', { timeout: 10000 }, async () => {
  const { workerFactory, calls, closed } = pairedFactory();
  const reader = await createScreenReader({ workerFactory });
  try {
    assert.equal(reader.workerCount, 2);
    const pending = reader.inspect(await frame());
    await until(() => calls[0].recognitions && calls[1].recognitions);
    calls[1].resolve(result(''));
    calls[0].resolve(result('ENTRY FEE PRIZE'));
    const observed = await pending;
    assert.equal(observed.state, 'table-selection');
    assert.ok(observed.stages.firstOcrMs > 0);
    assert.ok(observed.stages.contrastOcrMs > 0);
  } finally {
    await reader.close();
  }
  assert.deepEqual(closed.sort(), [0, 1]);
});

test('a settled first-pass screen returns without waiting for the mask worker', { timeout: 10000 }, async () => {
  const { workerFactory, calls } = pairedFactory();
  const reader = await createScreenReader({ workerFactory });
  try {
    const pending = reader.inspect(await frame());
    await until(() => calls[0].recognitions && calls[1].recognitions);
    calls[0].resolve(result('COME BACK EVERY DAY PLAY FREE'));
    const observed = await Promise.race([
      pending,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Shortcut waited for mask OCR.')), 500))
    ]);
    assert.equal(observed.state, 'lucky-promotion');
    calls[1].resolve(result(''));
  } finally {
    await reader.close();
  }
});

test('repeated settled screens skip mask OCR after the first speculative frame', { timeout: 10000 }, async () => {
  const { workerFactory, calls } = pairedFactory();
  const reader = await createScreenReader({ workerFactory });
  try {
    const image = await frame();
    const first = reader.inspect(image);
    await until(() => calls[0].recognitions === 1 && calls[1].recognitions === 1);
    calls[0].resolve(result('COME BACK EVERY DAY PLAY FREE'));
    assert.equal((await first).state, 'lucky-promotion');
    calls[1].resolve(result(''));
    const second = reader.inspect(image);
    await until(() => calls[0].recognitions === 2);
    calls[0].resolve(result('COME BACK EVERY DAY PLAY FREE'));
    assert.equal((await second).state, 'lucky-promotion');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(calls[1].recognitions, 1, 'the second settled screen uses one OCR pass');
  } finally {
    await reader.close();
  }
});

test('a partially provisioned pair is terminated on startup failure', async () => {
  let closed = false;
  let creations = 0;
  /** @type {any} */
  const workerFactory = async () => {
    if (creations++) throw new Error('second worker failed');
    return {
      terminate: async () => {
        closed = true;
      },
      setParameters: async () => {}
    };
  };
  await assert.rejects(createScreenReader({ workerFactory }), /second worker failed/);
  assert.equal(closed, true);
});
