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
│  profile-sweep.cjs  remove profile storage no account claims                │
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

### Dependency rules

| Rule                                 | Enforced by                  |
| ------------------------------------ | ---------------------------- |
| No module over 200 lines             | `test/architecture.test.cjs` |
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

| From         | To                             | Trigger                                                       |
| ------------ | ------------------------------ | ------------------------------------------------------------- |
| any          | `null`                         | main-frame navigation begins (**bumps the generation**)       |
| `null`       | `inspecting`                   | `inspectGame` starts                                          |
| `inspecting` | recognised state, or `unknown` | classification completes **and** the generation still matches |
| `inspecting` | `unknown`                      | inspection failed **and** the generation still matches        |

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
infrastructure (§2.4). What remains of M1 is the profile manager: create, delete, quota reporting,
corruption detection and repair.

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

`workspace.json` is written atomically (temp file + rename, mode `0600`). A malformed document puts
the app into read-only mode instead of overwriting data the user may still want.

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
  5. game-screen.inspect(): OCR → Sharp luminance mask → second OCR → classify()
  6. release the worker; discard the result if the generation changed
```

`classify()` returns `{state, score, evidence, alternatives}` and only ever returns a state label —
never OCR text, balances or names. Gates are the original conditions, kept deliberately unchanged
(ADR-0002), and a regression test embeds the previous implementation to prove it.

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

| Control                                                                                   | Where               |
| ----------------------------------------------------------------------------------------- | ------------------- |
| Game windows: sandboxed, no preload, no Node, context isolated                            | `windows.cjs`       |
| HTTPS-only navigation; popups inherit the account session and are re-hardened recursively | `hardening.cjs`     |
| Downloads blocked; all permission requests and checks denied                              | `hardening.cjs`     |
| Dashboard: CSP `default-src 'self'`, `connect-src 'none'`, no external requests           | `src/ui/index.html` |
| IPC trust guard on every handler                                                          | `ipc.cjs`           |
| Workspace written atomically, `0600`, read-only fallback on corruption                    | `workspace.cjs`     |
| Session file id-validated (no traversal), `0600`, encrypted via DPAPI                     | `saved-session.cjs` |
| Recognition returns a label, a score and matched phrases only                             | `game-screen.cjs`   |
| No telemetry, no remote config, no updater                                                | ADR-0010            |

## 8. Observability

Today: an in-memory activity feed (last 100 events) with `info`/`warning` kinds, surfaced in the
dashboard, plus console output. It records actions, not credentials and not full URLs.

M4 compiles that feed together with the session FSM's transition history (last 50 per session) into one
ordered **diagnostic timeline** (`timeline-engine.cjs`), reads it with `timeline-query.cjs`, and collates the
per-account metrics — measured size, configured ceiling, generation, crash flags — into layers
(`dashboard-telemetry.cjs`). The layers differ by sensitivity, and only the `export` layer may leave the
machine: `telemetry-redaction.cjs` produces it, rewriting every string, and `diagnostics:preview` refuses to
return a payload that fails its own scan (ADR-0016). Addresses, filesystem paths and token-shaped strings are
matched by shape; account names by literal.

Still to come in M4: durable JSON logs with rotation, frame-timing
instrumentation, and validation of that bundle against scripted failure scenarios.

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
| Sweep     | `profile-sweep.cjs`                        | removes `poolside-<uuid>` directories and `<uuid>.plist` files that no account claims; every other name is reported foreign and left alone                  |

Two storage layers, with different authority (ADR-0004):

| Layer              | Path                                  | Holds                                  | If it is lost             |
| ------------------ | ------------------------------------- | -------------------------------------- | ------------------------- |
| Chromium partition | `<userData>/Partitions/poolside-<id>` | every cookie, all site storage, caches | a real re-login           |
| Carry-over file    | `<userData>/accounts/<id>.plist`      | session cookies only, encrypted        | a sign-in for the session |

**Startup order.** The integrity scan runs before the window is shown — one small file per account — and
the measurement runs after it via `setImmediate`, because walking every profile directory is the slow half
and the dashboard should not wait for it. The scan sweeps abandoned `.tmp` files, removes storage no
account claims, checks each account and quarantines what is damaged, then logs one summary line.

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

## 13. Known gaps

Carried deliberately, with the milestone that closes each:

| Gap                                                                   | Milestone                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| No transition history or deadline enforcement on session state        | M1 (closed — `session-fsm.cjs`)                                                                        |
| No crash/stall handlers or per-session health record                  | M1 (closed — `supervision.cjs`)                                                                        |
| Identity configuration, per session                                   | M1 (closed — `identity.cjs`, ADR-0012)                                                                 |
| Remembered geometry and per-monitor bounds                            | M1 (closed — `geometry.cjs`)                                                                           |
| Per-session route as infrastructure, honestly reported                | M1 (closed — `proxy.cjs`)                                                                              |
| No profile lifecycle (establish, check, delete)                       | M1 (closed — `profile-manager.cjs`)                                                                    |
| No corruption detection on stored session data                        | M1 (closed — `profile-integrity.cjs`)                                                                  |
| Config is hand-validated in `model.cjs`; venues are hardcoded         | M2 (closed — `config-schema.cjs`)                                                                      |
| The roadmap sketch's five-section config is not built                 | M2 remainder                                                                                           |
| Corpus is seven positive fixtures and no negatives                    | M3 (harness in: `test/fixtures/vision-corpus.json`)                                                    |
| Region ranking unvalidated against the live site                      | M3 (needs a live pass)                                                                                 |
| No labelled frame corpus, so accuracy is unmeasurable                 | M3 remainder                                                                                           |
| No regression harness with enforced accuracy thresholds               | M3 remainder                                                                                           |
| No ordered history across sessions; two rings with opposite orderings | M4 (closed — `timeline-engine.cjs`, ADR-0016)                                                          |
| Metrics scattered across four subsystems, re-joined by the dashboard  | M4 (closed — `dashboard-telemetry.cjs`)                                                                |
| No rule for what a diagnostics payload may contain                    | M4 (closed — `telemetry-redaction.cjs`: redaction + a refusing scan)                                   |
| No durable logs, no frame timings, no crash file                      | M4 remainder                                                                                           |
| The (future) bundle is validated against no scripted failure scenario | M4 remainder                                                                                           |
| No settings UI bound to the configuration schema                      | M5 (closed — `settings-form-mapper.cjs`, ADR-0017)                                                     |
| No per-session detail view; account overrides have no UI              | M5 remainder                                                                                           |
| No design tokens, component kit, i18n or accessibility audit          | M5 remainder                                                                                           |
| No command palette or hotkeys                                         | M5 remainder                                                                                           |
| No fault-injection harness, no soak results                           | M6                                                                                                     |
| No threat model, SBOM or secret scanning                              | M7 in progress — threat model and reproducible SBOM are in; privacy scanning and release review remain |
| No signing, no updater, no reproducible-build proof                   | M8                                                                                                     |
| No performance budgets measured on a reference machine                | M9                                                                                                     |
| `main.cjs` wiring is reviewed, not enforced                           | M0 remainder                                                                                           |
