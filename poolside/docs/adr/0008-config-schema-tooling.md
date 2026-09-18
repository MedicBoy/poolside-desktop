# ADR-0008 — Config schema tooling

- **Status:** Proposed — decide in M2
- **Date:** 2026-09-18
- **Related:** `src/model.cjs`, `src/workspace.cjs`, roadmap M2

## Context

Configuration is currently hand-validated in `src/model.cjs` (38 lines): `account()`, `settings()`
and `decode()`, each throwing a plain `Error` with a message, plus `TABLES = ['Bangkok','Rome','Seoul']`
hardcoded as a module constant.

M2 grows this substantially: a five-section typed config (general, vision, sessions, layout,
diagnostics), per-session overrides, migrations between schema versions, export/import with
redaction, a data-driven venue list so "all tables as options" needs no code change, and a settings
UI generated from the schema. Hand-writing all of that means three copies of the same truth
(runtime validation, migrations, UI) that will drift.

There are two credible approaches and the choice affects how much of M2 is boilerplate.

## Decision

Defer the choice to M2, and decide it there against these criteria. Recorded now so the decision is
made deliberately and with the criteria already agreed:

1. **Single source of truth.** Can one declaration generate runtime validation, default values, the
   migration baseline, and the settings UI bindings?
2. **No new runtime dependency at the cost of the boundary.** A schema library must not pull a
   network-capable dependency into the main process (ADR-0010).
3. **Error quality.** An invalid hand-edited value must produce a message naming the field and the
   constraint, without a stack trace, and must not prevent the app from starting.
4. **Effort.** The generator must cost less than the drift it prevents. If M2's schema is small
   enough that hand-writing stays honest, hand-writing wins.

Both current options satisfy (2) — a JSON Schema plus a small validator, or a hand-written typed
validator module. The deciding factor is likely (1) versus (4).

## Consequences

### Positive

- The decision gets made against stated criteria rather than by whoever writes the first file.
- `src/model.cjs` stays as it is until then, so no work is thrown away either way.
- The existing tests (`test/model.test.cjs`) already pin the validation behaviour, so whichever
  tooling lands must preserve it.

### Negative / costs

- M2 carries an open question at its start, which is a small scheduling risk.
- Hand-validated config and the new schema will coexist during the transition unless M2 is done in
  one pass.

## Alternatives considered

- **Decide now, hand-written.** Plausible, and the safest choice; not decided because the M2 schema
  is not yet written and its size is the main input to criterion (4).
- **Decide now, JSON Schema + AJV.** Rejected for now: adds a dependency before knowing whether the
  generation benefit is real.
- **No schema; validate at point of use.** Rejected: that is the drift problem in its worst form.

## Enforcement

Review only, and explicitly time-boxed: this record is `Proposed`, and M2's exit gate requires it to
become `Accepted` or be replaced by the ADR that supersedes it. A `Proposed` ADR that outlives its
milestone is itself a defect.
