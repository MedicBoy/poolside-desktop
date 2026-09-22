// The side-by-side comparison, which is a pure function of what each session read.
//
// The rules worth pinning are the ones that decide the sentence above the table: how many fields are shared, what
// is said when everything is shared, and what is said when nothing could be read at all.

const test = require('node:test');
const assert = require('node:assert/strict');
const { compare, valueOf, FIELDS, VALUE_LIMIT } = require('../src/identity-readback.cjs');

const read = overrides => ({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0',
  language: 'en-GB',
  languages: 'en-GB, en',
  timeZone: 'Europe/London',
  locale: 'en-GB',
  viewport: '800 x 600',
  screen: '1920 x 1080',
  colorScheme: 'dark',
  cores: 8,
  memory: 8,
  ...overrides
});

const session = (name, overrides) => ({ id: name.toLowerCase(), name, read: read(overrides) });

test('two sessions that differ are reported field by field, and the shared ones are named', () => {
  const result = compare([
    session('Newfie', { userAgent: 'Poolside/1.0 (Newfie)', timeZone: 'America/St_Johns', language: 'en-CA' }),
    session('Gmail', { userAgent: 'Poolside/1.0 (Gmail)', timeZone: 'Europe/London', language: 'en-GB' })
  ]);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.rows.length, FIELDS.length, 'every declared field has a row');
  const userAgent = /** @type {any} */ (result.rows.find(row => row.key === 'userAgent'));
  assert.equal(userAgent.same, false);
  assert.deepEqual(
    userAgent.values.map(value => value.name),
    ['Newfie', 'Gmail'],
    'the columns are in the order the sessions were given'
  );
  // 10 fields, 3 of them different: 7 shared, and the sentence names which.
  assert.equal(result.different, 3);
  assert.equal(result.shared, 7);
  assert.deepEqual(result.sharedFields, [
    'Accepted languages',
    'Locale',
    'Window viewport',
    'Screen size',
    'Preferred colour scheme',
    'Reported processor cores',
    'Reported device memory'
  ]);
  assert.match(result.verdict, /^7 of 10 fields are the same on both sessions:/);
  assert.match(result.verdict, /Locale/);
  assert.doesNotMatch(result.verdict, /Time zone/, 'the fields that differ are the point, and are not listed as shared');
});

test('two sessions that look identical are said to look identical, and told what to do', () => {
  const result = compare([session('Newfie'), session('Gmail')]);
  assert.equal(result.different, 0);
  assert.equal(result.shared, FIELDS.length);
  assert.match(result.verdict, /look like one machine/);
  assert.match(result.verdict, /Give one of them its own identity in Settings/);
});

test('nothing shared, one session, and nothing readable each say something different', () => {
  // Every field different: the honest wording still refuses to promise anything about a website.
  const different = compare([
    session('A', {
      userAgent: 'A',
      language: 'a',
      languages: 'a',
      timeZone: 'a',
      locale: 'a',
      viewport: 'a',
      screen: 'a',
      colorScheme: 'a',
      cores: '1',
      memory: '1'
    }),
    session('B', {
      userAgent: 'B',
      language: 'b',
      languages: 'b',
      timeZone: 'b',
      locale: 'b',
      viewport: 'b',
      screen: 'b',
      colorScheme: 'b',
      cores: '2',
      memory: '2'
    })
  ]);
  assert.equal(different.shared, 0);
  assert.match(different.verdict, /Every field compared is different/);
  assert.match(different.verdict, /not a guarantee that a website treats them as different machines/);
  const single = compare([session('Newfie')]);
  assert.match(single.verdict, /Open two sessions/);
  assert.equal(single.rows[0].same, false, 'one session cannot be the same as itself');
  const unreadable = compare([
    { id: 'a', name: 'Newfie', read: null },
    { id: 'b', name: 'Gmail', read: { failed: 'no page' } }
  ]);
  assert.deepEqual(unreadable.unreadable, ['Newfie', 'Gmail']);
  assert.match(unreadable.verdict, /Neither session answered/);
  assert.equal(unreadable.rows[0].values[0].value, 'could not be read');
  assert.equal(unreadable.shared, 0, 'two unreadable sessions share nothing; they are not "identical"');
});

test('junk is compared as junk rather than throwing, and long values are cut for the table', () => {
  assert.doesNotThrow(() => compare(undefined));
  assert.doesNotThrow(() => compare(/** @type {any} */ ([null, 0, 'x', {}])));
  assert.equal(compare([]).sessions.length, 0);
  // A missing property is "not reported", not the string "undefined".
  const missing = compare([
    { id: 'a', name: 'A', read: {} },
    { id: 'b', name: 'B', read: {} }
  ]);
  assert.equal(missing.rows[0].values[0].value, 'not reported');
  // And two sessions that both report nothing are **not** described as identical: a property neither page has says
  // nothing about whether they look alike, and counting it as a match is how "we could not read this" turns into
  // "these are the same machine".
  assert.equal(missing.shared, 0);
  assert.equal(missing.compared, 0);
  assert.match(missing.verdict, /neither reported anything on this list/);
  const long = valueOf('x'.repeat(VALUE_LIMIT + 50));
  assert.equal(long.length, VALUE_LIMIT);
  assert.match(long, /…$/);
  assert.equal(valueOf('  a\n  b  '), 'a b', 'whitespace is collapsed rather than shown raw');
  assert.equal(valueOf(0), '0', 'a zero is a value, not an absence');
});
