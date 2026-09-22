const { app, session, safeStorage, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const saved = require('../src/saved-session.cjs');
const { createProfileStore } = require('../src/profiles.cjs');
const [root, mode] = process.argv.slice(2);
app.setPath('userData', root);
app
  .whenReady()
  .then(async () => {
    // Electron tears down its compositor once the window count reaches zero; a BrowserWindow
    // created after that fails to load with ERR_FAILED (-2). Poolside's dashboard window is alive
    // for the whole session so it never hits this, but this test destroys its window every
    // iteration. Keep one window alive for the duration of the run.
    const keepAlive = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await keepAlive.loadURL('data:text/html,<title>keep-alive</title>');
    const profiles = createProfileStore({ log: () => {} });
    /** @type {import('../src/types.cjs').Account[]} */
    const accounts = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'A & <test>',
        role: 'receiver',
        archived: false,
        createdAt: new Date(0).toISOString()
      },
      { id: '22222222-2222-4222-8222-222222222222', name: 'B', role: 'sender', archived: false, createdAt: new Date(0).toISOString() }
    ];
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const store = session.fromPartition(saved.partition(account.id));
      assert.equal(store.isPersistent(), true);
      store.protocol.handle('https', () => new Response('<title>Local storage fixture</title>'));
      const window = new BrowserWindow({ show: false, webPreferences: { session: store, sandbox: true } });
      await window.loadURL('https://example.test/');
      await profiles.prepare(account, store);
      if (mode === 'seed') {
        await store.cookies.set({
          url: 'https://example.test',
          name: 'session',
          value: `test-session-${i}`,
          secure: true,
          httpOnly: true,
          sameSite: 'lax'
        });
        await store.cookies.set({
          url: 'https://example.test',
          name: 'persistent',
          value: `test-persistent-${i}`,
          expirationDate: Date.now() / 1000 + 86400
        });
        await window.webContents.executeJavaScript(`localStorage.setItem('account', '${i}')`);
        // Production calls this when the account window closes, before the process-wide quit flush.
        await profiles.flushAccount(account.id);
        const xml = fs.readFileSync(saved.fileFor(root, account.id), 'utf8');
        assert.ok(xml.includes('<plist version="1.0">'));
        assert.ok(xml.includes('<key>Scope</key><string>session-cookies</string>'));
        assert.ok(!xml.includes(`test-session-${i}`));
        assert.ok(!xml.includes(`test-persistent-${i}`));
        // D3 / ADR-004: the file carries only what Chromium will not keep. The persistent cookie must
        // exist exactly once on disk — in the profile — and never be duplicated into this file.
        const match = xml.match(/<data>([\s\S]*?)<\/data>/);
        assert.ok(match, 'the plist carries an encrypted payload');
        const payload = JSON.parse(safeStorage.decryptString(Buffer.from(match[1], 'base64')));
        assert.equal(payload.version, saved.PAYLOAD_VERSION);
        assert.equal(payload.scope, saved.SCOPE);
        assert.equal(payload.accountId, account.id);
        assert.deepEqual(
          payload.cookies.map(c => c.name),
          ['session'],
          'only the session cookie is carried over'
        );
        assert.ok(!JSON.stringify(payload).includes(`test-persistent-${i}`), 'persistent cookie must not be duplicated into the plist');
      } else {
        assert.equal((await store.cookies.get({ name: 'session' }))[0].value, `test-session-${i}`);
        assert.equal((await store.cookies.get({ name: 'persistent' }))[0].value, `test-persistent-${i}`);
        assert.equal(await window.webContents.executeJavaScript("localStorage.getItem('account')"), String(i));
      }
      window.destroy();
    }
    console.log(`PASS: ${mode} isolated saved profiles, encrypted plist cookies, and localStorage.`);
    keepAlive.destroy();
    app.exit(0);
  })
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
