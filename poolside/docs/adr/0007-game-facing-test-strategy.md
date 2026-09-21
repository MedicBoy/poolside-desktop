# ADR-0007 — Game-facing test strategy

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** ADR-0011 (game automation implementation gaps), `test/fixtures/`,
  `test/classification.test.cjs`, `test/saved-session.test.cjs`, roadmap M3

## Context

The parts of this application that matter most are the parts touching a live third-party website: does
the game page load, is the sign-in screen recognised, is the shop detected, is the capture region
correct. None of that can be verified from a test run. The existing suite handles this with local
HTTPS protocol fixtures (`protocol.handle`) instead of real accounts, which works well — but it has a
blind spot: every screen-recognition fixture is a _positive_ example, so a classifier that answers too
eagerly would still pass.

The unfinished game-automation work that this record originally carried alongside the test strategy
is now tracked in **ADR-0011**. The subjects were split because implementation status and test strategy
change independently.

## Decision

1. Offline fixtures are the primary evidence. Any game-facing behaviour must be exercised by a local
   fixture before it is exercised against the live site.
2. **A bug becomes a fixture before it becomes a fix.** The corpus is versioned; each entry carries
   provenance: source (recording / live capture / synthetic), state label, venue, resolution, scale,
   language, and whether it is train or held-out.
3. Negative fixtures are mandatory. A recogniser must be shown to _not_ answer on blank frames,
   mid-load partials, dialogs, the shop page, wrong-aspect surfaces and non-English screens.
4. Live validation is scheduled, scripted and recorded — never the only evidence, and never asserted
   in CI, because it depends on a third-party site that can change without notice.
5. Current synthetic-input and device-value tests exercise fixtures and the application's own UI.
   Production game-input and device-fingerprint integration are not implemented; ADR-0011 tracks the
   missing components.

## Consequences

### Positive

- The suite runs offline, deterministically, with no game account, no credentials and no live site.
- Rule 2 gives every regression a permanent, reviewable artefact, so a fixed bug cannot quietly
  return.
- Rule 3 makes the failure mode that matters most — a confident wrong answer — a test failure rather
  than a field report.

### Negative / costs

- Accuracy on the real site cannot be proven in CI; the corpus is a proxy that must be kept honest.
- Fixtures become stale when the site changes, so someone must re-capture and re-label. That cost is
  real and recurring, and it is why labelling tooling is an M3 deliverable.
- Mandatory negative fixtures slow down recognition work: a new positive case is not finished until
  something has been shown to stay negative against it.

## Alternatives considered

- **Test only against the live site.** Rejected: non-deterministic, requires credentials, and would
  make the suite fail whenever the site or the network misbehaves.
- **Positive fixtures only.** Rejected: it cannot detect over-eager recognition, which is the failure
  the user actually experiences (a wrong state label is worse than no label).
- **Positive and happy-path fixtures only.** Rejected: leaving negative fixtures optional is exactly
  how a recogniser becomes confidently wrong and hides missing-state behavior.

## Enforcement

Test-backed. `npm test` runs the offline corpus; `test/classification.test.cjs` holds the recogniser to
the legacy chain's behaviour across a labelled corpus, including the negative cases; and
`test/architecture.test.cjs` keeps the modules that do this work inside their size and dependency
rules. A game-facing change with no fixture is rejected in review regardless of test status.
