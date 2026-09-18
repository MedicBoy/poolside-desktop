# ADR-0014 — Configuration validation semantics and the drift guard

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** ADR-0008 (which tooling — decided alongside this), ADR-0004 (storage authority),
  ADR-0010 (no network dependency), ADR-0013 (profile lifecycle), roadmap M2
- **Supersedes:** nothing

## Context

Three modules already validate parts of the configuration, each when it is used:

| Module                | Validates                                                 | When             | On a bad value                               |
| --------------------- | --------------------------------------------------------- | ---------------- | -------------------------------------------- |
| `model.cjs`           | the document's shape: table, limit, account fields, UUIDs | on load and save | throws; the document is refused              |
| `identity-fields.cjs` | the identity grammar, field by field                      | at resolution    | silently drops the field                     |
| `proxy.cjs`           | route and bypass grammar                                  | at apply         | returns a refusal the caller logs or ignores |

That division is reasonable in itself — each rule lives where it is used — but it left two gaps that M2 exists to
close:

1. **Nothing validated the whole configuration at one moment.** A hand-edited workspace could carry an unusable
   time zone, an unparseable route and an unknown key, and the app would start, open sessions, and say nothing
   about any of it. The first symptom would be a session that behaves unexpectedly.
2. **Nothing tied the pieces together.** The field lists lived in `pickKnown(input, FIELD_LIST)` call sites, so
   adding a field to the grammar without adding it to `decode` - the D3 defect class, where a setting silently
   vanishes on the next save - was caught only if someone happened to write that test.

ADR-0008 decided the tooling: a hand-written declaration in `src/config-schema.cjs`, walked by
`src/config-walk.cjs`, with the boundary entry points in `src/config-validator.cjs`. This record decides what
validation _means_ and how the declaration is kept true.

## Decision

### 14.1 Two outcomes, and the difference is the point

Every validation returns `{ ok, value, errors, dropped }`.

- **`errors` — the declared type is wrong.** A required field is missing, an enum value is not in its list, an
  integer is outside its range. The document's own shape is broken and `ok` is `false`. These are exactly the
  cases `model.settings` already refuses.
- **`dropped` — the value has the right shape to ignore and the rest is usable.** A grammar owned elsewhere
  refused it, or nothing declares the key. `ok` stays `true`, the field is left out of `value`, and the problem
  is reported with its path.

The rule exists so that a mistyped time zone cannot keep someone out of their own account — the principle
`identity-fields.cjs` already stated — while a configuration that cannot be _executed_ is refused. Silent
dropping was the defect; being told what was ignored is the fix.

### 14.2 The boundary runs at two moments, and neither is decorative

| Moment                                              | Call                     | On an error                                                                                                                               | On a drop                                                    |
| --------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Saving settings (`settings:save`)                   | `validateSettings`       | the write is refused and the message reaches the dashboard                                                                                | the value is stored without it and the activity feed says so |
| Opening a session (`session-config.applyFootprint`) | `validateSessionProfile` | the launch is refused: that state means the stored document is corrupt, because `model.decode` would have caught user error on the way in | the session opens, and the feed says what was ignored        |

A validator that is never called is documentation, so both moments are wired and both are covered: the saving
path by the desktop suite through the real IPC bridge, the opening path by the same suite opening sessions.

### 14.3 No cross-field rules

The validator has none, deliberately: "a route is enabled but has no spec" is answered by
`proxy.resolveProxyRoute`, and "an account identity overrides a settings identity" is answered by
`identity.resolveIdentity`. Answering either here would create a second authority for the same question, and two
authorities eventually disagree. A test asserts the absence, so adding a rule is a deliberate amendment to this
record rather than an accident.

### 14.4 Sections are validated separately and never merged

`validateSessionProfile` returns `{ settings: {...}, account: {...} }`, keeping the two apart. The first version
of this function merged them into one flat object, and a suite written to check path prefixes caught it:
`settings.identity` was silently overwriting `account.identity`. Precedence belongs to the resolvers; the
boundary's job is to say whether each declared value is usable.

### 14.5 Nothing throws

Every entry point returns a verdict, including on `null`, an array, a number or a string. This is a boundary that
reads data from disk and from a renderer; a throwing validator would be one callers wrap in `try`/`catch` and stop
reading, and the interesting part of its output is the list of problems, not the first one. A test fuzzes it with
a dozen unusable inputs and asserts that nothing throws.

### 14.6 Defaults are a separate operation from validation

`applyDefaults` fills declared defaults; validation never does. Conflating them would make the validator disagree
with `model.settings`, which throws on a settings object with no table — and, worse, would mean a _missing_
required field silently became an accepted one. Declaring a default is how a form (M5) and an import know what
to offer; it is not how a boundary decides whether what it was given is usable.

### 14.7 A malformed nested section is dropped, not fatal

A section supplied as a non-object (`identity: "en-GB"`) is reported as dropped. This matches what already
happens: `pickKnown` in `model.cjs` ignores it and the resolvers ignore it. Calling it an error here would have
made the new validator disagree with the old one on a case that already had an answer.

### 14.8 The declaration is held true by cross-reference, not by intention

`test/config.test.cjs` is the drift guard. It compares the declaration against the structures that are actually
stored and executed:

| Assertion                                                                                                           | The drift it catches                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The declared identity field list equals `IDENTITY_FIELDS`, and the test's own fixture carries a value for every one | a field added to the grammar but not declared — or a fixture that quietly stopped covering a field |
| The declared route fields equal `model.PROXY_FIELDS`; the declared tables equal `model.TABLES`                      | the same list in two places, diverging                                                             |
| A document carrying every declared field round-trips through the real `model.decode` unchanged                      | the D3 class: a declared field that `decode` drops on the next save                                |
| `model.decode` keeps everything the validator emits                                                                 | validated output nobody can store                                                                  |
| The validator and `model.settings` reach the same verdict on a 21-value corpus                                      | two validators, two opinions                                                                       |
| Every accepted route spec validates clean, and every refused one is dropped with the parser's own message           | a second route pattern that would drift from `parseProxySpec`                                      |
| Every declared field has a rule and a label                                                                         | a field declared but unchecked, or unusable in a message                                           |

The one intentional asymmetry is asserted rather than hidden: `validateSettings(undefined)` is `ok` (nothing
supplied) while `model.settings(undefined)` throws (a document always has settings). The test states it in its
own case so the difference cannot be lost.

## Consequences

### Positive

- A hand-edited or imported configuration is now checked in one place, at one moment, with paths and labels
  attached to every problem.
- The D3 defect class is caught structurally: adding a stored field without declaring it, or declaring one the
  storage layer drops, fails the suite.
- The boundary is proven to be wired, not merely available: the desktop suite saves settings through the real
  IPC bridge and asserts that an unknown table is refused and an unknown key never reaches the document.
- `identity-fields.cjs` and `proxy.cjs` keep ownership of their grammars. The schema layer adds position, not
  rules, so there is no third copy of any constraint to update.

### Negative / costs

- There are now four modules in this layer (`config-schema`, `config-walk`, `config-validator`, `session-config`)
  where there was one `model.cjs` doing the work. The split is by question — declare, walk, decide, apply — and
  each is small, but it is more files to know about.
- The parity suite pins the declaration to today's storage shape. That is the point, but it also means adding a
  field is a two-file change by construction.
- `model.cjs` and the schema both know the route field list. The test asserts they agree rather than merging
  them, because `model.decode` is the storage authority.
- Two validation paths still exist: `model.settings` for the document and `config-validator` for the boundary.
  They are held to identical verdicts by test, which is weaker than having one of them — but replacing
  `model.settings` outright would put a new module on the corruption boundary in the same change that introduces
  it, which is worse.

## Alternatives considered

- **Validate only in `model.decode`, and make it stricter.** Rejected: `decode` runs on load, and its failure mode
  is read-only mode for the whole workspace. A single unusable time zone would lock someone out of the app,
  which is precisely the failure this decision avoids.
- **Validate only at the boundary, leaving `model.settings` as a pass-through.** Rejected: the document's shape
  must keep being refused at load, or a corrupt file propagates into the app.
- **Report only the first problem.** Rejected: a generated form (M5) needs every problem at once, and a
  hand-edited file usually has more than one.
- **Throw from the validator.** Rejected: see 14.5.
- **Merge the two sections and validate the result.** Rejected: see 14.4 — it silently discarded one identity,
  and it moves precedence out of the resolvers that own it.

## Enforcement

| Rule                                                                 | Enforced by                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Two outcomes, never silent                                           | `test/config.test.cjs` — a dropped field is asserted by path and message |
| Errors are fatal, drops are not                                      | `test/config.test.cjs`                                                   |
| No cross-field rules                                                 | `test/config.test.cjs` — asserted absent, so adding one is deliberate    |
| Sections never merged                                                | `test/config.test.cjs` — path prefixes and two distinct identities       |
| Nothing throws                                                       | `test/config.test.cjs` — a fuzz corpus                                   |
| Defaults are not validation                                          | `test/config.test.cjs`                                                   |
| The declaration matches storage, and verdicts match `model.settings` | `test/config.test.cjs` — the drift guard                                 |
| The boundary is wired at both moments                                | `src/self-test.cjs` via `npm run test:desktop`                           |
| The layer stays Electron-free and under the size ceiling             | `test/architecture.test.cjs`                                             |

`npm run verify` must stay green, and the desktop suite must report 8 PASS.
