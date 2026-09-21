// The settings form: what it is generated from, what it does with typed text, and what it refuses.
//
// The form is derived from `config-schema.cjs`, so the interesting assertions are the parity ones — a field the
// schema declares must have a control, and a control must describe a field the schema declares. The rest is the
// conversion boundary: strings from controls in, typed values or per-field errors out. Every error is keyed by
// the same dotted path a control's `data-path` attribute carries, which is what lets the renderer mark the field
// that is wrong instead of printing one sentence about the whole form.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/config-schema.cjs');
const mapper = require('../src/settings-form-mapper.cjs');
const formValues = require('../src/settings-form-values.cjs');
const controller = require('../src/settings-ui-controller.cjs');

const VALID = { table: 'Rome', limit: 25, identity: { timezone: 'Europe/London' } };

/** The form for a section, asserting it exists — a null here means the section name is wrong. */
function formOf(name, current) {
  const form = mapper.buildForm(name, current);
  assert.ok(form, `${name} must build a form`);
  return /** @type {any} */ (form);
}

/** The state an accepted edit produced, asserting it was accepted. */
function stored(outcome) {
  assert.equal(outcome.ok, true, controller.describe(outcome) || 'expected the edit to be accepted');
  return /** @type {Record<string, any>} */ (outcome.value);
}

/** Every path a form offers, across both sections. */
function pathsOf(name) {
  return formOf(name, {}).paths;
}

test('every declared field has a control, and no control describes an undeclared field', () => {
  const declared = schema.describeSchema();
  assert.deepEqual(pathsOf('settings'), [
    'table',
    'limit',
    ...declared.identity.map(f => `identity.${f}`),
    ...declared.proxy.map(f => `proxy.${f}`)
  ]);
  assert.deepEqual(pathsOf('account'), [
    ...declared.identity.map(f => `identity.${f}`),
    ...declared.proxy.map(f => `proxy.${f}`),
    ...declared.recovery.map(f => `recovery.${f}`)
  ]);
  // The other direction: every path a form offers resolves to a declared spec.
  for (const name of ['settings', 'account']) {
    for (const path of pathsOf(name)) {
      assert.ok(mapper.specAt(name, path), `${name}: ${path} has no declared spec`);
    }
  }
});

test('a tab is not a table, and a section is not a control', () => {
  // `settings` carries two scalar fields and two sections; the sections must not also appear as controls.
  assert.equal(pathsOf('settings').includes('identity'), false);
  assert.equal(pathsOf('settings').includes('proxy'), false);
  const form = formOf('settings', VALID);
  assert.deepEqual(
    form.groups.map(group => group.name),
    ['', 'identity', 'proxy']
  );
  assert.equal(form.groups[1].label, schema.LABELS.identity);
});

test('controls take their label and their bounds from the schema, not from the markup', () => {
  const form = formOf('settings', VALID);
  const byPath = Object.fromEntries(form.groups.flatMap(group => group.fields).map(field => [field.path, field]));
  assert.equal(byPath.table.label, schema.LABELS.table);
  assert.deepEqual(
    byPath.table.options.map(option => option.value),
    [...schema.TABLES]
  );
  assert.equal(byPath.table.options.find(option => option.value === 'Rome').selected, true);
  assert.equal(byPath.limit.control, 'number');
  assert.equal(byPath.limit.min, schema.LIMIT_MIN);
  assert.equal(byPath.limit.max, schema.LIMIT_MAX);
  assert.equal(byPath.limit.value, 25);
  assert.equal(byPath['proxy.enabled'].control, 'checkbox');
  assert.equal(byPath['proxy.enabled'].value, false, 'a declared default is what an unset boolean shows');
  assert.equal(byPath['identity.timezone'].control, 'text');
  assert.equal(byPath['identity.timezone'].value, 'Europe/London');
});

test('every control id is unique and derived from its path', () => {
  const ids = pathsOf('settings').map(mapper.controlId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(mapper.controlId('identity.timezone'), 'f-identity_timezone');
  assert.equal(mapper.controlId('identity.userAgent'), 'f-identity_userAgent');
});

test('a control id cannot collide between a path and a field that spells it the same way', () => {
  // The separator is what keeps `a.b-c` and `a-b.c` apart; without it they would share a DOM id.
  assert.notEqual(mapper.controlId('a.b-c'), mapper.controlId('a-b.c'));
});

test('typed text becomes the declared type, and a blank control is not an instruction', () => {
  const read = formValues.readForm('settings', { table: 'Rome', limit: '25', 'proxy.enabled': 'on' });
  assert.deepEqual(read.errors, []);
  assert.deepEqual(read.values, { table: 'Rome', limit: 25, 'proxy.enabled': true });
  assert.deepEqual(read.touched.sort(), ['limit', 'proxy.enabled', 'table']);

  // Blank means untouched: nothing is sent, so whatever is stored survives.
  const blank = formValues.readForm('settings', { table: '', limit: '', 'identity.timezone': '   ' });
  assert.deepEqual(blank.values, {});
  assert.deepEqual(blank.touched, []);
});

test('a value the control cannot hold is refused by name, not coerced', () => {
  const cases = [
    [{ limit: 'ten' }, 'limit', 'Match limit must be a whole number.'],
    [{ limit: '1.5' }, 'limit', 'Match limit must be a whole number.'],
    [
      { table: 'Atlantis' },
      'table',
      'Preferred table must be one of: Bangkok, London, Sydney, Moscow, Tokyo, Las Vegas, Jakarta, Toronto, Cairo, Mumbai, Seoul, Rome, Paris, Berlin, Dubai, Shanghai.'
    ],
    [{ 'proxy.enabled': 'maybe' }, 'proxy.enabled', 'Use this location for every account must be on or off.']
  ];
  for (const [values, path, message] of cases) {
    assert.deepEqual(formValues.readForm('settings', values).errors, [{ path, message }], JSON.stringify(values));
  }
  // The message names its field because the same string also reaches the status line and the activity log, where
  // no label sits beside it — the validator's own messages are read as a joined list for the same reason.
  assert.match(formValues.readForm('settings', { table: 'Atlantis' }).errors[0].message, /^Preferred table/);
});

test('a field grammar is not re-implemented here: text is passed through untouched', () => {
  // The mapper decides type, not acceptability. Trimming or lower-casing here would be a second opinion about
  // the identity grammar, and `config-validator` is the only one allowed to have it.
  const read = formValues.readForm('settings', { 'identity.timezone': '  Europe/London  ' });
  assert.deepEqual(read.values, { 'identity.timezone': '  Europe/London  ' });
});

test('a route that carries a credential is masked, and the credential is not in the descriptor', () => {
  const secret = 'http://nicho:hunter2@127.0.0.1:8080';
  const form = formOf('settings', { proxy: { spec: secret } });
  const spec = form.groups.flatMap(group => group.fields).find(field => field.path === 'proxy.spec');
  assert.equal(spec.masked, true);
  assert.equal(spec.hasValue, true);
  assert.equal(spec.value, null, 'a masked control is given no value to print');
  assert.equal(JSON.stringify(form).includes('hunter2'), false, 'the descriptor is the thing that reaches the page');

  // A route without credentials is ordinary text, and shows.
  const plain = formOf('settings', { proxy: { spec: 'http://127.0.0.1:8080' } });
  const visible = plain.groups.flatMap(group => group.fields).find(field => field.path === 'proxy.spec');
  assert.equal(visible.masked, undefined);
  assert.equal(visible.value, 'http://127.0.0.1:8080');
});

test('nesting and removal are the two operations the controller needs', () => {
  assert.deepEqual(formValues.nest({ 'identity.timezone': 'UTC', limit: 5 }), { identity: { timezone: 'UTC' }, limit: 5 });
  assert.deepEqual(formValues.unset({ identity: { timezone: 'UTC' }, table: 'Rome' }, ['identity.timezone']), {
    identity: {},
    table: 'Rome'
  });
  assert.deepEqual(formValues.unset({ identity: { timezone: 'UTC' }, table: 'Rome' }, ['identity']), { table: 'Rome' });
  assert.deepEqual(formValues.unset({ table: 'Rome' }, ['proxy.spec']), { table: 'Rome' }, 'removing something absent is not an error');
});

test('nothing here throws, whatever it is handed', () => {
  for (const value of [undefined, null, 0, '', 'settings', [], [{ path: 'table' }], { groups: null }]) {
    assert.doesNotThrow(() => mapper.buildForm(/** @type {any} */ (value), /** @type {any} */ (value)));
    assert.doesNotThrow(() => formValues.readForm('settings', /** @type {any} */ (value)));
    assert.doesNotThrow(() => mapper.buildForm('settings', /** @type {any} */ (value)));
    assert.doesNotThrow(() => formValues.nest(/** @type {any} */ (value)));
    assert.doesNotThrow(() => formValues.unset(/** @type {any} */ (value), /** @type {any} */ (value)));
    assert.doesNotThrow(() => controller.route(/** @type {any} */ (value)));
  }
  assert.equal(mapper.buildForm('nope', {}), null);
  assert.equal(mapper.specAt('nope', 'table'), null);
  assert.equal(formValues.readForm('nope', {}).errors[0].path, '');
  assert.equal(controller.route({ section: 'nope' }).ok, false);
});

test('a valid edit produces the validated state, and the form comes back with it', () => {
  const outcome = controller.route({ section: 'settings', current: VALID, values: { table: 'Seoul', limit: '40' } });
  assert.equal(outcome.ok, true, controller.describe(outcome) || '');
  assert.equal(stored(outcome).table, 'Seoul');
  assert.equal(stored(outcome).limit, 40);
  assert.equal(stored(outcome).identity.timezone, 'Europe/London', 'a section nobody edited survives');
  const posted = outcome.form.groups.flatMap(group => group.fields).find(field => field.path === 'table');
  assert.equal(posted.value, 'Seoul', 'the form reflects what was stored');
});

test('the candidate is merged before it is validated, because requiredness is a property of the whole', () => {
  // This command touches one time zone. `table` and `limit` are required and are not in the patch; validating
  // the patch alone would refuse an edit that is perfectly fine.
  const outcome = controller.route({ section: 'settings', current: VALID, values: { 'identity.timezone': 'Asia/Tokyo' } });
  assert.equal(outcome.ok, true, controller.describe(outcome) || '');
  assert.equal(stored(outcome).identity.timezone, 'Asia/Tokyo');
  assert.equal(stored(outcome).table, 'Rome');
});

test('a grammar refusal on a field the user typed is an error, not a drop', () => {
  // The milestone's whole point. `config-validator` drops a bad grammar value so a corrupt document cannot lock
  // anybody out (ADR-0014). In a form the user is looking at that field: "saved, but your time zone was
  // ignored" is a lie, so it is promoted and the save is refused.
  const outcome = controller.route({ section: 'settings', current: VALID, values: { 'identity.timezone': 'Mars/Phobos' } });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors.length, 1);
  assert.equal(outcome.errors[0].path, 'identity.timezone', 'the error is keyed to the control that carries the path');
  assert.ok(outcome.errors[0].message.length > 0);
  assert.equal(outcome.value, null);
  // ...and the validator still reports it as `dropped`, which is the difference being reconciled here.
  const validator = require('../src/config-validator.cjs');
  const checked = validator.validateSettings({ ...VALID, identity: { timezone: 'Mars/Phobos' } });
  assert.equal(checked.dropped.length, 1);
  assert.equal(checked.errors.length, 0);
});

test('a grammar refusal on a field the user did not touch keeps its dropped meaning', () => {
  // Somebody's stored document already carries a bad value. Editing the table must not be blocked by it, and the
  // value must not be carried into what gets stored.
  const carried = { table: 'Rome', limit: 25, identity: { timezone: 'Mars/Phobos' } };
  const outcome = controller.route({ section: 'settings', current: carried, values: { table: 'Seoul' } });
  assert.equal(outcome.ok, true, controller.describe(outcome) || '');
  assert.equal(stored(outcome).identity, undefined, 'the unusable value is not stored again');
  assert.equal(outcome.ignored.length, 1);
  assert.equal(outcome.ignored[0].path, 'identity.timezone');
});

test('an error on a section concerns an edit inside it', () => {
  // A problem reported against the parent path is an error when a child was submitted — otherwise the control
  // that caused it is never marked.
  assert.equal(controller.affects(new Set(['identity.timezone']), 'identity'), true);
  assert.equal(controller.affects(new Set(['identity']), 'identity.timezone'), false);
  assert.equal(controller.affects(new Set(['limit']), 'limit'), true);
});

test('a refusal leaves the stored state alone and the form intact', () => {
  const outcome = controller.route({ section: 'settings', current: VALID, values: { limit: 'ten' } });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.value, null, 'nothing is returned to store');
  const limit = outcome.form.groups.flatMap(group => group.fields).find(field => field.path === 'limit');
  assert.equal(limit.value, 25, 'the form shows what is stored, not the rejected text');
});

test('clearing is explicit, and cannot produce an invalid document', () => {
  const cleared = controller.route({ section: 'settings', current: VALID, clear: ['identity.timezone'] });
  assert.equal(cleared.ok, true);
  assert.equal(stored(cleared).identity, undefined, 'the empty section is not stored as a husk');

  // `table` is required: removing it must be refused rather than stored.
  const refused = controller.route({ section: 'settings', current: VALID, clear: ['table'] });
  assert.equal(refused.ok, false);
  assert.equal(refused.errors[0].path, 'table');
});

test('reset returns the declared defaults', () => {
  const outcome = controller.route({ section: 'settings', current: VALID, reset: true });
  assert.equal(outcome.ok, true, controller.describe(outcome) || '');
  assert.equal(stored(outcome).table, schema.TABLES[0]);
  assert.equal(stored(outcome).limit, schema.LIMIT_DEFAULT);
  assert.equal(stored(outcome).identity, undefined);
});

test("an account's overrides are validated by the account boundary, not the settings one", () => {
  const record = { id: 'acct-1', name: 'Main', identity: { locale: 'en-GB' } };
  const good = controller.route({
    section: 'account',
    current: record,
    values: { 'proxy.enabled': 'true', 'proxy.spec': 'http://127.0.0.1:8080' }
  });
  assert.equal(good.ok, true, controller.describe(good) || '');
  assert.equal(stored(good).identity.locale, 'en-GB');
  assert.equal(stored(good).proxy.spec, 'http://127.0.0.1:8080');

  const bad = controller.route({ section: 'account', current: record, values: { 'proxy.spec': 'not a route' } });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].path, 'proxy.spec');

  // An account record carries fields the configuration schema does not declare (id, name, role). They are the
  // account document's, not the form's, and a save must not report them as unknown settings.
  assert.equal(controller.route({ section: 'account', current: stored, values: { 'identity.locale': 'fr-FR' } }).errors.length, 0);
  assert.deepEqual(controller.route({ section: 'account', current: stored, clear: ['identity', 'proxy'] }).value, {});
});

test('the form section names come from the mapper, so the controller cannot invent one', () => {
  assert.deepEqual(Object.keys(mapper.FORM_SECTIONS), ['settings', 'account']);
  assert.equal(formOf('settings', VALID).section, 'settings');
  assert.equal(controller.form('nope', {}), null);
});
