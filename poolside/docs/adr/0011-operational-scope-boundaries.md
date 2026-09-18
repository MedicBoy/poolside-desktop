# ADR-0011 — Operational scope boundaries

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** ADR-0007 (test strategy — this record was split out of it), `BOUNDARIES.md` §3, roadmap §0.1
- **Supersedes:** nothing. This record carries the scope decision out of ADR-0007 unchanged, so that
  each record holds one decision (see `docs/adr/README.md`, Conventions).

## Context

The application runs an isolated Chromium session per game account, recognises screen state locally,
and reports diagnostics. Everything up to that sentence is ordinary multi-session browser
infrastructure.

The originally stated version-one goal went further: emit synthetic input at the game's own controls,
coordinate several accounts so they are matched together, and spoof device identity so the game
treats them as separate machines. That is a different product with a different risk profile, and it
is the kind of change that is much easier to decide once, explicitly, than to re-litigate at every
milestone.

Two properties of the system make this decision architectural rather than editorial:

1. Some of those elements require dedicated modules and long-lived state (a matchmaking scheduler,
   an input injector, a transfer accounting loop). Deciding them early determines the module map.
2. Some of the infrastructure this project builds for legitimate reasons — per-session proxies,
   configurable session identity, screen capture — sits one parameter away from an excluded
   element. Without stated distinctions, "add a proxy option" and "choose routes to steer a matching
   pool" look like the same request.

The exclusions below are recorded as a **decision with a rationale**, not as a limitation of the
tooling or the operator. They apply regardless of how the work is framed — personal, research, or
unreleased — because the risk they carry (account bans, and an ecosystem of loggers and droppers)
lands on the user either way.

## Decision

The following element groups are **out of scope permanently**. Each is stated as the technical
element plus the purpose that makes it excluded; the purpose is the deciding factor, and it is what
makes the adjacent in-scope cases distinguishable.

### 11.1 Input emission into the game surface

`webContents.sendInputEvent`, CDP `Input.dispatchMouseEvent`/`dispatchKeyEvent`, OS-level input
injection, and JS-injected synthetic pointer/keyboard events dispatched at the game's own controls.
_Purpose: to operate the game's controls without a human._

In scope by contrast: synthetic input at **fixture pages and this application's own UI**, which is
how the existing tests drive dialogs and forms. The boundary is the target, not the API.

### 11.2 Multi-account coordination

Schedulers, timing synchronisation, shared matchmaking state, or any orchestration whose purpose is
getting N accounts into the same match. _Purpose: to construct a match between accounts under one
operator's control._

### 11.3 Match-outcome manipulation

Forfeit/leave automation, the "opponent will win" confirm flow, and win/loss accounting used to route
pot value between accounts. _Purpose: to decide who wins a live match._

### 11.4 Identity spoofing for detection evasion

HWID, install-date and device-fingerprint overrides, canvas/WebGL/audio fingerprint spoofing, and
anti-fingerprinting indirection. _Purpose: to defeat the game's own multi-account or device
detection._

In scope by contrast: setting a session's user agent, locale, timezone, viewport or colour scheme is
ordinary multi-session browser configuration (M1), asserted by a fixture page reading `navigator`
and `Intl` back. Spoofing **device identity fingerprints specifically to defeat account detection**
is not the same activity.

### 11.5 Network routing used to manipulate a matching pool

In scope by contrast: per-session proxy support as **infrastructure** — one session, one route,
health-checked and honestly reported (M1). Choosing or shaping routes so that a matchmaking pool
shrinks or a specific opponent becomes more likely is excluded. _Purpose: to steer who gets matched._

### 11.6 Token and credential import

Extracting, parsing or importing tokens or session cookies from `.plist` files or any external
source, and any bulk credential importer. _Purpose: to use authentication material outside the
session that created it._

In scope by contrast: signing in inside a session, and persisting that session's own cookies (M1,
ADR-0004).

### 11.7 Transfer accounting

Balance read-back, pot-value verification, or per-account value tracking built as the feedback loop of
a transfer process. _Purpose: to confirm value moved between accounts._

In scope by contrast: the diagnostics layer displays whatever a session is showing, balances
included, because that is generic observability. It is not wired into a transfer loop.

### 11.8 Adjacent, also excluded

Bypassing Cloudflare or bot-detection challenges; loader, dropper or HWID-spoofer research,
including the internals of any reference tool; and anything whose specification reduces to "make the
game treat these sessions as different people so they can be matched together."

## Consequences

### Positive

- The module map is constrained by a written decision, so a new module's purpose is reviewable
  against a list instead of against taste.
- The near-miss cases (11.4, 11.5, 11.6, 11.7) each carry an explicit in-scope counterpart, so
  legitimate M1 infrastructure does not have to be re-justified every time it is touched.
- The platform the boundary leaves in place — multi-session orchestration, offline vision, session
  diagnostics, hardening policy — is a coherent product on its own, and it is the part that is
  testable offline.

### Negative / costs

- The originally stated version-one goal is not reachable in this repository, and any reader planning
  work from the older documents should know that before estimating.
- Declining work carries no test that fails when someone changes their mind, so the list has to be
  maintained deliberately (see Enforcement).
- Excluded elements are genuinely adjacent: this record creates recurring review questions about
  near-misses, which is a cost accepted in exchange for the distinctions being written down.

## Alternatives considered

- **No boundary; build what was asked.** Rejected. The excluded elements are not hard engineering
  problems — they are a bot farming a live multiplayer game's monetised currency against its terms,
  with the user's accounts carrying the ban risk and the surrounding ecosystem being where the
  loggers and droppers that already cost this user one machine operate.
- **Leave the boundary inside ADR-0007.** Rejected: ADR-0007 would then hold two independent
  decisions, which its own conventions forbid, and a test-strategy record is not where a future
  reader looks for an operational scope decision.
- **Keep the boundary as prose in `BOUNDARIES.md` only.** Rejected: a reference document states
  current status; an ADR records the decision and its rationale. The two serve different readers and
  `BOUNDARIES.md` §3 now cross-references this record as authoritative.
- **Re-state the boundary as a lint rule.** Rejected — see Enforcement.

## Enforcement

**Review only, deliberately.** `test/architecture.test.cjs` enforces module size, dependency
direction and that every module is reachable from an entry point; it cannot enforce this. No pattern
match reliably distinguishes "capture the screen" from "click the screen", and the excluded elements
are defined by purpose rather than by API. A rule that flagged `sendInputEvent` would flag the
fixture tests that legitimately use it, while missing an OS-level injector entirely.

What holds the line instead:

1. **Every new module must be reachable from an entry point** (`architecture.test.cjs`). An injector
   or a scheduler has to be wired in somewhere, which makes it visible in review.
2. **`BOUNDARIES.md` §3.1–§3.8** is the user-facing statement, and it is re-issued whenever the
   boundary is touched.
3. **This record is the authoritative list.** A change to any item requires a new ADR superseding
   this one, per `docs/adr/README.md` — a visible, deliberate act rather than an edit.
