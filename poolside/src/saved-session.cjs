const fs = require('node:fs');
const path = require('node:path');
const escape = s => String(s).replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' }[c]));
function partition(id) { return `persist:poolside-${id}`; }
function fileFor(root, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid session identifier.');
  return path.join(root, 'accounts', `${id}.plist`);
}
async function saveSession(root, account, browserSession, crypto) {
  if (!crypto.isEncryptionAvailable()) throw new Error('Windows session encryption is unavailable.');
  const cookies = await browserSession.cookies.get({});
  const secret = crypto.encryptString(JSON.stringify({ version: 1, accountId: account.id, cookies })).toString('base64');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Format</key><string>Poolside Windows Session v1</string>\n<key>AccountID</key><string>${account.id}</string>\n<key>Name</key><string>${escape(account.name)}</string>\n<key>Role</key><string>${escape(account.role)}</string>\n<key>BrowserProfile</key><string>${partition(account.id)}</string>\n<key>SavedAt</key><date>${new Date().toISOString()}</date>\n<key>EncryptedSession</key><data>${secret}</data>\n</dict></plist>\n`;
  const file = fileFor(root, account.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', xml, { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  await browserSession.cookies.flushStore();
  browserSession.flushStorageData();
}
async function restoreSession(root, account, browserSession, crypto) {
  const file = fileFor(root, account.id);
  if (!fs.existsSync(file)) return;
  try {
    const xml = fs.readFileSync(file, 'utf8');
    const encoded = xml.match(/<key>EncryptedSession<\/key>\s*<data>([A-Za-z0-9+/=\s]+)<\/data>/)?.[1];
    if (!encoded) throw new Error();
    const saved = JSON.parse(crypto.decryptString(Buffer.from(encoded.replace(/\s/g, ''), 'base64')));
    if (saved.version !== 1 || saved.accountId !== account.id || !Array.isArray(saved.cookies)) throw new Error();
    // Only restore session cookies missing after browser restart. Persistent cookies
    // belong to Chromium's profile and are never resurrected from an older backup.
    const current = await browserSession.cookies.get({});
    for (const c of saved.cookies.filter(c => c.session)) {
      if (current.some(x => x.name === c.name && x.domain === c.domain && x.path === c.path)) continue;
      const cookie = { url: `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path || '/'}`, name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite };
      if (!c.hostOnly) cookie.domain = c.domain;
      await browserSession.cookies.set(cookie);
    }
  } catch { throw new Error('Saved session could not be restored. Its plist has been preserved.'); }
}
module.exports = { partition, saveSession, restoreSession, fileFor };
