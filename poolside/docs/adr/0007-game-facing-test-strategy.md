# ADR-0007 — Game-facing test strategy and the scope boundary

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** `test/fixtures/`, `test/classification.test.cjs`, `test/saved-session.test.cjs`, `BOUNDARIES.md`, roadmap M3

## Context

Two problems sit together, because the same answer addresses both.

**Testing.** The parts of this application that matter most are the parts touching a live third-party
website: does the game page load, is the sign-in screen recognised, is the shop detected, is the
capture region correct. None of that can be verified from a test run. The existing suite handles this
with local HTTPS protocol fixtures (`protocol.handle`) instead of real accounts, which works well —
but it has a blind spot: every screen-recognition fixture is a _positive_ example, so a classifier
that answers too eagerly would still pass.

**Scope.** The project's stated goal includes automating a game client: synthetic input at the game's
controls, coordinating several accounts so they are matched together, and spoofing device identity so
the game treats them as different machines. This is recorded here as an architectural decision
because it determines what the system is allowed to do, which modules may exist, and what the test
suite is allowed to simulate.

## Decision

**Test strategy.**

1. Offline fixtures are the primary evidence. Any game-facing behaviour must be exercised by a local
   fixture before it is exercised against the live site.
2. **A bug becomes a fixture before it becomes a fix.** The corpus is versioned; each entry carries
   provenance: source (recording / live capture / synthetic), state label, venue, resolution, scale,
   language, and whether it is train or held-out.
3. Negative fixtures are mandatory. A recogniser must be shown to _not_ answer on blank frames,
   mid-load partials, dialogs, the shop page, wrong-aspect surfaces and non-English screens.
4. Live validation is scheduled, scripted and recorded — never the only evidence, and never asserted
   in CI, because it depends on a third-party site that can change without notice.
5. Synthetic input and synthetic device values are used **only** against fixtures and the
   application's own UI. That is how the current tests work.

**Scope boundary.** The following are out of scope permanently, as a decision rather than a
limitation:

- Emitting synthetic input at the game's own controls (`sendInputEvent`, CDP input dispatch,
  OS-level input injection, or JS-injected synthetic pointer/keyboard events).
- Coordinating multiple accounts — synchronised queueing, shared matchmaking state, any scheduler
  whose purpose is getting N accounts into one match.
- Manipulating match outcomes (forfeit automation, win/loss accounting used to route value).
- Spoofing device identity to defeat the game's own account or device detection (HWID, install date,
  canvas/WebGL/audio fingerprints).
- Importing tokens or session cookies from files or any external source.
- Choosing network routes so a matchmaking pool shrinks or a specific opponent is likelier.
- Building balance read-back as the feedback loop of a transfer process.

The full statement, including the distinctions that keep it precise (per-session proxy configuration
is in scope as infrastructure; routing used to steer matching is not), is in `BOUNDARIES.md`.

## Consequences

### Positive

- The suite runs offline, deterministically, with no game account, no credentials and no live site.
- The boundary is a recorded decision with a stated rationale, so it does not get re-argued at every
  milestone and no work item is ambiguous.
- The platform this decision leaves in place — multi-session orchestration, offline vision, session
  diagnostics — is a coherent product on its own.

### Negative / costs

- Accuracy on the real site cannot be proven in CI; the corpus is a proxy that must be kept honest.
- Fixtures become stale when the site changes, so someone must re-capture and re-label. That cost is
  real and recurring, and it is why labelling tooling is an M3 deliverable.
- The boundary means the originally stated version-one goal is not reachable in this repository. Any
  reader should know that before planning work from the older documents.

## Alternatives considered

- **No boundary; build what is asked.** Rejected. The excluded items are not hard engineering
  problems, they are a bot that farms a live multiplayer game's monetised currency against its
  terms, and they put the user's accounts at ban risk.
- **Boundary with no test-strategy consequence.** Rejected: leaving negative fixtures optional is
  exactly how a recogniser becomes confidently wrong.
- **Test only against the live site.** Rejected: non-deterministic, requires credentials, and would
  make the suite fail whenever the site or the network misbehaves.

## Enforcement

Partly test-backed, partly recorded. `test/architecture.test.cjs` keeps modules inside their size
and dependency rules, and `npm test` runs the offline corpus. The boundary itself is enforced by
review against `BOUNDARIES.md`; the reason it is not a lint rule is that it constrains intent, not
syntax — no pattern match reliably distinguishes "capture the screen" from "click the screen".
