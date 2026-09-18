# ADR-0008 — Config schema tooling

- **Status:** Accepted — decided in M2, as this record required of itself
- **Date:** 2026-09-18 (proposed and decided the same day)
- **Related:** `src/config-schema.cjs`, `src/config-walk.cjs`, `src/config-validator.cjs`, `src/model.cjs`,
  `src/identity-fields.cjs`, `src/proxy.cjs`, ADR-0014 (what validation means, and the drift guard), roadmap M2

## Context

Configuration was hand-validated in `src/model.cjs`: `account()`, `settings()` and `decode()`, each throwing a
plain `Error` with a message, plus `TABLES = ['Bangkok','Rome','Seoul']` hardcoded as a module constant.

M2 was expected to grow this substantially, and this record was written to defer the tooling choice to M2 and
decide it there against agreed criteria rather than by whoever wrote the first file. What M2 actually had to
declare, when it arrived, was smaller than the roadmap sketch implied:

| Surface            | Fields                                | Owner of each rule before this decision         |
| ------------------ | ------------------------------------- | ----------------------------------------------- |
| Workspace settings | `table`, `limit`, `identity`, `proxy` | `model.settings`                                |
| Account overrides  | `identity`, `proxy`                   | `model.settings` / nothing                      |
| Identity           | 7 fields                              | `identity-fields.validateField`                 |
| Route              | 3 fields                              | `proxy.parseProxySpec`, `proxy.normaliseBypass` |

So the rules already existed and were already tested. What was missing was a single statement of **what exists**
— the field lists, the section nesting, the defaults — because that statement lived implicitly in
`pickKnown(input, FIELD_LIST)` call sites, where an unrecognised key was dropped in silence.

The roadmap's five-section config (general, vision, sessions, layout, diagnostics) is **not** in the codebase
yet. This decision covers the surface that exists, and is deliberately shaped so that adding a section is a
declaration in `config-schema.cjs`, not a second mechanism.

## Decision

**Hand-written, declared in one module, delegating every rule. No schema library, no new dependency.**

`src/config-schema.cjs` declares the configuration surface:

- the identity field list, generated from `IDENTITY_FIELDS`, so a field added to the grammar is declared here
  automatically and cannot be declared-but-unchecked;
- the route fields, whose checks _are_ `parseProxySpec` and `normaliseBypass` — the stored value is the trimmed
  spec the user wrote, not a parser-internal shape;
- the settings and account-override fields, with which sections are optional, which are required, and what each
  defaults to;
- a human label per field, so an error message and (M5) a generated form cannot describe a field differently.

It declares only. The walking is `src/config-walk.cjs` and the boundary entry points are
`src/config-validator.cjs`; what validation _means_ is ADR-0014.

Against the criteria this record set:

| #   | Criterion                                                                   | How it is satisfied                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Single source of truth for validation, defaults, migrations and UI bindings | One declaration drives all four: `config-validator` reads it for validation, `applyDefaults` reads it for defaults, `describeSchema()` is what M5's form binds to, and `SCHEMA_VERSION` is the migration baseline.                                                                                    |
| 2   | No network-capable dependency in the main process                           | Nothing was added. A JSON Schema validator would have been a new runtime dependency (ADR-0010).                                                                                                                                                                                                       |
| 3   | Error quality, and no failure to start                                      | Every problem carries a dotted path and a label. Nothing throws, so nothing here can stop the app starting; a bad optional value is reported and ignored (ADR-0014).                                                                                                                                  |
| 4   | The generator must cost less than the drift it prevents                     | The surface is 16 declared fields across 4 objects. A library plus its integration would have cost more than the drift it removes, and the enum, the routes and the identity grammar already have owners — a library would have been a _third_ copy of rules that are already tested where they live. |

## Consequences

### Positive

- The field lists are declared once, and `test/config.test.cjs` holds the declaration and the storage layer
  together — drift is a red test rather than a silent field loss.
- The venue list moved into the schema, so "which tables exist" is data in one place. `model.cjs` re-exports it.
- A new field is a declaration plus its rule: the parity suite then fails until the storage layer keeps it.
- The declaration is usable by M5 without a second pass, and by import/export without a second validator.
- No dependency was added, so the supply-chain surface is unchanged.

### Negative / costs

- A hand-written declaration is a file to read rather than a grammar to learn. Accepted: there is one of them.
- Nothing _generates_ a validator from the declaration; the walk is generic but hand-written, so a new `kind`
  is code in `config-walk.cjs`.
- Rule (4) is a judgement that could be revisited. If the surface grows to the roadmap's five sections with
  nested arrays and per-section migrations, this decision should be re-opened rather than stretched — the
  criteria above are the ones to re-run.
- The declaration and `model.cjs` still both know the route field list; the parity test asserts they agree
  rather than merging them, because `model.decode` is the storage authority and the schema is the description.

## Alternatives considered

- **JSON Schema + AJV.** Rejected on criteria 2 and 4. It adds a runtime dependency to the main process for a
  16-field surface, and its error paths would still need mapping onto our labels — so it removes less work than
  it costs, while duplicating rules that `identity-fields.cjs` and `proxy.cjs` already own and test.
- **Decide now, hand-written, without a declaration** (validate at each entry point). Rejected: that is the
  drift problem in its mildest form — three entry points, three field lists, no single statement of what exists.
- **No schema; validate at point of use.** Rejected earlier and again here: it is the drift problem in its worst
  form, and it is what let an unrecognised key be dropped in silence.
- **Generate the module from a schema file at build time.** Rejected: a build step for 16 fields, and a generated
  artifact in a codebase that reads as source.

## Enforcement

| Rule                                                                       | Enforced by                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The declaration matches the grammar and the storage layer, field for field | `test/config.test.cjs` — key-list comparisons and a decode round trip carrying every declared field |
| Every declared field has a working rule and a label                        | `test/config.test.cjs`                                                                              |
| The validator's verdicts agree with the hand-written `model.settings`      | `test/config.test.cjs` — a corpus asserted verdict-for-verdict against both                         |
| The schema modules stay Electron-free and under the size ceiling           | `test/architecture.test.cjs`                                                                        |
| The boundary is actually wired, not merely available                       | `src/self-test.cjs` — a real IPC settings save, refused through the real bridge                     |

`npm run verify` must stay green. This record is no longer `Proposed`: a `Proposed` ADR that outlives its
milestone is itself a defect, and this one was closed at M2's exit gate as it required.
