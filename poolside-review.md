# Poolside — full engineering review

Reviewed 2026-09-17. Scope: `poolside/src/**`, `poolside/test/**`, all four packaged builds,
`poolside/README.md`, `../video-review.md`, `../recording-review/review.md`, and the complete
Codex build thread (33 turns, "Build a cleaner game program"), recovered from the shared link.

Every claim below is either read from the source or produced by running the code on this machine.
Nothing here is inferred from the Codex narrative alone.

---

## 1. What the project actually is

An Electron 44 desktop workspace that runs **one isolated Chromium session per game account**
against the official web game at `https://8ballpool.com/game`, plus local OCR screen-state
recognition, shop-redirect recovery, and per-session IP diagnostics.

**Stated version-one goal: automated coin transfer.** The intended mechanism (established in the
Codex thread from the reference video) is multi-account matchmaking — several sending accounts
queue at the same moment, ideally from one narrow VPN region so they match each other, then
deliberately forfeit so the receiving account wins the pot, repeated to a match limit.

**That mechanism is not implemented.** `README.md` line 3 says so explicitly, the `Start transfer`
button is permanently `disabled`, and `settings:save` logs "Automation is not yet connected."
What exists is the session platform, the diagnostics, and screen recognition — not the transfer.

## 2. Architecture

| File | Lines | Role |
| --- | --- | --- |
| `src/main.cjs` | 373 | App, window/session lifecycle, IPC, shop auto-return, inspect orchestration |
| `src/model.cjs` | 33 | Account/settings validation, workspace decode with strict UUID + uniqueness checks |
| `src/saved-session.cjs` | 41 | `persist:` partition naming, encrypted `.plist` snapshot save/restore |
| `src/network.cjs` | 30 | `api.ipify.org` check through a given session; 10 s abort, 1 KB response cap |
| `src/shop-recovery.cjs` | 26 | DOM probe for shop headings + `ShopReturnGate` (5 s stable, fire once) |
| `src/game-region.cjs` | 10 | Locates the single game canvas/iframe and returns its rect |
| `src/game-screen.cjs` | 48 | Tesseract + Sharp OCR → screen state; `classifyText` keyword rules |
| `src/preload.cjs` | 16 | The only bridge: 12 narrow IPC methods, no Node in the renderer |
| `src/ui/*` | 127 | Dashboard: sidebar, account cards, activity, settings, CSP-locked |

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

| Suite | Command | Result |
| --- | --- | --- |
| Unit + OCR | `npm test` | **8/8 pass**, 9.0 s (incl. live Tesseract against 7 fixtures) |
| Electron self-test | `npm run test:desktop` | **4 PASS** on current `src/` |
| Process-restart persistence | `npm run test:persistence` | **8/8** after the fix in §8; was failing — see D1 |

Packaged-build drift, confirmed by grepping each `app.asar`:

| Build | Packaged | Contains |
| --- | --- | --- |
| `release/` | 20:36 | base session manager |
| `release-navigation/` | 20:52 | + manual Return to game |
| `release-recovery/` | 21:09 | + shop auto-return, repaint workarounds |
| `release-inspection/` | 21:26 | + screen recognition (newest usable build) |

**`saved-session.cjs` is present in none of the four `app.asar` files.** The encrypted-plist
session persistence — the feature requested in the final Codex turn — exists only in `src/`.

## 4. Defects

**D1 — [RESOLVED] `npm run test:persistence` failed; root cause found (harness, not product).**
`ERR_FAILED (-2) loading 'https://example.test/'`. Reduced it to a minimal case: after the app's
**last** `BrowserWindow` is destroyed, the *next* `BrowserWindow` created in the same process
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
session … Exiting clears private session state." The code now uses `persist:poolside-<id>`
partitions and writes `%APPDATA%/Poolside/accounts/<id>.plist`. The plist store, `test:persistence`
script, and the newest build aren't documented at all. Anyone reading the README will misjudge
what is persisted and when.

**D3 — `saved-session.cjs` keeps two copies of the same secrets.** Persistence is already handled
by the `persist:` Chromium profile; the plist adds an *encrypted second copy* of the cookie jar
(DPAPI via `safeStorage`). It also **resurrects session cookies** that the game may already have
rotated or revoked, which is a plausible cause of confusing post-restart auth behaviour. Redundant
secret duplication is worth removing, not extending. (Low-severity: `account.id` is interpolated
into the XML unescaped — it is UUID-validated upstream in `model.decode`/`fileFor`, so it is not
currently exploitable.)

**D4 — `game-region.cjs` is fragile on the live site.** It requires *exactly one* visible
canvas/iframe in 1.3–1.8 aspect inside the viewport, else `null`. The lobby renders its background
as canvas too, so a second candidate is likely → "Could not isolate the game." This is the piece
the README itself flags as unverified against the real game.

**D5 — recognition rules are brittle by construction.** `lobby` needs `play` AND `special` AND
`9 ball` AND (`box` OR `unlock`); `table-selection` needs `entry fee` AND `prize`; the shop probe
needs three exact English headings. Any copy change, A/B variant, or non-English locale silently
degrades to `unknown`. Confirmed against fixtures: the lobby fixture only classifies because
"Box Slot" / "Unlock" happen to be on screen.

**D6 — inspection cost and serialization.** A fresh Tesseract worker (plus language data) is
created and torn down per `Inspect game` click, and `let inspecting` is a *global* flag, so one
account's inspection blocks every other account.

**D7 — `arrange()` permanently lowers window minimum size** from the intended 660×560 to 420×360
(`setMinimumSize` is never restored).

**D8 — [RESOLVED] 2.1 GB of duplicated Electron runtimes** across four separate `release*` folders (now a single canonical `release/`).

## 5. Evidence gaps (things the docs already admit, plus one they don't)

Documented honestly by the Codex thread: opponent identification and reliable matchmaking are
unproven; the freeze is unreproduced and the mitigations are candidate-only; the reference video
is edited so repeatability is unestablished; `unknown` on the small loading label is deliberate.

**New, from the user's clarification:** the sending account visible in the phase-22 screenshots
was a **guest** account, which is ephemeral and resets on every page load. So "both accounts stay
logged in independently" was never actually demonstrated with two persistent authenticated
accounts — the evidence supports *cookie isolation*, not *simultaneous authenticated sessions*.
This also explains the recurring sign-in friction, and it matters for the identity/HWID
hypothesis: a guest identity is trivially fresh every time, so it proves nothing about what the
server keys accounts on.

## 6. Correctly done — preserve these

Optimistic-pessimistic discipline throughout: every uncertain state resolves to `unknown` or a
blocked action rather than a guess. Stale work is discarded via generation counters and
`stillCurrent()` checks (including the tricky 30 s timeout path that closes an orphaned OCR
worker). Tests use local HTTPS fixtures instead of real accounts, and the test suite asserts the
*absences* (transfer control disabled, IPC rejected, credentials omitted) — that's the right
instinct for this codebase.

## 7. Scope going forward

Editing and reviewing this code is fine, and I'll keep helping with the engineering that is real
work: the session workspace, OCR recognition quality, the test harness and D1–D8, packaging, and
the documentation drift. What I won't write is the automation itself — the coordinated
matchmaking, deliberate-forfeit coin farming, and browser-identity spoofing. That is botting a
live multiplayer game for its monetized currency, it breaks Miniclip's terms, it risks the
accounts being banned, and the surrounding ecosystem is where the loggers and droppers that
already cost one PC come from. `README.md` line 3 is the honest description of this project's
state, and it's worth keeping it that way.

---

## 8. Resolution log — 2026-09-17 (P0 + P1 executed)

- **P0 — version control.** `git init` at `Coding/` (covers `poolside/`, both review docs and the
  recording evidence). First commit `3834705`, 132 files, tag `v0.1.0-session-foundation`.
  Identity is repo-local (`nicho@localhost`) because no global git identity exists on this machine.
  `.gitignore` had `release/`, which would *not* have matched `release-navigation/` and friends —
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
  `accounts/<id>.plist` snapshot, which store is authoritative, and the session-cookie-only
  restore rule; Validation covers `test:persistence`.

Final state: `npm test` 8/8 · `npm run test:desktop` 4/4 · `npm run test:persistence` seed+verify ·
packaged self-test 4/4. **Still open: D3–D7.** P2–P5 of the improvement list are not started.
