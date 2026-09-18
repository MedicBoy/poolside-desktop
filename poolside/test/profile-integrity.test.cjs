const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspect, summarise } = require('../src/profile-integrity.cjs');
const { repair } = require('../src/profile-repair.cjs');
const { buildDocument } = require('../src/plist.cjs');
const { carryOverFile, quarantineFile } = require('../src/profile-paths.cjs');

const ID = 'e5b1c1b3-0000-4000-8000-000000000000';
const OTHER = 'f0e1d2c3-1111-4222-8333-444444444444';
const COOKIE = { name: 'session', value: 'abc', domain: '8ballpool.com', path: '/', secure: true, httpOnly: true };

/** A reversible stand-in for safeStorage: what goes in comes back out, unless told to fail. */
function fakeCrypto(options = {}) {
  return {
    isEncryptionAvailable: () => options.available !== false,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => {
      if (options.undecryptable) throw new Error('decrypt failed');
      return value.toString('utf8');
    }
  };
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-integrity-'));
}

/**
 * Write a carry-over file with a controlled defect, using the real plist and payload builders.
 * @param {string} root
 * @param {{payload?: any, headerAccountId?: string, format?: string, omitSecret?: boolean, declaredCount?: number, raw?: string}} [options]
 */
function writeCarryOver(root, options = {}) {
  const file = carryOverFile(root, ID);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (typeof options.raw === 'string') {
    fs.writeFileSync(file, options.raw);
    return file;
  }
  const payload = options.payload ?? {
    version: 2,
    scope: 'session-cookies',
    accountId: ID,
    savedAt: '2026-09-18T00:00:00.000Z',
    cookies: [COOKIE]
  };
  const xml = buildDocument({
    format: options.format ?? 'Poolside Windows Session v2',
    scope: 'session-cookies',
    accountId: options.headerAccountId ?? ID,
    name: 'Main',
    role: 'receiver',
    browserProfile: `persist:poolside-${ID}`,
    cookieCount: options.declaredCount ?? (Array.isArray(payload.cookies) ? payload.cookies.length : 0),
    savedAt: '2026-09-18T00:00:00.000Z',
    secret: options.omitSecret ? '' : Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  });
  fs.writeFileSync(file, options.omitSecret ? xml.replace(/<key>EncryptedSession<\/key>[\s\S]*?<\/data>\n/, '') : xml);
  return file;
}

function withRoot(run) {
  const root = tempRoot();
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('a missing carry-over file is normal, not a fault', () => {
  withRoot(root => {
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'missing');
    assert.equal(result.severity, 0, 'nothing to shout about: the session has simply not been saved yet');
    assert.match(result.issues[0], /has not been saved/);
  });
});

test('a healthy v2 file is reported ok with its cookie count and version', () => {
  withRoot(root => {
    writeCarryOver(root);
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'ok');
    assert.equal(result.severity, 0);
    assert.deepEqual(result.issues, []);
    assert.equal(result.cookies, 1);
    assert.equal(result.payloadVersion, 2);
    assert.ok((result.bytes ?? 0) > 0, 'the file size is measured');
  });
});

test('a v1 payload is legacy, not corruption: it is narrowed on read and rewritten on the next save', () => {
  withRoot(root => {
    writeCarryOver(root, {
      payload: { version: 1, scope: 'session-cookies', accountId: ID, cookies: [{ ...COOKIE, session: true }] }
    });
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'legacy');
    assert.equal(result.cookies, 1, 'a v1 session cookie is still narrowed successfully');
    assert.match(result.issues[0], /v1 payload/);
  });
});

test('a file with no encrypted payload is corrupt', () => {
  withRoot(root => {
    writeCarryOver(root, { omitSecret: true });
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'corrupt');
    assert.equal(result.severity, 3);
    assert.match(result.issues[0], /no encrypted session payload/);
  });
});

test('a file whose header names another account is corrupt, before anything is decrypted', () => {
  withRoot(root => {
    writeCarryOver(root, { headerAccountId: OTHER });
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'corrupt');
    assert.match(result.issues[0], /different account/);
  });
});

test('a payload belonging to another account is corrupt even when the header agrees', () => {
  withRoot(root => {
    writeCarryOver(root, { payload: { version: 2, scope: 'session-cookies', accountId: OTHER, cookies: [COOKIE] } });
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'corrupt');
    assert.match(result.issues[0], /another account/);
  });
});

test('a payload version this build does not know is corrupt, not silently ignored', () => {
  withRoot(root => {
    writeCarryOver(root, { payload: { version: 9, scope: 'session-cookies', accountId: ID, cookies: [COOKIE] } });
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'corrupt');
    assert.match(result.issues[0], /version 9/);
  });
});

test('an undecryptable payload is corrupt, and an unavailable keychain is unverifiable', () => {
  withRoot(root => {
    writeCarryOver(root);
    assert.equal(inspect(root, ID, fakeCrypto({ undecryptable: true })).state, 'corrupt');
    const unverifiable = inspect(root, ID, fakeCrypto({ available: false }));
    assert.equal(unverifiable.state, 'unverifiable');
    assert.match(unverifiable.issues[0], /encryption is unavailable/);
  });
});

test('a payload that is not JSON is corrupt rather than fatal', () => {
  withRoot(root => {
    const file = carryOverFile(root, ID);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      buildDocument({
        format: 'Poolside Windows Session v2',
        scope: 'session-cookies',
        accountId: ID,
        name: 'Main',
        role: 'receiver',
        browserProfile: `persist:poolside-${ID}`,
        cookieCount: 0,
        savedAt: '2026-09-18T00:00:00.000Z',
        secret: Buffer.from('not json at all', 'utf8').toString('base64')
      })
    );
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'corrupt');
    assert.match(result.issues[0], /not JSON/);
  });
});

test('a file whose header disagrees with its payload is usable but suspect', () => {
  withRoot(root => {
    writeCarryOver(root, { declaredCount: 7 });
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'suspect');
    assert.equal(result.severity, 1);
    assert.equal(result.cookies, 1, 'the payload is still read');
    assert.match(result.issues[0], /claims 7 cookies but the payload holds 1/);
  });
});

test('an unfamiliar format string is noted without making the file unusable', () => {
  withRoot(root => {
    writeCarryOver(root, { format: 'Poolside Windows Session v3-preview' });
    const result = inspect(root, ID, fakeCrypto());
    assert.equal(result.state, 'suspect');
    assert.match(result.issues[0], /unfamiliar format/);
  });
});

test('repair quarantines the damaged file and deletes nothing', () => {
  withRoot(root => {
    const file = writeCarryOver(root, { omitSecret: true });
    const original = fs.readFileSync(file, 'utf8');
    const outcome = repair(root, ID, fakeCrypto(), Date.parse('2026-09-18T01:02:03.456Z'));
    assert.equal(outcome.repaired, true);
    assert.equal(outcome.action, 'quarantined');
    assert.equal(fs.existsSync(file), false, 'the damaged file is no longer in the place it is read from');
    const destination = quarantineFile(root, ID, Date.parse('2026-09-18T01:02:03.456Z'));
    assert.equal(outcome.quarantined, destination);
    assert.equal(fs.readFileSync(destination, 'utf8'), original, 'its bytes are kept as evidence');
    assert.match(outcome.note, /sign-in may be needed/, 'the note does not overclaim a recovery');
    // And the account is no longer reported corrupt, because the loop cannot spin on a moved file.
    assert.equal(inspect(root, ID, fakeCrypto()).state, 'missing');
  });
});

test('repair on a healthy or absent file does nothing', () => {
  withRoot(root => {
    assert.equal(repair(root, ID, fakeCrypto()).repaired, false);
    assert.match(repair(root, ID, fakeCrypto()).note, /no carry-over file/);
    writeCarryOver(root);
    const outcome = repair(root, ID, fakeCrypto());
    assert.equal(outcome.repaired, false, 'a healthy file is never moved: repair is not a delete-and-recreate');
    assert.match(outcome.note, /usable \(ok\)/);
    assert.equal(fs.existsSync(carryOverFile(root, ID)), true);
  });
});

test('summarise counts verdicts for one log line', () => {
  const counts = summarise([{ state: 'ok' }, { state: 'ok' }, { state: 'missing' }]);
  assert.deepEqual(counts, { ok: 2, missing: 1 });
});
