# Architecture

Structure of the application: what the modules are, what may depend on what, how a session moves
through its states, and where each kind of state lives. Decisions behind the structure are in
[`docs/adr/`](adr/README.md); the scope boundary is in [`../BOUNDARIES.md`](../BOUNDARIES.md).

## 1. Shape of the system

Electron 44, CommonJS main process (ADR-0001), one window per account, a separate dashboard window,
and a pooled OCR worker.

```
┌─────────────────────────────── MAIN (Node) ───────────────────────────────┐
│  main.cjs         composition root — lifecycle, dashboard, wiring          │
│  ipc.cjs          the dashboard contract + trust guard                     │
│  workspace.cjs    data layer: log, snapshot, publish, save, load            │
│  state.cjs        shared singletons: sessions, sessionStores, events, ws    │
│  windows.cjs      session windows: open / close / arrange / return          │
│  profiles.cjs     when to save a session, debounce, flush on quit           │
│  saved-session.cjs  where the carry-over file lives, crypto, read/write     │
│  session-cookies.cjs  which cookies are carried (policy + payload shape)    │
│  plist.cjs        the plist document format                                 │
│  hardening.cjs    session, navigation and popup policy                      │
│  recovery.cjs     shop auto-return + repaint supervision                    │
│  inspection.cjs   capture → classify orchestration + failure text           │
│  game-region.cjs  locate the game surface                                   │
│  game-screen.cjs  Tesseract + Sharp pipeline, classify()                    │
│  screen-reader-pool.cjs  warm OCR workers, queue, idle retirement           │
│  network.cjs      ipify check through a given session                       │
│  layout.cjs       pure tile geometry for arrange()                          │
│  model.cjs        workspace validation                                      │
│  errors.cjs       messageOf — normalises unknown catch values               │
│  types.cjs        JSDoc typedefs (SessionGroup, ProfileStore, LogFn, …)     │
│  self-test.cjs    the --self-test suite, loaded only when flagged           │
└────────────────────────────────────────────────────────────────────────────┘
        ▲ IPC (envelope + trust guard)              ▲ utilityProcess
┌───────┴──────────────┐                  ┌─────────┴────────────────┐
│ DASHBOARD (renderer) │                  │ GAME WINDOWS (sandboxed) │
│ preload bridge only  │                  │ no preload, no Node      │
└──────────────────────┘                  └──────────────────────────┘
```

### Dependency rules

| Rule                                                                                                                      | Enforced by                  |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| No module over 200 lines                                                                                                  | `test/architecture.test.cjs` |
| No cycles in the local require graph                                                                                      | `test/architecture.test.cjs` |
| `layout`, `model`, `shop-recovery`, `game-region`, `saved-session`, `session-cookies`, `plist` must not import `electron` | `test/architecture.test.cjs` |
| No unreferenced modules                                                                                                   | `test/architecture.test.cjs` |
| `main.cjs` is wiring only                                                                                                 | review + the size ceiling    |

Dependency direction is one-way. `state.cjs` is a leaf that others read. Feature modules receive what
they need as an injected `deps` object, so `windows.cjs` can take `returnToGame` from itself without
creating a cycle back through `recovery.cjs`:

```
main ──▶ ipc ──▶ (windows, inspector)
 │      └─▶ workspace ──▶ state
 └──▶ windows ──▶ hardening, profiles, recovery, layout
        └──▶ profiles ──▶ saved-session ──▶ session-cookies, plist
```

## 2. Session lifecycle — the state machine as it exists today

There are two layers. The **session** layer is per account and lives in `sessions` (`state.cjs`). The
**observation** layer describes what has been seen inside that window.

### 2.1 Session status

`status` is `'loading' | 'open' | 'error'`. **`closed` is not a stored value** — a session is closed
when it has no entry in `sessions`.

| From                         | To            | Trigger                                 | Where         | Also happens                                                                |
| ---------------------------- | ------------- | --------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| _(absent)_                   | `loading`     | `openAccount` creates the group         | `windows.cjs` | session policy applied, window created, recovery attached, profile prepared |
| `loading`                    | `open`        | `did-finish-load`                       | `windows.cjs` | logged; the renderer drops the _Loading game…_ label                        |
| `loading` / `open`           | `loading`     | `returnToGame`                          | `windows.cjs` | shop gate marked used, then `loadURL`                                       |
| `loading` / `open`           | `error`       | `did-fail-load` (main frame, code ≠ −3) | `windows.cjs` | logged with the code; user is told to reopen                                |
| `loading`                    | `error`       | profile prepare or `loadURL` threw      | `windows.cjs` | logged with the reason                                                      |
| any                          | _(absent)_    | window `closed`                         | `windows.cjs` | child popups destroyed, entry deleted                                       |
| `loading` / `open` / `error` | _(unchanged)_ | `openAccount` on a live window          | `windows.cjs` | window is shown and focused, no transition                                  |

Notes that matter:

- Code `−3` (aborted) is ignored on purpose: it fires for ordinary in-app navigation.
- `open` means **the page loaded**. It does not mean signed in, and the UI says so
  (`● Window open · login unverified`).
- A closed session is not lost work: the partition is persistent (ADR-0003), so reopening restores
  the profile.

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

### 2.3 What this is not yet

The roadmap's M1 replaces this with an explicit FSM: `idle → launching → loading → ready → degraded →
closing → closed`, with every transition evented and timeouts owned by the machine. Today:

- transitions are assignments scattered across three modules, not a transition table;
- there is no `degraded` state — a session that loads but never renders is reported as `open`;
- timeouts belong to call sites (`INSPECTION_TIMEOUT_MS` in `inspection.cjs`, 45 s in `runGameCheck`)
  rather than to the machine;
- nothing records a transition history, so M4's timeline will need it added.

## 3. Storage model

Three kinds of state, deliberately separate.

| Store              | Owns                                    | Path                                                             | Lifetime                                              |
| ------------------ | --------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Chromium profile   | **every cookie** and all site storage   | `%APPDATA%/Poolside/Partitions/poolside-<id>` (Chromium-managed) | until the profile is deleted                          |
| Workspace document | account labels, roles, preferences      | `%APPDATA%/Poolside/workspace.json`                              | user data                                             |
| Carry-over file    | **only** session cookies Chromium drops | `%APPDATA%/Poolside/accounts/<id>.plist`                         | until deleted; survives corruption by being preserved |

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

M4 adds the structured event bus, JSON logs with rotation, per-session metrics, frame-timing
instrumentation and a redacted diagnostics bundle with a secret-scanner test.

## 9. Testing architecture

| Layer         | Suite                                                                                                                        | What it proves                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Pure unit     | `npm test` — `layout`, `model`, `network`, `shop-recovery`, `classification`, `saved-session`, `plist`, `screen-reader-pool` | logic, validation, payload invariants — no Electron needed    |
| Recognition   | `npm test` — `game-screen.test.cjs`                                                                                          | real OCR against the fixture corpus                           |
| Architectural | `npm test` — `architecture.test.cjs`                                                                                         | ceilings, cycles, purity, orphans                             |
| Integration   | `npm run test:desktop`                                                                                                       | real sessions, real IPC, real dashboard, local HTTPS fixtures |
| Process       | `npm run test:persistence`                                                                                                   | two real processes: state survives restart                    |
| Packaged      | `release/…/Poolside.exe --self-test`                                                                                         | the shipped build, native deps included                       |

Game-facing behaviour is proved offline via `protocol.handle` fixtures (ADR-0007). No test uses a
real account.

## 10. Known gaps

Carried deliberately, with the milestone that closes each:

| Gap                                                           | Milestone              |
| ------------------------------------------------------------- | ---------------------- |
| No explicit session FSM, no transition history                | M1                     |
| Identity configuration is not exposed per session             | M1                     |
| Config is hand-validated in `model.cjs`; venues are hardcoded | M2                     |
| Corpus is seven positive fixtures and no negatives            | M3                     |
| Region ranking unvalidated against the live site              | M3 (needs a live pass) |
| No structured logging, metrics or diagnostics bundle          | M4                     |
| No design system, i18n or accessibility audit                 | M5                     |
| No fault-injection harness, no soak results                   | M6                     |
| No threat model, SBOM or secret scanning                      | M7                     |
| No signing, no updater, no reproducible-build proof           | M8                     |
| No performance budgets measured on a reference machine        | M9                     |
| `main.cjs` wiring is reviewed, not enforced                   | M0 remainder           |
