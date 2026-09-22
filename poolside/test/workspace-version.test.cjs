// The version on the document, and the golden fixture from version 1.
//
// There is one released version, so the migration list is empty and these tests are about the two things that are
// real today: a document this build will not read is refused **by name**, with the file left alone, and a document
// this build wrote can be read back field for field.
//
// The fixture is the shape version 1 has actually shipped with — every field the storage layer can carry, present
// and populated. Its value is not that it is exercised (other tests do that) but that it is **frozen**: a change
// that silently drops a stored field, or renames one, fails here against a document nobody has been editing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readDocument, versionOf, CURRENT_VERSION, MIGRATIONS } = require('../src/workspace-version.cjs');
const { workspace } = require('../src/state.cjs');
const store = require('../src/workspace.cjs');

const fixturePath = path.join(__dirname, 'fixtures', 'workspace-v1.json');
const fixture = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('the golden version-1 fixture reads back with every field it was written with', () => {
  const read = readDocument(fixture());
  assert.equal(read.ok, true, read.ok ? '' : read.message);
  const document = /** @type {any} */ (read.ok ? read.document : null);
  assert.equal(document.version, CURRENT_VERSION);
  assert.equal(document.accounts.length, 2);
  const [newfie, gmail] = document.accounts;
  // Identity: the user agent is applied through the session API rather than the wire, so it survives; the quota
  // ceiling is reported data and must survive as a number.
  assert.equal(newfie.name, 'Newfie');
  assert.equal(newfie.identity.timezone, 'America/St_Johns');
  assert.deepEqual(newfie.identity.viewport, { width: 900, height: 700 });
  assert.equal(newfie.identity.quotaBytes, 268435456);
  // A route with credentials is stored whole: this is the one place it is allowed to exist, and a change that
  // dropped it would look like "the route stopped working" with nothing to point at.
  assert.equal(newfie.proxy.spec, '198.105.121.200:6462:leucqwsr:secret');
  assert.equal(newfie.proxy.bypass, '<local>');
  assert.equal(newfie.note, 'Local reminder only.');
  assert.equal(newfie.routePresetId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  // Profile bookkeeping, including the corruption history the dashboard counts.
  assert.equal(newfie.profile.generation, 2);
  assert.equal(newfie.profile.established, true);
  assert.equal(newfie.profile.corruption.count, 1);
  assert.equal(newfie.profile.corruption.lastAction, 'quarantined');
  // An archived account keeps everything it had, including its role, and is not treated as a second receiver.
  assert.equal(gmail.archived, true);
  assert.equal(gmail.role, 'sender');
  // Workspace settings, route presets with their health, and the remembered window rectangle.
  assert.equal(document.settings.table, 'Bangkok');
  assert.equal(document.settings.limit, 10);
  assert.equal(document.settings.identity.timezone, 'Europe/London');
  assert.equal(document.settings.proxy.spec, '127.0.0.1:8080');
  assert.equal(document.routePresets.length, 1);
  assert.equal(document.routePresets[0].lastResult, 'ok');
  assert.equal(document.routePresets[0].checks, 2);
  assert.equal(document.windows['e5b1c1b3-0000-4000-8000-000000000000'].width, 1060);
});

test('a document from a newer build is refused by name, and the file is not touched', () => {
  const parsed = { ...fixture(), version: CURRENT_VERSION + 1 };
  const read = readDocument(parsed);
  assert.equal(read.ok, false);
  assert.equal(/** @type {any} */ (read).kind, 'future');
  // The message has to name the version, say which version this build reads, and say the file is untouched —
  // those are the three facts the operator needs to decide whether to update or to restore.
  assert.match(/** @type {any} */ (read).message, new RegExp(`version ${CURRENT_VERSION + 1}`));
  assert.match(/** @type {any} */ (read).message, new RegExp(`reads version ${CURRENT_VERSION}`));
  assert.match(/** @type {any} */ (read).message, /has not changed the file/);
  assert.equal(MIGRATIONS.length, 0, 'there is nothing to migrate between version 1 and version 1');
  assert.equal(versionOf(parsed), CURRENT_VERSION + 1);
});

test('an unnumbered or older document is refused as unreadable rather than guessed at', () => {
  for (const version of [undefined, 0, -1, '1', 1.5]) {
    const parsed = { ...fixture(), version };
    const read = readDocument(parsed);
    assert.equal(read.ok, false, `version ${JSON.stringify(version)} must not be read`);
    assert.equal(/** @type {any} */ (read).kind, 'legacy');
    assert.match(/** @type {any} */ (read).message, /will not guess at it/);
  }
  assert.equal(versionOf(null), null);
  assert.equal(versionOf('a string'), null);
  // A right-versioned document that is simply broken keeps its own wording, and does not claim to be a version
  // problem: this is the case where restoring a copy is the remedy, not updating.
  const broken = readDocument({ version: CURRENT_VERSION, accounts: 'not a list' });
  assert.equal(broken.ok, false);
  assert.equal(/** @type {any} */ (broken).kind, 'malformed');
  assert.match(/** @type {any} */ (broken).message, /could not be read/);
});

test('the application says the version problem in words, and goes read-only without overwriting', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-version-'));
  const file = path.join(root, 'workspace.json');
  const future = { ...fixture(), version: CURRENT_VERSION + 1 };
  fs.writeFileSync(file, JSON.stringify(future));
  const bytes = fs.readFileSync(file, 'utf8');
  const previous = {
    data: workspace.data,
    storeFile: workspace.storeFile,
    readOnly: workspace.readOnly,
    authoritative: workspace.authoritative
  };
  const messages = [];
  try {
    const before = require('../src/state.cjs').events.length;
    const result = store.load(file);
    assert.equal(result.state, 'invalid');
    assert.equal(workspace.readOnly, true, 'a file it will not read means it will not write either');
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'and the file on disk is exactly what it was');
    const logged = require('../src/state.cjs')
      .events.slice(0, 4)
      .map(entry => entry.message)
      .join(' ');
    messages.push(logged);
    assert.match(messages[0], /newer version of Poolside/, 'the operator is told which version and what to do');
    assert.ok(require('../src/state.cjs').events.length > before, 'and it reaches the activity feed');
    // Saving is refused rather than overwriting the newer document with this build's older shape.
    assert.throws(() => store.save({ ...fixture(), accounts: [] }), /could not be read|read-only|Workspace data/);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  } finally {
    workspace.data = previous.data;
    workspace.storeFile = previous.storeFile;
    workspace.readOnly = previous.readOnly;
    workspace.authoritative = previous.authoritative;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
