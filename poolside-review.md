# Poolside — full engineering review

Reviewed 2026-09-17. Scope: `poolside/src/**`, `poolside/test/**`, all four packaged builds,
`poolside/README.md`, `../video-review.md`, `../recording-review/review.md`, and the available
project requirements and build history.

Every claim below is either read from the source or produced by running the code on this machine.

---

## 1. What the project actually is

An Electron 44 desktop workspace that runs **one isolated Chromium session per game account**
against the official web game at `https://8ballpool.com/game`, plus local OCR screen-state
recognition, shop-redirect recovery, and per-session IP diagnostics.

**Stated version-one goal: automated coin transfer.** The intended mechanism (established in the
project requirements and the reference video) is multi-account matchmaking — several sending accounts
queue at the same moment, ideally from one narrow VPN region so they match each other, then
deliberately forfeit so the receiving account wins the pot, repeated to a match limit.

**That mechanism is not implemented.** `README.md` line 3 says so explicitly, the `Start transfer`
button is permanently `disabled`, and `settings:save` logs "Automation is not yet connected."
What exists is the session platform, the diagnostics, and screen recognition — not the transfer.

## 2. Architecture

| File                    | Lines | Role                                                                               |
| :---------------------- | :---- | :--------------------------------------------------------------------------------- |
| `src/main.cjs`          | 373   | App, window/session lifecycle, IPC, shop auto-return, inspect orchestration        |
| `src/model.cjs`         | 33    | Account/settings validation, workspace decode with strict UUID + uniqueness checks |
| `src/saved-session.cjs` | 41    | `persist:` partition naming, encrypted `.plist` snapshot save/restore              |
| `src/network.cjs`       | 30    | `api.ipify.org` check through a given session; 10 s abort, 1 KB response cap       |
| `src/shop-recovery.cjs` | 26    | DOM probe for shop headings + `ShopReturnGate` (5 s stable, fire once)             |
| `src/game-region.cjs`   | 10    | Locates the single game canvas/iframe and returns its rect                         |
| `src/game-screen.cjs`   | 48    | Tesseract + Sharp OCR → screen state; `classifyText` keyword rules                 |
| `src/preload.cjs`       | 16    | The only bridge: 12 narrow IPC methods, no Node in the renderer                    |
| `src/ui/*`              | 127   | Dashboard: sidebar, account cards, activity, settings, CSP-locked                  |

### Data flow

`renderer → preload bridge → ipcMain.handle → trusted() check → model validation → atomic write`
with `workspace:changed` snapshots pushed back on every mutation.

### Security posture — genuinely good

- `trusted()` verifies sender **and** `senderFrame` **and** frame URL before any IPC runs.
- Game windows: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload.
- `will-navigate`/`will-redirect` reject anything non-HTTPS; `will-download` always blocked;
  all permission requests and checks denied.
- Popups inherit the account's session but are re-hardened recursively.
- Workspace writes are `tmp` + `rename` (atomic), `mode 0600`; a corrupt file flips the app to
  read-only instead of overwriting user data.
- Dashboard has a strict CSP (`connect-src 'none'`), all interpolated text is HTML-escaped.
- OCR returns only `{ state, observedAt }` — recognized names/balances are discarded on purpose.
- IP addresses are held in memory only and never written to `workspace.json`.

## 3. Verified by execution on this machine

| Suite                       | Command                    | Result                                                        |
| :-------------------------- | :------------------------- | :------------------------------------------------------------ |
| Unit + OCR                  | `npm test`                 | **8/8 pass**, 9.0 s (incl. live Tesseract against 7 fixtures) |
| Electron self-test          | `npm run test:desktop`     | **4 PASS** on current `src/`                                  |
| Process-restart persistence | `npm run test:persistence` | **8/8** after the fix in §8; was failing — see D1             |

Packaged-build drift, confirmed by grepping each `app.asar`:

| Build                 | Packaged | Contains                                   |
| :-------------------- | :------- | :----------------------------------------- |
| `release/`            | 20:36    | base session manager                       |
| `release-navigation/` | 20:52    | + manual Return to game                    |
| `release-recovery/`   | 21:09    | + shop auto-return, repaint workarounds    |
| `release-inspection/` | 21:26    | + screen recognition (newest usable build) |

**`saved-session.cjs` is present in none of the four `app.asar` files.** The encrypted-plist
session persistence — a late addition to the requirements — exists only in `src/`.

## 4. Defects

**D1 — [RESOLVED] `npm run test:persistence` failed; root cause found (harness, not product).**
`ERR_FAILED (-2) loading 'https://example.test/'`. Reduced it to a minimal case: after the app's
**last** `BrowserWindow` is destroyed, the _next_ `BrowserWindow` created in the same process
fails to load with `ERR_FAILED (-2)` — for any partition, with or without a `protocol.handle`
fixture, even a `data:` URL. Keeping one window alive throughout makes every subsequent window
load fine (`keepalive w0 OK / w1 OK` vs `zerowindows w0 OK / w1 FAILED`). The same run logged
`GPU state invalid after WaitForGetOffsetInRange`, so this looks like compositor teardown when
the window count hits zero. `test/session-restart.cjs` destroys its window inside the loop and so
trips it on account 2. **The product is not affected** — the dashboard window always stays alive
while Poolside runs, and the self-test passes for exactly that reason. Fix is test-side: keep a
hidden keep-alive window (or don't destroy between accounts). Until then, the persistence feature
is **unverified end-to-end**.

**D2 — [RESOLVED] README contradicted `src/`.** README lines 24–25 still claim "separate in-memory Chromium
session … Exiting clears private session state." The code now uses `persist:poolside-`
partitions and writes `%APPDATA%/Poolside/accounts/.plist`. The plist store, `test:persistence`
script, and the newest build aren't documented at all. Anyone reading the README will misjudge
what is persisted and when.

**D3 — `saved-session.cjs` keeps two copies of the same secrets.** Persistence is already handled
by the `persist:` Chromium profile; the plist adds an _encrypted second copy_ of the cookie jar
(DPAPI via `safeStorage`). It also **resurrects session cookies** that the game may already have
rotated or revoked, which is a plausible cause of confusing post-restart auth behaviour. Redundant
secret duplication is worth removing, not extending. (Low-severity: `account.id` is interpolated
into the XML unescaped — it is UUID-validated upstream in `model.decode`/`fileFor`, so it is not
currently exploitable.)

**D4 — [RESOLVED]** `game-region.cjs` was fragile on the live site. It requires _exactly one_ visible
canvas/iframe in 1.3–1.8 aspect inside the viewport, else `null`. The lobby renders its background
as canvas too, so a second candidate is likely → "Could not isolate the game." This is the piece
the README itself flags as unverified against the real game.

**D5 — [RESOLVED]** recognition rules were brittle by construction. `lobby` needs `play` AND `special` AND
`9 ball` AND (`box` OR `unlock`); `table-selection` needs `entry fee` AND `prize`; the shop probe
needs three exact English headings. Any copy change, A/B variant, or non-English locale silently
degrades to `unknown`. Confirmed against fixtures: the lobby fixture only classifies because
"Box Slot" / "Unlock" happen to be on screen.

**D6 — [RESOLVED]** inspection cost and serialization. A fresh Tesseract worker (plus language data) is
created and torn down per `Inspect game` click, and `let inspecting` is a _global_ flag, so one
account's inspection blocks every other account.

**D7 — [RESOLVED]** `arrange()` permanently lowered window minimum size from the intended 660×560 to 420×360 (`setMinimumSize` was never restored).

**D8 — [RESOLVED] 2.1 GB of duplicated Electron runtimes** across four separate `release*` folders (now a single canonical `release/`).

## 5. Evidence gaps (things the docs already admit, plus one they don't)

Documented in the project history: opponent identification and reliable matchmaking are
unproven; the freeze is unreproduced and the mitigations are candidate-only; the reference video
is edited so repeatability is unestablished; `unknown` on the small loading label is deliberate.

**New, from the user's clarification:** the sending account visible in the phase-22 screenshots
was a **guest** account, which is ephemeral and resets on every page load. So "both accounts stay
logged in independently" was never actually demonstrated with two persistent authenticated
accounts — the evidence supports _cookie isolation_, not _simultaneous authenticated sessions_.
This also explains the recurring sign-in friction, and it matters for the identity/HWID
hypothesis: a guest identity is trivially fresh every time, so it proves nothing about what the
server keys accounts on.

## 6. Correctly done — preserve these

Optimistic-pessimistic discipline throughout: every uncertain state resolves to `unknown` or a
blocked action rather than a guess. Stale work is discarded via generation counters and
`stillCurrent()` checks (including the tricky 30 s timeout path that closes an orphaned OCR
worker). Tests use local HTTPS fixtures instead of real accounts, and the test suite asserts the
_absences_ (transfer control disabled, IPC rejected, credentials omitted) — that's the right
instinct for this codebase.

---

## 8. Resolution log — 2026-09-17 (P0 + P1 executed)

- **P0 — version control.** `git init` at `Coding/` (covers `poolside/`, both review docs and the
  recording evidence). First commit `3834705`, 132 files, tag `v0.1.0-session-foundation`.
  Identity is repo-local (`nicho@localhost`) because no global git identity exists on this machine.
  `.gitignore` had `release/`, which would _not_ have matched `release-navigation/` and friends —
  changed to `release*/` before the first `add`, so no Electron binaries entered history
  (verified: 0 matches).
- **P0 — build folders.** `release-navigation`, `release-recovery` and `release-inspection` removed
  after grep-confirming that `release-inspection` already contained every earlier feature
  (`returnToGame`, `backgroundThrottling`, `ShopReturnGate`, `GAME_REGION_PROBE`, `classifyText`),
  so no capability was lost. `poolside/` went 2.1 GB → 948 MB.
- **P1.1 — D1 fixed.** `test/session-restart.cjs` holds a hidden keep-alive window for the run.
  `npm run test:persistence` now reports PASS for both `seed` and `verify`, so the plist
  persistence path is verified across a real process restart for the first time.
- **P1.2 — packaging fixed.** `release/` rebuilt from current `src/`: the first packaged build to
  contain `saved-session.cjs` (grep-verified), with native deps at
  `resources/app.asar.unpacked/node_modules`. Packaged `Poolside.exe --self-test` reports 4 PASS.
- **P1.3 — D2 fixed.** The README now documents the `persist:` profile, the
  `accounts/.plist` snapshot, which store is authoritative, and the session-cookie-only
  restore rule; Validation covers `test:persistence`.

Final state: `npm test` 8/8 · `npm run test:desktop` 4/4 · `npm run test:persistence` seed+verify ·
packaged self-test 4/4. **Still open: D3–D7.** P2–P5 of the improvement list are not started.

---

## 9. Resolution log — 2026-09-17 (D4–D7 wave)

Executed ahead of M1/M3 because all four were real defects with no milestone dependency.

- **D7 — closed.** New pure module `src/layout.cjs` (`tileGeometry`, `rectFor`). The per-window
  minimum now tracks the tile and is clamped so it can never exceed it (a minimum larger than the
  tile made `setBounds` clamp and rows overlap), and arranging a single window restores the
  660×560 default. Cramped grids log a warning instead of silently clamping. 7 unit tests,
  including the explicit 8-windows-then-1-window restore regression.
- **D4 — closed.** `game-region.cjs` rewritten to score every eligible surface (shape distance to
  16:9 weighted 0.65, viewport coverage 0.35) and to return `{ok:false, reason, candidates[]}`.
  `main.cjs` renders that into a message naming the surfaces it saw. Two new self-test assertions
  cover four canvases (game surface + clipped + tiny + hidden) and an unusable-surface failure
  that must report `120×60`. **The ranking is still unvalidated against the live site** — that
  remains an M3 task, now with the diagnostics to settle it in one pass.
- **D5 — closed.** `classify()` returns `{state, score, evidence, alternatives}`; `classifyText()`
  is retained as a thin wrapper. Deliberately **behaviour-preserving**: the gates are the original
  conditions unchanged, with `hints` contributing to evidence but never to the decision. The
  regression test embeds the legacy regex chain and asserts agreement over a 30+ string corpus —
  it caught the rewrite dropping `\b` semantics (`"Reconnecting to the server"` would otherwise
  have matched `connecting`), which is now fixed with boundary-aware matching.
- **D6 — closed.** New `src/screen-reader-pool.cjs`: warm worker pool with queueing, idle
  retirement and injectable factory. `main.cjs` holds one pool; the global `inspecting` flag is
  replaced by a per-account flag, so one account's inspection no longer blocks the others. 7 pool
  tests, including "five inspections, one worker" and "queued work is served on release".

**Verification after the wave:** `npm test` **33/33** (was 8) · `npm run test:desktop` **6 PASS**
(was 4) · `npm run test:persistence` seed+verify. New modules: `layout.cjs` 51 lines,
`screen-reader-pool.cjs` 100, `game-region.cjs` 80, `game-screen.cjs` 113.

**Note:** `main.cjs` is now 419 lines and over the roadmap's 200-line cap. That is expected — the
self-test grew and `describeRegionFailure` was added — and it is exactly what M0/M1's modularisation
is for. It should not grow further before `inspection.cjs` and the self-test are extracted.

**Still open: D3** (duplicate cookie stores) plus the whole of M0–M9.
