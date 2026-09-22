const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachProxyAuthentication } = require('../src/proxy-auth.cjs');
const { resolveProxyRoute } = require('../src/proxy.cjs');

test('credentials answer only the matching proxy challenge', () => {
  const webContents = new EventEmitter();
  const route = resolveProxyRoute({ proxy: { spec: 'nicho:hunter2@proxy.example:3128' } });
  assert.equal(attachProxyAuthentication(webContents, route), true);

  const answers = [];
  let prevented = 0;
  const event = { preventDefault: () => (prevented += 1) };
  webContents.emit('login', event, {}, { isProxy: true, host: 'proxy.example', port: 3128 }, (...answer) => answers.push(answer));
  webContents.emit('login', event, {}, { isProxy: false, host: 'proxy.example', port: 3128 }, (...answer) => answers.push(answer));
  webContents.emit('login', event, {}, { isProxy: true, host: 'other.example', port: 3128 }, (...answer) => answers.push(answer));

  assert.equal(prevented, 1);
  assert.deepEqual(answers, [['nicho', 'hunter2']]);
});

test('routes without credentials install no authentication handler', () => {
  const webContents = new EventEmitter();
  const route = resolveProxyRoute({ proxy: { spec: 'proxy.example:3128' } });
  assert.equal(attachProxyAuthentication(webContents, route), false);
  assert.equal(webContents.listenerCount('login'), 0);
});
