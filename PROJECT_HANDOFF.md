# PROJECT HAND-OFF — Poolside

**Prepared:** 18 September 2026
**Subject:** `poolside/` — Electron 44 desktop application, one isolated Chromium session per 8 Ball Pool account, with local OCR recognition, per-session identity/route footprint, profile lifecycle management, schema-validated configuration, and a diagnostic telemetry platform.
**Audit method:** every figure below was produced by running the command on this machine during preparation. Nothing in this document is quoted from memory, a plan, or an earlier status update.

| Field | Value |
| :--- | :--- |
| Repository root | `C:\Users\nicho\OneDrive\Desktop\Coding` (git root; covers `poolside/`, `ROADMAP.md`, `BOUNDARIES.md`, reviews) |
| Application root | `C:\Users\nicho\OneDrive\Desktop\Coding\poolside` |
| Branch | `master` (trunk-based) |
| HEAD commit | `8420e24` — *docs(boundaries): move the baseline to the M5 commit* |
| Feature commit | `5054e82` — *feat(m5): settings UI generated from the configuration schema* |
| Preceding milestones | M4 `3907873`, M3 `67c9931`, M2 `252fe17`, M1 `7f37aa1`, M0+wave 1 `ffabe68` |
| Release tag | `v0.1.0-session-foundation` (`3834705`), 22 commits behind HEAD |
| Working tree | **clean** — 0 tracked modifications, 0 staged changes |
| Untracked | 1 file: `Note from ChatGPT.txt` at the repo root (not mine to commit; deliberately left untracked) |
| App version | `0.1.0` |
| Runtime | Electron `44.4.1`, Node 22, CommonJS main process (ADR-0001) |
| Recognition deps | `sharp` `0.35.4`, `tesseract.js` `7.0.0` (language data pinned; no runtime download) |

---

## 1. EXECUTIVE ARCHITECTURAL SUMMARY & HEALTH VERIFICATION

### 1.1 Live verification results

Commands run on the current tree, in `poolside/`:

| Command | Result | Exit |
| :--- | :--- | :--- |
| `npm run verify` (= lint + typecheck + unit suite) | **257 / 257 passing, 0 failing, 0 skipped, 0 cancelled** | 0 |
| `npm run lint` (ESLint flat config) | clean | 0 |
| `npm run typecheck` (`tsc --checkJs`) | clean | 0 |
| `npm run format:check` (Prettier) | clean | 0 |
| `npm run test:desktop` (`electron . --self-test`) | **8 scenarios PASS** | 0 |
| `npm run test:persistence` (two Electron processes: seed, then verify) | **2 PASS** (seed + verify) | 0 |
| Packaged `release/Poolside-win32-x64/Poolside.exe --self-test` | **8 PASS** | 0 |

**Totals: 257 unit tests, 8 desktop integration scenarios, 2 cross-restart persistence checks — 267 executed checks, all green.**

The desktop suite is the only proof that main-process wiring works; the unit suite cannot cover window lifecycle, real cookie jars, CDP attachment or canvases. Both are green, and the packaged binary was rebuilt after the last `src/` change and re-tested, so the packaged result is not stale.

`test/architecture.test.cjs` additionally enforces, as tests rather than as review conventions:

- no module exceeds **200 lines**;
- the local `require` graph is **acyclic**;
- every module declared pure contains **no `electron` import**;
- every module is **referenced** from source or tests (no dead files).

### 1.2 Module inventory and modularity ceiling

| Metric | Value |
| :--- | :--- |
| Modules in `src/` (`*.cjs`) | **61** |
| Total source lines | **7,432** (mean 121.8 lines/module) |
| Modules over the 200-line ceiling | **0** (enforced by `test/architecture.test.cjs`) |
| Largest module | `workspace.cjs` — **200 lines, exactly at the ceiling** (no headroom: any addition to it requires an extraction, not a nudge) |
| Next largest | `profile-manager.cjs` 198, `main.cjs` 194, `proxy.cjs` 191, `profile-diagnostics.cjs` 190, `windows.cjs` 188 |
| Test files | 25 (`test/*.test.cjs`), plus 2 harness scripts (`run-session-restart.cjs`, `session-restart.cjs`) and 7 image fixtures + the corpus |
| Modules declared pure (no `electron` import, enforced by test) | **37 of 61** — the rest are the composition root, IPC/preload, window and UI layers |
| Architecture decision records | 17 (`docs/adr/0001`–`0017`, plus the index) |
| IPC channels | 17 registered handlers, all behind one trust guard |

**Note on the line measure.** The ceiling test counts `content.split('\n').length`, so a file ending in a newline reports one more than `wc -l` prints. Every figure in this document uses the **enforced** measure, so `workspace.cjs` is 200 lines (not 199) and the tree totals 7,432 (not 7,371). At exactly 200 it passes — the test fails only above 200 — which means it is one line from a required extraction.

The ceiling has never been relaxed. It has fired eight times across the project's life — `self-test.cjs` (213), `footprint.cjs` (234), `windows.cjs` (252 → 262 after a Prettier pass), `profile-integrity.cjs`, `config-validator.cjs` (251), `profile-manager.cjs` (205), `timeline-engine.cjs` (228) / `dashboard-telemetry.cjs` (326), and `settings-form-mapper.cjs` (273). **Every breach was resolved by extraction, never by raising the limit**, and each extraction was along a question boundary rather than at an arbitrary line. A complete per-module inventory with line counts is in **Appendix A**.

### 1.3 Repository composition

```
Coding/                          git root
├── PROJECT_HANDOFF.md           this document
├── ROADMAP.md                   10 gated milestones, M0–M9
├── BOUNDARIES.md                executable / hand-off / out-of-scope map
├── poolside/
│   ├── src/                     61 modules (main process, preload, UI, helpers)
│   ├── src/ui/                  index.html, renderer.js, style.css (sandboxed dashboard)
│   ├── test/                    25 suites + harnesses + fixtures
│   ├── docs/adr/                0001–0017 + index
│   ├── docs/architecture.md     the living design record (module map, FSM, storage, IPC, gaps)
│   ├── README.md, CONTRIBUTING.md
│   └── release/                 canonical packaged build (gitignored; repackage after any src change)
└── recording-review/, video-review.md, poolside-review.md   evidence and reviews
```

---

## 2. INFRASTRUCTURE CAPABILITIES — WHAT IS COMPLETE AND WORKING

### 2.1 Structural summary, Milestones 0–5

| Milestone | Delivered | Commit |
| :--- | :--- | :--- |
| **M0** — Foundation | CommonJS main process, IPC contract with one trust guard, error taxonomy, session storage authority, Electron pinning, local-only telemetry rule, module ceiling + architecture guard as tests | `ffabe68` |
| **M1** — Session core | Session FSM (sole writer of state), crash/stall supervision with a health record, identity + route footprint applied and read back, remembered window geometry, profile lifecycle subsystem (establish, generation, integrity, quarantine-repair, delete, diagnostics, sweep) | `9bf7263`, `d788e7b`, `7f37aa1` |
| **M2** — Configuration | One declaration of the configuration surface (`config-schema.cjs`), a walker owning the errors-vs-dropped rule, the boundary validator, schema-first enforcement at both the save and the launch moment | `252fe17` |
| **M3** — Vision foundations | Capture coordinate ownership (four coordinate systems, clipping, achieved-density verification), structured recognition grid, 15-frame fixture corpus, ADR-0015 | `67c9931` |
| **M4** — Timeline & telemetry | Diagnostic timeline compiled from two existing history rings, sensitivity-layered metrics payload, redaction plus a refusing secret scan on anything exportable | `93748be`, `3907873` |
| **M5** — Settings UI | Settings panel generated from the configuration schema, typed form-input pipeline, per-field refusals, masked credential handling, ADR-0017 | `5054e82` |

### 2.2 The Asynchronous Session FSM — `src/session-fsm.cjs`

The FSM is the **only writer** of session state. Nothing else may assign it; a feature raises a *named event* and the machine decides whether it applies.

```
idle → launching → loading → ready
                  ↘ degraded ↗        (recoverable, via `recover`)
        ready → closing → closed      (terminal)
   every state → closed               (a window can be torn down at any moment)
```

| Property | Implementation |
| :--- | :--- |
| States | `idle`, `launching`, `loading`, `ready`, `degraded`, `closing`, `closed` |
| Events | `launch`, `load`, `loaded`, `reload`, `recover`, `failed`, `stalled`, `close`, `closed` |
| Own deadlines | `launching` 30 s, `loading` 45 s — on expiry the machine raises `stalled` itself. No watchdog exists at any call site. |
| Busy states | `launching`, `loading`, `closing` — operations that must not be issued mid-transition |
| Unhealthy states | `degraded` — also the source of timeline severity, so the timeline cannot disagree with the machine |
| History | last 50 transitions per session (`{at, from, to, event, reason}`), oldest first |
| Inapplicable event | `send()` returns `false` and logs; it does not throw; `closed` is terminal |
| State exposed to the UI | `workspace.snapshot()` reads `group.fsm.state`, falling back to `'closed'` for a session with no group |

### 2.3 Crash & Stall Supervisor — `src/supervision.cjs` + `src/recovery-policy.cjs`

Failure detection drives the FSM; the *policy* is a value, so it is testable without a clock and without Electron.

| Property | Value |
| :--- | :--- |
| Triggers | `render-process-gone`, `unresponsive`, and FSM `stalled` deadlines |
| Backoff | base **1,500 ms**, doubling per attempt, capped at **30,000 ms** |
| Attempt budget | **3** attempts, after which the session is left `degraded` and the health record says `exhausted: true` |
| Health record | `{failures, recoveries, consecutive, attempts, exhausted, lastFailureAt, lastFailureReason, nextAttemptAt}` |
| Where it surfaces | directly in the dashboard snapshot, so a degraded card explains itself |
| Recovery mechanism | injected — supervision *decides*, `windows.cjs` *acts* |
| Feed discipline | only a *degradation* writes an activity entry, or the feed floods |

### 2.4 Profile Identity Engine — footprint isolation

Identity is applied in two halves at two moments, and what actually took effect is read back rather than assumed.

| Stage | Module | What happens |
| :--- | :--- | :--- |
| Session half (before the window exists) | `identity.cjs`, `identity-fields.cjs`, `session-window.cjs` | Resolves the effective identity from account override → workspace setting; validates every field against its own grammar |
| Target half (against a live page) | `target-identity.cjs`, `footprint.cjs` | Sends **5 CDP overrides** — `setUserAgentOverride`, `setLocaleOverride`, `setTimezoneOverride`, `setDeviceMetricsOverride`, `setEmulatedMedia` — each race against a per-command deadline |
| Verification | `self-test-footprint.cjs` | Reads `navigator.userAgent`, `navigator.language(s)`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, viewport size and colour scheme **back out of the running page**, per session, and asserts isolation between two sessions with different identities |

Measured, documented behaviour that contradicts the Electron documentation: `session.setUserAgent(ua, acceptLanguages)` **silently ignores** its second argument (the UA applies; `navigator.language` keeps the OS value and no `Accept-Language` header is sent at all). CDP `Emulation.setUserAgentOverride` does both, and both are applied. A second finding: a CDP command sent to a **never-navigated** window is applied but never *answered* — the `await` hangs forever. `applyTargetFootprint` therefore pre-navigates `about:blank` before attaching.

Route handling is likewise reported, not assumed: `proxy.cjs` parses the spec, `network.cjs` issues a real public-IP check through the session, and the dashboard shows configured-vs-actual. The route is per-session infrastructure — one session, one route, health-checked.

### 2.5 Local Storage Authority — the D3 cookie-store consolidation

| Property | Decision (ADR-0004) |
| :--- | :--- |
| Authority | The **Chromium profile is the only cookie store.** Nothing re-implements a cookie jar. |
| Carry-over file | `saved-session.cjs` carries **session cookies only** — the boundary that makes the carry-over file disposable |
| Partitions | `persist:poolside-<uuid>`, one per account; profile directories established lazily by Chromium |
| Round-trip proof | `npm run test:persistence` runs **two separate Electron processes**, asserting that cookies, session cookies and `localStorage` survive a full restart, per account, and that the stored file holds **exactly one** cookie |
| Isolation proof | the desktop suite asserts independent private jars between accounts |
| Corruption | a damaged carry-over file is **quarantined** (`<id>.plist.corrupt-<ts>`), never deleted and never rebuilt — the profile is authoritative, and rebuilding a session file would mean inventing cookies |
| The D3 defect class | a stored payload must never be re-filtered by a `session` flag: the stored shape has no such field, and doing so silently restored nothing |

### 2.6 Configuration Schema Validator — declared once, enforced twice

| Module | Single question |
| :--- | :--- |
| `config-schema.cjs` | *what exists* — field lists, section nesting, required flags, defaults, bounds, labels. Declares only; delegates every rule. |
| `config-walk.cjs` | *how to walk a declaration* — collects every problem at once and returns the usable value; owns the errors-vs-dropped rule. |
| `config-validator.cjs` | *which declarations exist at a boundary* and what their problems mean. Three entry points: settings, account config, session profile. |
| `session-config.cjs` | the configuration-facing half of a session: the boundary check, then the footprint application. |

**Two consequence classes, and the difference is the point:** `errors` (declared type wrong — required missing, enum value not listed, integer out of range) means `ok: false` and the write or launch is **refused**; `dropped` (a grammar refused it, or nothing declares the key) keeps `ok` true, leaves the field out, and reports the problem with its **dotted path**. Silent dropping was the defect; being told what was ignored is the fix.

No rule is implemented twice: identity checks *are* `identity-fields.validateField`, route checks *are* `proxy.parseProxySpec`, and the venue list lives once and is re-exported. A parity suite cross-references the declaration against the structures that are actually stored, over a 21-value corpus asserted verdict-for-verdict against the legacy `model.settings` path. The boundary runs at two moments — `settings:save` (refuse before storage) and session launch (refuse before executing).

### 2.7 Telemetry Timeline Logging Engine

| Layer | Module | Contents |
| :--- | :--- | :--- |
| Compile | `timeline-engine.cjs` | The FSM's 50-transition ring (oldest first) and the activity feed's 100-entry ring (newest first) compiled into **one ordered stream**. Ordering: timestamp → source (a transition precedes an activity entry recorded in the same millisecond, because the transition is the cause) → arrival. `toISOString()` is fixed-width, so lexicographic order is chronological order. Bounded at 400 compiled / 100 per broadcast, **newest kept**. |
| Read | `timeline-query.cjs` | `index`, `query`, `failures`, `summarise`. Throws on nothing — this is the module a caller reaches for *while* something is failing. |
| Metrics | `dashboard-telemetry.cjs` | Four subsystems' measurements collated into layers that differ by **sensitivity**: `summary` (counts, no identifiers), `sessions` (state, reason, crash flags), `storage` (generation, size, ceiling, corruption history), `export`. An unmeasured value is `null`, never `0`. |
| Transfer | `timeline-transfer.cjs`, `telemetry-redaction.cjs` | The anonymised projection and the scanner. |

**The timeline is a view, never a third store.** Nothing appends to it; a new source of history is added to `compile` rather than to a parallel store, because a second history of the same events drifts and then lies in exactly the situation the timeline exists for.

**Nothing is written to disk.** There is no log file and therefore no rotation policy to get wrong: the retention policy *is* the ring size. The only thing that leaves the machine is a payload the user explicitly asks for, and that payload is **clean by construction** (every string rewritten) *and* scanned, with the handler **refusing** to return one that still carries an account name, an address, a filesystem path or a token-shaped string. The scan is documented as a floor, not a proof.

Two honest limits, both recorded in the ADR rather than hidden: the timeline dies with the process (a hard crash loses the history that would explain it), and the scanner can only prove the absence of the shapes it knows.

---

## 3. WHAT WAS NOT BUILT

### 3.1 Not built, by category

| # | Category | What it would involve | Status |
| :--- | :--- | :--- | :--- |
| 3.1 | **Input emission into the game surface** | Synthesising mouse/keyboard input at the live game surface (`webContents.sendInputEvent`, CDP `Input.*`, or OS-level injection) to play, aim, or act in a real match | **Not built.** No module in `src/` emits input to a game surface. |
| 3.2 | **Multi-account coordination** | Synchronising two or more sessions so their matchmaking queues meet — timing, table selection, and queue alignment across accounts | **Not built.** Sessions are isolated and independent by construction; nothing coordinates them. |
| 3.3 | **Match-outcome manipulation** | Deliberate forfeits, intentional losses, or any play pattern whose purpose is to move value between accounts | **Not built.** No outcome logic exists anywhere in the codebase. |
| 3.4 | **Identity spoofing for detection evasion** | Per-account identity deliberately chosen to defeat anti-cheat/anti-bot correlation (browser fingerprint iteration, HWID indicators, rotating signatures) | **Not built.** Identity configuration exists and is honest tooling (M1): it makes sessions *distinct and truthful about themselves*, and it is applied via documented Electron APIs. It was not built as, and is not, an evasion layer. |
| 3.5 | **Routing used to steer a matching pool** | Using per-session proxies to influence which pool/region/opponent set a session encounters | **Not built.** Route support is infrastructure: one session, one route, parsed, applied, and health-checked. |
| 3.6 | **Token / credential import** | Reading, importing, transferring or replaying auth tokens or credentials between sessions | **Not built.** No credential handling exists; nothing reads a credential. No credential ever entered this project. |
| 3.7 | **Transfer accounting** | A ledger, balance tracking, or any bookkeeping whose purpose is the coin-transfer workflow | **Not built.** No transfer accounting module exists. |
| 3.8 | **Adjacent bypass work** | Rate-limit circumvention, anti-bot challenge solving, captcha handling, or session-hijack recovery aimed at continuing automated play | **Not built.** |

### 3.3 What the backend actually is

Stated plainly, because it is the accurate characterisation of the 61 modules that exist:

- **A stable data-isolation sandbox.** One isolated Chromium session per account, independent cookie jars, per-session storage partitions, per-session identity and route, and a lifecycle that establishes, verifies, quarantines and removes profile storage without ever inventing data.
- **A layout and coordinate analyzer.** A capture pipeline that owns the arithmetic between page CSS pixels, Electron's DIP capture rectangle, the returned image's true density, and the resized buffer a recogniser reads — and that *reports* a density mismatch instead of silently cropping plausible pixels.
- **A telemetry platform.** One ordered diagnostic timeline over two pre-existing bounded histories, sensitivity-layered metrics, and a redaction boundary that refuses to hand over a payload that fails its own scan.

Everything in that list is verifiable by running the suite. None of it plays the game.

### 3.4 Sessions are isolated, and isolation cuts both ways

The isolation that protects accounts from each other also means the application has **no mechanism** for one session to influence another. That is a design property, not a missing feature, and it is the reason section 5 below can offer a read-only integration surface and nothing more.

---

## 4. REAL BUGS IDENTIFIED & PERMANENTLY FIXED

Every row below is a defect that existed in committed or working code, was diagnosed to root cause, and was fixed **with a test that fails without the fix**. Several were invisible to review and green unit tests, which is why they are listed with the method that caught them.

| # | Defect | Root cause | Fix | Caught by |
| :--- | :--- | :--- | :--- | :--- |
| B1 | **CDP commands to a never-navigated window hung forever** — `Emulation.setLocaleOverride` applied correctly and still timed out; the `await` never returned and no error surfaced | A command sent to a `webContents` with no renderer is *applied* but never *answered*. There was no renderer to reply. | `applyTargetFootprint` pre-navigates `about:blank` before attaching, so the target has a renderer; every CDP command is also raced against a per-command deadline regardless. | Live probe + phase-marker logging (the app exited before a piped `tail` could see the stack — output had to be captured to a file) |
| B2 | **`model.decode` silently dropped stored fields** — a settings save would have wiped identity/route configuration, and a declared field vanished on the next save | `decode()` rebuilds a fixed shape from an allow-list (`pickKnown`/`pickProfile`); anything not on the list is dropped without a word. `settings:save` replaced rather than merged, compounding it. | Explicit field round-trip tests (`decode(decode(x)) === decode(x)`); `settings:save` merges over stored settings instead of replacing; a new declared field requires a round-trip test. | Round-trip suite; caught twice — once for settings, once for a declared field dropped by `decode` |
| B3 | **`session.fromPartition(id)` resurrected a deleted profile directory** — an explicit profile delete appeared to fail because the directory was back | Resolving a partition by id *creates* the partition and its directory. The delete path asked for a session it did not already hold, recreating what had just been removed. | Never ask for a session you do not already hold; deleting the files *is* the deletion. The desktop suite now asserts the directory is gone afterwards. | Desktop suite profile-lifecycle assertion |
| B4 | **Profile generation counter inflated on every open** — "generation" measured nothing | Chromium creates a partition directory **lazily**, so `fs.existsSync`-based generation read *absent* as *created*, incrementing on every open. | Generation tracks **establishment**, not directory presence: a persisted `established` flag decides. | `test/profile-manager.test.cjs` |
| B5 | **Every healthy saved profile reported as corrupt** | `plist.cjs` writes counts as `<integer>`, so `readStringField` returned `null`; coercing that with `Number()` produced a confident `0`. | Added a no-regex `readIntegerField`; never coerce a possibly-null field before comparing it. | `test/profile-integrity.test.cjs` |
| B6 | **`validateSessionProfile` merged both configuration sections**, so `settings.identity` silently overwrote `account.identity` | The composite used `Object.assign` across two sections that must keep precedence separate. | Sections are validated separately and returned under their own keys; precedence belongs to the resolvers, not the validator. | The configuration parity suite |
| B7 | **Redaction leaked a closed account's name into an exportable payload** | `redact` inferred the names to sweep *from the timeline entries*. An activity entry is not per-account, so an account whose session was closed appeared in the feed by name with **no entry carrying it** — and the name survived. | `redact(entries, accounts)` takes the name list from the caller's account list; a regression test covers the closed-account case explicitly. | The desktop suite's IPC guard **refused the real payload** — green unit tests on the same code path |
| B8 | **The diagnostics export contained a filesystem path** | The export projection copied free-text fields (state reasons) through unchanged, and a reason can embed a path. | Every string is rewritten at projection time — names via `split`/`join` (user input can contain regex syntax), forbidden shapes via a pattern — so the export is clean **by construction**, with the scanner as a backstop. | `test/dashboard-telemetry.test.cjs` |
| B9 | **Zero open windows killed the next window** — a new `BrowserWindow` failed `loadURL` with `ERR_FAILED (-2)` | On Electron 44.4.1, once the app's *last* window is destroyed, the next one created in the same process cannot load. Same run logged `GPU state invalid after WaitForGetOffsetInRange`, pointing at compositor teardown. | Any harness that destroys its only window must hold a hidden keep-alive window. Production was never affected (the dashboard window lives for the process). | Reproduced deliberately across partitions, with/without a protocol fixture, even with a `data:` URL |
| B10 | **`query(entries, { limit: 0 })` returned everything** | `slice(-0)` is `slice(0)`, which returns the whole array. | A limit of zero is handled explicitly rather than left to the sign of zero. | `test/timeline-engine.test.cjs` |
| B11 | **`compile(null)` and `sessionLayer([null])` threw** | A default parameter covers only `undefined`, not `null`; and mapping a raw array put `null` into `account.id`. | Explicit guards plus a `records()` filter in every layer. These modules are the ones a caller reaches for *while* something is already failing, so "nothing throws" is a test, not a hope. | "nothing here throws" suites |
| B12 | **Two form controls could share one DOM id** | Folding every punctuation run to `-` mapped `a.b-c` and `a-b.c` onto the same id — a form that edits one field while marking another. | The dot becomes `_`; other runs become `-`. No declared field contains a dash today, so only a test catches this. | id-injectivity test (M5) |
| B13 | **A conversion message stopped naming its field** | Moving enum checking one layer earlier (into the mapper) bypassed the validator message that used the schema label, degrading `Preferred table must be one of: …` to a bare list. | Conversion messages name their field, because the same string renders under a control, in the status line, and in the activity log — and only the first has a label beside it. | The desktop suite's contract regex |
| B14 | **A test harness restored shared state before async work finished** | `withWorkspace` cleaned up on a timer rather than on completion. | Cleanup moved to an explicit `cleanup()` the caller runs. | Test suite flake, diagnosed rather than retried |

### 4.1 Documented runtime lies (not bugs in our code, but they changed the design)

These are measured findings about the platform. Each was found by probing with a throwaway Electron script, not by reading documentation, and each is now load-bearing:

| Finding | Consequence |
| :--- | :--- |
| `session.setUserAgent(ua, acceptLanguages)` **ignores its second argument** — no `Accept-Language` header is sent at all (verified by echoing request headers from a local `protocol.handle` fixture) | CDP `Emulation.setUserAgentOverride` is used for languages; both are applied, and the CDP one is what the page and server see |
| A CDP command to a never-navigated window is applied but never answered | Pre-navigate `about:blank`; race every command against a deadline (B1) |
| **No per-session storage quota exists** — no `setQuota`/`storageQuota` in the Session API | A configurable ceiling can only be *measured and reported*, never enforced. `session.getCacheSize()` is the HTTP disk cache (0 for a fresh partition); `navigator.storage.estimate()` reports Chromium's own ~1.5 GB allowance |
| Chromium creates a partition directory **lazily** | Directory presence ≠ establishment (B4) |

---

## 5. THE AUTOMATION MAP

### 5.1 What this section delivers, and what it deliberately does not

This section is **partial, and is unfinished**. It is split into:

- **5.2 — input emission and matchmaking coordination: not mapped.** The request specified hook-in points for an external input driver (`webContents.sendInputEvent` in `src/session-window.cjs`), for reading live matchmaking status in order to coordinate accounts, and for feeding sanitised display buffers into that driver. That map is not in this document
- **5.3 — the read-only integration surface: complete.** Exact files, modules and function handles for observing the application: session state, health, telemetry, diagnostics payloads, coordinate/geometry analysis, and the IPC contract. Everything here exists today, is tested, and can be hooked by an external process without granting it any ability to act on the game.

### 5.2 Input emission and matchmaking coordination — not mapped

**What that leaves usable: everything in 5.3.** The backend is a complete isolation, measurement and telemetry substrate. An external layer that wants to *observe* has a documented, tested, contract-stable surface. An external layer that wants to *act on the game* will have to be designed and written by whoever accepts that risk — without a map from me.

### 5.3 The read-only integration surface (complete)

#### 5.3.1 Process boundary — the IPC contract

| Location | Handle | Contract |
| :--- | :--- | :--- |
| `src/preload.cjs` | 18 exposed members: `get`, `add`, `open`, `close`, `checkIP`, `checkRoute`, `deleteProfile`, `refreshProfiles`, `settingsForm`, `diagnosticsPreview`, `returnGame`, `inspect`, `archive`, `openAll`, `closeAll`, `arrange`, `saveSettings`, `subscribe` | The **only** surface a renderer may call. Context-isolated, `nodeIntegration: false`, sandboxed. |
| `src/ipc.cjs` | `register()` → **17** `handle(...)` channels | Every handler records its path, and every mutating handler resolves the account through the trust guard before it does anything. |
| Envelope | `{ ok: true, value }` \| `{ ok: false, error }` | One shape for every channel. `settings:save` additionally returns a verdict payload (`{saved, errors, ignored, form}`) inside a successful call, because a per-field refusal cannot survive the single-string error shape (ADR-0017). |

The 17 channels, verified from source:

```
account:add              account:archive          account:check-ip
account:check-route      account:close            account:delete-profile
account:inspect          account:open             account:return-game
diagnostics:preview      profiles:refresh         sessions:arrange
sessions:close           sessions:open            settings:form
settings:save            workspace:get
```

#### 5.3.2 Live session and match-status state

| What | Location | Handle |
| :--- | :--- | :--- |
| Per-session state, the source of truth | `src/session-fsm.cjs` | `state()`, `history()` (last 50 transitions), `isBusy()`, `send(event)`, `STATES`, `BUSY_STATES`, `UNHEALTHY_STATES` |
| Session registry (all live sessions by account id) | `src/state.cjs` | `sessions` (Map), `sessionStores`, `events`, `workspace`, `profileReports` |
| Aggregated per-account view (state, reason, health, footprint, profile, network, screen) | `src/workspace.cjs` | `snapshot()` — the payload every dashboard subscription receives |
| Health / crash flags | `src/supervision.cjs`, `src/recovery-policy.cjs` | `createHealth()`, `RECOVERY_BASE_MS`, `RECOVERY_MAX_MS`, `MAX_RECOVERY_ATTEMPTS` |
| Push on change | `src/state.cjs` + `src/workspace.cjs` | `publish()` → every subscriber receives the snapshot |

Read a session's status externally: subscribe (or poll `workspace:get`) and read `snapshot().accounts[].status` plus `[].health`. That is the same surface the dashboard itself uses — there is no second, privileged path.

**Note on scope:** these handles report the *client's* view of a session — its lifecycle, its window, its health. They are not a matchmaking interface and cannot be turned into one from here; nothing in the codebase reads or influences the game's own matchmaking state.

#### 5.3.3 Sanitised display buffers and coordinate matrices

| What | Location | Handle | Output |
| :--- | :--- | :--- | :--- |
| Capture coordinate ownership | `src/vision-frame.cjs` | `toCaptureRect`, `toPageRect`, `clampRect`, `checkCapture`, `describeFrame` | Conversions across four coordinate systems, clipping decisions, and the **achieved-density** verification (page CSS px → DIP capture rect → returned image → resized buffer) |
| Recognition grid | `src/vision-grid.cjs` | `parseTextGrid`, `gridText`, `describeGrid`, `overlapRatio`, `cleanText`, `LOW_CONFIDENCE` | Recognised lines → positioned cells with boxes, rows, per-token confidence, and a low-confidence count that is never silently trusted |
| Capture seam | `src/vision-pipeline.cjs` | `createVisionPipeline`, `handles()`, `read()`, `text()`, `describe()`, `BOTTOM_BAND`, `BAND_MAGNIFY` | One capture in; frame + sharp-dialect transform handles + parsed grid out. Rectangles are in sharp's `{left, top, width, height}` dialect so no caller translates |
| Surface location | `src/game-region.cjs` | scoring locator returning `{ok, reason, candidates[]}` | Scores every eligible canvas/iframe by aspect ratio and viewport coverage; lists the surfaces it saw on failure |
| Classification | `src/game-screen.cjs` | `classify()` / `classifyText()` | Screen category, confidence, matched phrases, evidence — **scores and evidence, never a bare guess** |
| OCR worker pool | `src/screen-reader-pool.cjs` | warm Tesseract workers, queue, idle retirement | Local OCR; language data pinned, never downloaded at runtime |

Two honest limits, recorded in ADR-0002 and ADR-0015 rather than glossed: the corpus in `test/fixtures/vision-corpus.json` is **derived layouts, not labelled ground truth** — 15 frames (8 derived from recorded screens, 7 negatives with no screenshot at all) against the ≥300 labelled frames ADR-0002's criterion 1 requires, so recognition accuracy is not yet measured against a standard; and the grid is built and tested but **not wired into the recognition path**, because changing what the classifier reads requires that measurement first. Region ranking is likewise unvalidated against the live site — one live pass would settle it, and the failure message lists the candidate surfaces so it can be fixed in one iteration.

#### 5.3.4 Telemetry, export and diagnostics

| What | Location | Handle |
| :--- | :--- | :--- |
| Ordered diagnostic timeline | `src/timeline-engine.cjs`, `src/timeline-query.cjs` | `compile`, `index`, `query`, `failures`, `summarise`, `fromTransitions`, `fromActivity`, `transitionLevel` |
| Metrics layers | `src/dashboard-telemetry.cjs` | `build`, `summarise`, `sessionLayer`, `storageLayer`, `describeLayer`, `LAYERS` |
| Redaction and scan | `src/telemetry-redaction.cjs`, `src/timeline-transfer.cjs` | `exportLayer`, `findSecrets`, `hasSecretShape`, `stripSecretShapes`, `scalars`, `SHAPES`, `redact`, `view` |
| The one exportable payload | `src/ipc.cjs` | `diagnostics:preview` — anonymised, scanned, and **refused** if it still carries a name, an address, a path or a token-shaped string |
| Per-profile measurement | `src/profile-diagnostics.cjs` | bounded directory walk, `report`, `measureDirectory`, `formatBytes`, `.tmp` sweep |
| Profile lifecycle | `src/profile-manager.cjs` | `initialise`, `inspect`, `repair`, `measure`, `delete`, `scan` |

#### 5.3.5 Configuration surface

| What | Location | Handle |
| :--- | :--- | :--- |
| The declaration | `src/config-schema.cjs` | `SETTINGS`, `ACCOUNT`, `IDENTITY`, `PROXY`, `SECTIONS`, `TABLES`, `LABELS`, `describeSchema()` |
| The boundary | `src/config-validator.cjs` | `validateSettings`, `validateAccountConfig`, `validateSessionProfile`, `validateSection`, `applySettingsDefaults`, `describeProblems` |
| The form binding | `src/settings-form-mapper.cjs`, `src/settings-form-values.cjs`, `src/settings-ui-controller.cjs` | `buildForm`, `readForm`, `nest`, `unset`, `specAt`, `controlId`, `route`, `form`, `describe` |

**Extension note:** an external tool that needs a new observable should add a channel in `src/ipc.cjs` behind the existing trust guard and a method in `src/preload.cjs`, not reach into main-process modules directly. The architecture test will fail a module that is unreferenced, impure where declared pure, or over 200 lines — so new work inherits those constraints automatically.

### 5.4 What remains genuinely unfinished (independent of the boundary above)

| Item | Milestone | Note |
| :--- | :--- | :--- |
| Labelled frame corpus (≥300 frames) + accuracy measurement | M3 remainder | ADR-0002 stays `Accepted (provisional)` until then; flipping it now would claim a measurement nobody took |
| Grid wired into the recognition path | M3 remainder | Blocked on the measurement above |
| Region ranking validated against the live site | M3 remainder | Needs one live pass from the user |
| Durable structured logs, diagnostics **bundle file**, frame timings, crash file | M4 remainder | The collation, ordering and redaction floor those pieces assemble through already exist and are tested |
| Bundle validated against three scripted failure scenarios | M4 remainder | Needs fault injection |
| Design tokens, component kit, i18n + extraction test, full a11y audit (keyboard, focus, contrast, reduced motion), command palette, per-session detail view, ≤100 ms p95 click→paint | M5 remainder | M5's acceptance criteria are **not** met and its exit gate is unverified |
| Account override UI | M5 remainder | The mapper and controller support the `account` section and it is tested; no view renders it yet |
| Fault injection + soak results, reproducible-build proof, signing/updater, threat model/SBOM | M6–M8 | Not started |
| GitHub remote for CI | M0 remainder | Needs a hand-off (H3) |

### 5.5 Reproducing this audit

*This document was produced from the tree at `8420e24`, and is itself committed in `b6f118b` — which is why `git log` shows a HEAD one commit ahead of the hash named in the header. Every figure above was captured before the commit that added this file.*

```bash
cd poolside
npm run verify           # lint + typecheck + 257 unit tests
npm run test:desktop     # 8 integration scenarios against real Electron
npm run test:persistence # 2 cross-restart checks
npm run package          # rebuild release/ (gitignored; goes stale with every src change)
./release/Poolside-win32-x64/Poolside.exe --self-test   # 8 PASS on the packaged binary
```

Operational traps worth knowing before running anything: a stray `electron.exe` holds the single-instance lock and makes the next run hang (`taskkill //F //IM electron.exe` clears it); the app exits before a piped `tail` can see a stack trace, so capture output to a file; the repo lives in OneDrive, where sync can lock `.git` mid-operation.

---

## Appendix A — Module inventory

*Generated from the working tree at HEAD `8420e24`. Line counts use the ceiling test's own measure
(`content.split('\n').length`).*

**61 modules · 7,432 lines · largest 200 (`workspace.cjs`, exactly at the ceiling) · 0 over the ceiling**

| Module | Lines | Purpose (from the module's own header) |
| :--- | ---: | :--- |
| `config-schema.cjs` | 185 | The configuration surface, declared once. |
| `config-validator.cjs` | 109 | The configuration boundary: which declarations a session is made of, and what its problems mean. |
| `config-walk.cjs` | 162 | Walking a declared configuration specification, generically. |
| `dashboard-telemetry.cjs` | 156 | The dashboard's metrics, collated into layers. |
| `display-geometry.cjs` | 60 | How a rectangle relates to a monitor layout: how much of it is visible, whether a user can re… |
| `errors.cjs` | 16 | Error helpers. |
| `footprint.cjs` | 170 | Apply a session's configured footprint — identity (identity.cjs) and route (proxy.cjs) — and… |
| `game-region.cjs` | 82 | Locates the game surface inside the page. |
| `game-screen.cjs` | 132 | (no header comment) |
| `geometry.cjs` | 154 | Remembered window geometry: restore, clamp, and per-monitor bounds. |
| `hardening.cjs` | 88 | Session and navigation policy. |
| `identity-fields.cjs` | 145 | The identity field grammar: which values are usable, and what a usable value looks like. |
| `identity.cjs` | 110 | Per-session identity configuration. |
| `inspection.cjs` | 123 | Screen inspection: locate the game surface, capture it, classify it, and report a state. |
| `ipc.cjs` | 172 | The IPC contract. |
| `layout.cjs` | 57 | Pure layout arithmetic for game windows. |
| `main.cjs` | 194 | Poolside — composition root. |
| `model.cjs` | 153 | The venue list is declared in the schema, so "which tables exist" has one home. This module r… |
| `network.cjs` | 38 | (no header comment) |
| `plist.cjs` | 93 | Minimal property-list writer and reader for Poolside's saved-session files. |
| `preload.cjs` | 26 | (no header comment) |
| `profile-diagnostics.cjs` | 190 | Measuring a profile: how much disk it occupies, and how that compares with its configured cei… |
| `profile-integrity.cjs` | 161 | Integrity checking for an account's carry-over file. |
| `profile-manager.cjs` | 198 | Profile lifecycle for one account: establish its storage, track a generation, check its integ… |
| `profile-paths.cjs` | 145 | Where an account's profile lives, and the guards that make deleting one safe. |
| `profile-removal.cjs` | 92 | Deleting one account's storage. The only destructive operation in the application. |
| `profile-repair.cjs` | 59 | Repair for a damaged carry-over file. |
| `profile-sweep.cjs` | 104 | Sweeping the storage directories: what is on disk that no account claims. |
| `profiles.cjs` | 85 | Saved browser profiles: restore an account's session on open and keep it saved afterwards. |
| `proxy.cjs` | 191 | Per-session proxy routes: storage shape, validation, and honest reporting. |
| `recovery-policy.cjs` | 66 | Recovery policy: how long to wait, how many times to try, and how to describe a failure. |
| `recovery.cjs` | 89 | Per-window recovery supervision: shop detection with automatic return, and post-load repaints. |
| `saved-session.cjs` | 129 | On-disk persistence for one account's carry-over session cookies. |
| `screen-reader-pool.cjs` | 113 | A small pool of screen readers. |
| `self-test-fixtures.cjs` | 142 | The fixture-session scenarios of the packaged self-test: navigation back to the game, automatic |
| `self-test-footprint.cjs` | 181 | Footprint assertions for the packaged self-test: what a session *claims* to be, read back out… |
| `self-test-profiles.cjs` | 130 | Profile management checks for --self-test. |
| `self-test.cjs` | 158 | The --self-test suite. |
| `session-config.cjs` | 63 | What a session is configured with, and applying it. |
| `session-cookies.cjs` | 127 | Cookie policy: which cookies this application is willing to carry between runs, and the shape of |
| `session-events.cjs` | 57 | What a session window's own events do to the session. |
| `session-fsm.cjs` | 166 | The session state machine. |
| `session-window.cjs` | 71 | Creating and measuring a session window: its remembered geometry, the displays that exist now… |
| `settings-form-mapper.cjs` | 166 | The settings form, derived from the declaration instead of written by hand. |
| `settings-form-values.cjs` | 122 | The values a form carries: what comes back from the controls. |
| `settings-ui-controller.cjs` | 131 | The settings form's backend: one command in, one safe state out. |
| `shop-recovery.cjs` | 45 | (no header comment) |
| `state.cjs` | 55 | Shared process-lifetime state. |
| `supervision.cjs` | 169 | Crash and stall supervision for one session window. |
| `target-identity.cjs` | 75 | The target half of a session footprint: the CDP overrides that make a *live page* claim a con… |
| `telemetry-redaction.cjs` | 169 | What may leave the machine. |
| `timeline-engine.cjs` | 133 | The diagnostic timeline: one ordered history, compiled from the two rings that already record… |
| `timeline-query.cjs` | 102 | Reading the compiled timeline: the questions a failure asks. |
| `timeline-transfer.cjs` | 93 | What may leave the machine. |
| `types.cjs` | 138 | Shared JSDoc typedefs. |
| `vision-frame.cjs` | 180 | Coordinate frames for a capture. |
| `vision-grid.cjs` | 183 | Parsing recognised text into a positioned grid. |
| `vision-pipeline.cjs` | 101 | The capture pipeline, as one object. |
| `window-arrange.cjs` | 40 | Arranging the open session windows into a grid on the primary display's work area. |
| `windows.cjs` | 188 | Account session windows: creation, arrangement and lifecycle. |
| `workspace.cjs` | 200 | The data layer: the persisted workspace document, the activity feed, and the snapshot the |



