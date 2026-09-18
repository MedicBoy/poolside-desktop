# Poolside — session preview

A Windows desktop foundation for the requested 8 Ball Pool tool. This build manages isolated browser sessions. **Automated coin transfers, opponent recognition, VPN configuration, and identity spoofing are not implemented.** The overall version-one goal is not complete.

## Run

Open `release/Poolside-win32-x64/Poolside.exe` after packaging, or use `npm install` followed by `npm start` from this folder for development. `npm run package` creates the portable application folder; keep its supporting files beside the executable.

## First session test

1. Add a receiving account slot and a sending account slot.
2. Open both windows and sign into your own accounts directly in the game.
3. Verify that opening and signing into the second account does not log out the first.
4. Report any login failure or browser-compatibility error. Do not share passwords, cookies, or tokens.

The app reports a window as open, not an account as authenticated. Authentication and opponent detection are not verified in this build. Google or other providers may reject embedded browsers; those cases must be tested without bypassing their protections.

If signing in lands on the web shop, Poolside now checks for the visible English shop headings on the official site. After they remain present for five seconds, it navigates the same window back to the game once per window opening. A visible password field, dialog, or large game canvas/iframe prevents this detection. This is a text-based heuristic, not authenticated-login detection. Different shop wording or layouts may require the manual **Return to game** control. The manual control also disables further automatic returns for that window. Avoid using it during a match.

Game windows now disable background timer/animation throttling and request several repaints after page load, plus a repaint on focus. These are candidate workarounds for the reported freeze, which the user also observes in ordinary Chrome. They are not a verified freeze fix and may increase background resource use. No random clicks or window dragging are generated.

## Data and behavior

- Account names, roles, and preferred table/limit are stored locally in `%APPDATA%/Poolside/workspace.json` (Electron's user-data folder).
- **Configuration is validated against a declared schema before it is used** (ADR-0008, ADR-0014). Saving preferences checks the whole settings object first: a value of the wrong type — an unknown table, a match limit outside 1–100, a missing required field — is refused and the reason is shown. A value that is the right shape but unusable, such as a time zone the browser does not know, or an unrecognised key, is left out and reported in the activity feed. Nothing is silently discarded, which is what used to happen. A session's configuration is checked again immediately before it is applied, so what a session runs with is what was validated.
- Every account has its own persistent Chromium profile (`persist:poolside-<account id>`), so cookies and site storage survive closing a window, closing the app, and restarting the PC. Closing a game window keeps that session available until the entire app exits.
- Alongside the profile, each account gets an encrypted carry-over file at `%APPDATA%/Poolside/accounts/<account id>.plist`. It exists for one reason: Chromium drops **session** cookies when it closes. The file therefore holds _only_ session cookies — never the persistent ones the profile already stores, so no secret is written twice. Its payload is a blob encrypted with Electron `safeStorage` (Windows DPAPI); nothing in it is readable without the Windows user account that wrote it. It is rewritten when cookies change and again on exit.
- The profile is the authoritative store, and it wins wherever the two could disagree: restore never overwrites a cookie the profile already has, so a value the game has rotated is never replaced by an older snapshot. See `docs/adr/0004-session-storage-authority.md`.
- **Profile management.** Opening an account establishes its storage and counts a _generation_: how many times that storage directory has been created or recreated. The counter does not move on an ordinary open. On startup, Poolside sweeps abandoned temporary files, removes profile storage that no account claims (only `poolside-<uuid>` directories and `<uuid>.plist` files — anything else is reported and left alone), then checks every account's carry-over file and logs one summary line.
- A damaged carry-over file is **quarantined, never deleted**: it is renamed to `<account id>.plist.corrupt-<timestamp>`, the damage is recorded against the account, and the dashboard shows the count. The Chromium profile still holds every persistent cookie, so the worst case is signing in again — which is what the message says, rather than claiming a recovery. Poolside does not repair a damaged `workspace.json`: a malformed document puts the app into read-only mode instead, because that file holds your account records and "repairing" it would mean discarding them.
- **Delete profile** on an account card removes that account's cookies, site storage, carry-over file and quarantined copies from this PC. It is the only irreversible action in the app, so it asks for confirmation in a native dialog, it is refused while that session is open (the control is disabled and says why), and it never reports success for a partial removal. The account record stays; only its stored profile goes.
- Each account's profile size on disk is measured and shown against the `quotaBytes` ceiling from its identity configuration. That ceiling is **reported, not enforced** — Electron exposes no per-session storage quota to enforce it with. The measurement is capped at 5000 files per profile and shown as "or more" when it stops early; an unreadable file is reported as unknown rather than as zero. See `docs/adr/0013-profile-lifecycle-and-repair.md`.
- Game windows have no Node.js access or Poolside preload bridge. HTTPS login popups use the same isolated session as their account. HTTP/custom-protocol navigation and downloads are blocked in the game windows.
- The dashboard renderer makes no external requests. Its Check IP action asks the main process to contact ipify through the selected game session. Game windows load the official website, its providers, and its third-party content.
- Activity shown in the dashboard is in-memory only. It records session actions, not credentials or complete navigation URLs.
- Archive hides an account slot without deleting its metadata. No archive-restore interface is included yet.
- There is no updater, bundled VPN, token importer, or remote code/configuration loader.

## Validation

`npm test` checks model constraints, saved-data validation, IP response/error handling, shop-return gating, screen classification, the profile subsystem (path safety, the integrity verdicts, measurement, and lifecycle against a temporary directory), and the configuration schema layer — where the declaration is cross-referenced against the storage structures field for field, against a real `decode` round trip, and verdict-for-verdict against the hand-written settings validator it sits in front of. `npm run test:desktop` launches an isolated test workspace and checks actual Electron cookie-store separation between two sessions, cookies retained when a window reopens, the sandbox boundary, IPC account validation, metadata saving, IP controls for closed windows, per-session identity read back from `navigator` and `Intl`, and the profile lifecycle end to end — generation counting, a real measurement of real bytes against a configured ceiling, a damaged saved session quarantined and counted, and an explicit delete refused while the session is open before removing the directory, the files and the record. Add `-- --live-ip-check` to contact the real IP service through a test session. `npm run test:persistence` runs two separate Electron processes — one seeds, one verifies — to prove that each account's cookies, session cookies and `localStorage` survive a full app restart independently of the other. These checks do not prove real-game login, opponent pairing, or transfer behavior.

Read `../video-review.md` for the reference evidence and remaining uncertainties.

## Screen recognition development

**Inspect game** on an open account card captures a single visible game surface and runs `src/game-screen.cjs` locally. The locator (`src/game-region.cjs`) scores every visible canvas/iframe by how closely it matches the game's aspect ratio and by how much of the viewport it covers, then picks the best candidate; a page with several surfaces no longer fails just for having several. When nothing is usable it reports why and lists the surfaces it saw, so a wrong choice is diagnosable. That ranking still needs verification against the real game. Results are timestamped observations, not proof of responsiveness or permission to start a match. No image or OCR transcript is saved, and no gameplay input is sent. It runs bundled English Tesseract OCR locally, with a second contrast pass using Sharp, and returns a screen category, a confidence score, the phrases that matched, and a timestamp. Tests use cropped user-provided screenshots plus separate lobby/table frames from the recording. Connecting, Lucky Shot promotion, lobby, and table selection are recognized in those samples. The small loading label in the first recording frame is not reliably recognized and deliberately returns unknown. This is not general accuracy validation, account authentication, opponent recognition, or a freeze detector. Dependencies and language data are pinned in package-lock.json; recognition uses local language files without downloading them at runtime.

## Development

Layout: `main.cjs` is a composition root only. Session windows are `windows.cjs`, saved-session
persistence `profiles.cjs` + `saved-session.cjs`, session/navigation policy `hardening.cjs`, recovery
supervision `recovery.cjs`, screen inspection `inspection.cjs`, the dashboard contract `ipc.cjs`, and
the test suite `self-test.cjs`. Shared shapes are declared in `types.cjs`.

| Document               | Covers                                                                     |
| ---------------------- | -------------------------------------------------------------------------- |
| `docs/architecture.md` | Modules, dependency rules, the session state machine, storage and IPC      |
| `docs/adr/`            | Twelve architectural decisions, each with its costs and how it is enforced |
| `CONTRIBUTING.md`      | The gate, branching, commit format, module rules, definition of done       |
| `../BOUNDARIES.md`     | What is in scope, what needs a hand-off, what is out of scope              |

| Command                           | What it does                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run verify`                  | lint + typecheck + unit tests — the gate to run before any commit                   |
| `npm run lint`                    | ESLint over the repository (flat config, separate browser globals for the renderer) |
| `npm run typecheck`               | `tsc --checkJs` over `src/` and `test/`                                             |
| `npm run format` / `format:check` | Prettier, with `.editorconfig` for editors                                          |

`test/architecture.test.cjs` enforces the rules that matter as tests rather than conventions: no
module over 200 lines, no cycles in the local require graph, no Electron import in the modules that
claim to be unit testable, and no module left unreferenced.

## Session identity and route

Each session can present its own identity and use its own network route. There is no settings UI for this
yet (M5), so it is configured in the workspace document at `%APPDATA%/Poolside/workspace.json`. Set a
default every account inherits under `settings`, and override it per account:

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
