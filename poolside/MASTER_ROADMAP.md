# Poolside — Final-Product Blueprint

- **Plan of record:** 2026-09-21
- **Product baseline when this plan was written:** 0.3.10; Module A source/claim controls entered in 0.3.11
- **Automated baseline at planning:** 421 unit tests, plus lint, type checking, formatting, SBOM, package inspection, packaged self-test, and two-process persistence restart test. Run `npm run verify` for the current count.
- **Purpose:** take the existing local 8 Ball Pool workspace from its current tested foundation to a complete, robust, supportable Windows product.

This document replaces the earlier phase sketch. It is the authoritative delivery plan. `INCOMPLETE_WORK.md` remains the short defect/gap register, the ADRs retain architectural decisions, and the release checklist remains the per-build procedure.
The [work-item register](docs/work-items.json) tracks every deliverable with its owner, dependencies, and evidence contract; the [generated capability report](docs/CAPABILITIES.md) states what the current build actually does.

---

## 1. What “finished” means

Poolside is finished only when a person can install it on a clean supported Windows machine, create or restore their workspace, open several isolated sessions, sign in manually, select a target table, run a supervised multi-session workflow, understand every state, recover from expected failures, review the resulting local record, update or roll back the application, and uninstall it without losing or leaking unrelated data.

The final product must provide all of the following:

1. **Workspace and accounts.** Create, edit, archive, restore, back up, migrate, and deliberately delete account workspaces. Each account has an isolated persistent browser profile and clearly displayed health.
2. **Reliable sessions.** Open, close, focus, arrange, inspect, and recover game windows independently. A failure in one session must not corrupt or silently stop another.
3. **Truthful observation.** Recognize only real supported screens, find supported tables, read approved on-screen values with measured confidence, and show `unrecognized` as an outcome—not as an invented screen.
4. **Controlled navigation.** Navigate from the current screen to the selected table through explicit, cancellable states. Every input must have a verified precondition and postcondition.
5. **Coordinated runs.** Prepare the configured receiver and senders, validate readiness, start them through a controlled barrier, verify pairing or safely stop, track the configured run limit, and allow pause/resume/cancel.
6. **Outcome and balance accounting.** Observe match outcomes and balances, reconcile expected versus observed changes, identify uncertainty, and never present an inferred value as confirmed.
7. **Safe recovery.** Bound retries, provide manual takeover, preserve profiles, retain useful local diagnostics, and never loop indefinitely or click blindly.
8. **Professional UI.** A coherent component system, per-session detail view, first-run guidance, command palette and keyboard controls, accessibility, localization readiness, and no stale or misleading status.
9. **Operational quality.** Rotating logs, crash records, fault injection, performance budgets, clean-machine tests, long-running soak evidence, high-session-count evidence, and GPU/compositor characterization.
10. **Real distribution.** CI, deterministic dependency evidence, signed installer, signed update metadata, safe updates with rollback, release notes, support bundle, and a rehearsed recovery path.

“Implemented” is not synonymous with “finished.” A capability moves through this evidence ladder:

| Level              | Meaning                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Designed           | Contract, state model, risks, and acceptance tests are written.                                |
| Implemented        | Production code exists behind an explicit feature boundary.                                    |
| Fixture-proven     | Unit and deterministic fixture tests pass.                                                     |
| Integration-proven | Electron/process/storage/input boundaries pass automated tests.                                |
| Live-validated     | The real game and real supported Windows configurations were tested and results recorded.      |
| Release-proven     | The signed packaged build passed clean-machine, update, rollback, performance, and soak gates. |

No feature is called complete before the level required by its acceptance gate.

---

## 2. Product boundaries and safety rules

These boundaries are part of the product, not optional polish:

- Poolside is local-first. Captures, account metadata, profiles, logs, and observations stay on the machine unless the user explicitly exports a redacted support bundle.
- The user signs in inside the real browser window. Poolside does not ask for, display, export, or import raw passwords, tokens, or third-party credential files.
- Captcha, consent, age gates, security challenges, account recovery, purchase flows, and unexpected legal notices always pause automation for manual handling.
- Live input is allowed only for a recognized supported state and a mapped control whose geometry has been validated. No coordinate-only blind clicking is permitted.
- Every run has a visible stop control, a global emergency stop, bounded retries, and automatic stop on loss of confidence or contradictory evidence.
- Network routes and ordinary browser identity settings may be configured and verified. Poolside must not claim to bypass anti-cheat, device-integrity, identity, or platform enforcement.
- The product must be used only with accounts the user is authorized to control and in accordance with applicable law and service rules. A compliance review is a release gate before coordinated automation is enabled by default.
- There is no cloud control plane, remote code loading, silent analytics, or hidden updater behavior.

---

## 3. Current baseline: 0.3.10

### 3.1 Implemented and automated-test covered

- Isolated persistent Chromium partitions and encrypted session-cookie carry-over.
- Defensive workspace loading: malformed workspace data becomes read-only instead of causing account/profile deletion.
- Workspace writes now validate the full version-1 document, flush unique staging files, and retain one privacy-aware local recovery copy. Missing primaries with recovery material remain read-only; automatic recovery and clean-VM interruption proof are still open.
- Profile generation, integrity checking, quarantine, size reporting, repair and deliberate deletion.
- Account creation, rename, notes, archive/restore, removal, bulk planning, workspace backup foundations.
- Per-session browser identity configuration, route parsing including authenticated proxies, route presets, and public-IP verification.
- Window lifecycle, remembered geometry, multi-monitor bounds, shop-return behavior, background throttling and repaint controls.
- Session state machine, bounded recovery policy, supervision, activity journal, combined timeline, telemetry redaction, and diagnostics bundle foundations.
- Local capture and OCR pipeline, surface ranking, coordinate transforms, seven real screen labels, table-specific capture targets, evidence/benchmark separation, review workflow, and corpus gates.
- Provisional, confidence-gated visual comparison against reviewed local table Evidence; held-out Benchmark images remain excluded and the production recognition gate has not passed.
- Read-only aggregate replay of reviewed Evidence through first-pass and current full-pipeline OCR, including timing. Reviewed Lucky Promotion and Shop variants now have explicit screen rules, with no claim of independent accuracy.
- Development replay on the current 112 reviewed Evidence images: 112/112 screen labels matched, 64/64 table names matched **in-sample**, and full-pipeline OCR p95 was about 2.0 seconds on this machine. These images drove the rules and can be visual references, so these numbers are diagnostic only; the held-out latency gate is still open. The original 800 ms target was provisionally revised to 2,000 ms for this local machine on 2026-09-21; this did not approve the gate.
- The newer capture collection raised the stored held-out Benchmark set to 108 images. Its capture-time aggregate passes the current accuracy and table-target thresholds but not set size, per-label/per-table coverage, or latency. It remains untouched for future validation; experimental input resizing and central-card crops were rejected from production after Evidence-only misses, while a first-pass Shop fast path preserved all 13 reviewed Shop screen labels and reading values.
- The 0.3.8 development replay processed all 113 reviewed Evidence images without changing them: 113/113 screen labels and 65/65 table names matched in-sample; local full-reader p95 was about 1.7 seconds. This is not held-out accuracy, and the capture-plus-OCR production gate remains open.
- The 0.3.9 read-only Evidence replay retained 113/113 screen labels and 65/65 in-sample table names; full-reader p95 was 1,698 ms. Stage timings show table-selection first OCR p50 915 ms, visual matching p50 46 ms, and 17/65 table samples requiring contrast OCR. Late OCR completion after an inspection timeout can no longer write a capture. Full L4 telemetry, fault injection, and the held-out release gate remain open.
- Periodic visible-value reading foundations with current/uncertain/stale status.
- Schema-driven settings validation and form mapping.
- A per-session table-navigation **dry run** with target table selection, explicit states, timeouts, cancellation, retry, manual instructions, and a bounded journal.
- Source architecture guards: 300-line module ceiling, acyclic local dependencies, pure-module Electron isolation, and orphan detection.
- Windows CI workflow on main pushes and pull requests for clean dependency installation, formatting, lint, type checking, unit tests, two-process persistence, corpus-validation contract tests, SBOM, packaging, package inspection, and packaged self-test. The updated workflow has not yet run on the hosted remote.
- Pinned dependencies, CycloneDX SBOM generation/checking, package hashing, portable Windows package, and packaged self-test.

### 3.2 Not yet release-proven or not implemented

- Real-site recognition accuracy has not passed the full held-out benchmark gate.
- Table-navigation live input is intentionally disabled.
- Matchmaking coordination, pairing verification, match lifecycle, and run accounting are not implemented.
- Durable rotating logs, crash files, and a scripted fault-injection harness are incomplete.
- The per-session detail experience, complete design system, localization, full accessibility audit, command palette, and complete first-run flow are incomplete.
- There is no signed installer, signing identity, updater, update rollback proof, or reproducible-build proof.
- Clean-VM installation/update/uninstall, 72-hour soak, 16-session stretch, GPU/compositor matrix, and reference-machine performance reports have not been completed.

### 3.3 Baseline rule

Before starting a work item, record the current green commit/build and run:

```text
npm ci
npm run verify
npm run format:check
npm run sbom:check
npm run package
npm run release:inspect
release/Poolside-win32-x64/Poolside.exe --self-test
```

If the baseline is red, fix or explicitly quarantine that defect before layering a feature over it.

---

## 4. Target architecture

The application remains a desktop shell around small modules with explicit ownership:

```text
Renderer UI
  ↓ versioned preload API
IPC validation and authorization
  ↓
Application services
  ├─ workspace/profile services
  ├─ session/window services
  ├─ observation and recognition services
  ├─ navigation/input services
  ├─ coordination/run services
  └─ logging, recovery, and release services
  ↓
Pure policy and state machines
  ↓
Electron, filesystem, OCR, Windows, and network adapters
```

Architecture rules:

- State transitions belong to pure reducers; services perform effects and publish snapshots.
- A renderer never receives a `BrowserWindow`, filesystem path, cookie, token, raw proxy credential, or unrestricted IPC method.
- Every effect adapter has a dry-run/fake implementation for deterministic testing.
- Stored documents are versioned and migrated. Migrations are one-way in memory, followed by an atomic write and recoverable backup.
- Every queue is bounded. Every wait has a timeout. Every retry has a limit and backoff. Every long operation is cancellable.
- Every user-visible value includes its source, timestamp, and confidence/verification state where applicable.
- The 300-line limit is a maintainability signal, not a reason to fragment cohesive logic. Exceptions require an ADR and a focused test.
- Game-facing logic must be independent of text shown in the UI and independent of arbitrary screen coordinates.

### 4.1 Canonical data entities

The final schema must explicitly version and validate these entities:

| Entity           | Required purpose                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace        | Schema version, application preferences, account order, route presets, UI preferences, migration metadata.                                         |
| Account          | Stable ID, role, label, local note, profile generation, account overrides, recovery settings, archival state.                                      |
| Session runtime  | Window/session generation, FSM state, health, route result, observation, navigation plan, last error. Never written as authoritative account data. |
| Capture sample   | Image hash, expected real screen, table target where relevant, capture geometry, timings, review and benchmark status.                             |
| Observation      | Recognized state, visible tables, field readings, confidence, frame/capture identity, timestamp, model/rule version.                               |
| Navigation plan  | Target table, current state, attempt, deadline, precondition, input request/result, observation, transition history.                               |
| Coordination run | Participants and roles, target, limit, policy, readiness, barrier generation, lifecycle state, cancellation and failure reason.                    |
| Match record     | Run ID, participant IDs, observed start/end, pairing evidence, outcome evidence, balances before/after, reconciliation verdict.                    |
| Activity event   | Stable event code, severity, redacted context, monotonic and wall-clock time, correlation IDs.                                                     |
| Crash record     | Process/build identity, safe stack/failure code, active correlation IDs, recent redacted events, recovery result.                                  |
| Release manifest | Version, channel, artifact hashes, SBOM hash, signing identity, minimum schema, rollback compatibility.                                            |

No stored entity may accept arbitrary object spreading from a browser or OCR result. Writers use fixed allowlists.

---

## 5. Module workstreams

Each workstream has an owner contract and an exit gate. IDs are stable so issues and commits can reference them.

### Module A — Product governance, scope, and documentation truth

**Outcome:** code, UI, help, ADRs, and release claims describe the same product.

Deliverables:

- **A1** Convert this blueprint into tracked work items with dependencies, acceptance evidence, and responsible owner.
- **A2** Add a capability registry consumed by the About/Diagnostics view: implemented mode, validation level, feature flag, and build version.
- **A3** Remove stale claims from README, architecture notes, incomplete-work register, and ADR-0011 whenever a capability changes level.
- **A4** Record product boundaries, supported Windows versions, supported game locale(s), supported display configurations, and support lifetime.
- **A5** Add decision templates for game-facing input, updater infrastructure, signing, and data migrations.
- **A6** Establish a release evidence folder format containing reports, hashes, screenshots without secrets, matrix results, and sign-off.

Exit gate:

- A generated capability report and repository documentation agree in an automated test.
- No UI string claims authentication, pairing, accuracy, or completion without the backing state/evidence.

### Module B — Workspace durability, schema migrations, backup, and restore

**Outcome:** upgrades, crashes, malformed records, and operator mistakes cannot silently erase the workspace.

Deliverables:

- **B1** Introduce an explicit workspace schema version and ordered migration registry with golden fixtures from every released version.
- **B2** Use atomic write: validate → write temporary sibling → flush → rename → retain bounded previous-known-good copy.
- **B3** Add startup recovery choices for corrupt primary plus valid backup; never auto-discard account records.
- **B4** Complete portable Poolside backup/export with manifest, checksums, version, encrypted sensitive profile payload, and preflight size estimate.
- **B5** Complete restore into a staging directory, validate everything, detect conflicts, then commit atomically.
- **B6** Define cross-Windows-user behavior for DPAPI material: re-authentication or an explicit user-chosen export encryption key; never imply DPAPI blobs are portable.
- **B7** Add retention controls and test archive/restore/delete independently of profile deletion.
- **B8** Test disk-full, access-denied, interrupted write, partial copy, damaged manifest, old schema, future schema, and OneDrive contention.

Exit gate:

- A fault at every write boundary leaves either the old valid workspace or the new valid workspace.
- Restore never mutates the live workspace until all manifest, path, checksum, schema, and capacity checks pass.

### Module C — Account and profile lifecycle

**Outcome:** account records and their browser storage have explicit, recoverable lifecycles.

Deliverables:

- **C1** Finish the per-account detail view: role, profile generation, storage health/size, sign-in persistence status, route, identity, observations, recovery history, and safe actions.
- **C2** Enforce role invariants in one policy module: exactly one active receiver for coordinated runs and one or more eligible senders, without blocking ordinary independent sessions.
- **C3** Add profile health actions: inspect, quarantine summary, reopen, repair-safe metadata, export, and deliberate delete.
- **C4** Add conflict-proof names only as display labels; stable IDs remain the authority.
- **C5** Verify archive, restore, remove-record-only if supported, and remove-record-plus-profile semantics with explicit confirmations.
- **C6** Add profile-lock detection and clean handling when another Poolside process or security product holds files.
- **C7** Validate at least two complete restart cycles and machine reboot behavior with multiple real signed-in accounts.

Exit gate:

- Every destructive action names exactly what is removed, refuses unsafe partial execution, and is covered by path-safety tests.
- No startup path can infer that an unreadable workspace means “zero accounts.”

### Module D — Session, window, GPU, and compositor reliability

**Outcome:** each browser session behaves independently and failures are visible and recoverable.

Deliverables:

- **D1** Complete the session FSM states, reason codes, deadlines, and transitions for launch, page readiness, manual challenge, degraded rendering, crash, recovery, and closure.
- **D2** Add renderer-process and GPU-process crash observation with safe crash records and bounded recovery.
- **D3** Build freeze detection from frame-change probes, navigation progress, compositor health, and user focus—not from an invented “blank screen” label.
- **D4** Offer explicit recovery actions: refocus/repaint, reload, reopen window, restart session process, and manual takeover.
- **D5** Characterize hardware acceleration on supported GPUs/drivers and add a documented per-machine fallback flag only when evidence supports it.
- **D6** Test remembered placement across monitor disconnect, DPI change, resolution change, taskbar movement, and off-screen recovery.
- **D7** Prevent duplicate launches and give the second process a safe “focus existing instance” behavior.

Exit gate:

- A session crash cannot crash the dashboard or corrupt another session.
- The GPU/compositor matrix has a recorded result and workaround decision for each supported configuration.

### Module E — Identity, routes, network preflight, and connectivity

**Outcome:** every session’s effective browser settings and route are known before a coordinated run starts.

Deliverables:

- **E1** Complete schema-generated workspace defaults and per-account overrides for every supported identity and route field.
- **E2** Keep route credentials masked end to end; separate authentication from public route descriptions and diagnostics.
- **E3** Add route-preset lifecycle: create, edit, test, assign, unassign, delete-if-unused, health timestamp, and failure history.
- **E4** Add per-session preflight for DNS/connectivity, game reachability, public IP, route mismatch, and latency sample.
- **E5** Define route readiness rules for coordinated runs and prevent starting with duplicate/missing/unverified routes when policy requires otherwise.
- **E6** Handle proxy authentication prompts, offline state, captive portals, DNS failure, TLS failure, and partial network recovery without exposing secrets.
- **E7** State exactly which browser identity surfaces are controlled and which are not. Add live readback tests for every controlled field.

Exit gate:

- The effective settings shown in the detail view match values read back from the live session.
- A coordinated run cannot start when its declared network policy is unmet.

### Module F — Capture Lab and labelled data program

**Outcome:** game-facing decisions are based on representative, reviewed evidence instead of assumptions.

Deliverables:

- **F1** Complete the current evidence and held-out benchmark sets described in `docs/live-validation-runbook.md`.
- **F2** Collect all seven real screen labels: loading, connecting, lucky promotion, lucky shot, lobby, table selection, and shop.
- **F3** Label table-selection samples with the actual supported table target. Cover every table at several scroll positions.
- **F4** Add hard negative outcomes—cropped text, menus, overlays, browser chrome, degraded frames, unrelated pages—as expected `unrecognized` results, never as fake screens.
- **F5** Add action annotations in normalized game-surface coordinates for every control needed by supported navigation. Each annotation includes control name, bounds, visible state, disabled state if applicable, screen label, table target, and reviewer.
- **F6** Cover at least three window sizes, two display scales where hardware permits, multiple launches, early/settled transitions, multiple background themes, and occlusion/failure examples.
- **F7** Keep evidence and benchmark samples separate. Any benchmark sample used to tune a rule returns to evidence and is replaced with a later held-out sample.
- **F8** Add corpus version, recognizer version, capture geometry, duplicate detection, reviewer history, and exportable aggregate report.
- **F9** Define retention and deletion for images and ensure captures containing private data are rejected or immediately removable.

Exit gate:

- Surface-selection, label, per-table, negative-outcome, uniqueness, review-queue, accuracy, macro-F1, unrecognized-rate, and p95 timing gates all pass on a frozen held-out set.
- A second person can reproduce the aggregate report from the local manifest without seeing credentials or private page text.

### Module G — Recognition and visible-reading engine

**Outcome:** observations are accurate enough for safe state transitions and honest enough to stop when unsure.

Deliverables:

- **G1** Validate surface ranking against real multi-canvas/iframe layouts and no-surface failures.
- **G2** Move from concatenated OCR to the existing spatial grid only when benchmark results demonstrate improvement.
- **G3** Add control/anchor detection for navigation using a tested combination of OCR, layout geometry, color/shape features, and template matching as justified by data.
- **G4** Produce a typed observation: screen, visible tables, controls, readings, confidence, contradictions, capture identity, timings, and rule version.
- **G5** Calibrate thresholds per observation type. Table visibility and clickable-control readiness require stronger evidence than a passive UI label.
- **G6** Complete balance/rank/trophy and match-result regions with current/uncertain/stale handling, normalized number parsing, and explicit approximate-value behavior.
- **G7** Add transition smoothing: require stable repeated evidence where appropriate while retaining fast response for safety stops.
- **G8** Detect contradictory evidence and return `unrecognized`/`unsafe`, never pick the highest weak guess.
- **G9** Version recognizer rules and record before/after benchmark reports for every change.

Exit gate:

- Recognition passes the frozen benchmark thresholds and live matrix.
- No production navigation action is enabled by a single low-confidence or contradictory observation.

### Module H — Safe input execution

**Outcome:** Poolside can perform validated game navigation actions without blind clicks or runaway input.

Deliverables:

- **H1** Preserve the dry-run adapter and add a production input-adapter interface; feature flag remains off until all H gates pass.
- **H2** Define one action catalog: close supported detour, return/back, open play, choose 1-on-1, move table list, select target table, enter table, leave/cancel supported flow, and other explicitly approved navigation actions.
- **H3** Resolve control bounds from the current observation in normalized game-surface coordinates and transform them through the existing CSS/DIP/image coordinate model.
- **H4** For every action, enforce: fresh observation → expected screen → required control confidence → bounds inside surface → window/session generation match → input → postcondition wait.
- **H5** Add idempotency and duplicate suppression so a delayed postcondition cannot cause a second destructive click.
- **H6** Add per-action deadline, retry policy, backoff, attempt count, screenshot hash, and safe failure result.
- **H7** Pause immediately on focus loss, window movement during dispatch, manual pointer/keyboard activity, security challenge, or emergency stop.
- **H8** Create a deterministic fake input adapter and a fixture window for integration tests; never use the live game in CI.
- **H9** Add visible “automation active” indication and an always-available global stop hotkey whose handler does not depend on renderer responsiveness.

Exit gate:

- Every live action succeeds across the supported display matrix with a verified postcondition.
- Mislabelled, stale, moved, occluded, or low-confidence frames result in zero input.
- Emergency stop prevents any new input within a measured and documented upper bound.

### Module I — Table navigation

**Outcome:** any open eligible session can reach a selected supported table or stop with a precise reason.

Deliverables:

- **I1** Extend the current dry-run FSM into the complete navigation graph: inspect current state, leave supported detours, reach lobby, open table selection, locate table, open table, reach ready/matchmaking, complete or fail.
- **I2** Model table list direction, visible range, wrap/no-wrap behavior, repeated-frame detection, maximum search steps, and “table unavailable” outcome.
- **I3** Keep target table as data from the shared table catalog, not as separate screen labels.
- **I4** Add manual, assisted, and live modes behind the same state contract.
- **I5** Persist only redacted bounded navigation events; a restarted app must not resume input from a stale plan.
- **I6** Add cancel, retry-from-safe-state, return-to-lobby, and manual takeover paths for every nonterminal state.
- **I7** Validate each supported table and each supported starting screen with live evidence.

Exit gate:

- A live validation matrix reaches every supported table from every supported starting state or records an intentional unsupported path.
- Timeouts, missing tables, detours, network failures, and cancellation never cause an unbounded loop.

### Module J — Multi-session coordination and matchmaking

**Outcome:** Poolside coordinates a receiver and eligible senders as one observable, cancellable run.

Deliverables:

- **J1** Add a pure coordination-run FSM with states: draft, preflight, preparing, waiting-ready, armed, releasing, matching, verifying-pairing, active-match, reconciling, between-matches, paused, completed, cancelled, and failed.
- **J2** Create a run plan containing participant IDs/roles, target table, match limit, route policy, timing policy, retry limits, and stop conditions.
- **J3** Preflight every participant: open/healthy session, manual challenges cleared, correct target, route policy satisfied, recent high-confidence observation, input enabled, and no conflicting run.
- **J4** Navigate participants independently to a common readiness barrier. A failure removes readiness and blocks release.
- **J5** Implement monotonic-clock barrier release and record requested versus actual dispatch skew per session.
- **J6** Verify pairing from approved visible evidence. Do not infer successful pairing solely from simultaneous connecting screens.
- **J7** If pairing is not confirmed, cancel or recover according to an explicit bounded policy and require manual intervention after the limit.
- **J8** Support pause after a safe boundary, immediate emergency cancel, participant dropout, replacement policy if supported, and clean return to independent session control.
- **J9** Ensure only one coordinator owns a session and one active run owns a participant.
- **J10** Add a run dashboard with readiness, current stage, attempt, skew, observation age, stop reason, and per-session next action.

Exit gate:

- Deterministic simulations cover every transition, participant failure at every stage, timeout, cancel, pause/resume, and stale event.
- Live tests demonstrate repeatable readiness and pairing verification without false success claims.

### Module K — Match lifecycle, outcome detection, and reconciliation

**Outcome:** Poolside knows what happened in each coordinated match and can stop when results are uncertain.

Deliverables:

- **K1** Define the supported match lifecycle and collect/label the additional real frames required to observe it. Do not invent labels before evidence exists.
- **K2** Detect match start, participant identity/pairing evidence, in-match state, result, return flow, and interrupted/abandoned outcome.
- **K3** Snapshot approved visible balances before and after with confidence and observation age.
- **K4** Create an append-only match ledger with run ID, participants, timestamps, outcome evidence, balance evidence, and reconciliation verdict.
- **K5** Calculate expected versus observed changes using a pure accounting module with integer-safe units and table/rule metadata.
- **K6** Mark each record confirmed, uncertain, contradicted, or incomplete. Never silently rewrite an earlier observation; corrections are linked records.
- **K7** Enforce configured match/run limits, loss/balance floors, maximum consecutive failures, maximum duration, and manual stop.
- **K8** Present summaries by run and account: matches attempted/confirmed, outcomes, observed balance changes, uncertainty, retries, and stop reason.
- **K9** Export a redacted user-owned report without profile data, credentials, arbitrary browser text, or capture images unless separately selected.

Exit gate:

- Fixture and live validation demonstrate correct lifecycle and accounting across normal completion, disconnect, ambiguous result, interrupted match, stale reading, and contradictory balance evidence.
- No automation continues past a configured safety limit or unresolved reconciliation error.

### Module L — Recovery, observability, diagnostics, and fault injection

**Outcome:** failures are diagnosable, bounded, and recoverable without private-data leakage.

Deliverables:

- **L1** Introduce stable event codes, correlation IDs for session/navigation/run/match, severity, monotonic time, and redacted structured context.
- **L2** Add rotating durable JSON logs with size/count limits, crash-safe append strategy, and user-controlled erasure.
- **L3** Add main, renderer, child-process, GPU, unhandled rejection, and fatal startup crash records with build identity and recent safe events.
- **L4** Record frame timings: capture, preprocessing, OCR, classification, queue wait, action-to-postcondition, coordination skew, and UI render.
- **L5** Finish the diagnostics bundle with manifest, hashes, capability report, configuration-with-secrets-removed, recent events, crash files, and explicit preview before export.
- **L6** Build a fault-injection harness for disk full, permission denied, corrupt files, OCR timeout, worker crash, browser crash, GPU crash, route loss, delayed IPC, stale observation, invalid transition, clock jump, and partial update.
- **L7** Define operator-facing error taxonomy and next action for every terminal failure code.
- **L8** Add support-bundle compatibility tests and secret/privacy scans that refuse export on a match.

Exit gate:

- Every injected fault produces the documented state, bounded recovery, and redacted evidence.
- A support bundle from each failure scenario is sufficient to identify the failing subsystem without containing secrets.

### Module M — User experience, design system, accessibility, and localization

**Outcome:** the application is understandable during normal operation and stress, not merely technically capable.

Deliverables:

- **M1** Define design tokens for color, typography, spacing, radius, elevation, motion, focus, status, and charts.
- **M2** Build reusable components for buttons, fields, selects, badges, cards, dialogs, tables, tabs, toasts, empty states, progress, timelines, and destructive confirmations.
- **M3** Complete the information architecture: Sessions, Run, Activity, Accounts, Capture Lab, Settings, and Help/About.
- **M4** Add a focused per-session detail view instead of forcing every advanced control into an account card.
- **M5** Add first-run setup and contextual guidance: create roles, open/sign in, capture/validate, configure route if needed, run dry mode, then enable validated live mode.
- **M6** Add command palette and documented hotkeys for focus/open/close/inspect/start/pause/cancel/emergency stop, with conflict handling.
- **M7** Complete keyboard navigation, logical focus order, visible focus, screen-reader names/states, error association, reduced motion, zoom/reflow, contrast, and non-color status cues.
- **M8** Externalize all user-facing strings and establish locale fallback, pluralization, date/number formatting, and layout-resilience tests. Declare which game locale recognition supports separately.
- **M9** Ensure zero-state, loading, stale, uncertain, unavailable, disconnected, permission, and recovery states are deliberately designed.
- **M10** Show application version, build/channel, update state, storage location, privacy controls, and support-bundle action in About.
- **M11** Conduct usability tests on first-run, account recovery, dry-run navigation, live-run stop, update, and restore.

Exit gate:

- WCAG 2.2 AA-oriented audit has no unresolved critical/serious finding for the desktop UI.
- Every core workflow is usable without a mouse, and automation can be stopped without navigating the UI.
- User testing demonstrates that people can distinguish observed, inferred, stale, and unavailable information.

### Module N — Security, privacy, dependency, and compliance hardening

**Outcome:** release risks are known, mitigated, and reviewed on every material change.

Deliverables:

- **N1** Update the threat model for live input, coordination, updater, installer, backup encryption, logs, crash files, and exported reports.
- **N2** Minimize and version IPC; validate sender, account/session ownership, arguments, size, rate, and state preconditions at every handler.
- **N3** Retain Electron hardening: context isolation, sandboxing where supported, no Node integration in game windows, navigation allowlists, popup control, blocked downloads, and permission denial by default.
- **N4** Add automated secret scanning, dependency vulnerability review, license policy, SBOM generation, and release provenance.
- **N5** Define local data inventory and retention. Provide erase controls for activity, captures, logs, backups, and profiles independently.
- **N6** Protect update metadata with signatures and anti-rollback/minimum-version rules where necessary, while preserving a safe documented rollback path.
- **N7** Review route credentials, support bundles, clipboard actions, renderer HTML escaping, local file permissions, and Windows temporary-file behavior.
- **N8** Complete a compliance review of coordinated game input before enabling it by default. Record supported use, restrictions, and manual-only fallback.
- **N9** Commission or perform an independent security review before 1.0 and triage all findings.

Exit gate:

- No unresolved critical/high security finding.
- Privacy/secret scans pass on every exported artifact and release package.
- Threat model and SBOM match the shipped build.

### Module O — CI, packaging, signing, updates, and rollback

**Outcome:** the binary users run is traceable to reviewed source and can be safely installed, updated, rolled back, and removed.

Deliverables:

- **O1** Expand the existing Windows CI on pull request and main: retain clean install, formatting, lint, type check, unit tests, and SBOM checks; add explicit corpus validation, package, package inspection, and packaged self-test stages.
- **O2** Add artifact retention for test reports, benchmark aggregates, SBOM, hashes, and package logs.
- **O3** Choose and implement installer format, install scope, shortcuts, protocol/association policy if any, repair behavior, and clean uninstall semantics.
- **O4** Acquire protected Windows code-signing capability; sign executables, installer, uninstaller, and update artifacts; verify signatures in CI/release ceremony.
- **O5** Add stable/beta update channels, signed manifest, staged download, hash/signature verification, explicit user control, release notes, and failure reporting.
- **O6** Implement update transaction: preflight disk/schema compatibility → close sessions safely → backup workspace metadata → install → first-start health check → commit or rollback.
- **O7** Test upgrade and rollback from every supported previous version, including no-network, corrupt download, power/process interruption, insufficient space, and schema incompatibility.
- **O8** Produce reproducible-build evidence. Prefer byte-for-byte artifacts; where upstream packaging embeds unavoidable metadata, document and independently verify normalized contents and dependency provenance.
- **O9** Publish version, SHA-256, signature identity, SBOM, release notes, known limitations, and minimum requirements together.
- **O10** Rehearse signing-key loss/rotation, bad-update withdrawal, and emergency release procedures.

Exit gate:

- A clean VM can install, launch, update, roll back, repair, and uninstall the signed build using only published artifacts.
- The installed app passes its packaged self-test and preserves the workspace across supported update/rollback paths.

### Module P — Performance, scale, compatibility, and long-run validation

**Outcome:** supported limits are measured and failures occur gracefully before resource exhaustion.

Deliverables:

- **P1** Define a reference machine and a low-end supported machine, including Windows build, CPU, RAM, GPU/driver, display scale, and network conditions.
- **P2** Establish measured budgets for cold start, dashboard responsiveness, session open, capture, OCR, observation freshness, input postcondition, coordination skew, memory, CPU, disk growth, and shutdown.
- **P3** Add repeatable performance scripts and reports; fail CI or release review on unexplained regression beyond the agreed tolerance.
- **P4** Run 1-, 4-, 8-, and 16-session stretch tests for launch, arrangement, periodic reading, navigation readiness, route checks, and clean shutdown.
- **P5** Run a 72-hour soak with representative session churn, capture cadence, route interruption, sleep/wake, monitor change, and log rotation.
- **P6** Test GPU/compositor configurations, 100/125/150/175/200% scaling, supported resolutions, single/multi-monitor, and remote/virtualized environments if supported.
- **P7** Test offline startup, slow network, high latency, packet loss, DNS failure, proxy loss, suspend/resume, clock change, low disk, antivirus scanning, and OneDrive-managed workspace surroundings.
- **P8** Measure storage growth and prove configured bounds for logs, history, captures, backups, quarantines, and update caches.
- **P9** Publish supported maximum active sessions based on evidence, not aspiration. When the limit is reached, refuse gracefully with an explanation.

Initial budgets to validate and adjust from evidence:

| Measure                        | Initial target                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Dashboard interaction feedback | p95 under 100 ms when no blocking dialog is open                                       |
| Cold dashboard availability    | p95 under 3 s on the reference machine                                                 |
| Local screen classification    | median under 1.5 s, p95 under 3 s per observation on the reference machine             |
| Emergency input stop           | no new dispatch after 250 ms; already-dispatched action reported                       |
| Coordination release skew      | measured per run; target selected only after real multi-session baseline               |
| Bounded disk data              | no category grows without configured or documented retention                           |
| Long-run stability             | zero unhandled crash, corrupt workspace, runaway input, or unbounded queue in 72 hours |

Exit gate:

- Performance and compatibility reports identify pass/fail for every supported configuration.
- Sixteen-session stretch and 72-hour soak pass the defined error and resource budgets.

### Module Q — Support, maintenance, and post-release operations

**Outcome:** 1.0 can be maintained without guessing how a user reached a failure.

Deliverables:

- **Q1** Write user guide, first-run guide, backup/restore guide, troubleshooting decision tree, privacy guide, and update/rollback guide.
- **Q2** Define severity levels, response targets, supported-version window, data requested for support, and escalation paths.
- **Q3** Add a known-issues document tied to build versions and workarounds.
- **Q4** Define compatibility monitoring for Electron, Windows, OCR dependencies, and live-game layout changes.
- **Q5** Add a safe recognizer/corpus update procedure that requires benchmark and release gates; never load remote rules at runtime.
- **Q6** Schedule dependency, threat-model, backup-restore, signing, and disaster-recovery reviews.
- **Q7** Define rollback/kill-switch behavior for automation locally through signed releases or user-controlled settings—not remote executable code.

Exit gate:

- A support exercise can diagnose and resolve representative install, profile, recognition, route, navigation, and update failures using published procedures.

---

## 6. State-machine contracts

### 6.1 Navigation contract

Every transition carries:

- current and next state;
- stable event/reason code;
- session and window generation;
- target table;
- fresh observation ID and age;
- requested input and actual result;
- deadline/attempt/retry count;
- correlation ID and timestamp.

The plan fails closed when the window generation changes, observation is stale, bounds leave the game surface, state is contradictory, or postcondition is not observed.

### 6.2 Coordination contract

The coordinator does not send arbitrary commands. It asks each participant service to reach a declared readiness condition, then releases a generation-tagged barrier. Old events from a prior run or prior window generation are ignored. Participant failure invalidates the barrier.

### 6.3 Match and ledger contract

A match record is append-only. Observations may be superseded but not rewritten. “Confirmed” requires approved pairing, result, and reconciliation evidence. An ambiguous record stops or pauses the run according to policy and remains visibly ambiguous.

### 6.4 Cancellation contract

Cancellation is propagated from UI/global hotkey → coordinator → navigation/input services → pending OCR/network work. After cancellation:

- no new input may be dispatched;
- late results may be logged but cannot advance state;
- all sessions return to independently controllable status;
- the final reason and any in-flight action are shown.

---

## 7. Test and evidence pyramid

| Layer                | Required evidence                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pure unit            | State machines, validation, migrations, accounting, policy, redaction, coordinate transforms, retry/cancel semantics.   |
| Fixture              | Real-derived screen/capture fixtures, hard negatives, action maps, value parsing, match lifecycle, error messages.      |
| Component            | Service with fake clocks, fake OCR, fake input, fake filesystem/network, deterministic concurrency.                     |
| Electron integration | IPC authorization, session isolation, live readback, browser crashes, cookie persistence, packaged native dependencies. |
| Package              | Installer/portable package inspection, hashes, signatures, SBOM match, packaged self-test.                              |
| Live manual          | Real game layouts, all supported tables, challenges/manual takeover, pairing evidence, result/reconciliation.           |
| Compatibility        | Clean VMs, Windows versions, DPI/GPU/display/network matrices.                                                          |
| Resilience           | Fault injection, restart, update interruption, rollback, disk/permission failures.                                      |
| Scale                | 1/4/8/16 sessions and resource budgets.                                                                                 |
| Endurance            | 72-hour soak and storage/log rotation.                                                                                  |

Every defect found in live testing gets the smallest deterministic regression test capable of reproducing its class before the fix is accepted.

---

## 8. Delivery sequence and critical path

Work should proceed in this order. Parallel work is allowed only where the dependency is already stable.

### Stage 0 — Freeze and truth baseline

Modules: A, B foundations, O1 foundations.

- Make CI reproduce the current 0.3.10 local gate and record hosted-run evidence.
- Reconcile stale documentation and capability claims.
- Version workspace schema and lock the migration/atomic-write contract.
- Create release-evidence and test-report formats.

**Gate 0:** current source and packaged build are reproducibly green in CI, with no known data-loss defect.

### Stage 1 — Real capture campaign and observation proof

Modules: F, G, relevant D/P matrix setup.

- The user collects and reviews evidence samples.
- Freeze and pass a held-out benchmark.
- Validate surface selection, tables, visible readings, geometry, and timing across DPI/window conditions.
- Collect action annotations without enabling live input.

**Gate 1:** production corpus gate and live observation matrix pass. Until then navigation remains dry-run.

### Stage 2 — Safe single-session input and navigation

Modules: H, I, L fault injection.

- Build fake adapter and fixture window first.
- Implement production input behind a disabled feature flag.
- Prove precondition/postcondition/cancel/emergency-stop behavior.
- Validate every table and supported starting screen in assisted mode, then limited live mode.

**Gate 2:** single-session navigation passes live matrix with zero blind input and bounded recovery.

### Stage 3 — Coordination and pairing

Modules: J, E preflight, M run dashboard.

- Implement coordinator simulation and failure matrix.
- Add readiness barrier and measured dispatch.
- Add pairing verification and safe stop.
- Start with two sessions, then expand to supported participant count.

**Gate 3:** repeatable, observable pairing workflow with pause/cancel/manual takeover and no false success.

### Stage 4 — Match lifecycle and accounting

Modules: K plus new F/G evidence.

- Collect real lifecycle frames before defining rules.
- Add result/balance evidence and append-only ledger.
- Add limits, reconciliation, uncertainty stop, summaries, and export.

**Gate 4:** configured end-to-end runs stop at the correct limit and produce reconciled or explicitly uncertain records.

### Stage 5 — Reliability, security, and product UX

Modules: C, D, L, M, N, Q.

- Complete detail views, design system, first-run, accessibility, localization readiness, diagnostics, crash handling, and privacy controls.
- Execute fault-injection and support exercises.
- Resolve security/compliance review findings.

**Gate 5:** no critical usability, accessibility, privacy, data-loss, security, or runaway-input defect.

### Stage 6 — Distribution and release proof

Modules: O, P, Q.

- Sign installer/update artifacts.
- Execute clean-VM install/update/rollback/uninstall.
- Complete reference/low-end performance, GPU/DPI matrix, 16-session stretch, and 72-hour soak.
- Publish release evidence and known limitations.

**Gate 6:** 1.0 release candidate satisfies the final definition of done below.

### Critical path

```text
Workspace safety + CI truth
  → labelled live corpus
  → recognition/geometry gate
  → safe input adapter
  → single-session navigation
  → multi-session coordination
  → match/outcome evidence
  → accounting and run limits
  → fault/security/accessibility closure
  → signed update/rollback
  → scale + soak + clean-VM release
```

The capture campaign is the immediate critical dependency. UI polish, installer research, diagnostics, and fault-harness work can proceed while captures are collected, but production clicking must not leapfrog the corpus and geometry gates.

---

## 9. Capture work to bring back from testing

Use Capture Lab and `docs/live-validation-runbook.md`. Do not share passwords, tokens, cookies, private messages, or sign-in screens.

For each saved sample record:

- expected real screen;
- target table when expected screen is table selection;
- correct game-surface selection;
- window size and Windows display scale;
- whether the image is evidence or untouched benchmark;
- whether overlays, transitions, or unusual conditions are present;
- whether the recognition result is correct;
- review status.

Priority order:

1. Table-selection samples for every table, including left/middle/right or equivalent scroll positions.
2. Lobby and table-selection at several window sizes and display scales.
3. Connecting/loading transitions, including short-lived frames.
4. Lucky promotion, Lucky Shot, and shop detours.
5. Hard negatives that should return `unrecognized`.
6. Later, only after the capture schema supports it: action-bound annotations and match-lifecycle frames.

Report separately:

- wrong region selected;
- correct region but wrong screen result;
- correct screen but wrong/missing table;
- visibly frozen game surface;
- UI/state disagreement;
- crash, reload, route, or sign-in persistence failure;
- time and exact build version.

Do not tune rules against benchmark samples. A benchmark failure used for development becomes evidence and must be replaced by a fresh held-out sample.

---

## 10. Final end-to-end acceptance scenarios

The signed release candidate must pass all scenarios with documented evidence:

1. **Fresh install:** install on a clean standard user account, complete first run, create receiver/sender records, open and sign in manually, restart Windows, and retain independent sessions.
2. **Migration:** upgrade a copy of every supported prior workspace version without losing records, notes, routes, profiles, or settings.
3. **Backup/restore:** create a verified backup, restore into a clean supported environment, correctly handle nonportable DPAPI data, and explain any required sign-in.
4. **Independent sessions:** run multiple accounts with distinct profiles, effective identity settings, routes, geometry, and public-IP results.
5. **Observation:** correctly locate and classify every supported real screen/table across the declared display matrix; unsafe samples produce no action.
6. **Navigation:** from each supported start, reach every supported table or return a precise bounded failure; cancel and emergency stop work at every stage.
7. **Coordination:** preflight receiver/senders, reach readiness, release barrier, verify pairing, reject incorrect/uncertain pairing, pause/resume, and cancel.
8. **Run completion:** observe lifecycle/outcomes, reconcile balances, enforce limit/stop policies, and create a truthful ledger/summary.
9. **Failure recovery:** inject browser/GPU/OCR/network/disk/permission/stale-state faults and recover or stop exactly as documented.
10. **Privacy:** erase each local data category, export a redacted support bundle, and prove secret scans refuse contaminated output.
11. **Update/rollback:** update signed build with sessions closed safely, preserve workspace, survive interrupted update, and roll back through the supported path.
12. **Scale/endurance:** pass supported 16-session stretch and 72-hour soak without data corruption, unhandled crash, unbounded growth, or runaway input.
13. **Accessibility:** complete the primary workflow with keyboard and assistive technology, including emergency stop and recovery dialogs.
14. **Uninstall:** remove application binaries and update components, offer an explicit choice for user data, and leave unrelated files untouched.

---

## 11. Definition of done for Poolside 1.0

Poolside 1.0 is releasable only when all items below are true:

- [ ] Every required Module A–Q exit gate passes or an intentionally excluded capability is removed from product claims and UI.
- [ ] `npm ci`, verification, formatting, corpus validation, SBOM check, packaging, package inspection, and packaged self-test pass in CI from a clean checkout.
- [ ] All schema migrations and rollback compatibility paths have golden fixtures and clean-machine evidence.
- [ ] The frozen held-out corpus passes all recognition, per-label, per-table, duplicate, review, and timing thresholds.
- [ ] Every production input has current-state, control, geometry, generation, timeout, postcondition, and cancellation tests.
- [ ] Multi-session coordinator and match ledger pass deterministic failure simulations and live acceptance runs.
- [ ] No unresolved critical/high defect in data integrity, security, privacy, input safety, accessibility, or release/update flow.
- [ ] Signed installer, executable, uninstaller, and update artifacts verify against published hashes and SBOM.
- [ ] Clean-VM install, update, rollback, repair, and uninstall results are recorded.
- [ ] Reference/low-end performance, DPI/GPU/network compatibility, 16-session stretch, and 72-hour soak reports pass.
- [ ] Threat model, architecture, ADR index, README, user guides, known limitations, changelog, and capability report match the shipped build.
- [ ] A restore rehearsal and bad-update rollback rehearsal have been completed from published artifacts.
- [ ] The release shows its exact version/build/channel and provides a user-visible emergency stop, data controls, diagnostics preview, and support path.

If any checkbox is false, the build can still be issued as an explicitly labelled preview, but it is not the final complete product.

---

## 12. Risk register

| Risk                                                           | Early signal                                     | Mitigation / stop rule                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Live game layout changes                                       | Benchmark/live mismatch or missing anchors       | Disable affected live actions, keep assisted/manual mode, collect fresh evidence, rerun gates.                             |
| OCR is too slow or inaccurate                                  | Timing/accuracy gate failure                     | Improve crops/grid, evaluate alternative local recognizer through an ADR, never lower safety thresholds merely to proceed. |
| False click from stale geometry                                | Window generation/rect mismatch                  | Reobserve after movement/focus change; dispatch only against current transform; emergency stop.                            |
| Pairing cannot be verified reliably                            | Simultaneous connecting but no identity evidence | Do not claim success; require manual confirmation or stop that workflow.                                                   |
| Balance/result ambiguity                                       | Contradictory or stale readings                  | Mark uncertain, pause/stop, retain evidence references, never reconcile by assumption.                                     |
| Profile/workspace corruption                                   | Decode, checksum, or atomic-write failure        | Read-only recovery, previous-known-good copy, staged restore, never sweep from an empty/untrusted account set.             |
| Resource exhaustion at many sessions                           | Queue age, memory, CPU, or compositor failures   | Concurrency limits, backpressure, published maximum, graceful refusal.                                                     |
| Updater damages install/data                                   | Failed first-start health or schema check        | Signed transaction, metadata backup, automatic/manual rollback, clean-VM interruption tests.                               |
| Secret leakage in diagnostics                                  | Scanner match or arbitrary payload field         | Fixed allowlists, refuse export, preview, targeted tests, independent review.                                              |
| Platform/service rules prohibit an automated behavior          | Compliance review or service change              | Keep feature off, provide supervised/manual mode, revise claims and documentation.                                         |
| One developer becomes the only source of operational knowledge | Undocumented release or recovery step            | Scripted gates, ADRs, runbooks, evidence folders, support exercises.                                                       |

---

## 13. Maintenance rule for this blueprint

Every feature change that advances or invalidates this plan must update:

1. the relevant work-item status and exit evidence here;
2. `INCOMPLETE_WORK.md`;
3. architecture/ADR documentation when ownership or a decision changes;
4. the changelog and capability report;
5. tests that prevent the documentation claim from drifting where practical.

Dates and estimates are intentionally not promises in this plan. Progress is measured by passed gates and retained evidence. The immediate next gate is **finish Stage 0 with a hosted CI run and a deliberate workspace-recovery path, while continuing the Stage 1 real-capture campaign**.
