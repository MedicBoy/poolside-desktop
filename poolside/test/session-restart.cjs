const { app, session, safeStorage, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const saved = require('../src/saved-session.cjs');
const [root, mode] = process.argv.slice(2);
app.setPath('userData', root);
app.whenReady().then(async () => {
  // Electron tears down its compositor once the window count reaches zero; a BrowserWindow
  // created after that fails to load with ERR_FAILED (-2). Poolside's dashboard window is alive
  // for the whole session so it never hits this, but this test destroys its window every
  // iteration. Keep one window alive for the duration of the run.
  const keepAlive = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await keepAlive.loadURL('data:text/html,<title>keep-alive</title>');
  const accounts = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'A & <test>', role: 'receiver' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'B', role: 'sender' }
  ];
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const store = session.fromPartition(saved.partition(account.id));
    assert.equal(store.isPersistent(), true);
    store.protocol.handle('https', () => new Response('<title>Local storage fixture</title>'));
    const window = new BrowserWindow({ show: false, webPreferences: { session: store, sandbox: true } });
    await window.loadURL('https://example.test/');
    if (mode === 'seed') {
      await store.cookies.set({ url: 'https://example.test', name: 'session', value: `test-session-${i}`, secure: true, httpOnly: true, sameSite: 'lax' });
      await store.cookies.set({ url: 'https://example.test', name: 'persistent', value: `test-persistent-${i}`, expirationDate: Date.now()/1000 + 86400 });
      await window.webContents.executeJavaScript(`localStorage.setItem('account', '${i}')`);
      await saved.saveSession(root, account, store, safeStorage);
      const xml = fs.readFileSync(saved.fileFor(root, account.id), 'utf8');
      assert.ok(xml.includes('<plist version="1.0">'));
      assert.ok(!xml.includes(`test-session-${i}`));
      assert.ok(!xml.includes(`test-persistent-${i}`));
    } else {
      await saved.restoreSession(root, account, store, safeStorage);
      assert.equal((await store.cookies.get({ name: 'session' }))[0].value, `test-session-${i}`);
      assert.equal((await store.cookies.get({ name: 'persistent' }))[0].value, `test-persistent-${i}`);
      assert.equal(await window.webContents.executeJavaScript("localStorage.getItem('account')"), String(i));
    }
    window.destroy();
  }
  console.log(`PASS: ${mode} isolated saved profiles, encrypted plist cookies, and localStorage.`);
  keepAlive.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
