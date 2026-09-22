# Architecture

Structure of the application: what the modules are, what may depend on what, how a session moves
through its states, and where each kind of state lives. Decisions behind the structure are in
[`docs/adr/`](adr/README.md); unfinished game automation is recorded in
[ADR-0011](adr/0011-game-automation-gaps.md) and [`../../INCOMPLETE_WORK.md`](../../INCOMPLETE_WORK.md).
The privacy and security review is in [the threat model](threat-model.md).

## 1. Shape of the system

Electron 44, CommonJS main process (ADR-0001), one window per account, a separate dashboard window,
and a pooled OCR worker.

```
┌──────────────────────────────── MAIN (Node) ────────────────────────────────┐
│  main.cjs         composition root — lifecycle, dashboard, wiring           │
│  ipc.cjs          the dashboard contract + trust guard                      │
│  workspace.cjs    data layer: log, snapshot, publish, save, load            │
│  state.cjs        shared singletons: sessions, sessionStores, events, ws    │
│  windows.cjs      session windows: open / close / arrange / return          │
│  profiles.cjs     when to save a session, debounce, flush on quit           │
│  saved-session.cjs  where the carry-over file lives, crypto, read/write     │
│  session-cookies.cjs  which cookies are carried (policy + payload shape)    │
│  plist.cjs        the plist document format                                 │
│  profile-manager.cjs profile lifecycle: establish, generation, scan, delete │
│  profile-paths.cjs  where a profile lives, and the deletion guards (pure)   │
│  profile-integrity.cjs damage detection: the verdict vocabulary             │
│  profile-repair.cjs quarantine a damaged file (never deletes)               │
│  profile-removal.cjs delete a profile: files, directory, record             │
│  profile-diagnostics.cjs measure a profile, compare with its ceiling        │
│  profile-sweep.cjs  report unclaimed storage; delete only on explicit use   │
│  config-schema.cjs  what config exists: fields, sections, defaults (pure)   │
│  config-walk.cjs    walk a declaration, collect every problem (pure)        │
│  config-validator.cjs the boundary: settings, account, whole profile (pure) │
│  session-config.cjs the configuration-facing half of a session (pure)       │
│  hardening.cjs    session, navigation and popup policy                      │
│  session-fsm.cjs  the session state machine: transitions + deadlines        │
│  supervision.cjs  crash/stall detection, bounded recovery, health record    │
│  recovery-policy.cjs  backoff + health shape (pure, no timers of its own)   │
│  identity.cjs     resolve + describe a session identity (pure)              │
│  identity-fields.cjsthe identity field grammar (pure)                       │
│  proxy.cjs        route parsing + the honesty comparison (pure)             │
│  footprint.cjs    apply identity/route, report what took effect             │
│  session-window.cjscreate a window at its remembered geometry               │
│  session-events.cjswindow events -> FSM events                              │
│  window-arrange.cjstile the open session windows                            │
│  geometry.cjs     remembered-geometry restore (pure)                        │
│  display-geometry.cjsrectangle vs monitor layout (pure)                     │
│  recovery.cjs     shop auto-return + repaint supervision                    │
│  inspection.cjs   capture → classify orchestration + failure text           │
│  game-region.cjs  locate the game surface                                   │
│  vision-frame.cjs   capture coordinates + boundary rules (pure)             │
│  vision-grid.cjs    recognised text into positioned cells and rows (pure)   │
│  vision-pipeline.cjs the capture seam: frame, handles and grid (pure)       │
│  timeline-engine.cjs  the two histories as one ordered stream (pure)        │
│  timeline-query.cjs   index, query and summarise a stream (pure)            │
│  timeline-transfer.cjs redaction: what may leave the machine (pure)         │
│  dashboard-telemetry.cjs collate metrics into layers (pure)                 │
│  telemetry-redaction.cjs the export projection and secret scanner (pure)    │
│  settings-form-mapper.cjs  the form, generated from the schema (pure)       │
│  settings-form-values.cjs  submitted strings into typed values (pure)       │
│  settings-ui-controller.cjs one edit in, a safe state or a refusal out      │
│  game-screen.cjs  Tesseract + Sharp pipeline, classify()                    │
│  screen-reader-pool.cjs  warm OCR workers, queue, idle retirement           │
│  network.cjs      ipify check through a given session                       │
│  layout.cjs       pure tile geometry for arrange()                          │
│  model.cjs        workspace validation                                      │
│  errors.cjs       messageOf — normalises unknown catch values               │
│  types.cjs        JSDoc typedefs (SessionGroup, ProfileStore, LogFn, …)     │
│  self-test.cjs    the --self-test suite, loaded only when flagged           │
└─────────────────────────────────────────────────────────────────────────────┘
        ▲ IPC (envelope + trust guard)              ▲ utilityProcess
┌───────┴──────────────┐                  ┌─────────┴────────────────┐
│ DASHBOARD (renderer) │                  │ GAME WINDOWS (sandboxed) │
│ preload bridge only  │                  │ no preload, no Node      │
└──────────────────────┘                  └──────────────────────────┘
```

The box above is the shape of the thing; it is not the inventory. The inventory below is generated from
`src/*.cjs` itself, so a module that exists is a module that is listed, and a module nobody can describe in a
sentence is reported rather than passing quietly.

<!-- modules:begin -->

_Generated from the source by `scripts/architecture-modules.cjs`. 152 modules, each with the
first line of its own header comment. `npm run docs:check` fails if a module is missing, or if it has no
description to carry._

| Module                         | What it is                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `main.cjs`                     | Poolside composition root.                                                                                           |
| `ipc.cjs`                      | The IPC contract.                                                                                                    |
| `preload.cjs`                  | The dashboard's bridge: one named method per channel, no generic invoke, nothing else exposed.                       |
| `account-management-ipc.cjs`   | Account-directory mutations live outside the general IPC wiring so the three account lifecycle                       |
| `account-overview.cjs`         | A dashboard-safe account summary.                                                                                    |
| `activity-journal.cjs`         | A small, private, redacted activity journal.                                                                         |
| `attention.cjs`                | Everything that needs the operator's attention, gathered in one place.                                               |
| `backup-ipc.cjs`               | Backup IPC handlers. The filesystem work remains in workspace-backup.cjs.                                            |
| `backup-manifest.cjs`          | The document that describes a Poolside backup, and the decision about what a restore may touch.                      |
| `bulk-plan.cjs`                | What a bulk account action would do, decided before anything is touched.                                             |
| `capability-registry.cjs`      | Public product claims. Keep modes conservative: tests establish implementation,                                      |
| `capture-evaluation.cjs`       | A local evidence summary for Capture Lab. This is deliberately descriptive rather than an accuracy claim:            |
| `capture-lab-ipc.cjs`          | The dashboard contract for the Capture Lab: reference frames, samples and evaluation.                                |
| `capture-lab.cjs`              | The Capture Lab: a private library of game screens, what the recogniser said about each, and the operator's verdict. |
| `capture-manifest.cjs`         | What one capture pass recorded: geometry, outcome, timings, and the bounded per-stage breakdown.                     |
| `capture-validation.cjs`       | The corpus gate: cohort counts, per-label precision and recall, and the release conditions over a frozen set.        |
| `config-schema.cjs`            | The configuration surface, declared once.                                                                            |
| `config-validator.cjs`         | The configuration boundary: which declarations a session is made of, and what its problems mean.                     |
| `config-walk.cjs`              | Walking a declared configuration specification, generically.                                                         |
| `dashboard-telemetry.cjs`      | The dashboard's metrics, collated into layers.                                                                       |
| `diagnostics-bundle.cjs`       | Local, share-safe diagnostics export.                                                                                |
| `diagnostics-state.cjs`        | What the machine was doing when a support bundle was written.                                                        |
| `display-geometry.cjs`         | How a rectangle relates to a monitor layout: how much of it is visible, whether a user can reach it,                 |
| `errors.cjs`                   | Error helpers.                                                                                                       |
| `footprint.cjs`                | Apply a session's configured footprint — identity (identity.cjs) and route (proxy.cjs) — and report                  |
| `game-region.cjs`              | Locates the game surface inside the page.                                                                            |
| `game-screen.cjs`              | Reading a game screen: two OCR passes, the contrast band, the local table matcher, and the verdict they support.     |
| `geometry.cjs`                 | Remembered window geometry: restore, clamp, and per-monitor bounds.                                                  |
| `guidance.cjs`                 | What to do next, for a workspace that has not been set up yet.                                                       |
| `hardening.cjs`                | Session and navigation policy.                                                                                       |
| `identity-fields.cjs`          | The identity field grammar: which values are usable, and what a usable value looks like.                             |
| `identity-ipc.cjs`             | The dashboard's way to ask each open session what it reports about itself.                                           |
| `identity-readback.cjs`        | What each open session reports about itself, side by side.                                                           |
| `identity.cjs`                 | Per-session identity configuration.                                                                                  |
| `inspection.cjs`               | Screen inspection: locate the game surface, capture it, classify it, and report a state.                             |
| `layout.cjs`                   | Pure layout arithmetic for game windows.                                                                             |
| `match-barrier.cjs`            | The readiness barrier: when a match may be released, and when release must be withdrawn.                             |
| `match-coordination.cjs`       | Local match coordination: pair two of your own accounts into a match, record the result, and keep a                  |
| `match-dropout.cjs`            | Dropout: a participant whose session is gone.                                                                        |
| `match-ipc.cjs`                | Dashboard surface for local match coordination. Validation lives in the engine so the message the                    |
| `match-journal.cjs`            | The local match ledger on disk.                                                                                      |
| `match-ledger.cjs`             | The ledger of record: the one place the match and run ledger is read, written, published and projected.              |
| `match-lifecycle.cjs`          | What settling a match does: record it, then let the run's plan judge it — in one write.                              |
| `match-outcome.cjs`            | The balances around a match, kept for the one write that records what happened.                                      |
| `match-pairing.cjs`            | The pairing checker: the wiring between the evidence rules and the running application.                              |
| `match-participants.cjs`       | Bringing a match's participants up, and reading the address they leave through.                                      |
| `match-preflight.cjs`          | What has to be true about one participant before a match may be released.                                            |
| `match-record.cjs`             | The shape of a match ledger record, and the only place that decides whether a stored one is trusted.                 |
| `match-release.cjs`            | The count-in, and the measurement that comes out of it.                                                              |
| `match-runs.cjs`               | The run keeper: the wiring between the run rules and the running application.                                        |
| `match-service.cjs`            | Runtime bridge between the workspace accounts and the pure match-coordination engine.                                |
| `match-start.cjs`              | Starting a match, and asking for release again.                                                                      |
| `match-view.cjs`               | The dashboard-safe projection of the match ledger.                                                                   |
| `model-storage.cjs`            | Disposable profile bookkeeping and remembered window geometry in a workspace document.                               |
| `model.cjs`                    | The workspace document: what an account and a setting may contain, and the round trip that keeps them.               |
| `native-dialogs.cjs`           | Native confirmation and folder-selection dialogs kept outside the composition root.                                  |
| `network-ipc.cjs`              | The dashboard's Check IP action: read an address through one session, and never through the machine's own route.     |
| `network.cjs`                  | The rules of reading a session's public address, and why the transport is not part of them.                          |
| `observation-services.cjs`     | Wiring for the two observation services the composition root needs: the inspector and the screen monitor.            |
| `outcome-evidence.cjs`         | What a match did to the balances, recorded from the sessions' own readings.                                          |
| `output-inventory.cjs`         | What Poolside itself has written, and the one erasure control that may touch it.                                     |
| `outputs-ipc.cjs`              | The dashboard surface for the files Poolside wrote itself: see them, and erase them deliberately.                    |
| `pairing-evidence.cjs`         | Pairing evidence: what the two sessions actually showed, and whether that is enough to say they met.                 |
| `participant-contrast.cjs`     | What the two accounts of a match are configured to look like, said next to the pairing verdict.                      |
| `plist.cjs`                    | Minimal property-list writer and reader for Poolside's saved-session files.                                          |
| `profile-diagnostics.cjs`      | Measuring a profile: how much disk it occupies, and how that compares with its configured ceiling.                   |
| `profile-integrity.cjs`        | Integrity checking for an account's carry-over file.                                                                 |
| `profile-manager.cjs`          | Profile lifecycle for one account: establish its storage, track a generation, check its integrity,                   |
| `profile-paths.cjs`            | Where an account's profile lives, and the guards that make deleting one safe.                                        |
| `profile-removal.cjs`          | Deleting one account's storage. The only destructive operation in the application.                                   |
| `profile-repair.cjs`           | Repair for a damaged carry-over file.                                                                                |
| `profile-scan.cjs`             | Sequence startup profile maintenance. Startup is deliberately non-destructive: an account record can                 |
| `profile-sweep.cjs`            | Sweeping the storage directories: what is on disk that no account claims.                                            |
| `profiles.cjs`                 | Saved browser profiles: restore an account's session on open and keep it saved afterwards.                           |
| `proxy-auth.cjs`               | Supply credentials only to the proxy endpoint configured for this one browser window.                                |
| `proxy-public.cjs`             | Renderer-safe proxy labels. Credentials stay in main-process configuration only.                                     |
| `proxy-spec.cjs`               | Parse one proxy route without exposing credentials to Chromium's proxyRules grammar.                                 |
| `proxy.cjs`                    | Per-session proxy routes: storage shape, validation, and honest reporting.                                           |
| `reading-regions.cjs`          | Which recognised numbers are account balances, and what each one is worth.                                           |
| `reading-status.cjs`           | Whether a locally recognised account reading can be trusted as a current figure, and why not.                        |
| `record-text.cjs`              | The two helpers every stored record shares: how a piece of text is made safe to store, and how a moment is           |
| `recovery-ipc.cjs`             | The dashboard's way back: what recovery copies exist, and restoring one deliberately.                                |
| `recovery-policy.cjs`          | Recovery policy: how long to wait, how many times to try, and how to describe a failure.                             |
| `recovery-settings.cjs`        | Per-account reliability preferences. They affect only Poolside's browser window behaviour.                           |
| `recovery.cjs`                 | Per-window recovery supervision: shop detection with automatic return, and post-load repaints.                       |
| `release-countdown.cjs`        | The count-in for queueing a pair by hand, and the measurement of what two hands actually achieve.                    |
| `route-health.cjs`             | What a session actually did, recorded against the saved location it was told to use.                                 |
| `route-preset-ipc.cjs`         | The dashboard contract for saved network locations: save, edit, tick on and off, try, and delete when unused.        |
| `route-presets.cjs`            | Saved network locations: their grammar, their stored health, and the sentences the Settings list shows.              |
| `route-probe-format.cjs`       | Turning a probe's raw answer into something worth reading.                                                           |
| `route-probe.cjs`              | Trying an address before saving it.                                                                                  |
| `run-coordination.cjs`         | Runs: a plan, the matches played under it, and the reasons it stops.                                                 |
| `run-plan.cjs`                 | A run plan: how many matches this run is for, and what makes it stop.                                                |
| `run-record.cjs`               | The shape of a run record, and the only place that decides whether a stored one is trusted.                          |
| `run-report.cjs`               | A record of a run, written where the operator can find it and send it on.                                            |
| `run-status.cjs`               | Where a run is, and what the operator should do about it.                                                            |
| `run-view.cjs`                 | The dashboard-safe projection of a run.                                                                              |
| `saved-session.cjs`            | On-disk persistence for one account's carry-over session cookies.                                                    |
| `screen-attention.cjs`         | Recognise a prolonged local loading/connecting observation. This reports a condition; it never acts on the game.     |
| `screen-history.cjs`           | Compact, in-memory screen-state history for one open session. A record is added only when the                        |
| `screen-monitor.cjs`           | Local screen observation scheduler. Production sessions start it automatically and the UI can stop                   |
| `screen-reader-pool.cjs`       | A small pool of screen readers.                                                                                      |
| `self-test-context.cjs`        | What the self-test suite is allowed to inspect.                                                                      |
| `self-test-dropout.cjs`        | The dropout scenario of the self-test: a match with no session behind it.                                            |
| `self-test-fixtures.cjs`       | The fixture-session scenarios of the packaged self-test: navigation back to the game, automatic                      |
| `self-test-footprint.cjs`      | Footprint assertions for the packaged self-test: what a session _claims_ to be, read back out of a                   |
| `self-test-matches.cjs`        | The match-coordination scenario of the self-test: pairing two real accounts, loading both profiles,                  |
| `self-test-outputs.cjs`        | The self-test's view of the files Poolside wrote itself.                                                             |
| `self-test-profiles.cjs`       | Profile management checks for --self-test.                                                                           |
| `self-test-run-plan.cjs`       | The run-plan scenario of the self-test: a plan, its matches, and the program ending the run itself.                  |
| `self-test-workspace.cjs`      | Where a self-test keeps its throwaway user-data directory, and which older ones are safe to remove.                  |
| `self-test.cjs`                | The --self-test suite.                                                                                               |
| `session-actions.cjs`          | Commands for an already-created account window.                                                                      |
| `session-config.cjs`           | What a session is configured with, and applying it.                                                                  |
| `session-cookies.cjs`          | Cookie policy: which cookies this application is willing to carry between runs, and the shape of                     |
| `session-events.cjs`           | What a session window's own events do to the session.                                                                |
| `session-fsm.cjs`              | The session state machine.                                                                                           |
| `session-ip.cjs`               | Reading a session's public address through its own route — including a route that needs a password.                  |
| `session-window.cjs`           | Creating and measuring a session window: its remembered geometry, the displays that exist now, and                   |
| `settings-form-mapper.cjs`     | The settings form, derived from the declaration instead of written by hand.                                          |
| `settings-form-values.cjs`     | The values a form carries: what comes back from the controls.                                                        |
| `settings-ui-controller.cjs`   | The settings form's backend: one command in, one safe state out.                                                     |
| `shop-recovery.cjs`            | The shop auto-return: recognise the shop, wait for the headings to settle, then navigate back once per opening.      |
| `state.cjs`                    | Shared process-lifetime state.                                                                                       |
| `supervision.cjs`              | Crash and stall supervision for one session window.                                                                  |
| `table-list.cjs`               | The supported 8 Ball Pool 1-on-1 venue labels.                                                                       |
| `table-navigation-input.cjs`   | Dry-run game-input adapter. It explains the next manual action and deliberately performs none.                       |
| `table-navigation-journal.cjs` | Bounded, local-only journal for table-navigation plans. It stores no browser text or account names.                  |
| `table-navigation-service.cjs` | Runtime bridge between screen inspection and the pure table-navigation state machine.                                |
| `table-navigation-state.cjs`   | Pure table-navigation state machine. It describes what must happen without sending game input.                       |
| `table-visual.cjs`             | A conservative, local visual assist for the selected 1-on-1 venue card.                                              |
| `target-identity.cjs`          | The target half of a session footprint: the CDP overrides that make a _live page_ claim a configured                 |
| `telemetry-redaction.cjs`      | What may leave the machine.                                                                                          |
| `timeline-engine.cjs`          | The diagnostic timeline: one ordered history, compiled from the two rings that already record one.                   |
| `timeline-query.cjs`           | Reading the compiled timeline: the questions a failure asks.                                                         |
| `timeline-transfer.cjs`        | What may leave the machine.                                                                                          |
| `types.cjs`                    | Shared JSDoc typedefs.                                                                                               |
| `visible-readings.cjs`         | Extract display-only account readings from locally recognised text. Values require an explicit nearby                |
| `vision-frame.cjs`             | Coordinate frames for a capture.                                                                                     |
| `vision-grid.cjs`              | Parsing recognised text into a positioned grid.                                                                      |
| `vision-pipeline.cjs`          | The capture pipeline, as one object.                                                                                 |
| `webrtc-policy.cjs`            | Which WebRTC policy one session gets.                                                                                |
| `window-arrange.cjs`           | Arranging the open session windows into a grid on the primary display's work area.                                   |
| `window-title.cjs`             | One session window's title.                                                                                          |
| `windows.cjs`                  | session: it drives the FSM (session-fsm.cjs) from real Electron events, hands recovery policy to                     |
| `workspace-backup.cjs`         | Copying a workspace out to a backup folder, and copying one back in.                                                 |
| `workspace-file.cjs`           | Durable workspace-document replacement. Only validated version-1 documents reach disk.                               |
| `workspace-history.cjs`        | The workspace-facing adapter around the persistent activity journal.                                                 |
| `workspace-recovery.cjs`       | The workspace's own recovery material, read as candidates rather than guessed at.                                    |
| `workspace-snapshot.cjs`       | Build the dashboard-safe view of process and workspace state.                                                        |
| `workspace-version.cjs`        | Which workspace documents this build will read, and what it says about the ones it will not.                         |
| `workspace.cjs`                | The persisted workspace document, activity feed, and snapshot the dashboard renders.                                 |

**Every module carries a description.**

<!-- modules:end -->

### Dependency rules

| Rule                                 | Enforced by                  |
| ------------------------------------ | ---------------------------- |
| No module over 300 lines             | `test/architecture.test.cjs` |
| No cycles in the local require graph | `test/architecture.test.cjs` |
| No unreferenced modules              | `test/architecture.test.cjs` |
| `main.cjs` is wiring only            | review + the size ceiling    |

The modules in `PURE_MODULES` (`test/architecture.test.cjs`) must not import `electron`, so every one of
them is testable without an Electron runtime: `layout`, `model`, `shop-recovery`, `game-region`, `saved-session`, `session-cookies`, `plist`, `session-fsm`, `supervision`, `recovery-policy`, `identity`, `identity-fields`, `proxy`, `geometry`, `display-geometry`, `profile-paths`, `config-schema`, `config-walk`, `config-validator`, `session-config`, `profile-integrity`, `profile-repair`, `profile-removal`, `profile-diagnostics`, `profile-sweep`, `profile-manager`, `vision-frame`, `vision-grid`, `vision-pipeline`, `timeline-engine`, `timeline-query`, `timeline-transfer`, `dashboard-telemetry`, `telemetry-redaction`, `settings-form-mapper`, `settings-form-values`, `settings-ui-controller`.

Dependency direction is one-way. `state.cjs` is a leaf that others read. Feature modules receive what
they need as an injected `deps` object, so `windows.cjs` can take `returnToGame` from itself without
creating a cycle back through `recovery.cjs`:

```
main ──▶ ipc ──▶ (windows, inspector)
 │      └─▶ workspace ──▶ state
 └──▶ windows ──▶ hardening, profiles, recovery, layout
        │           └──▶ session-fsm, supervision ──▶ recovery-policy
        │           └──▶ session-window ──▶ geometry ──▶ display-geometry
        │           └──▶ session-events, window-arrange
        │           └──▶ footprint ──▶ identity, proxy
        └──▶ profiles ──▶ saved-session ──▶ session-cookies, plist
```

## 2. Session lifecycle — the session FSM

There are two layers. The **session** layer is per account and is a formal state machine
(`session-fsm.cjs`); it lives in `sessions` (`state.cjs`). The **observation** layer describes what has
been seen inside that window.

### 2.1 Session states

```
idle ──launch──▶ launching ──load──▶ loading ──loaded──▶ ready
                     │                  │                 │
                     └──── failed ──────┴───── failed ────┘──▶ degraded ──recover──▶ loading
                                                                    │
   any live state ──close──▶ closing ──closed──▶ closed ◀───────────┘
```

`session-fsm.cjs` is the only writer of a session's state. Before M1 three modules assigned a `status`
string directly, `closed` was implied by absence, and each call site owned its own timeouts.

| From                    | Event     | To          | Raised by                                                                                    |
| ----------------------- | --------- | ----------- | -------------------------------------------------------------------------------------------- |
| `idle`                  | `launch`  | `launching` | `openAccount`, before the profile is prepared                                                |
| `launching`             | `load`    | `loading`   | `openAccount`, after `profiles.prepare`, before `loadURL`                                    |
| `launching` / `loading` | `loaded`  | `ready`     | `did-finish-load`                                                                            |
| `degraded`              | `loaded`  | `ready`     | `responsive` after a stall — the session answered on its own                                 |
| `ready`                 | `reload`  | `loading`   | `returnToGame`                                                                               |
| `degraded`              | `recover` | `loading`   | supervision, at the moment a recovery attempt starts                                         |
| any live state          | `failed`  | `degraded`  | `did-fail-load`, a throw from prepare/`loadURL`, `render-process-gone`, stall                |
| any live state          | `stalled` | `degraded`  | the FSM's own deadline for the current state                                                 |
| any state               | `close`   | `closing`   | window `close`                                                                               |
| any state               | `closed`  | `closed`    | window `closed` — reachable from everywhere, because a window can be torn down at any moment |

Rules the machine enforces:

- **Deadlines belong to the machine, not to call sites.** `launching` has 30 s and `loading` 45 s
  (`DEFAULT_TIMEOUTS`); a state with no deadline arms no timer. On expiry the machine raises `stalled`
  itself and lands in `degraded` with a reason a user can read, so no caller has to remember a
  watchdog.
- **An event that does not apply is refused, not applied.** `send()` returns `false` and logs
  (`'loaded' does not apply in state 'idle'`) rather than throwing or silently corrupting state. A
  second `openAccount` on a live window therefore cannot restart the machine.
- Browser navigation can emit more than one `did-finish-load` while sign-in redirects settle. The
  session-event adapter sends `loaded` only when the machine currently accepts it, making repeated
  browser completion signals idempotent without weakening refusal logging for other invalid events.
- **Every transition is recorded** with its timestamp, event and reason, capped at the last 50
  (`HISTORY_LIMIT`) — the input M4's timeline view will render, and what makes a support report
  diagnosable.
- `closed` is terminal: later events are ignored, and the machine is disposed with the window.

Notes that matter:

- Code `−3` (aborted) is ignored on purpose: it fires for ordinary in-app navigation.
- `ready` means **the page loaded**. It does not mean signed in, and the UI says so
  (`● Window open · login unverified`).
- A closed session is not lost work: the partition is persistent (ADR-0003), so reopening restores
  the profile.

### 2.1.1 Crash and stall supervision (M1)

`supervision.cjs` watches the window's `webContents` and owns the policy for failure; the FSM owns the
state; `windows.cjs` supplies the mechanism (a reload). The policy is a pure module
(`recovery-policy.cjs`), so it is readable and testable without a clock.

| Event                       | Reaction                                                                         |
| --------------------------- | -------------------------------------------------------------------------------- |
| `render-process-gone`       | `failed` with the renderer's reason and exit code, then a bounded recovery       |
| `unresponsive`              | degrades only after an 8 s grace period — a busy renderer is not a hung one      |
| `responsive` while degraded | `loaded` back to `ready`, and the recovery budget is credited back               |
| `did-finish-load`           | credits the recovery budget: a page that loaded is evidence the session is alive |

Recovery is bounded: base 1.5 s, doubling (1.5 s → 3 s → 6 s → …), capped at 30 s, and **at most 3
attempts** before the supervisor stops trying and says so. A recovery attempt that itself throws counts
as a failure. The per-session health record — `failures`, `recoveries`, `attempts`,
`lastFailureReason`, `nextAttemptAt`, `exhausted` — is published in the snapshot, so a degraded card
explains itself rather than just changing colour.

### 2.2 Observation state (per session)

| Field                   | Values                                                                                 | Set by                              |
| ----------------------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| `observationGeneration` | integer, monotonic                                                                     | `did-start-navigation` (main frame) |
| `gameScreen`            | `null`, `{state:'inspecting'}`, or an observation                                      | `recovery.cjs`, `inspection.cjs`    |
| `inspecting`            | boolean, per account                                                                   | `inspection.cjs`                    |
| `shopGate`              | `{since, url, used}`                                                                   | `recovery.cjs`                      |
| `network`               | `null`, `{status:'checking'}`, `{status:'checked', ip, checkedAt}`, `{status:'error'}` | `ipc.cjs`                           |
| `children`              | `Set<BrowserWindow>`                                                                   | `hardening.cjs`                     |

`gameScreen.state` transitions:

| From         | To                                  | Trigger                                                       |
| ------------ | ----------------------------------- | ------------------------------------------------------------- |
| any          | `null`                              | main-frame navigation begins (**bumps the generation**)       |
| `null`       | `inspecting`                        | `inspectGame` starts                                          |
| `inspecting` | recognised state, or `unrecognized` | classification completes **and** the generation still matches |
| `inspecting` | `inspection-failed`                 | inspection failed **and** the generation still matches        |

The generation counter is what makes a stale result harmless: a result computed before a navigation
is discarded rather than written over newer state.

### 2.3 What M1 changed, and what remains

This section previously listed four gaps: transitions assigned across three modules rather than
declared, no `degraded` state, timeouts owned by call sites, and no transition history. All four are
closed — `session-fsm.cjs` declares the transitions, the state set includes `degraded`, deadlines are
a property of the state (`DEFAULT_TIMEOUTS`), and the most recent 50 transitions are recorded for M4's
timeline.

One deadline is deliberately still owned by its call site: `INSPECTION_TIMEOUT_MS` in `inspection.cjs`,
because it bounds a single operation _inside_ a session rather than the session's state.

M1's identity, geometry and route work landed in this milestone: per-session identity configuration
(§2.4), remembered window geometry with per-monitor clamping (§2.5), and per-session proxy support as
infrastructure (§2.4). Profile creation, deletion, quota reporting and corruption detection now exist;
full user-directed workspace recovery and portable restore remain Module B work.

The supervisor's failure paths are unit-tested against a fake `webContents`, and the dashboard contract
for session state is asserted in the packaged self-test. Driving them against a genuinely crashed
renderer is M6's fault-injection harness; `supervision.cjs` takes both the recovery mechanism and its
timers as injected dependencies, so that harness can drive it deterministically rather than by killing
processes.

### 2.4 The session footprint: identity, route, and what actually took effect

A session's _footprint_ is what it presents to the site: its identity and the route its traffic takes.
`footprint.cjs` applies it and reports back what happened; `identity.cjs`/`identity-fields.cjs` and
`proxy.cjs` decide what the configuration means. The decisions are in ADR-0012 and the boundary in
ADR-0011 §11.5.

| Part                                      | Mechanism                                                       | Where                                      |
| ----------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| User agent                                | `session.setUserAgent` **and** `Emulation.setUserAgentOverride` | before the window exists; on a live target |
| Accepted languages                        | `Emulation.setUserAgentOverride` only                           | on a live target                           |
| Locale, timezone, viewport, colour scheme | CDP `Emulation.*`                                               | on a live target                           |
| Route                                     | `session.setProxy`                                              | before the window loads                    |
| Storage ceiling                           | measured against the session's HTTP cache                       | reported, never enforced                   |

Three of those rows are consequences of measurement rather than preference, and ADR-0012 records the
evidence:

- The session-level `acceptLanguages` argument does not reach the renderer or the wire in Electron
  44.4.1, so the user agent is also set over CDP. The fixture check prints what each session reads back.
- A CDP command sent to a window that has never navigated is applied but never answered, so
  `applyTargetFootprint` gives the target a renderer by loading `about:blank` first — which also places
  the overrides before the real page's first script runs. Every command is raced against a deadline, so a
  stuck debugger is reported instead of holding a session open.
- Electron exposes no per-session storage quota, so `quotaBytes` is a _reported_ ceiling. A page can read
  Chromium's own allowance with `navigator.storage.estimate()`; that is a measurement too.

Target overrides are **opt-in per account**, because they require an attached debugger and DevTools can
no longer be opened on that window. A session with no identity configured attaches nothing.

The route is verified rather than assumed: `session.resolveProxy()` reports what Chromium will actually
use, and `routeMatches` compares it with what was configured. A route that is configured but not in use
is worse than none, because the user would believe something false about that session's footprint.

### 2.5 Remembered window geometry

Opening a session reads its remembered rectangle (`geometry.cjs`), clamps it to the displays that exist
_now_, and applies the standard minimum from `layout.cjs`. The arithmetic is pure and unit-tested against
invented monitor layouts, including the case that matters most — a position on a display that is no
longer attached, which centres the window on the primary instead of losing it.

Geometry is stored in the workspace document under `windows`, keyed by account id, and is deliberately
**disposable**: a corrupt entry is dropped by `model.cjs` rather than being allowed to make the workspace
unreadable, because a damaged rectangle must never cost anyone their account list. It is captured from
`getNormalBounds` on window close, so a maximized window remembers the size it un-maximizes to.

## 3. Storage model

Three kinds of state, deliberately separate.

| Store              | Owns                                    | Path                                                             | Lifetime                                              |
| ------------------ | --------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Chromium profile   | **every cookie** and all site storage   | `%APPDATA%/Poolside/Partitions/poolside-<id>` (Chromium-managed) | until the profile is deleted                          |
| Workspace document | account labels, roles, preferences      | `%APPDATA%/Poolside/workspace.json`                              | user data                                             |
| Carry-over file    | **only** session cookies Chromium drops | `%APPDATA%/Poolside/accounts/<id>.plist`                         | until deleted; survives corruption by being preserved |

The workspace document also carries, in the same file:

| Key                                   | Holds                             | Validation                                           |
| ------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `settings.identity`, `settings.proxy` | defaults every account inherits   | known keys only; semantic validity checked when used |
| `account.identity`, `account.proxy`   | one account's overrides           | as above                                             |
| `windows[accountId]`                  | that window's remembered geometry | a damaged entry is dropped, never fatal              |

Identity and route values are validated **when they are used**, not when the file is read, and an invalid
value is dropped with a warning. That is deliberate: `decode` rejects the whole document on bad account
data, which is right for an account list and wrong for a mistyped time zone, which must never be able to
lock a workspace or stop a session opening. The stored file keeps only known keys, so a hand-edited
workspace cannot smuggle unrelated data into the config.

**Authority (ADR-0004):** the profile owns cookie data. The `.plist` is a narrow exception, not a
second copy. It holds session cookies only, encrypted with `safeStorage` (DPAPI), and a restore never
overwrites a cookie the profile already has.

`workspace.json` is validated, written to a unique flushed sibling, then renamed into place
(ADR-0018). A bounded `.previous` copy supports deliberate recovery; it is never auto-loaded as
authoritative data and is purged when removed account or route values would otherwise linger.
A malformed document, or a missing primary with recovery material present, puts the app into
read-only mode rather than overwriting data the user may still want. The pending B3 work is an
in-app recovery choice and clean-VM interruption proof.

## 4. IPC contract

Every dashboard action goes through `ipc.cjs`. Full detail in ADR-0005; the summary:

1. **Trust guard first.** `trusted(event)` requires the sender to be the dashboard's `webContents`,
   the frame to be its `mainFrame`, and the URL to be exactly the local `ui/index.html`. Anything else
   gets `Request rejected.`
2. **Envelope always.** `{ok: true, value}` or `{ok: false, error}` — errors are returned, not thrown
   across the boundary.
3. **Channels are the contract.** Additive changes are safe; changing a message's meaning means a new
   channel.

Channels: `workspace:get`, `account:add`, `account:open`, `account:close`, `account:check-ip`,
`account:return-game`, `account:inspect`, `account:archive`, `sessions:open`, `sessions:close`,
`sessions:arrange`, `settings:save`.

## 5. Vision pipeline

```
inspection.cjs
  1. require the official page and a settled main frame
  2. GAME_REGION_PROBE (isolated world 999) ──▶ score every visible canvas/iframe
     • refuse if a password field or dialog is visible
     • eligible: ≥280×180, aspect 1.2–2.1, ≥15% of the viewport
     • score = 0.65 × shape distance from 16:9 + 0.35 × viewport coverage
  3. capturePage(rect scaled by zoom) ──▶ PNG
  4. screen-reader-pool.acquire() ──▶ warm Tesseract worker
  5. game-screen.inspect(): first OCR → classify(); a strong local visual venue match on an
     already-recognized table-selection screen, or the reviewed Lucky Promotion/Lucky Shot/Shop
     wording, can skip the second full-frame OCR. Other observations keep the luminance-mask
     OCR pass → classify()
  6. release the worker; discard the result if the generation changed
```

`classify()` returns a state, score, matched phrases, alternatives, and supported visible table
names — never raw OCR text or account details. Original gates remain regression-tested, while
narrow additional gates recognize reviewed Lucky Promotion and Shop layout variants. Duplicate
rules for one state produce one candidate, not conflicting alternatives.

The optional visual venue assist in `table-visual.cjs` compares a small centered-card feature to
reviewed or detector-confirmed local **Evidence** images. It verifies image hashes, requires several
examples per venue, and refuses distant or ambiguous matches. It never learns from the held-out
Benchmark cohort or makes a screen into table selection on its own. Existing capture records keep
their original detector results; `npm run analyze:tables` is a development-only, aggregate
leave-one-out check, not production accuracy evidence.
`npm run replay:evidence` reprocesses reviewed Evidence through the current OCR pipeline and
reports aggregate first-pass/full-pipeline recognition and fixed numeric stage timings without changing stored samples
or reading Benchmark images. Its table-name count is in-sample only because those images can also
be visual references; it never replaces the frozen held-out corpus gate.
An inspection that exceeds its deadline reports failure; any later OCR result is discarded before
capture recording or session publication, and a timed-out queue waiter is removed from the reader
pool. Surface timing ends before waiting for a pooled reader.

Failure produces prose, not `null`: `describeRegionFailure` names the reason and lists the surfaces
it saw (ADR-0009).

## 6. Recovery supervision

`recovery.cjs` attaches to each game window:

- **Shop auto-return.** Once per second, `SHOP_PROBE` reads visible headings. When the shop has been
  stable for five seconds, the window navigates back to the game and the gate is marked used, so it
  fires once per window opening. A visible password field, dialog, or large surface cancels it.
- **Repaints.** After load and on focus, `invalidate()` is requested. This is a _candidate_ mitigation
  for a freeze that also occurs in ordinary Chrome; it is not a verified fix and is documented as
  such.
- **Stale-work guard.** Each poll records the generation and discards its result if navigation
  happened in between.

## 7. Security posture

| Control                                                                                       | Where                |
| --------------------------------------------------------------------------------------------- | -------------------- |
| Game windows: sandboxed, no preload, no Node, context isolated                                | `windows.cjs`        |
| HTTPS-only navigation; popups inherit the account session and are re-hardened recursively     | `hardening.cjs`      |
| Downloads blocked; all permission requests and checks denied                                  | `hardening.cjs`      |
| Dashboard: CSP `default-src 'self'`, `connect-src 'none'`, no external requests               | `src/ui/index.html`  |
| IPC trust guard on every handler                                                              | `ipc.cjs`            |
| Workspace validated and staged with a flushed, bounded recovery copy; read-only on corruption | `workspace-file.cjs` |
| Session file id-validated (no traversal), `0600`, encrypted via DPAPI                         | `saved-session.cjs`  |
| Recognition returns a label, a score and matched phrases only                                 | `game-screen.cjs`    |
| No telemetry, no remote config, no updater                                                    | ADR-0010             |

## 8. Observability

Today: a bounded in-memory activity feed and a local redacted activity journal (up to 200 messages),
surfaced in the dashboard, plus console output. They record actions, not credentials or full URLs.

M4 compiles that feed together with the session FSM's transition history (last 50 per session) into one
ordered **diagnostic timeline** (`timeline-engine.cjs`), reads it with `timeline-query.cjs`, and collates the
per-account metrics — measured size, configured ceiling, generation, crash flags — into layers
(`dashboard-telemetry.cjs`). The layers differ by sensitivity, and only the `export` layer may leave the
machine: `telemetry-redaction.cjs` produces it, rewriting every string, and `diagnostics:preview` refuses to
return a payload that fails its own scan (ADR-0016). Addresses, filesystem paths and token-shaped strings are
matched by shape; account names by literal.

Fixed OCR-stage timing measurements exist. Rotating durable structured logs, wider capture/action/render
timings, crash files, and support-bundle fault-injection validation remain Modules L/P work.

## 9. Testing architecture

| Layer         | Suite                                                                                                                                                                                                          | What it proves                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Pure unit     | `npm test` — `layout`, `model`, `network`, `shop-recovery`, `classification`, `saved-session`, `plist`, `screen-reader-pool`, `session-fsm`, `supervision`, `recovery-policy`, `identity`, `proxy`, `geometry` | logic, validation, payload invariants, state transitions, identity grammar, route comparison, restore arithmetic — no Electron needed |
| Recognition   | `npm test` — `game-screen.test.cjs`                                                                                                                                                                            | real OCR against the fixture corpus                                                                                                   |
| Architectural | `npm test` — `architecture.test.cjs`                                                                                                                                                                           | ceilings, cycles, purity, orphans                                                                                                     |
| Integration   | `npm run test:desktop`                                                                                                                                                                                         | real sessions, real IPC, real dashboard, local HTTPS fixtures                                                                         |
| Process       | `npm run test:persistence`                                                                                                                                                                                     | two real processes: state survives restart                                                                                            |
| Packaged      | `release/…/Poolside.exe --self-test`                                                                                                                                                                           | the shipped build, native deps included                                                                                               |

Game-facing behaviour is proved offline via `protocol.handle` fixtures (ADR-0007). No test uses a
real account.

## 10. Profile lifecycle, integrity and diagnostics

`profile-manager.cjs` (ADR-0013) owns everything that happens to an account's on-disk storage. Nothing
else creates, repairs or deletes it.

| Operation | Modules                                    | What it does, and what it refuses                                                                                                                           |
| --------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Establish | `profile-manager.cjs`, `profile-paths.cjs` | ensures the two directories this app owns exist, and moves the generation counter when a storage directory is established — not on an ordinary open         |
| Check     | `profile-integrity.cjs`                    | reads the carry-over file and returns one verdict: `ok`, `missing`, `suspect`, `legacy`, `unverifiable` or `corrupt`                                        |
| Repair    | `profile-repair.cjs`                       | renames a corrupt file to `<id>.plist.corrupt-<timestamp>`. Never deletes, never rebuilds, and re-checks the verdict first so it cannot move a healthy file |
| Delete    | `profile-removal.cjs`                      | removes the carry-over file, its quarantined copies and the partition directory, then the persisted record                                                  |
| Measure   | `profile-diagnostics.cjs`                  | walks the directory under a file cap (and reports `truncated`), then compares the total with the account's configured ceiling                               |
| Sweep     | `profile-sweep.cjs`                        | startup reports unclaimed `poolside-<uuid>` directories and `<uuid>.plist` files without deleting; an explicit applied sweep owns any later cleanup         |

Two storage layers, with different authority (ADR-0004):

| Layer              | Path                                  | Holds                                  | If it is lost             |
| ------------------ | ------------------------------------- | -------------------------------------- | ------------------------- |
| Chromium partition | `<userData>/Partitions/poolside-<id>` | every cookie, all site storage, caches | a real re-login           |
| Carry-over file    | `<userData>/accounts/<id>.plist`      | session cookies only, encrypted        | a sign-in for the session |

**Startup order.** The integrity scan runs before the window is shown — one small file per account — and
the measurement runs after it via `setImmediate`, because walking every profile directory is the slow half
and the dashboard should not wait for it. The scan preserves interrupted `.tmp` files, reports storage no
account claims without deleting it, checks each account and quarantines what is damaged, then logs one summary line.

**Durable vs volatile.** The generation counter and the corruption history are persisted per account in the
workspace document. `directoryBytes`, `fileCount`, `quotaBytes` and `overQuota` are re-derived on every
scan into `state.profileReports` and never written: a measurement is not a fact worth surviving a restart,
and rewriting the document on every measurement would be churn. The dashboard view merges the two, so the
renderer sees one object.

**Two traps this subsystem is built around**, both found the hard way and both now covered by tests:

- `session.fromPartition` _creates_ the partition and its directory. Resolving one by id during a delete
  resurrects the directory that was just removed, so the manager never asks for a session it does not
  already hold — and the desktop suite asserts the directory is gone afterwards.
- Chromium creates a partition directory lazily on first use, so "the directory is absent" cannot
  distinguish _not used yet_ from _deleted_. That is why the persisted `established` flag exists; without
  it the generation counter incremented on every open.

## 11. Configuration: one declaration, one boundary

`src/config-schema.cjs` declares what configuration exists — the settings fields, the two overridable sections,
the identity grammar's seven fields, the route fields, which are required, what each defaults to, and a human
label for every one (ADR-0008). It **declares only**: every individual rule is delegated to the module that
already owns it, so each constraint has one implementation.

| Module                 | Question it answers                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `config-schema.cjs`    | what exists: field lists, section nesting, required, defaults, labels                          |
| `config-walk.cjs`      | how to walk a declaration: collect every problem, and the usable value                         |
| `config-validator.cjs` | which declarations a session is made of: settings, account overrides, both together            |
| `session-config.cjs`   | the configuration-facing half of a session: the boundary check, then the footprint application |

Every check returns `{ok, value, errors, dropped}` (ADR-0014):

- **`errors`** — the declared type is wrong: a required field missing, an enum value not in its list, an integer
  out of range. `ok` is false. These are exactly the cases `model.settings` refuses, and
  `test/config.test.cjs` asserts that the two agree verdict-for-verdict.
- **`dropped`** — a grammar owned elsewhere refused the value, or nothing declares the key. `ok` stays true, the
  field is left out of the validated value, and the problem is reported with its dotted path. Silent dropping was
  the defect; being told what was ignored is the fix.

The boundary runs at two moments, and neither is decorative:

| Moment                            | Call                     | On an error                                                                                                              | On a drop                                             |
| --------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Saving settings (`settings:save`) | `validateSettings`       | the write is refused; the message reaches the dashboard                                                                  | stored without it, and the activity feed says so      |
| Opening a session                 | `validateSessionProfile` | the launch is refused — that state means the stored document is corrupt, since `decode` catches user error on the way in | the session opens, and the feed says what was ignored |

**The drift guard.** `test/config.test.cjs` cross-references the declaration against the structures that are
actually stored and executed: the field lists against `IDENTITY_FIELDS`, `model.PROXY_FIELDS` and
`model.TABLES`; a document carrying every declared field through the real `decode` round trip; everything the
validator emits back through `decode`; and a 21-value corpus asserted verdict-for-verdict against
`model.settings`. Adding a stored field without declaring it — or declaring one the storage layer drops, which
is the D3 defect class — fails the suite rather than losing a setting on the next save.

Two things this layer deliberately does **not** do: it has no cross-field rules (the resolvers own those, and a
second authority eventually disagrees with the first), and it never merges the two sections (precedence belongs to
`identity.cjs` and `proxy.cjs`; merging silently discarded one of two configured identities until the parity
suite caught it).

### 11.1 The form is generated from the declaration (ADR-0017)

The settings panel holds no field list. `settings-form-mapper.cjs` builds controls from the declarations —
label, bounds, option list and required flag all from the schema — so a field added to `config-schema.cjs`
appears in the form without an edit to any UI file, and a field the app cannot execute cannot be edited into
existence.

The edit pipeline is four questions, one module each:

| Question                                                           | Module                       |
| ------------------------------------------------------------------ | ---------------------------- |
| What does the form show?                                           | `settings-form-mapper.cjs`   |
| What is a submitted string?                                        | `settings-form-values.cjs`   |
| Is that value acceptable?                                          | `config-validator.cjs`       |
| What does the whole document become, and what does a refusal mean? | `settings-ui-controller.cjs` |

The binding contract is the **dotted path**, used three ways: a control carries it as `data-path` and gets a
derived DOM id, a page sends its values keyed by it, and an error comes back keyed by it so it can mark the
control that caused it. A blank control means _untouched_, never _cleared_; removing a value is an explicit
`clear` list. A route spec carrying a credential is presented masked, with no value sent to the page at all.

**Where a form diverges from ADR-0014.** The validator reports a grammar refusal as `dropped` so that a
corrupt document cannot lock anybody out. In a form, a drop on a field the user just edited is promoted to an
error and the save is refused; a drop on a field they did not touch keeps its ADR-0014 meaning. The difference
is intent: nobody typed the value on the corruption boundary, and "saved, but your value was ignored" is not
true enough for a screen somebody is looking at. A refused edit is returned as **data**
(`{saved: false, errors: [{path, message}], …}`), not as a thrown error, because the IPC envelope collapses a
failure to a single string and a form needs a path per problem.

## 12. Vision: one capture, four coordinate systems

Four coordinate systems meet in a single capture, and `vision-frame.cjs` owns every conversion between them
(ADR-0015): the probe's **page CSS pixels**, the **DIPs** `capturePage` takes, the **captured image's pixels** at
the display's scale factor, and the **resized image** the recogniser reads.

| Module                | Question it answers                                                              |
| --------------------- | -------------------------------------------------------------------------------- |
| `vision-frame.cjs`    | coordinates: convert, clip, and report the density that actually arrived         |
| `vision-grid.cjs`     | text: recognised lines into cells with positions, rows, confidence and telemetry |
| `vision-pipeline.cjs` | the seam: one capture in, frame + transform handles + grid parsing out           |
| `inspection.cjs`      | drives the capture and reports what it found                                     |
| `game-screen.cjs`     | the rule engine and the OCR worker; takes its band geometry from the handles     |

The rules that matter, all arithmetic rather than claims about a window:

- **Floor the origin, round the extent, never below one pixel.** A crop that starts one pixel late loses text at
  a region's edge; a zero-sized extract is refused by `sharp`, so it is never allowed to get that far.
- **Clip and flag; refuse only when nothing is left.** The probe already clamps to the viewport, so a partial
  overlap is normal — an empty crop is not, and it is refused with a reason rather than read as a blank screen.
- **The achieved density is reported, not assumed.** `zoom × deviceScaleFactor` is the expectation; a 125 %
  display returns a larger image, and an image captured _below_ the page's own scale is called out, because that
  is the condition under which a small label is misread.
- **Two rectangle dialects.** Electron takes `{x, y}`, `sharp` takes `{left, top}`; the transform handles are
  in sharp's, so nothing translates between them.

The grid is **built but not yet in the recognition path**: the geometry is wired, the classifier still reads the
concatenation of its two OCR passes. Changing what it reads needs the labelled corpus (ADR-0002), so it waits.

## 13. Table navigation: plan first, input later

`table-navigation-state.cjs` is a pure reducer for the sequence from lobby to table selection, target discovery,
table opening, and matchmaking. `table-navigation-service.cjs` attaches one plan to an open session and advances
it only from a fresh inspection or an explicit acknowledgement of a manual step. Every active stage has a
two-minute deadline; cancellation and retry are real transitions rather than renderer-only flags.

The input boundary is intentionally already present. `table-navigation-input.cjs` implements it in `dry-run`
mode: every requested action returns `performed: false` and a human-readable instruction. It never receives an
Electron window and cannot send pointer or keyboard input. Replacing it with a live adapter requires the real
capture corpus, coordinate transforms, and fixture-backed input tests rather than a conditional in the UI.

Each transition is held on the live session for the dashboard and appended to the bounded local
`table-navigation-history.json` journal. That file carries account IDs, table labels, states, events, and
timestamps only. Account names, browser text, images, routes, and credentials are not accepted by the journal's
fixed writer shape.

## 14. Current limitations and claim authority

The [generated capability report](CAPABILITIES.md) is the build-specific inventory of available, limited, dry-run, and unavailable behavior. The [work-item register](work-items.json) tracks the 142 final-product deliverables, their owners, dependencies, and required evidence. The [support policy](support-policy.md) records the preview operating boundary. These are checked by `npm run product:check`.

Important remaining limitations are workspace restore UX and full backup portability (Module B), hardware/GPU and failure characterization (D/P), representative held-out game recognition evidence (F/G), live game input (H/I), pairing (J), match accounting (K), durable fault diagnostics (L), accessibility/localization (M), external security/compliance review (N), and signed installation/update/rollback and clean-VM release proof (O). Existing local tests and Capture Lab evidence are not interchangeable with those external gates.

ADR-0011 records the game-facing automation boundary. Do not describe a browser window as authenticated, a pair as matched, or a match/transfer as complete based solely on session or screen state.
