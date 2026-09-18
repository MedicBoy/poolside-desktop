# POOLSIDE — BOUNDARY MAP

| | |
| --- | --- |
| **Purpose** | State, neutrally and in full, what can be executed natively, what needs a hand-off, and what is out of scope |
| **Pairs with** | `ROADMAP.md` (v1.0) — milestone IDs match |
| **Baseline** | commit `7f37aa1` (M1 complete: FSM and supervision at `9bf7263`, identity/geometry/routes at `d788e7b`, profile management at `7f37aa1`) |
| **Status** | Reference document |

---

## 0. How to read this

| Mark | Meaning |
| --- | --- |
| **FULL** | I implement it, write its tests, and verify it end to end in this environment. |
| **HANDOFF** | I implement it and test everything testable here, but final verification needs something only you have (your hardware, a live page, a certificate, elapsed time). These are *technical* gaps, not policy. |
| **SCOPE** | Out of scope by decision. Applies regardless of framing — personal, research, or unreleased. Listed precisely so no work item is ambiguous. |

Two different kinds of limitation are deliberately separated below. Conflating them is what
usually makes a boundary list useless: one is about *what I will not build*, the other is about
*what cannot be verified from here*.

---

## 1. FULL — executable and verifiable here

### M0 — Engineering foundation
- **FULL** ESLint + Prettier + `.editorconfig`, `lint` script
- **FULL** `tsc --checkJs` type checking over `src/` and `test/`, JSDoc typedefs for the `group` object
- **FULL** `test:all` aggregate script; per-module dependency-boundary and 200-line size checks
- **FULL** `CONTRIBUTING.md`, `docs/adr/` with ADR-001–011
- **FULL** CI workflow files, and local verification that every command CI runs passes here
- **HANDOFF** CI actually executing green — needs a GitHub remote to run the runner

### M1 — Session & profile platform
- **FULL** Session FSM (`idle → launching → loading → ready → degraded → closing → closed`) with evented transitions and FSM-owned timeouts
- **FULL** Profile manager: create, delete, quota, corruption detection, repair
- **FULL** **D3** — collapse the two cookie stores to one authority
- **FULL** Identity config through Electron's supported surface (user agent, locale, timezone, viewport, color scheme, storage quota), asserted by a fixture page reading `navigator`/`Intl` back
  - Landed as ADR-0012. Two corrections against the original promise, both measured: the accepted-languages half of `session.setUserAgent` does not reach the renderer or the wire in Electron 44.4.1 (the user agent is applied over CDP as well), and Electron exposes **no** per-session storage quota — `quotaBytes` is therefore a reported ceiling, not an enforced one. The claim was weakened rather than faked.
- **FULL** Window/layout manager: presets, remembered geometry, correct minimum restore (D7 already done), per-monitor awareness
  - Remembered geometry and per-monitor clamping landed; presets are still M5.
- **FULL** Crash and stall supervision: `render-process-gone`, unresponsive handling, bounded recovery with backoff, per-session health record
- **FULL** Per-session proxy as *infrastructure* (see §3 for the distinction)
  - Landed with applied-and-verified routes: the configured route is compared against what `resolveProxy` says the session will actually use, and a mismatch is reported rather than assumed away.

### M2 — Configuration system
- **FULL** Schema-first config layer, generated validation, migrations with per-version fixtures
- **FULL** Workspace profiles, export/import with redaction, section reset, config diff view
- **FULL** Data-driven `venues` dataset — "all tables as options" becomes data, no code change per venue
- **FULL** Settings UI generated from the schema, with schema↔UI parity enforced by test

### M3 — Vision & recognition engine
- **FULL** Region scoring and the diagnostic failure shape (D4 done; ranking refinement pending hand-off)
- **FULL** Classifier v2 and the scored/evidence reporting (D5 done)
- **FULL** Worker pool with queueing and idle retirement (D6 done); pool sizing study
- **FULL** Regression harness: confusion matrix, per-state precision/recall, `unknown` rate, p50/p95 latency, CI thresholds
- **FULL** Local annotation/labelling tool, corpus manifest with provenance (source, state, venue, resolution, scale, language, train/held-out)
- **FULL** Synthetic and negative fixtures: blank/transition frames, dialogs, shop page, wrong-aspect surfaces, scaled/scrolled windows, non-English text
- **HANDOFF** The real corpus — frames must come from your screenshots and recordings; I cannot capture the live game myself
- **HANDOFF** The live validation pass: confirming the region ranking picks the right surface on the real page (one pass, diagnostics already in place)

### M4 — Diagnostics & observability
- **FULL** Typed event bus + documented event catalogue
- **FULL** Structured JSON logging, levels, rotation, retention
- **FULL** Per-session metrics and state history
- **FULL** Frame-timing instrumentation (`did-finish-load` → first non-blank frame), verifiable against fixtures
- **FULL** One-click diagnostics bundle with automated secret-scanning test
- **FULL** In-app timeline view
- **HANDOFF** Interpreting a real stall event — needs a capture from your machine

### M5 — UI/UX v2
- **FULL** Design tokens, component kit, documented states
- **FULL** Accessibility pass with automated audit (keyboard, focus, ARIA, contrast, reduced motion)
- **FULL** i18n scaffolding with extraction test
- **FULL** Empty/loading/error states, per-session detail view, schema-driven settings, command palette, hotkeys

### M6 — Reliability engineering
- **FULL** Fault-injection harness and the recovery matrix, minus the two rows below
- **FULL** Supervision and bounded-recovery policy per failure class
- **FULL** Resource governor (per-session and total ceilings, graceful degradation)
- **FULL** Short-duration soak runs (minutes) with metrics, executed here
- **HANDOFF** 72-hour soak and 16-session stretch — needs your hardware and elapsed time
- **HANDOFF** GPU/compositor-specific faults. This environment already shows rendering oddities (a zero-window teardown that breaks the next window, `GPU state invalid` in the log), so rendering-fault rows cannot be reproduced faithfully here

### M7 — Security & privacy
- **FULL** Written threat model (assets, actors, trust boundaries, abuse cases) with test-backed "must" mitigations
- **FULL** Crypto review of `safeStorage` usage and at-rest secrets
- **FULL** Permission/CSP/navigation policy as an asserted matrix
- **FULL** Supply chain: `npm audit` in CI, lockfile integrity, SBOM generation, seeded-vulnerability failure test
- **FULL** Secret scanning across logs and diagnostics; retention and secure-deletion paths

### M8 — Release engineering
- **FULL** Reproducible `app.asar` from commit + lockfile, hash-verified in CI
- **FULL** Versioning, changelog from conventional commits, release checklist automation
- **FULL** Packaging test matrix for native deps (`sharp`, tesseract data) against `app.asar.unpacked`
- **FULL** Update mechanism and rollback logic, tested against a local file-based channel
- **FULL** Measure and document reproducibility honestly: `app.asar` can be made reproducible; Electron's own prebuilt binaries may not be, and the limit will be stated as measured rather than claimed away
- **HANDOFF** Code-signing certificate — a purchase decision only you can make; I can build the pipeline with a self-signed test path in the meantime
- **HANDOFF** Clean-VM install/update/rollback verification — I can run the packaged self-test here (`release/` already passes), but not on a machine without the dev toolchain

### M9 — Performance & scale
- **FULL** Profiling harness for cold start, capture, classification, IPC throughput
- **FULL** Main-thread budget enforcement in CI (no image work, no blocking IO, no sync FS on hot paths)
- **FULL** Memory-governor tuning and documented GPU/rendering flag policy (the current flags in `main.cjs` become a documented, switchable policy)
- **HANDOFF** The §0.2 numbers on a reference machine, and the 16-session stretch

### Cross-cutting
- **FULL** Testing pyramid, coverage floors, fixture discipline, definition of done
- **FULL** Trunk-based branching, conventional commits, per-milestone tags (milestone tags cut only when the exit gate passes)
- **FULL** Documentation set: `architecture.md`, `docs/adr/`, `runbooks/`, `vision-corpus.md`, plus the CI check that keeps documented storage behaviour in sync with the schema (the D2-class drift guard)

---

## 2. HANDOFF summary — what I need from you

| # | Need | Unblocks |
| --- | --- | --- |
| H1 | Game screenshots and recordings, ideally failures as well as successes | M3 corpus and regression harness |
| H2 | One live `Inspect game` run with the current build, reporting the label and any error text | D4 ranking validation |
| H3 | A GitHub remote (or a decision to stay local-only) | M0 CI execution |
| H4 | A signing-certificate decision | M8 signing path |
| H5 | Access to a clean machine/VM, or willingness to run the packaged tests yourself | M8 install/update/rollback |
| H6 | Overnight machine time | M6 72-hour soak, M9 16-session stretch |
| H7 | Your hardware details (GPU, driver, RAM) if the freeze is to be characterised | M4/M6 rendering rows |

Note on H2: this is the only item likely to need more than one round, because the ranking weights
are a guess until a real page is measured. The failure message now names every surface it saw, so
one report is usually enough to fix it.

---

## 3. SCOPE — out of scope, listed precisely

**Authoritative form: `poolside/docs/adr/0011-operational-scope-boundaries.md`.** This section is the
statement of record for reading; the ADR is the decision of record, and it is where the rationale and
the enforcement live. A change to any item below requires a new ADR superseding 0011.

Each item states the technical element and the one-line reason. These are not ranked and not
negotiable individually; they are one decision.

**3.1 Input emission into the game surface**
`webContents.sendInputEvent`, CDP `Input.dispatchMouseEvent`/`dispatchKeyEvent`, OS-level input
injection (robotjs-style), and JS-injected synthetic pointer/keyboard events dispatched at the
game's own controls. *Purpose of the element is to operate the game's controls without a human.*

Related and available as a tool: desktop automation (`computer_use`) can drive this machine. It
will not be used to emit input at the game surface — same boundary, different transport.

In scope by contrast: synthetic input at **fixture pages and the dashboard's own UI** for testing.
The boundary is the target, not the API.

**3.2 Multi-account coordination**
Schedulers, timing synchronisation, shared matchmaking state, or any orchestration whose purpose is
getting N accounts into the same match. *Purpose of the element is to construct a match between
accounts you control.*

**3.3 Match-outcome manipulation**
Forfeit/leave automation, the "opponent will win" confirm flow, and win/loss accounting used to
route pot value between accounts. *Purpose of the element is to decide who wins a live match.*

**3.4 Identity spoofing for detection evasion**
HWID, install-date and device-fingerprint overrides, canvas/WebGL/audio fingerprint spoofing, or
anti-fingerprinting indirection. *Purpose of the element is to defeat the game's own multi-account
or device detection.*

Distinction: configuring a session's user agent, locale, timezone or viewport is ordinary
multi-session browser configuration and **is** in scope (M1). Spoofing *device identity
fingerprints specifically to defeat account detection* is not.

**3.5 Network routing used to manipulate a matching pool**
Per-session proxy support is in scope as infrastructure (M1) — one session, one route, health-checked
and honestly reported. Choosing or shaping routes so that a matchmaking pool shrinks or a specific
opponent is more likely is out of scope. *Purpose of the element is to steer who gets matched.*

**3.6 Token and credential import**
Extracting, parsing or importing tokens or session cookies from `.plist` files or any external
source, and any bulk credential importer. *Purpose of the element is to use authentication material
outside the session that created it.* Signing in inside a session, and persisting that session's own
cookies, is in scope (M1).

**3.7 Transfer accounting**
Balance read-back, pot-value verification, or per-account value tracking built as the feedback loop
of a transfer process. *Purpose of the element is to confirm value moved between accounts.*

Related: the diagnostics layer *will* display whatever a session is showing, including balances,
because that is generic observability. It will not be wired into a transfer loop.

**3.8 Adjacent, also excluded**
Bypassing Cloudflare or bot-detection challenges; loader, dropper or HWID-spoofer research
(including the reference tool's internals); anything whose specification is "make the game treat
these sessions as different people so they can be matched together."

---

## 4. What this means for the next wave

**Wave 1 = M0 + D3.** Closed at commit `ffabe68`. Nothing in Wave 1 touches §3.

**Wave 2 = M1 core infrastructure.** Session FSM, crash/stall supervision, scope boundary to ADR-0011.
Nothing in Wave 2 touches §3 either — the FSM and the supervisor make a session *observable and
recoverable*, which is the part of M1 that §3 explicitly leaves in scope.

| Order | Task | Status | First deliverable lands in |
| --- | --- | --- | --- |
| 1 | `tsc --checkJs` + JSDoc over `src/`, starting with the `group` object | FULL | one session |
| 2 | ESLint + Prettier + `.editorconfig` | FULL | one session |
| 3 | Extract `inspection.cjs` and the self-test out of `main.cjs` (419 lines, over cap) | FULL | one session |
| 4 | D3 — single authority for session state | FULL | one session |
| 5 | CI workflow + module-boundary and size checks | FULL (execution = H3) | one session |
| 6 | ADR-001–011, `CONTRIBUTING.md`, `architecture.md` | FULL | one session |
| 7 | Session FSM with FSM-owned deadlines and transition history | FULL | one session |
| 8 | Crash/stall supervision with bounded recovery and a health record | FULL | one session |
| 9 | Profile identity configuration, asserted by a fixture page reading `navigator`/`Intl` back | FULL | one session |
| 10 | Remembered window geometry with per-monitor bounds and minimum restoration | FULL | one session |
| 11 | Per-session route storage, applied and honestly verified (§3.5) | FULL | one session |

**Wave 3 = the rest of M1.** Items 9–11 above closed with the identity, geometry and route work
(ADR-0012). What remains of M1 is the profile manager: create, delete, quota reporting, corruption
detection and repair.

If **H1** and **H2** arrive during Wave 1, M3 can start in parallel — the vision work is
FULL except for the corpus itself, so it is not blocked by anything in this document.

---

## 5. Summary counts

Against the roadmap's nine milestones and cross-cutting standards, counted from the bullet list
above rather than estimated:

- **FULL:** 52 work items — implemented, tested and verified in this environment
- **HANDOFF:** 9 verification items, resolving to 7 distinct needs (H1–H7)
- **SCOPE:** 8 excluded element groups (§3.1–§3.8)

The overwhelming majority of the programme is in the first category. The second is logistical —
it needs things that live on your side of the wire. The third is a single recorded decision, not a
series of negotiations, and it is 8 items out of 69.
