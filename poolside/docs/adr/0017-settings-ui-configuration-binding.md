# ADR-0017 — Settings UI Configuration Binding

- **Status:** Accepted
- **Date:** 2026-09-18
- **Milestone:** M5 (UI/UX v2)
- **Supersedes:** nothing
- **Related:** ADR-0008 (config schema tooling), ADR-0014 (configuration validation semantics), ADR-0012 (session identity)

## Context

Until M5 the settings panel was two controls written into the markup: a `<select>` with the three table names
copied into `index.html`, and a number input. `ipc.cjs`'s `settings:save` validated the two fields it received
and merged them over the stored settings.

That was survivable while the configuration surface was two fields. It stopped being survivable at M2, when
`config-schema.cjs` began declaring the whole surface — identity fields, route fields, bounds, labels — with the
stated purpose of being _"for M5's form to bind to"_ and a label table whose own comment says _"a generated form
cannot describe a field differently"_. At that point a field added to the schema appeared nowhere in the UI, and
the table list existed in two places that could disagree.

Two other facts shaped this record:

- **ADR-0014 wrote its error/dropped rule for the corruption boundary**, not for a form. There, a value that a
  field's grammar refuses is `dropped` and the operation continues, because a mistyped time zone must never keep
  somebody out of their own account. A form is the opposite situation: the user is looking at the field they just
  typed into.
- **The panel carried two claims that were no longer true** — "VPN / proxy: Not configured by Poolside" and
  "Identity overrides: Not implemented or verified" — after M1 built and reported both. A settings screen that
  understates what the app does is the same class of defect as a doc that does (ADR-0012).

## Decision

### 1. The form is generated from the declaration, and the renderer holds no field list

`settings-form-mapper.cjs` turns `config-schema.cjs`'s declarations into descriptors: one control per declared
field, with the label, the bounds, the option list and the required flag all taken from the schema. Adding a field
to the schema adds it to the form without an edit to any UI file.

The mapping is split by question, the same seam the timeline uses:

| Module                       | Question                                                             |
| ---------------------------- | -------------------------------------------------------------------- |
| `settings-form-mapper.cjs`   | what does the form **show** — controls, labels, bounds, masked state |
| `settings-form-values.cjs`   | what **is** a submitted string — a number, a boolean, a listed value |
| `config-validator.cjs`       | is that value **acceptable**, by the field's own grammar             |
| `settings-ui-controller.cjs` | what does the whole document become, and what a refusal **means**    |

A conversion is about type and nothing else. Trimming, lower-casing or pattern-matching a value in the mapper
would be a second opinion about the identity or route grammar, which is exactly what ADR-0008 and ADR-0014 forbid.

### 2. One namespace, used three ways

A field's **dotted path** (`identity.timezone`, `proxy.spec`, `limit`) is the binding contract:

- a control carries it in `data-path` and receives a derived DOM id,
- a page sends its values keyed by it,
- an error comes back keyed by it, and marks the control that caused it.

`controlId` is injective: the dot becomes an underscore and every _other_ punctuation run becomes a hyphen.
Folding all punctuation to one character would map `a.b-c` and `a-b.c` onto the same id, and two controls sharing
an id is a form that edits one field while marking another.

### 3. A blank control is not an instruction; clearing is explicit

`''` means the user did not touch the field, so it is omitted from the patch and the stored value survives.
Removing a value is a separate, explicit request (`clear: ['identity.timezone']`). "Empty means empty" is how a
settings form wipes a route somebody did not mean to remove.

For the same reason, **a masked control is given no value**: a route spec carrying `user:password@host` is
presented as set with `value: null`, and the credential never reaches the page. Because a patch carries only the
fields that were edited, leaving a masked field alone cannot clear it — the usual failure of masked inputs is
structurally impossible under this contract, not merely avoided.

Credential-bearing proxy specs are executable, not presentation-only: the parser removes the credential from
Chromium's proxy rules, and the matching session window answers only a proxy authentication challenge for the
configured host and port. Origin-server authentication and challenges from any other endpoint are left alone.

### 4. Merge first, validate second, store the validated value

A patch cannot be validated on its own: `table` and `limit` are required by the schema, so a command that only
changes a time zone would be refused for not repeating them. The controller assembles the candidate (stored
document ⊕ typed patch − cleared paths), validates the whole, and returns **`checked.value`** — the validated
document, not what was submitted. What is stored is what the rest of the app has already checked.

An edit that removes a required field (`clear: ['table']`) is therefore refused rather than stored: clearing
cannot produce a document the app cannot execute.

### 5. In a form, a grammar refusal on an edited field is an error, not a drop

This is the record's central decision, and it is a deliberate divergence from ADR-0014 in exactly one situation.

`config-validator` reports a value the field's grammar refused as `dropped` with `ok` still true. The controller
promotes it to an **error** — and the save is refused — **when the problem's path is one this command submitted**.
A `dropped` problem on a field the user did not touch keeps ADR-0014's meaning: the value is left out of what is
stored, and reported as ignored.

The distinction is intent. On the corruption boundary nobody typed the value, and refusing to load is worse than
ignoring it. In a form the user is looking at the field having just typed into it, where "saved, but your route
was ignored" is a lie a settings screen must not tell. A parent-path problem counts as concerning the edit when a
child was submitted, or the control that caused it is never marked.

### 6. A refusal is data, not an exception

The IPC envelope carries `{ok: true, value}` or `{ok: false, error}` — one string. A per-field refusal cannot
survive that shape, so `settings:save` returns its verdict **inside a successful call**:

```js
{ saved: false, errors: [{ path: 'identity.timezone', message: '…' }], ignored: [], form: {…} }
```

The transport succeeding and the edit being accepted are different events, and the payload says which happened.
A thrown error still means the call itself failed, and still reaches the toast. The cost is that `settings:save`'s
success value is not a snapshot like most handlers; the benefit is that the form can mark the field rather than
print one sentence about the panel.

The handler sets `section` and `current` **after** spreading the caller's payload, so no caller can route a
settings save into the account boundary, which is validated by different rules.

### 7. A message names its field

Conversion messages name the field they belong to (`Preferred table must be one of: Bangkok, Rome, Seoul.`),
because the same string is rendered under a control, in the status line, and in the activity log — and only the
first of those has a visible label beside it. The validator's messages already did this for the same reason.

## Consequences

**Good**

- The settings panel and the configuration schema cannot disagree: a field the app can execute is editable, and a
  field it cannot execute cannot be edited into existence.
- An unusable value is refused _at the field_, before it is stored, with the field named — instead of a panel-wide
  failure or, worse, a silent drop.
- The masked-route contract means a credential is never handed to the renderer as text and can never be wiped by
  saving a different field.
- The mapper and the controller are pure and Electron-free, so the semantics above are asserted without a window.

**Costs**

- Four modules now stand between a keystroke and a stored value. The split is by question and each is small, but
  the pipeline is longer than the two-field handler it replaces.
- The reviewed markup of the old form is gone. Anything that depended on `#table`/`#limit` had to change, and the
  generated controls rely on the existing `.settings-panel` styling rather than their own.
- The form is rebuilt on every paint (a save, a refusal), which drops focus; focus is restored to the first
  invalid control, but a rebuild is a rebuild, and keyboard behaviour across the whole dashboard is still M5's
  outstanding acceptance criterion rather than something this record settles.
- The `account` section is supported by the mapper and the controller and is **not rendered by any view yet** —
  a per-session detail view is a separate M5 deliverable.

## Enforcement

1. `test/settings-form.test.cjs` — parity in both directions (every declared field has a control; every control
   resolves to a declared field), labels and bounds taken from the schema, injective control ids, typed
   conversion, refusal by name, pass-through of text that a grammar owns, credential masking with the credential
   absent from the serialised descriptor, blank-means-untouched, explicit clearing, reset, the promotion rule with
   its counterpart (an untouched dropped value stays dropped), and "nothing throws" across junk inputs.
2. `test/config.test.cjs` — the schema parity suite that keeps the declaration and the storage structures aligned.
3. `src/self-test.cjs` — through the real IPC bridge: an unusable table is refused with `saved: false` and an
   error whose `path` is `table`, a usable one is stored with a number typed as text arriving as a number, an
   undeclared key never reaches the workspace document, every declared field has a control, and the number of
   controls in the dashboard's DOM equals the number the schema declared.
4. `test/architecture.test.cjs` — the four modules are declared pure (no `electron` import), under the 300-line
   ceiling, and reachable from source or tests.

## Not decided here

M5's roadmap section also requires design tokens and a component kit with documented states, a full accessibility
pass (keyboard reachability, focus management, ARIA, contrast ≥ 4.5:1, reduced motion), i18n scaffolding with an
extraction test, designed empty/loading/error states, a per-session detail view, a command palette and hotkeys,
and a ≤ 100 ms p95 click→paint budget with 8 sessions open. None of that is decided or built by this record. What
exists is the binding and the pipeline those pieces will sit on: the form a new field appears in without a UI
edit, and the refusal that lands on the field that caused it.
