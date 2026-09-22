# ADR-0019 — Surfacing state where the eye lands, one instruction at a time

- **Status:** Accepted
- **Date:** 2026-09-22
- **Milestone:** M4/M5 (the dashboard's reliability surfaces)
- **Supersedes:** nothing
- **Related:** ADR-0010 (telemetry is local-only), ADR-0013 (profile lifecycle), ADR-0014 (validation semantics), ADR-0016 (what may leave the machine)

## Context

In one session of ordinary use the operator hit five problems, and every one of them was **a fact the program
already held** that happened to be on a panel they were not looking at:

1. A match from a previous run of the program was still "in progress", so both of its accounts were refused a new
   match. The count was on the Matches view; the reason was nowhere.
2. Identity values the browser refused left a session that did not behave as configured. The refusal was a line in
   the activity feed, phrased in terms of a CDP method name.
3. A paused run rendered with **no controls at all**, so there was no way back and no way out. (That was a defect,
   not a missing surface — but the operator's only escape was to archive an account.)
4. The workspace had recovery material beside it and no way to see or use it: the app could only say a copy
   existed.
5. The exit address of a routed session could not be read, and the match never released. The failure was recorded
   as one sentence with no field, no value and no next step.

None of these needed new measurement. Each needed the same thing the timeline decision (ADR-0016) needed: the
facts the program already had, joined and shown where somebody is actually looking, in the operator's words rather
than the program's.

## Decision

**A new surface is added only where a fact already exists, and it obeys three rules.**

1. **Derived, never stored.** The attention list, the getting-started steps, the run status and the report are all
   pure functions of the snapshot (`attention.cjs`, `guidance.cjs`, `run-status.cjs`, `run-report.cjs`). A derived
   surface cannot disagree with the ledger it describes, and it needs no migration when the ledger changes.
2. **Named by the control, not the mechanism.** A refusal is reported as _"Time zone \"Europe/London\" was refused
   by the browser … clear or correct that field in Settings"_ rather than `Emulation.setTimezoneOverride` failed.
   The CDP command list carries the field name and value for exactly this reason.
3. **One instruction at a time.** The getting-started panel hides whenever the attention list has anything in it,
   and the attention panel hides when there is nothing to say. Two panels telling the operator what to do at the
   same moment is one too many, and a problem outranks a tutorial.

**What may be claimed is unchanged, and the new surfaces are held to it.** The attention list states facts
(`readOnly`, a refused field, a route not in use) and never a diagnosis. The pairing verdict keeps saying
_"agreement, not proof"_; the balance record keeps saying _"recorded, not reconciled"_; the getting-started steps
never say an account is signed in, because whether a sign-in worked on the game's own website is not something
this program can see.

## Consequences

- **Good:** the operator is told what is wrong and what to do about it without having to know which panel holds
  which fact. Five of the six defects found by hand in one session would have been visible immediately.
- **Good:** a support bundle can now carry the _state_ (`diagnostics-state.cjs`) as counts, flags and field names —
  which is what makes "the workspace could not be saved" diagnosable from a file rather than from a screenshot.
- **Cost:** more panels on the Sessions view, and more rules to keep honest. The mitigation is that every rule is a
  tested pure function, and the panels hide themselves when they have nothing to say.
- **Cost, recorded deliberately:** the first version of the support bundle carried a SHA-256 of the workspace file
  and the application's own secret scanner **refused the payload** — a long opaque string is the shape it exists to
  stop. The scanner was not weakened; the bundle now carries the file's size and last-written time, which answer the
  same question. A convenience is not a reason to move a boundary.
