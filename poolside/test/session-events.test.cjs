const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachSessionEvents } = require('../src/session-events.cjs');

function harness() {
  const window = /** @type {any} */ (new EventEmitter());
  window.webContents = new EventEmitter();
  window.isDestroyed = () => false;
  window.setTitle = () => {};
  const sent = [];
  let acceptsLoaded = true;
  const logs = [];
  attachSessionEvents(
    /** @type {any} */ ({
      window,
      group: { children: new Set() },
      fsm: {
        canSend: event => event === 'loaded' && acceptsLoaded,
        send: event => {
          sent.push(event);
          if (event === 'loaded') acceptsLoaded = false;
          return true;
        },
        dispose: () => {}
      },
      supervision: { dispose: () => {} },
      accountName: 'Account',
      beforeClose: () => {},
      onClosed: () => {},
      log: message => logs.push(message)
    })
  );
  return { window, sent, logs };
}

test('repeated completed page loads are idempotent after a session is ready', () => {
  const h = harness();
  h.window.webContents.emit('did-finish-load');
  h.window.webContents.emit('did-finish-load');
  assert.deepEqual(h.sent, ['loaded']);
  assert.equal(h.logs.length, 2, 'both real page loads remain visible without a false warning');
});
