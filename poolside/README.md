# Poolside — session preview

A Windows desktop foundation for the requested 8 Ball Pool tool. This build manages isolated browser sessions. **Automated coin transfers, opponent recognition, VPN configuration, and per-session device-fingerprint controls are not implemented.** The overall version-one goal is not complete.

For the exact build's available, limited, dry-run, and unavailable functions, see the [generated capability report](docs/CAPABILITIES.md). The [preview support boundary](docs/support-policy.md) distinguishes the intended Windows/game/display environment from configurations actually qualified by release testing. [The work-item register](docs/work-items.json) tracks all 142 final-product deliverables; only evidence-backed items are closed. The app's About view reads the same capability registry used to generate that report. A ready browser window never proves authentication, pairing, match completion, or recognition accuracy.

## Run

Open `release/Poolside-win32-x64/Poolside.exe` after packaging, or use `npm install` followed by `npm start` from this folder for development. `npm run package` creates the portable application folder; keep its supporting files beside the executable.

## First session test

1. Add a receiving account slot and a sending account slot.
2. Open both windows and sign into your own accounts directly in the game.
3. Verify that opening and signing into the second account does not log out the first.
4. Report any login failure or browser-compatibility error. Do not share passwords, cookies, or tokens.

The app reports a window as open, not an account as authenticated. Authentication and opponent detection are not verified in this build. Embedded-browser compatibility and authentication-challenge handling still require implementation and testing.

A new workspace shows **Set up your first session** — the steps that lead to two open, separately signed-in windows, derived from the workspace rather than written into the page. Once there is something wrong to say, that panel is replaced by **Needs your attention**, which names the problem and the control that fixes it: a workspace that could not be saved, a value the browser refused, a session that failed to load, a route that is not in use, a match still recorded as in progress with nothing open behind it. Both panels hide themselves when they have nothing to say.

Before a match is released, the dashboard shows a **run dashboard** — readiness, the attempt count, the measured click skew between the two windows, how old the last observation is, why the run stopped, and the next action — and a three-step count-in so both windows are released together. When a run is over, **Save a report of these runs** writes what was recorded (the plan, who played whom, each pairing verdict, and what the balances did around each match) to a local file; the file states its own limits and carries no route credentials, browser profiles, page text or images.

If signing in lands on the web shop, Poolside now checks for the visible English shop headings on the official site. After they remain present for five seconds, it navigates the same window back to the game once per window opening. A visible password field, dialog, or large game canvas/iframe prevents this detection. This is a text-based heuristic, not authenticated-login detection. Different shop wording or layouts may require the manual **Return to game** control. The manual control also disables further automatic returns for that window. Avoid using it during a match.

Game windows now disable background timer/animation throttling and request several repaints after page load, plus a repaint on focus. These are candidate workarounds for the reported freeze, which the user also observes in ordinary Chrome. They are not a verified freeze fix and may increase background resource use. No random clicks or window dragging are generated.

## Data and behavior

- Account names, roles, and preferred table/limit are stored locally in `%APPDATA%/Poolside/workspace.json` (Electron's user-data folder).
- **Configuration is validated against a declared schema before it is used** (ADR-0008, ADR-0014). Saving preferences checks the whole settings object first: a value of the wrong type — an unknown table, a match limit outside 1–100, a missing required field — is refused and the reason is shown. A value that is the right shape but unusable, such as a time zone the browser does not know, or an unrecognised key, is left out and reported in the activity feed. Nothing is silently discarded, which is what used to happen. A session's configuration is checked again immediately before it is applied, so what a session runs with is what was validated.
- Every account has its own persistent Chromium profile (`persist:poolside-<account id>`), so cookies and site storage survive closing a window, closing the app, and restarting the PC. Closing a game window keeps that session available until the entire app exits.
- Alongside the profile, each account gets an encrypted carry-over file at `%APPDATA%/Poolside/accounts/<account id>.plist`. It exists for one reason: Chromium drops **session** cookies when it closes. The file therefore holds _only_ session cookies — never the persistent ones the profile already stores, so no secret is written twice. Its payload is a blob encrypted with Electron `safeStorage` (Windows DPAPI); nothing in it is readable without the Windows user account that wrote it. It is rewritten when cookies change and again on exit.
- The profile is the authoritative store, and it wins wherever the two could disagree: restore never overwrites a cookie the profile already has, so a value the game has rotated is never replaced by an older snapshot. See `docs/adr/0004-session-storage-authority.md`.
- **Profile management.** Opening an account establishes its storage and counts a _generation_: how many times that storage directory has been created or recreated. The counter does not move on an ordinary open. On startup, Poolside preserves interrupted-write files, reports profile storage that no current account claims without deleting it, then checks every account's carry-over file and logs one summary line. Browser-profile and encrypted session-cookie storage is deleted only by an explicit account/profile removal.
- A damaged carry-over file is **quarantined, never deleted**: it is renamed to `<account id>.plist.corrupt-<timestamp>`, the damage is recorded against the account, and the dashboard shows the count. The Chromium profile still holds every persistent cookie, so the worst case is signing in again — which is what the message says, rather than claiming a recovery. Workspace saves validate and flush a staged document and retain one local `.previous` copy where safe. A malformed or missing `workspace.json` with recovery material puts the app into read-only mode; it never silently loads an older account list. **Recover earlier data** in Settings previews those copies, asks for native confirmation, and restores the chosen valid copy after all account windows close. A damaged primary is preserved byte for byte as `workspace.json.unreadable-<id>` before replacement. If the copy changes after confirmation, recovery stops so it can be previewed again.
- **Poolside backup and restore.** A backup records checksums for its workspace file, encrypted session files, and each copied browser profile. Restore verifies those records and checks all destination conflicts before staging files; if a workspace save fails, it removes the files it added. Older backups without profile checksums receive size and file-count checks. The encrypted session files remain tied to the Windows account that created them. Portable encryption and a crash-atomic restore are still unfinished.
- **Delete profile** on an account card removes that account's cookies, site storage, carry-over file and quarantined copies from this PC. It is the only irreversible action in the app, so it asks for confirmation in a native dialog, it is refused while that session is open (the control is disabled and says why), and it never reports success for a partial removal. The account record stays; only its stored profile goes.
- Each account's profile size on disk is measured and shown against the `quotaBytes` ceiling from its identity configuration. That ceiling is **reported, not enforced** — Electron exposes no per-session storage quota to enforce it with. The measurement is capped at 5000 files per profile and shown as "or more" when it stops early; an unreadable file is reported as unknown rather than as zero. See `docs/adr/0013-profile-lifecycle-and-repair.md`.
- Game windows have no Node.js access or Poolside preload bridge. HTTPS login popups use the same isolated session as their account. HTTP/custom-protocol navigation and downloads are blocked in the game windows.
- The dashboard renderer makes no external requests. Its Check IP action asks the main process to contact ipify through the selected game session. Game windows load the official website, its providers, and its third-party content.
- Activity is a local, bounded troubleshooting journal of up to 200 redacted application messages. It records session actions, not credentials or complete navigation URLs; account labels, paths, IP addresses, and token-shaped strings are removed before saving. **Erase saved activity history** removes it without affecting browser profiles or saved sign-ins.
- **Files Poolside has written.** Every diagnostics export and run report the operator saves lands in one folder under `%APPDATA%/Poolside/diagnostics`. Settings → **Files Poolside has written** lists them by name, size and time — never by path — reports how many files in that folder Poolside did not write and therefore left alone, and **Erase these files** removes them behind a native confirmation. It is the only control that touches that folder, and it erases only names this application writes, only strictly inside the folder; a backup is never stored there, because a backup inside the data directory it backs up is refused when the folder is chosen.
- **Two sessions, side by side.** When two sessions are open, the Sessions view can compare them: **Do these sessions look like one machine?** reads ten values from each session's own page — user agent, language and accepted languages, time zone, locale, viewport, screen size, colour scheme, reported processor cores and device memory — and marks every field the same or different, naming the shared ones. It is asked for rather than continuous, it changes nothing, and its wording states its ceiling: what those pages report on this machine, not a promise about how any website treats them. A value nobody reported, or a session that could not be read, is excluded rather than counted as a match. Beside each match's pairing verdict, a note states what the two accounts are _configured_ to look like, and points here for what they actually report (ADR-0020).
- Archive hides an account slot while preserving its local profile and metadata. Account management lists archived slots separately, where Restore returns a slot to the active workspace or Remove permanently deletes it and its local profile.
- Account management supports an optional 500-character **Local note** per account. Notes are stored only in the local workspace document, are never collected from browser pages, and are never used to automate or control the game. Do not place passwords, tokens, or private information in notes.
- There is no updater, bundled VPN, token importer, or remote code/configuration loader.

## Validation

`npm test` checks model constraints, saved-data validation, IP response/error handling, shop-return gating, screen classification, the profile subsystem (path safety, the integrity verdicts, measurement, and lifecycle against a temporary directory), and the configuration schema layer — where the declaration is cross-referenced against the storage structures field for field, against a real `decode` round trip, and verdict-for-verdict against the hand-written settings validator it sits in front of. `npm run test:desktop` launches an isolated test workspace and checks actual Electron cookie-store separation between two sessions, cookies retained when a window reopens, the sandbox boundary, IPC account validation, metadata saving, IP controls for closed windows, per-session identity read back from `navigator` and `Intl`, and the profile lifecycle end to end — generation counting, a real measurement of real bytes against a configured ceiling, a damaged saved session quarantined and counted, and an explicit delete refused while the session is open before removing the directory, the files and the record. Add `-- --live-ip-check` to contact the real IP service through a test session. `npm run test:persistence` runs two separate Electron processes — one seeds, one verifies — to prove that each account's cookies, session cookies and `localStorage` survive a full app restart independently of the other. These checks do not prove real-game login, opponent pairing, or transfer behavior.

Read `docs/threat-model.md` for the data-handling, threat, and residual-risk review, and
`docs/SBOM.cdx.json` for the locked runtime dependency inventory. Run `npm run sbom` after changing
the lockfile; `npm run sbom:check` verifies that the checked-in inventory is still reproducible. Read
`../video-review.md` for the reference evidence and remaining uncertainties.

## Screen recognition development

Opening a game window starts local screen observation automatically while that window is focused. **Inspect game** on an open account card also requests an immediate reading and runs `src/game-screen.cjs` locally. The locator (`src/game-region.cjs`) scores every visible canvas/iframe by how closely it matches the game's aspect ratio and by how much of the viewport it covers, then picks the best candidate; a page with several surfaces no longer fails just for having several. When nothing is usable it reports why and lists the surfaces it saw, so a wrong choice is diagnosable. That ranking still needs verification against the real game. Results are timestamped observations, not proof of responsiveness or permission to start a match. An ordinary observation is not saved, and no gameplay input is sent. The separate **Capture lab** can save a user-approved game-region image and its minimal expected-versus-observed result locally for recognition evaluation. Its expected-screen list contains only the seven real screens. A table-selection capture also requires a separate table target from the shared supported-table catalog. Cards and coverage reports show the user-saved expected table separately from any table name OCR detected; table targets are not represented as invented screen states. When you explicitly label a sample as **Shop**, it captures the visible official shop page instead because that page does not contain the game canvas or iframe. Identical image captures are refused so accidental repetition cannot inflate the evaluation count. A user can set aside a reviewed capture as a **Benchmark**; that set is kept out of coverage counts and produces a separate per-label precision, recall, F1, sample-count, and successful-detection report. The production gate uses only this held-out set and checks its size, per-label and per-table coverage, unique images, accuracy, macro F1, unrecognized rate, review queue, and p95 timing. The collection matrix and reporting procedure are in [`docs/live-validation-runbook.md`](docs/live-validation-runbook.md). Missing denominators are displayed as unavailable, not zero. Newly captured samples also retain local surface-capture, OCR, and total elapsed times; the lab shows medians and each sample’s timing. The local sample directory can be filtered by expected screen, evidence/benchmark set, and whether the OCR result agrees with both the label and table target. These are measurements against user-supplied labels, not a claim of live-game accuracy or a performance guarantee. It requires an explicit confirmation that the screen has no passwords, sign-in fields, tokens, private messages, or other sensitive content; each sample can be reviewed and permanently deleted from the lab. Capture files live under `%APPDATA%/Poolside/recognition-lab/` and are never sent anywhere. Their manifest accepts only a fixed recognition-metadata allowlist; browser-page text, account information, cookies, routes, and arbitrary inspection fields are discarded before every write. It runs bundled English Tesseract OCR locally, with a second contrast pass using Sharp, and returns a screen category, visible supported table names, a confidence score, the phrases that matched, and a timestamp. Tests use cropped user-provided screenshots plus separate lobby/table frames from the recording. Connecting, Lucky Shot promotion, lobby, and table selection are recognized in those samples. A recognition miss is reported as `unrecognized`, which is an outcome rather than a screen label. This is not general accuracy validation, account authentication, opponent recognition, live table navigation, or a freeze detector. Dependencies and language data are pinned in package-lock.json; recognition uses local language files without downloading them at runtime.

`npm run replay:evidence` performs a read-only aggregate replay of reviewed Evidence with the current recognizer; `-- --all` processes every reviewed Evidence image. It reports fixed numeric timings for each OCR/visual stage, never uses held-out Benchmark images, and never reports OCR text. Its results diagnose development changes, not independent recognition accuracy. A late OCR result after the inspection deadline cannot save a capture or replace the failure state. The latest production gate and capture procedure are in the live-validation runbook.

The reader skips a second full-frame OCR pass for a distinctive first-pass Shop result. Evidence replay confirmed the same Shop labels and visible reading values on the reviewed set. Resizing every capture or replacing table OCR with a small central crop was faster but lost real Evidence screens, so those remain experimental replay options rather than shipped recognition behavior.

Each open session also has a **Table navigation · dry run** panel. It plans the sequence from lobby to table selection, locates a chosen table using the same supported-table catalog, and tracks the later table-opening and matchmaking stages. The dry-run input adapter never sends pointer or keyboard input: it tells the user which manual step comes next, and **Check visible screen** advances only from a fresh local inspection. Plans have a two-minute stage timeout, cancellation, and retry. Their bounded transition history is visible on the account card and is also saved locally to `%APPDATA%/Poolside/table-navigation-history.json`; the journal contains account IDs, table labels, states, events, and timestamps, but no account names, browser text, credentials, or captured images. Actual table clicking remains disabled until the real capture corpus and coordinate mapping have been validated.

### Recognition fixtures and capture coordinates

`test/fixtures/vision-corpus.json` is a structured set of 15 text layouts: eight derived from recorded screens — the seven recognisable screens, plus one recorded lobby whose hint text is misread, which must rightly change nothing — and seven non-screen or degraded OCR inputs. Those inputs assert the `unrecognized` outcome; they are not additional screen labels. Each frame lists the wording it shows, where that wording appears, and how confident a recogniser was in reading it. `test/vision-corpus.test.cjs` runs every frame through the matching logic and asserts the outcome it claims, so changing the rules — or the text they read — fails here.

The frames are **derived layouts, not labelled screenshots**: the wording is what the real screens show, but the boxes are plausible placements rather than measured ones. The corpus drives the matching logic and pins the coordinate rules; it does **not** measure OCR accuracy, and a frame passing here says nothing about the live site. That distinction is written into the file itself and asserted by the suite.

Capture coordinates are owned by `src/vision-frame.cjs` (ADR-0015). One capture crosses four coordinate systems: the page's CSS pixels where the surface is measured, the DIP rect `capturePage` takes, the captured image's own pixels at your display's scale factor, and the resized image the recogniser reads. The conversion, the clipping rules and the achieved density are now reported rather than assumed, and a capture taken _below_ the page's own scale is called out in the activity feed — that is the condition under which a small label gets misread. The band the second OCR pass reads is derived from one place rather than recomputed at the call site.

## Timeline and diagnostics

The dashboard's **Activity** view shows two things the app already recorded but never as one sequence. The session state machine keeps the last 50 transitions per session, and the activity feed keeps the last 100 entries; `src/timeline-engine.cjs` compiles them into a single ordered stream (newest last), and `src/timeline-query.cjs` indexes and queries it. Both are pure modules with no Electron dependency, so the ordering rule is tested without a window. The timeline is **derived on every snapshot, never stored**: there is no log file to rotate, and the history lives and dies with the process.

`src/dashboard-telemetry.cjs` collates what the four subsystems measure — the directory size and the configured `quotaBytes` ceiling, the generation counter, corruption history and the crash flags — into layers that differ by sensitivity. A value nobody has measured is `null`, never `0`.

Only the `export` layer may leave the machine (ADR-0010). **Diagnostics preview** in the Activity view asks the main process for that layer, while **Save redacted diagnostics** writes the same screened payload locally under `%APPDATA%/Poolside/diagnostics/`. `src/telemetry-redaction.cjs` rewrites every string — account names become `account 1`, addresses and paths become `[redacted:ipv4]` — and `src/diagnostics-bundle.cjs` scans the final payload before either action completes. A file is refused if it still carries a name, an address, a path or a token-shaped string. The scan is a floor, not a proof: it catches the shapes it knows and says so. Rotating durable logs, broader frame/action timings, and crash-file reporting remain unfinished; fixed OCR-stage timings already exist.

A saved **run report** is a separate, deliberately narrower record: it is written only when the operator asks for it, it is built from the same view the dashboard renders rather than from the ledger directly, and it excludes route credentials, browser profiles, page text, captured images and network addresses. Each participant carries the **name** of the saved location it was pointed at, so the record can answer which of two exits an attempt used without carrying an address; each match carries the notes that were beside its verdict when the file was written, including what the two accounts were configured to look like. It includes account names, because a record of who played whom without names is not a record, and it says so inside the file.

## Settings

The **Settings** view is generated from `src/config-schema.cjs`, not written by hand: every field the app can execute gets a control, with its label, bounds and option list taken from the schema. Adding a field to the schema adds it to the form, and a field the app cannot execute cannot be edited into existence. The renderer holds no field list.

An edit goes through four questions, one module each — `settings-form-mapper.cjs` builds the controls, `settings-form-values.cjs` turns submitted text into the declared type, `config-validator.cjs` applies the field's own grammar, and `settings-ui-controller.cjs` assembles the document and decides what a refusal means (ADR-0017).

Two behaviours are worth knowing when using it:

- **A refusal lands on the field that caused it.** `settings:save` returns `{saved: false, errors: [{path, message}]}` inside a successful call, so the control is marked, focused, and named — rather than the panel reporting one sentence about itself. A value that a field's grammar refuses is an error when you typed it, even though the same value is only _ignored_ when it was already stored by something else.
- **A blank field means "leave it alone", not "clear it".** Clearing is explicit, and a route carrying a username and password is shown masked with no value handed to the page at all — so saving a different field can never wipe it.

Saved network locations follow the same rule when they are edited. **Try it now** tests the address that is _stored_ — by identity, in the main process — so the page never has to be handed an address it is not allowed to hold, and the answer says where the request left from and how long it took. **Edit** changes the name, the skip list and the switched-on state, and leaves the address field empty with a note: a blank address keeps the saved one, and the masked label (`host:port · credentials set`) is refused if it ever arrives as an address. Each row keeps what the location has actually done — when it was last checked, whether it worked, and the last three reasons it did not — recorded both from your own test and from a live session's exit address when it opens.

## Development

Layout: `main.cjs` is a composition root only. Session windows are `windows.cjs`, saved-session
persistence `profiles.cjs` + `saved-session.cjs`, session/navigation policy `hardening.cjs`, recovery
supervision `recovery.cjs`, screen inspection `inspection.cjs`, the dashboard contract `ipc.cjs`, and
the test suite `self-test.cjs`. Shared shapes are declared in `types.cjs`.

| Document                    | Covers                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| `MASTER_ROADMAP.md`         | Final-product blueprint, module workstreams, delivery gates, and 1.0 proof |
| `docs/CAPABILITIES.md`      | Generated build capability and validation report                           |
| `docs/support-policy.md`    | Preview target and explicit unsupported/unvalidated configurations         |
| `docs/work-items.json`      | Evidence-linked deliverable register                                       |
| `docs/architecture.md`      | Modules, dependency rules, the session state machine, storage and IPC      |
| `docs/threat-model.md`      | Assets, trust boundaries, mitigations, residual risks, and review triggers |
| `docs/SBOM.cdx.json`        | Reproducible CycloneDX inventory of locked runtime dependencies            |
| `docs/release-checklist.md` | Source, package, and clean-machine checks required before a release        |
| `docs/adr/`                 | Architectural decisions, each with its costs and how it is enforced        |
| `CONTRIBUTING.md`           | The gate, branching, commit format, module rules, definition of done       |
| `../INCOMPLETE_WORK.md`     | Remaining implementation and external verification work                    |

| Command                           | What it does                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run verify`                  | lint + typecheck + unit tests — the gate to run before any commit                   |
| `npm run lint`                    | ESLint over the repository (flat config, separate browser globals for the renderer) |
| `npm run typecheck`               | `tsc --checkJs` over `src/` and `test/`                                             |
| `npm run format` / `format:check` | Prettier, with `.editorconfig` for editors                                          |
| `npm run sbom`                    | Regenerates `docs/SBOM.cdx.json` from the lockfile                                  |
| `npm run sbom:check`              | Fails when the committed dependency inventory does not match the lockfile           |
| `npm run release:inspect`         | Hashes the executable and app archive in `release/Poolside-win32-x64`               |

`test/architecture.test.cjs` enforces the rules that matter as tests rather than conventions: no
module over 300 lines, no cycles in the local require graph, no Electron import in the modules that
claim to be unit testable, and no module left unreferenced.

## Session identity and route

Each session can present its own identity and use its own network route. Workspace defaults are editable in Settings; account-specific overrides and route presets are available in Account management. The validated local document at `%APPDATA%/Poolside/workspace.json` stores those choices. Do not hand-edit it while the app is running. Its shape includes defaults under `settings` and per-account overrides:

```jsonc
{
  "settings": {
    "table": "Bangkok",
    "limit": 10,
    "identity": { "locale": "en-GB", "colorScheme": "light" },
    "proxy": { "spec": "socks5://10.0.0.9:1080", "bypass": ["example.com"] }
  },
  "accounts": [
    {
      "id": "…",
      "name": "Main",
      "role": "receiver",
      "identity": { "timezone": "Europe/London", "viewport": { "width": 1280, "height": 720 } },
      "proxy": { "enabled": true, "spec": "10.0.0.1:8080" }
    }
  ]
}
```

| Field                      | Accepts                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `identity.userAgent`       | any string without a line break                                                |
| `identity.acceptLanguages` | an ordered comma-separated list, e.g. `"en-GB,en"`                             |
| `identity.locale`          | a language tag, e.g. `"en-GB"`                                                 |
| `identity.timezone`        | an IANA zone, e.g. `"Europe/London"`                                           |
| `identity.viewport`        | `{ "width": 320–7680, "height": 240–4320 }`                                    |
| `identity.colorScheme`     | `"light"` or `"dark"`                                                          |
| `identity.quotaBytes`      | a positive whole number of bytes — a **reported** ceiling, not an enforced one |
| `proxy.spec`               | `DIRECT`, `host:port`, or `scheme://host:port` for http/https/socks4/socks5    |
| `proxy.bypass`             | hostnames, `*.wildcards`, CIDR blocks, or `<local>`                            |

A value that is not usable is dropped with a warning in the activity feed and the session still opens —
a mistyped time zone cannot lock the workspace or block a session. Identity target overrides require an
attached debugger, so DevTools cannot be opened on a session that has them, and an account with no
identity configured attaches nothing. `Check route ↗` on a card asks Chromium which route the session
will actually use and compares it with what was configured; the two are shown separately, because a route
that is configured but not in use is worse than no route at all. The reasoning, the measurements behind
it, and what is deliberately _not_ claimed are in
[ADR-0012](docs/adr/0012-session-identity-surface.md).

Window positions and sizes are remembered per account under `windows` in the same file and restored on
the next open, clamped to whichever displays are attached at the time.

## Session IP checks

Open an account window, then choose **Check IP** on its card. This makes an HTTPS request to `api.ipify.org` through that account’s Chromium session, without cookies. The current IPv4 address and check time appear on the card until the window closes. Addresses are not saved in workspace metadata or activity logs. A result is an observation for that endpoint at that time; it does not verify VPN status, location, IPv6 routing, or the game’s route. No extension is installed by this feature.
