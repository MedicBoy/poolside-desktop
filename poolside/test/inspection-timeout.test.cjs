const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInspector } = require('../src/inspection.cjs');
const { sessions } = require('../src/state.cjs');

test('an OCR result arriving after the deadline cannot save a capture or replace the failure state', async () => {
  const id = 'inspection-timeout-fixture';
  const recorded = [];
  let finishOcr;
  let released = 0;
  const png = Buffer.from('image fixture');
  const picture = { isEmpty: () => false, getSize: () => ({ width: 1200, height: 800 }), resize: () => picture, toPNG: () => png };
  const wc = {
    getURL: () => 'https://www.8ballpool.com/',
    isLoadingMainFrame: () => false,
    isDestroyed: () => false,
    capturePage: async () => picture
  };
  const group = { window: { isDestroyed: () => false, webContents: wc }, observationGeneration: 1 };
  sessions.set(id, /** @type {any} */ (group));
  try {
    const inspector = createInspector({
      getAccount: () => ({ name: 'Fixture' }),
      publish: () => {},
      log: () => {},
      screenReaders: {
        acquire: async () => ({ reader: Promise.resolve({ inspect: () => new Promise(resolve => (finishOcr = resolve)) }) }),
        release: () => released++
      },
      captureLab: { record: input => recorded.push(input) },
      inspectionTimeoutMs: 10
    });
    await assert.rejects(inspector.inspectGame(id, { expectedState: 'shop' }), /timed out/);
    assert.equal(group.gameScreen.state, 'inspection-failed');
    assert.equal(typeof finishOcr, 'function');
    finishOcr({ state: 'shop', score: 1, evidence: [], readings: {} });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(recorded.length, 0);
    assert.equal(group.gameScreen.state, 'inspection-failed');
    assert.equal(released, 1);
  } finally {
    sessions.delete(id);
  }
});
