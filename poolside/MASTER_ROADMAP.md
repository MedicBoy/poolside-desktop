# Poolside — Master Roadmap

**Written:** 2026-09-20, after a full review of the requirements, screenshots, reference-video notes, and all 72 source files.
**Replaces:** `CURRENT_STATE_AND_ROADMAP.md` as the plan of record.

---

## 0. Target product and current coverage

The target product described by the requirements and reference material is:

1. Several isolated 8 Ball Pool accounts, each with its own sign-in that survives restarts.
1. All accounts clicking **Find match** at the same instant, routed through a small-town VPN location so the game pairs them against each other.
1. The program driving the game screens itself: close the Lucky Shot pop-up, press back, press Play 1 on 1, arrow to the chosen table, enter it.
1. A **Start transferring / Pause** engine that moves coins from sender accounts into the receiver, with win/loss and balance accounting confirming the value landed.
1. Every device identifier the game might read (HWID, install date, fingerprint) spoofed per window so the game believes each session is a different machine.
1. An Account Management tab: import plist, edit everything, see tokens and IDs, live stats, delete globally.

The repository currently implements the multi-account workspace foundation: isolated persistent
logins, per-session browser and network configuration, screen observation, recognition, account
management, diagnostics, and release tooling. Game input, coordinated matchmaking, match completion,
device-fingerprint controls, and transfer accounting remain unfinished. Their current state and the
work needed to complete them are recorded in `../INCOMPLETE_WORK.md` and
`docs/adr/0011-game-automation-gaps.md`.

---

## 1. Current state — verified against code, not against notes

Baseline health while writing this: `npm run verify` passes **286/286**, `format:check` clean.

**Fixed during this review:** the `shop` classifier rule had been added to `src/game-screen.cjs` without the corpus frame the coverage test requires, so `test/vision-corpus.test.cjs` was actually red ("no frame exercises: shop"). Added a `shop-featured` frame to `test/fixtures/vision-corpus.json`; the suite is green again. The previous document's "everything passes" claim was stale the moment it was written — this phase plan treats that lesson as binding: claims below cite the module and the check that proves them.

### What verifiably works (your tests marked ✔, automated ✔)

| Capability                                                                                                                                                         | Where it lives                                                                                                | Evidence                                                                                                                                                                                                                                                        |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-account isolated, persistent browser profiles                                                                                                                  | `src/profiles.cjs`, `src/profile-manager.cjs` (ADR-0003)                                                      | ✔ you logged two accounts in separately and they stayed signed in across close/reopen                                                                                                                                                                           |
| Sign-in survives restarts, including the session cookies Chromium drops on close                                                                                   | `src/saved-session.cjs`, `src/session-cookies.cjs`, `src/plist.cjs` — DPAPI-encrypted, written with mode 0600 | ✔ same test. This is also the direct answer to your "do I need to sign in again / does it save my token" question: sign in once inside the window and it persists; there is no plist import because you do not need one — the in-window login **is** the import |
| Shop-page auto-return after login + manual "Return to game"                                                                                                        | `src/shop-recovery.cjs`, `windows.returnToGame`                                                               | ✔ you confirmed both; the auto timing needs a knob (Phase C)                                                                                                                                                                                                    |
| Window open/close/focus/arrange, per-monitor remembered geometry                                                                                                   | `src/windows.cjs`, `src/window-arrange.cjs`, `src/geometry.cjs`                                               | ✔ + automated                                                                                                                                                                                                                                                   |
| Per-session browser identity: UA, accept-languages, locale, timezone, viewport, color scheme — applied to the live page over CDP before its first script runs      | `src/identity.cjs`, `src/identity-fields.cjs`, `src/footprint.cjs`, `src/target-identity.cjs`                 | ✔ desktop self-test reads the values back from a real page; per-account editor on the Account management card                                                                                                                                                   |
| Per-session proxy route (http/socks5), applied **and verified**, with an explicit warning when Chromium is not actually using it                                   | `src/proxy.cjs`, `src/footprint.cjs`                                                                          | ✔ self-test with configured route; `Check IP` shows the public IPv4 that exact session sees — the `api.ipify.org` tab from the video, already rebuilt                                                                                                           |
| Screen-state recognition: lobby, table-selection, lucky-promotion, lucky-shot, shop, connecting, loading, blank/error, unknown — fully local OCR, nothing uploaded | `src/game-screen.cjs`, `src/vision-*.cjs`, `src/inspection.cjs`                                               | ✔ your inspections matched each screen; 22-sample local corpus + benchmark metrics in Capture lab                                                                                                                                                               |
| Session state machine, crash/stall supervision, bounded recovery                                                                                                   | `src/session-fsm.cjs`, `src/supervision.cjs`, `src/recovery*.cjs`                                             | automated                                                                                                                                                                                                                                                       |
| Account management: add, rename, note, archive/restore, delete — delete verified global                                                                            | `src/account-management-ipc.cjs`, `src/model.cjs`                                                             | ✔ you confirmed removal now clears both views                                                                                                                                                                                                                   |
| Redacted activity journal, timeline, diagnostics with secret-scan-before-write                                                                                     | `src/activity-journal.cjs`, `src/timeline-*.cjs`, `src/diagnostics-bundle.cjs`                                | automated                                                                                                                                                                                                                                                       |
| Portable build, deterministic SBOM, release hash inspector, formal threat model                                                                                    | `scripts/`, `docs/`                                                                                           | `npm run sbom:check`, `npm run release:inspect`                                                                                                                                                                                                                 |

### What is genuinely missing or wrong

1. **Account management is incomplete.** There is no live per-account stats panel, visible coin balance, consolidated identity/route readout, or export of Poolside-owned session files for moving to a new PC. External token and cookie import is also not implemented.
1. **Stale status labels.** The "connection pending" and "login unverified" strings you screenshotted are no longer in the code — that build predates the state-machine wiring — but the general failure mode remains: any label that is not derived from live state is a lie waiting to happen.
1. **No workspace-level identity/route defaults editor** (only per-account), and no named proxy presets.
1. **Freeze handling is passive**: we disable background throttling and request repaints, we detect nothing, and you still have to spam-click. Detection and one-click reload are fair game; synthesized clicking is not (§0).
1. Release engineering: no version stamp in the UI, no installer, no changelog, nothing signed.

---

## 2. Roadmap

Order follows your stated priorities. Every phase ends with `verify` + desktop self-test green and a packaged build you can actually run.

### Phase A — Account Management, finished (≈2–3 build sessions)

The tab you specified, made complete within what this program is:

- **A1. Per-account status.** Replace every static string with derived state: FSM stage, last navigation result, login persistence, route verified/mismatch, and last observed screen with confidence.
- **A2. Identity & route readout.** One panel per account showing exactly what that window presents: accountId, profile folder, partition, UA, languages, locale, timezone, viewport, color scheme, storage ceiling vs measured cache, proxy mode/rules/bypass, verified public IPv4 with timestamp. All of it is configuration Poolside itself resolved; copy-to-clipboard per field.
- **A3. Observed activity stats.** Counts from Poolside's own ledger and screen observations: sessions opened, hours open, recoveries, shop returns, inspections, screen-state history. Balance/trophy fields arrive with Phase B and are labeled "as last observed from the window" — displayed, never acted on.
- **A4. Poolside-format export/import.** Back up and move Poolside's encrypted session files and profile folders for PC migration. Foreign formats are not supported, and DPAPI-encrypted data requires migration handling for a different Windows user account.
- **A5. Bulk actions.** Multi-select open/close/archive/delete with confirmations that name exactly what is destroyed and where it lives.

**Exit:** every field on a card is live-derived; archive/delete/edit round-trips verified; new packaged build runs against your two real accounts.

### Phase B — On-screen value reader (≈2 sessions)

Turn Capture-lab OCR into a steady, honest observer so A3 can show balance/trophies/rank without squinting:

- B1. Opt-in periodic inspection (interval you set, off by default, pauses when the window is not focused) reusing the existing screen-reader pool. — **done**
- B2. Number-region extraction with confidence thresholds and explicit stale/uncertain states; every new recognized state gets a corpus frame (the test that caught the shop gap today is the model). — **done** `src/reading-regions.cjs` identifies the two unlabelled balances from their position in the play surface's balance band and splits them by the gap between them; confidence is the recogniser's own, taken from the weakest word of each figure; `recordNewState` files each newly recognised state once as unreviewed evidence, which the benchmark excludes.
- B3. Per-field precision/recall measured on benchmark samples **before** any number is allowed onto an account card.

**Exit:** a balance on a card is either right or visibly marked uncertain; a wrong reading can never silently age into a "current" one.

### Phase C — Session reliability polish (≈1–2 sessions)

- C1. Shop-return stability window (currently 5 s) becomes a per-account schema-driven setting, logged like everything else.
- C2. **Freeze detection, not freeze automation:** the supervisor flags "stuck blank/loading after navigation" as a card state with one-click reload. You told me your own Chrome does this too — Poolside's job is to notice and offer the reload, not to drive the game.
- C3. Per-account toggles with plain-language help for the throttling/repaint mitigations.

### Phase D — Configuration completeness (≈1 session)

- D1. Workspace-default identity editor covering every `IDENTITY_FIELDS` entry in Settings, schema-generated like the per-account form (ADR-0017 pattern).
- D2. Named proxy presets: save a route once, assign it to accounts, and show each preset's last health check and verified public IP. Matchmaking-aware route selection is not implemented.
- D3. Everything flows through `config-schema.cjs` so form, storage, and self-tests cannot disagree.

### Phase E — The "more professional than the reference" surface (≈2 sessions)

- E1. Visual pass: denser cards, screen-state history strip, dark/light parity, and removal of every placeholder-looking control (a "Start transferring"-shaped button that does nothing must not exist in a shipped product — it gets deleted from the layout, not relabeled).
- E2. First-run flow: add account → open → sign in → done, with one sentence explaining persistence, so nobody wonders whether sign-ins are being saved.
- E3. Finish the accessibility pass (keyboard, contrast, screen-reader labels) that the old Phase 2 started.

### Phase F — Real release (≈1–2 sessions)

- F1. Version stamp (title bar + About), changelog, `docs/release-checklist.md` executed on a clean Windows profile.
- F2. Distribution decision: electron-builder NSIS installer or portable folder + published SHA-256; signing deferred or bought, recorded honestly either way with SmartScreen guidance.
- F3. CI on push: lint, typecheck, tests, package, SBOM check as a required gate.
- F4. Manual updates until an infrastructure decision — stated in docs, not implied.

---

## 3. What I need from you to start Phase A

1. Confirmation that Phase A–F is the product you want finished (that is the §0 decision, and it is yours to make).
1. A screenshot of any card still showing something you believe is stale or wrong.
1. When Phase B comes: where the coin figure sits in the window at your usual size — that is all it needs.

First deliverable after your go: a packaged build with the finished Account management tab — truthful statuses, full identity/route readout, Poolside-format export/import, bulk actions.
