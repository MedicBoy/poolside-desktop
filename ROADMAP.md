# POOLSIDE — ENGINEERING ROADMAP & BLUEPRINT

| | |
| --- | --- |
| **Document** | Poolside Engineering Roadmap |
| **Version** | 1.0 (baseline) |
| **Baseline commit** | `3834705` / tag `v0.1.0-session-foundation` |
| **Baseline date** | 2026-09-17 |
| **Status** | Draft for approval — no milestone below M0 is started |
| **Scope owner** | Project owner |
| **Engineering** | Project owner + Hermes |

---

## 0. How to read this document

This is a gated roadmap. Each milestone `M#` has an **objective**, **deliverables**, **acceptance
criteria that can be executed** (not described), and an **exit gate** that must pass before the next
milestone starts. A milestone is not "done" because the code exists; it is done when its acceptance
criteria run green on a clean checkout.

Effort figures are **estimates in engineer-weeks (ew)**, one competent generalist, and are given as
ranges because the game-facing surface is genuinely unknown until instrumented.

### 0.1 Scope boundary (read this first)

**In scope:** the session/profile platform, the vision & state-recognition engine, the
configuration system, UI/UX, diagnostics and observability, reliability engineering, security
hardening, release engineering, performance and scale.

**Out of scope — permanently, and by explicit decision:**

- Emitting synthetic input into the game surface (automated clicking/dragging/keying of gameplay)
- Coordinating multiple accounts (synchronised queueing, session orchestration for mutual matching)
- Any deliberate-forfeit or match-outcome manipulation
- Browser/device identity spoofing intended to defeat the game's own account or device detection
- Anything whose purpose is to move in-game currency between accounts

Rationale, stated once so it is not relitigated: that set is a bot that farms a live multiplayer
game's monetised currency, it breaches the operator's terms, and it puts the user's accounts at
ban risk. It is not a technical limitation and it does not change with scale, distribution model,
or whether the user sells anything. Everything **else** in this document is fair game and is the
overwhelming majority of the work.

The platform described here is a legitimate, genuinely ambitious product in its own right: a
**multi-session browser orchestration workspace with a computer-vision screen-state engine**. That
is what we are building, and we will build it to a standard the commercial antidetect/session-
management market does not currently meet.

### 0.2 Definition of "above industry standard" — made falsifiable

Ambition is worthless unless it is measurable. The target product must hold all of the following,
on a 4-core/16 GB reference machine, with **8 concurrent sessions open**:

| Metric | Target |
| --- | --- |
| Cold start to interactive dashboard | ≤ 1.5 s p95 |
| Dashboard input latency (click → paint) | ≤ 100 ms p95 |
| Capture → classified screen state | ≤ 800 ms p95 |
| Per-session resident memory (steady state) | ≤ 220 MB, no monotonic growth over 8 h soak |
| Screen-state accuracy on the labelled corpus | ≥ 97 % top-1, ≥ 0.90 macro-F1 |
| `unknown` rate on an unseen valid screen | ≤ 5 % (and never a wrong confident answer) |
| Crash-free session-hours | ≥ 99.5 % over a 72 h soak |
| Test suite wall-clock | ≤ 3 min for unit; ≤ 12 min for full CI |
| Reproducible build | Byte-identical `app.asar` from the same commit + lockfile |

---

## 1. Executive summary

**Where we are.** 833 lines of application source across 10 modules. A working Electron 44 shell
with genuinely careful security posture (verified IPC trust checks, sandboxed game windows,
HTTPS-only navigation, blocked downloads, atomic writes). Four test suites that all pass. One
packaged build. An OCR prototype that classifies 5 of 7 screen states correctly on 7 positive
fixtures and has no negative fixtures at all.

**What that is not.** It is a prototype with no CI, no type checking, no linter, no configuration
system, no observability, and a recognition layer whose accuracy is unmeasured because the corpus
cannot detect a false positive. Three of its five open defects are in that layer, and two of those
will fail the first time they meet the real website.

**What we are building.** A session-orchestration platform with a proper vision engine, a typed
and validated configuration surface, structured observability, and release engineering — with the
accuracy, latency and stability numbers in §0.2 held as contractual.

**Path.** Nine milestones, ~30–36 engineer-weeks at the stated targets, sequenced so that every
milestone ships something usable and nothing is built on an unverified layer. Critical path is
M0 → M1 → M3 → M6 → M8; M2, M4, M5, M7 parallelise.

---

## 2. Baseline assessment

### 2.1 Verified capability (executed, not claimed)

| Component | State | Evidence |
| --- | --- | --- |
| Session isolation | Works | `npm run test:desktop` — separate cookie jars, cookies survive window reopen |
| Session persistence | Works | `npm run test:persistence` — seed + verify across real process restart |
| IPC hardening | Works | `trusted()` validates sender + frame + frame URL |
| Workspace model | Works | Strict UUID/duplicate/single-receiver validation, atomic write, read-only fallback |
| Shop auto-return | Works (fixture) | `ShopReturnGate` 5 s stable, fires once, cancellable |
| Screen recognition | Partial | 8/8 tests, but 7 positive fixtures, 0 negatives, `loading` deliberately `unknown` |
| IP diagnostics | Works | ipify through the account's own session, credential-free |
| UI | Functional | Single-view dashboard, CSP-locked, no design system, no a11y audit |

### 2.2 Open defects carried into this roadmap

| ID | Defect | Milestone that closes it |
| --- | --- | --- |
| D3 | `saved-session.cjs` keeps two copies of the same cookies; plist resurrects rotated session cookies | M1 |
| D4 | `game-region.cjs` demands **exactly one** visible canvas in 1.3–1.8 aspect; lobby background is also canvas → `null` | M3 |
| D5 | `classifyText` is an AND of exact English keywords; single copy change → silent `unknown` | M3 |
| D6 | New Tesseract worker per inspection; `let inspecting` is a global lock across all accounts | M3 |
| D7 | `arrange()` permanently lowers window minimum size to 420×360 | M1 |

### 2.3 Capability gaps

No CI. No type checking. No linter. No configuration system (3 tables hardcoded in `model.cjs`).
No structured logging. No metrics. No crash reporting. No update mechanism. No internationalisation.
No accessibility audit. No performance budgets. No soak testing. No threat model. No ADRs.

---

## 3. Product definition

### 3.1 Capability model

1. **Session orchestration** — N concurrent isolated browser profiles, each independently
   configurable, observable, and recoverable.
2. **Profile identity control** — per-session user agent, locale, timezone, viewport, hardware
   concurrency and storage policy, so each session presents as a stable, coherent browser.
3. **Network policy** — per-session proxy/route configuration, connection health, and an honest
   per-session egress report (what the endpoint actually observed).
4. **Vision & state recognition** — locate the game viewport, capture it, and classify it into a
   known state with a calibrated confidence, entirely offline.
5. **Observability** — an event timeline, structured logs, metrics, and a one-click redacted
   diagnostics bundle.
6. **Configuration** — a typed, validated, versioned, importable/exportable settings surface.
7. **Recovery** — supervised sessions that survive renderer crashes, stalls and load failures with
   bounded, evidence-based recovery.
8. **Release engineering** — reproducible builds, signing, versioned updates, rollback.

### 3.2 Non-goals

- No synthetic input into the game surface (§0.1).
- No multi-account coordination (§0.1).
- No identity spoofing to defeat detection (§0.1).
- No cloud account storage, no token importing, no remote code/config loading, no bundled VPN.
- No attempt to bypass a provider's bot protections or authentication challenges.

### 3.3 Success metrics

Adoption-neutral, quality-absolute: §0.2's table is the contract. Secondary: every open defect
closed and regression-tested; ≥ 90 % of game-facing behaviour covered by offline fixtures rather
than live conditions; time-to-diagnose a reported failure ≤ 10 minutes from a diagnostics bundle.

---

## 4. Target architecture

### 4.1 Process and module layout

```
┌──────────────────────────────── MAIN (Node) ────────────────────────────────┐
│  app.cjs            composition root, lifecycle, single-instance            │
│  windows/           session-window manager, layout, arrangement presets     │
│  sessions/          profile manager, identity config, network policy, FSM   │
│  vision/            capture, locate, recognise, classify, confidence        │
│  recovery/          supervisors, gates, bounded retry, stall detection      │
│  ipc/               contract registry, schema validation, trust enforcement │
│  store/             config store, migrations, atomic IO, secret handling    │
│  obs/               event bus, structured log, metrics, diagnostics bundle  │
│  workers/           OCR pool (utilityProcess), capture pool                 │
└─────────────────────────────────────────────────────────────────────────────┘
        ▲ IPC (versioned, schema-validated)          ▲ utilityProcess
┌───────┴───────────────┐                  ┌──────────┴───────────────┐
│  RENDERER (dashboard) │                  │  GAME WINDOWS (sandboxed)│
│  UI kit, views, store │                  │  no preload, no node     │
└───────────────────────┘                  └──────────────────────────┘
```

**Hard rules**
- `main.cjs` (373 lines, 21 functions today) becomes the composition root only; every concern
  moves to a module with a single exported surface. Cap: **no module over 200 lines**, enforced in
  CI.
- Renderer never talks to a game session directly. All cross-boundary traffic is a named,
  versioned, schema-validated IPC message.
- Vision runs in `utilityProcess` workers, never on the main thread. Main thread does zero image
  work.
- Every long-lived object has an explicit `dispose()`; CI runs a leak check over 200 open/close
  cycles.

### 4.2 Data model

```
Workspace (config root, versioned)
├── schemaVersion: int            # migrations run on load
├── general:  { theme, locale, telemetry, updates }
├── vision:   { targetWidth, ocrLang, thresholds{...}, timeouts{...} }
├── sessions: [ SessionProfile ]
│     ├── id, label, role, archived, createdAt, notes
│     ├── browser: { userAgent, locale, timezone, viewport, colorScheme,
│     │              hardwareConcurrency, storageQuotaMb, persistent }
│     ├── network: { mode: direct|proxy, proxyUrl?, healthCheck }
│     └── overrides: { ...vision thresholds per session }
├── layout:   { presets[], lastArrangement }
├── venues:   [ { id, label, order, pinned, metadata } ]   # data-driven, not hardcoded
└── diagnostics: { logLevel, retention, captureOnError }
```

`venues` replaces the hardcoded `['Bangkok','Rome','Seoul']` in `model.cjs`. The list becomes a
seeded, user-editable dataset with ordering and pinning, so "all tables as options" is a data
problem, not a code change.

### 4.3 IPC contract (target)

Every message: `{ channel, version, payload }`, validated against a JSON Schema in a single
registry, rejected with a typed error on mismatch. The current `trusted()` check stays and becomes
the transport guard; schema validation becomes the semantic guard. Contract tests assert that
renderer and main agree on every channel version.

### 4.4 Storage

Single source of truth per concern: **Chromium profile** owns browser state; the **config store**
owns user settings (JSON sidecar, atomic, versioned, migratable); **secrets** go through
`safeStorage` only. The redundant encrypted cookie copy in the plist is removed (closes D3).

---

## 5. Milestones

### M0 — Engineering foundation · **2–3 ew** · *critical path*

**Objective.** Make every later change cheap, reviewable and mechanically verified.

**Deliverables.** ESLint + Prettier + `.editorconfig`; JSDoc type-checking via `tsc --checkJs`
(`--noEmit`) over `src/` and `test/`; `lint`, `typecheck`, `test`, `test:all` scripts; GitHub
Actions CI running lint → typecheck → unit → packaged smoke on Windows; `CONTRIBUTING.md`;
`docs/adr/` with the first six ADRs (§8); module-size and dependency-boundary checks in CI.

**Acceptance criteria.**
1. `npm run lint && npm run typecheck && npm test` is green from a clean `npm ci`.
2. CI is green on the baseline commit and reports its own duration.
3. `tsc --checkJs` covers 100 % of `src/`; no `any` escapes without an inline justification.
4. CI fails deliberately when a 201-line module is introduced (proves the boundary check works).

**Exit gate.** A pull request that breaks lint, types, tests or module size cannot be merged.

---

### M1 — Session & profile platform v2 · **4–5 ew** · *critical path*

**Objective.** Turn "open a window on a session" into a supervised, configurable, recoverable
session lifecycle.

**Deliverables.**
- **Session FSM**: `idle → launching → loading → ready → degraded → closing → closed`, with every
  transition evented and every timeout owned by the FSM rather than by ad-hoc `setTimeout`s.
- **Profile manager**: creation, deletion, quota, corruption detection, repair, with the
  authoritative-store decision from ADR-004 enforced in code (**closes D3**).
- **Identity config**: per-session UA, locale, timezone, viewport, color scheme, storage quota,
  applied through Electron's supported knobs. Unsupported knobs are *not* exposed as pretend
  switches.
- **Network policy**: per-session `direct | proxy`, proxy connectivity pre-check, and an egress
  report that states what the endpoint observed — never a claim about location.
- **Window/layout manager**: arrangement presets, remembered geometry, correct minimum-size
  restore (**closes D7**), per-monitor awareness, save/restore of layout.
- **Crash and stall supervision**: renderer `render-process-gone`, unresponsive handling, bounded
  recovery with backoff, and a per-session health record.

**Acceptance criteria.**
1. 8 sessions launch, reach `ready`, and close cleanly; each transitions through the FSM with no
   orphaned timers or listeners (asserted by a leak counter).
2. Killing a renderer process externally returns that session to `ready` within 10 s without
   disturbing the other 7.
3. Two sessions with different locales/timezones/viewports each report their own values from
   inside the page (`navigator`, `Intl`) — verified by a fixture page.
4. Profile repair recovers a deliberately corrupted profile without data loss to the others.
5. `arrange()` then `reset()` returns every window to the intended 660×560 minimum (D7 regression
   test).

**Exit gate.** Soak: 8 sessions, 8 hours, no leak growth beyond 5 %, no unrecovered `degraded`.

---

### M2 — Configuration system v2 · **3 ew** · *parallel*

**Objective.** Every behaviour-influencing value is typed, validated, versioned, migratable,
importable and exportable.

**Deliverables.** A schema-first config layer (single source of truth generating both runtime
validation and editor hints); migration framework with fixtures per schema version; workspace
profiles (multiple named configs); export/import with redaction; data-driven `venues` dataset with
ordering/pinning; full settings UI bound to the schema; "reset section to defaults"; a config
diff view.

**Acceptance criteria.**
1. Round-trip: export → import → byte-identical effective config.
2. A v1 workspace file loads into v2 through a migration test that asserts exact field mapping.
3. Hand-editing a config value to an out-of-range type produces a precise, non-fatal error naming
   the field and the constraint — the app still starts.
4. Adding a venue requires no code change (asserted by a test that adds one from data).
5. Every setting in the schema appears in the UI; a test asserts schema↔UI parity both ways.

**Exit gate.** Zero magic values in `src/` — a grep-based CI check for stray literals in behaviour
paths.

---

### M3 — Vision & state recognition engine v2 · **6–7 ew** · *critical path*

**Objective.** Replace an unmeasured keyword heuristic with a calibrated, offline, regression-
tested recognition engine.

**Deliverables.**
- **Capture pipeline**: viewport location that handles multiple candidate surfaces by scoring
  (largest clipped-to-viewport landscape element, ≥ 50 % viewport width), returning
  `{ok:false, reason, candidates[]}` instead of bare `null` (**closes D4**).
- **Classifier v2**: hybrid — template/feature matching for structural screens plus OCR for text
  evidence — producing `{state, confidence, evidence[], alternatives[]}`. Scored, thresholded,
  and **never** returning a confident wrong answer (**closes D5**).
- **Worker pool**: N persistent `utilityProcess` workers, per-session queue, cancellation on
  navigation, per-account concurrency instead of a global lock (**closes D6**).
- **Corpus**: ≥ 300 labelled frames — every state, every venue, both the promotion present and
  absent, plus the negatives the current suite lacks (blank/dark transition frames, mid-load
  partials, dialogs, the shop, wrong-aspect surfaces, non-English, scaled/resized windows, both
  recorded and live-captured).
- **Regression harness**: confusion matrix, per-state precision/recall, `unknown` rate, p50/p95
  latency, run on every CI build with thresholds enforced from §0.2.
- **Label tooling**: a small local labelling/annotation utility so new frames are cheap to add.

**Acceptance criteria.**
1. Macro-F1 ≥ 0.90 and top-1 accuracy ≥ 97 % on a **held-out** split of the corpus.
2. A blank or transition frame never produces a confident non-`unknown` answer (explicit negative
   test set).
3. On the real site, `Inspect game` succeeds and the reported state matches the observed screen on
   ≥ 20 consecutive manual checks across all target venues.
4. Recognition of a screen in 8 concurrent sessions: every result ≤ 800 ms p95, no cross-session
   interference.
5. Removing the Sharp contrast pass or the bottom-band fallback degrades accuracy measurably —
   i.e. the harness can *detect* a regression in each pipeline stage.

**Exit gate.** Recognition accuracy is a number on a dashboard, not an opinion.

---

### M4 — Diagnostics & observability · **3 ew** · *parallel*

**Objective.** Make every failure explicable from data, without touching the machine it happened on.

**Deliverables.** Typed event bus with a documented catalogue; structured JSON logging with levels,
rotation and retention; per-session metrics (state history, load timing, capture latency, memory);
frame-timing instrumentation from `did-finish-load` to first non-blank frame — the honest way to
characterise the reported stall instead of hypothesising; a one-click **diagnostics bundle**
(versions, config, per-session state, event timeline, frame-timings, sanitised logs — no cookies,
no credentials, no IPs, no account names); an in-app timeline view; opt-in crash reporting to a
local file only.

**Acceptance criteria.**
1. A diagnostics bundle from a repro captures the sequence leading to it — validated against three
   scripted failure scenarios (renderer kill, load failure, recognition failure).
2. Bundle generation is verified to contain zero secrets by an automated scanner test.
3. A stall produces an objective timeline (queue → load → first paint → interactive) with no
   guessing fields.
4. Log volume per session-hour is bounded and rotation verified over a 24 h synthetic run.

**Exit gate.** Any reported bug is diagnosable from the bundle alone in ≤ 10 minutes.

---

### M5 — UI/UX v2 · **4 ew** · *parallel*

**Objective.** Make the quality of the interface match the quality of the engine.

**Deliverables.** Design tokens + component kit (buttons, cards, tables, dialogs, toasts, forms)
with documented states; full accessibility pass (keyboard navigability, focus management, ARIA,
contrast ≥ 4.5:1, reduced-motion); i18n scaffolding with extractable strings; empty/loading/error
states designed rather than improvised; per-session detail view; settings UI generated from the
config schema; command palette + hotkeys for session and layout operations; a real error surface
that names the failing component and the next action.

**Acceptance criteria.**
1. Every interactive element is reachable and operable by keyboard alone (automated a11y audit
   green).
2. Contrast and focus checks pass on all views in both themes.
3. No string is hardcoded in a component (extraction test).
4. The dashboard holds ≤ 100 ms p95 click→paint with 8 sessions open.

**Exit gate.** An unaccompanied first-time user opens, arranges and understands 8 sessions without
documentation.

---

### M6 — Reliability engineering · **3 ew** · *critical path*

**Objective.** Prove the product survives things going wrong, rather than assuming it.

**Deliverables.** Fault-injection harness (kill renderer, kill utilityProcess, stall network,
corrupt profile, full disk, suspend/resume, GPU process loss, clock change); supervision and
bounded-recovery policy per failure class; resource governor (per-session and total memory/CPU
ceilings with graceful degradation); 72 h soak with metrics; documented recovery matrix (failure →
detection → action → evidence).

**Acceptance criteria.**
1. Every fault in the injection catalogue is detected within 10 s and either recovered or surfaced
   as an actionable state — no silent hangs.
2. 72 h soak, 8 sessions: crash-free ≥ 99.5 %, no unbounded growth, no orphaned processes on exit.
3. Recovery never leaves a session in a state the UI cannot describe.
4. Force-quitting mid-write never corrupts the config store (500-cycle crash-during-write test).

**Exit gate.** The recovery matrix is complete and every row is a passing test.

---

### M7 — Security & privacy hardening · **3 ew** · *parallel*

**Objective.** Replace "carefully written" with "threat-modelled and verified".

**Deliverables.** Written threat model (assets, actors, trust boundaries, abuse cases) covering the
dashboard, game windows, IPC, config store, profile store and update channel; crypto review of
`safeStorage` usage and at-rest secrets; permission/CSP/navigation policy as an explicit,
test-asserted matrix rather than per-handler code; dependency and supply-chain policy (`npm audit`
in CI, lockfile integrity, pinned transitive deps, SBOM generation); automated secret-scanning of
logs and diagnostics; a documented data-retention and deletion story.

**Acceptance criteria.**
1. Every trust boundary has at least one test that attempts the crossing and asserts refusal.
2. CSP is asserted by test on every renderer; no `unsafe-inline` anywhere.
3. `npm audit` and SBOM generation run in CI; a seeded vulnerable dependency fails the build.
4. A grep/scan test proves no credential, cookie value or IP can appear in any log or bundle.
5. Secure-deletion path erases a profile and its secrets, verified by post-condition inspection.

**Exit gate.** Threat model reviewed, all "must" mitigations implemented and test-backed.

---

### M8 — Release engineering · **3 ew** · *critical path*

**Objective.** Ship builds that are reproducible, signed, updatable and reversible.

**Deliverables.** Reproducible packaging (same commit + lockfile → byte-identical `app.asar`,
verified in CI); versioned release channel with signed artifacts; an update mechanism with staged
rollout and rollback; install/uninstall/portable paths documented and tested; release checklist
automation; changelog generation from conventional commits; a packaging test matrix proving native
deps (`sharp`, tesseract data) load from `app.asar.unpacked` in a clean VM.

**Acceptance criteria.**
1. Two CI runs of the same commit produce identical `app.asar` hashes.
2. Update path verified end-to-end in a clean VM: install → update → rollback.
3. Packaged self-test passes in a clean VM with no dev toolchain present.
4. Uninstall removes app data only when explicitly requested, and always leaves profiles intact
   unless asked otherwise.

**Exit gate.** A release can be cut by one command and rolled back by one command.

---

### M9 — Performance & scale · **2–3 ew** · *parallel*

**Objective.** Hit §0.2's numbers and prove they hold under load.

**Deliverables.** Profiling harness (cold start, capture, classification, IPC throughput);
main-thread budget enforcement in CI (no image work, no blocking IO, no sync FS on hot paths);
worker-pool sizing study; memory governor tuning; GPU/rendering flag policy documented (the
freeze-adjacent flags already in `main.cjs` become a documented, switchable policy rather than
hardcoded); 16-session stretch test.

**Acceptance criteria.**
1. All §0.2 metrics met on the reference machine, measured by the harness, in CI-archived results.
2. 16 sessions open with graceful degradation rather than failure, documented thresholds.
3. Cold start ≤ 1.5 s p95 with 8 configured sessions.
4. Any regression beyond 10 % against the stored baseline fails CI.

**Exit gate.** The performance report is a build artifact, not a claim.

---

## 6. Cross-cutting standards

**Definition of done for any change.** Linted, type-checked, unit-tested (new behaviour), fixture-
tested (any game-facing path), no module > 200 lines, no new magic values, docs updated, ADR if it
changes a decision, CI green.

**Testing pyramid.** Unit (pure logic, fast) → fixture integration (real Electron, local HTTPS
protocol handlers, no live game) → packaged smoke (the real `.exe`) → manual live validation
(scripted, recorded, and never the only evidence). Target: ≥ 90 % of game-facing behaviour
exercised offline via fixtures. Coverage floors: 85 % lines on `src/`, 100 % on validation and
error paths.

**Fixture discipline.** Every fixture carries a manifest entry: source (recording/live/synthetic),
state label, venue, resolution, scale, language, and whether it was used in training or held out.
The corpus is version-controlled and a new bug becomes a new fixture before it becomes a fix.

**Branching and releases.** Trunk-based; short-lived branches; conventional commits; tags per
milestone (`v0.2.0`, `v0.3.0`, …); a milestone tag is only cut when its exit gate passes.

**Documentation.** `README.md` (user), `docs/architecture.md`, `docs/adr/`, `docs/runbooks/`
(recovery procedures), `docs/vision-corpus.md` (label taxonomy and provenance). Docs are part of
"done"; the D2-class drift we already fixed once must not recur — a CI check compares documented
storage behaviour against the config schema.

**Security posture.** Sandboxed renderers, no node in game windows, HTTPS-only navigation, blocked
downloads, denied permissions, `safeStorage` for secrets, no remote code or config, no telemetry by
default.

---

## 7. Risk register

| # | Risk | P | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Game UI changes silently break recognition | High | High | Corpus + CI thresholds + `unknown`-first design; a copy change must degrade, never mislead |
| R2 | Electron/Chromium pin drift breaks behaviour (the zero-window teardown class of bug) | Medium | High | Pin exact version, ADR it, smoke-test windows lifecycle per upgrade, test the upgrade in a branch |
| R3 | Microphone-thin evidence for live behaviour (7 positive fixtures, 0 negatives) | High | High | M3 corpus ≥ 300 labelled frames with held-out split before any new game-facing logic |
| R4 | Native deps (`sharp`, tesseract data) break only in packaged builds | Medium | Medium | M8 clean-VM packaging matrix; packaging test in CI from M0 |
| R5 | Resource exhaustion with many sessions | Medium | Medium | M6 governor, M9 16-session stretch, memory ceilings |
| R6 | Repo lives inside a OneDrive-synced folder | Medium | Medium | Keep `.git` operations short; document lock failures; consider a non-synced clone as the working repo |
| R7 | Bus factor of one | High | High | ADRs, runbooks, exhaustive CI, diagnostics bundles — knowledge that survives is written down |
| R8 | Scope creep back toward the excluded automation set | Medium | High | §0.1 is a decision, not a default; it is re-read at every milestone gate |
| R9 | Ban/ToS consequences of any game-facing automation the owner pursues elsewhere | Medium | High | Documented and out of our scope; the platform's diagnostics remain useful without it |
| R10 | Silent accuracy rot (tests green, live wrong) | Medium | High | Held-out split, negative fixtures, periodic scripted live validation with recorded evidence |

---

## 8. Decision log — ADRs to write in M0

| ADR | Decision | Notes |
| --- | --- | --- |
| 001 | CommonJS vs ESM for main process | CJS today; decide once, document migration cost |
| 002 | Recognition stack: Tesseract vs ONNX/template hybrid | M3 chooses on measured accuracy and latency |
| 003 | `persist:` partitions vs managed profile directories | Affects control over corruption repair and quotas |
| 004 | Authoritative session store (profile) and the fate of the plist | **Closes D3**; one owner per piece of state |
| 005 | IPC contract versioning strategy | Compatibility policy across releases |
| 006 | Electron version pinning and upgrade policy | Directly motivated by the zero-window finding |
| 007 | Game-facing test strategy: fixtures vs live validation | Encodes §6's fixture discipline |
| 008 | Config schema tooling (hand-written vs generated) | Determines M2's ergonomics |
| 009 | Error taxonomy and user-facing message policy | Every failure names cause + next action |
| 010 | Telemetry policy: local-only by default | Privacy as the default posture |

---

## 9. Execution order, parallelism and critical path

```
M0 ──▶ M1 ──▶ M3 ──▶ M6 ──▶ M8        (critical path: foundation → sessions → vision → reliability → release)
        └──▶ M2  (parallel after M1's data model lands)
        └──▶ M4  (parallel, needs M1's event surface)
        └──▶ M5  (parallel, needs M2's schema)
                 M7  (parallel, needs M1+M4 surfaces)
                          M9 (final, needs M3+M6 measurements)
```

Estimated total: **30–36 ew** to the full target, with the first genuinely usable improvement
(M0+M1) landing in **6–8 ew**. Quick wins that can be pulled forward out of M1/M3 without waiting
for the full milestone: D7 restore (hours), D6 worker reuse (1–2 days), D4 candidate scoring (1–2
days), D5 confidence+evidence shape (2–3 days).

---

## 10. What "finished" means

The programme is complete when, on a clean machine: a single command produces a signed,
reproducible build; the packaged app passes its full self-test with no dev toolchain present; 8
sessions run for 72 hours inside the §0.2 budgets; recognition accuracy is ≥ 97 % top-1 on a ≥ 300
frame held-out corpus with zero confident wrong answers; every failure class in the recovery matrix
has a passing test; every trust boundary has a refusal test; and every architectural decision is
recorded in an ADR. That is the standard. Nothing in §0.1 is part of it.
