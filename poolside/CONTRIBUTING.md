# Contributing

## Prerequisites

- Node.js **22 or newer** (`engines` in `package.json` enforces it) and npm.
- Windows. The application targets Windows specifically: `safeStorage` is DPAPI-backed and the
  packaged output is `win32-x64`.
- No game account is needed for any test in this repository, and none should ever be used in one.

## Setup

```bash
npm ci          # not npm install — the lockfile is the source of truth for the toolchain
npm start       # run the app in development
```

## The gate

```bash
npm run verify  # lint + typecheck + unit tests
```

**Never commit red.** `verify` must pass before every commit, and it is what CI runs. The individual
pieces, for when you want them separately:

| Command                           | Purpose                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `npm run lint` / `lint:fix`       | ESLint (flat config; the renderer gets browser globals, not Node) |
| `npm run typecheck`               | `tsc --noEmit` with `checkJs` over `src/` and `test/`             |
| `npm run format` / `format:check` | Prettier                                                          |
| `npm test`                        | `node --test` — unit, OCR fixtures, and the architecture guard    |
| `npm run test:desktop`            | `electron . --self-test` — real Electron behaviour                |
| `npm run test:persistence`        | two real processes, seed then verify                              |
| `npm run package`                 | build `release/`                                                  |
| `npm run sbom:check`              | confirm the committed runtime dependency inventory is current     |
| `npm run release:inspect`         | hash the executable and packaged application archive              |

The Electron-level suites are not part of `verify` because they need a display and take minutes. Run
them before finishing any change that touches sessions, windows, inspection or recovery.

## Branching — trunk-based

- `main` is always green and always releasable.
- Branches are short-lived and branch off `main`. A branch that lives longer than a couple of days is
  a sign the change should have been split.
- No long-lived `develop`, no release branches. Releases are tags on `main`.
- Rebase onto `main` rather than merging `main` into your branch; keep history linear.
- Delete the branch when it lands.

## Commits — conventional

Format: `type(scope): imperative summary`, blank line, body explaining **why**.

```
fix(inspection): score surfaces instead of demanding exactly one

The locator returned null when the page had two visible canvases, which the
lobby always does because it draws its background as one. Now every eligible
surface is scored and the failure names the candidates it saw, so a wrong
choice is diagnosable from one report.
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`, `ci`.
Scopes: module name without the extension (`inspection`, `windows`, `profiles`, `saved-session`,
`ipc`, `ui`, `docs`, `deps`).

Rules:

- Imperative mood, no trailing full stop, under 72 characters for the summary.
- The body is for _why_. The diff already shows _what_.
- One logical change per commit. A formatting sweep and a behaviour change go in separate commits,
  always — a reviewer cannot find a bug in a 26-file reformat.
- Reference the defect or ADR when one exists (`defect D3`, `ADR-0004`).

## Tags and releases

Per roadmap milestone, not per commit: `v0.2.0`, `v0.3.0`, … A milestone tag is cut **only when its
exit gate passes** — a tag is a claim, and an unearned tag is a lie in the history.

## Module rules

Enforced as tests in `test/architecture.test.cjs`, not as conventions:

1. **No module over 200 lines.** Split by responsibility. When Prettier's reformatting pushed
   `windows.cjs` past the ceiling, the answer was to split it, not to raise the number.
2. **No cycles** in the local `require` graph.
3. **Pure modules stay pure.** `layout`, `model`, `shop-recovery`, `game-region`, `saved-session`,
   `session-cookies` and `plist` must not import `electron`. They are unit-testable without a running
   app, and that property is worth more than the convenience of one import.
4. **No unreferenced modules.**

`main.cjs` is a composition root: wiring, lifecycle and the last-resort error surface. Behaviour goes
in its own module.

## Testing requirements

- **A bug becomes a fixture before it becomes a fix.** If you cannot write a test that fails before
  your change, you do not yet know what the bug is.
- **Negative fixtures are mandatory** for anything recognition-related. A classifier that never says
  "unknown" is not accurate, it is confident (ADR-0007).
- Game-facing behaviour is tested against **local HTTPS fixtures** (`protocol.handle`), never a real
  account and never the live site in CI.
- Tests assert _absences_ too, where absence is the requirement: no `require` in the renderer, the
  transfer control disabled, a cookie never written to the session file.
- Delete a test only when the behaviour it covers is deliberately gone, and say so in the commit body.

## Definition of done

- [ ] `npm run verify` green
- [ ] Electron suites green if the change touches sessions, windows, inspection or recovery
- [ ] New behaviour has tests; a fixed bug has a regression test
- [ ] No module over 200 lines; no new cycle; no `electron` import in a pure module
- [ ] User-facing errors name a cause and a next action (ADR-0009)
- [ ] Docs updated in the same change: `README.md` for behaviour, `docs/architecture.md` for
      structure, an ADR for any changed decision
- [ ] Conventional commit, and the body explains why
- [ ] For a release candidate, complete `docs/release-checklist.md` and retain its inspection output

## Documentation policy

**Docs drift is a defect.** It has bitten this repository twice: the README described in-memory
sessions long after the code moved to persistent profiles, and the screen-recognition section still
described a locator that had been replaced. Both were fixed as bugs.

If a change makes a document wrong, the document is part of the change. That applies to `README.md`,
`docs/architecture.md`, the ADRs and `../INCOMPLETE_WORK.md`.

## Security rules

- Never commit credentials, cookies, tokens, session files or profile data. `*.plist` files under
  `%APPDATA%` are user data and never belong in the repository.
- Never add a fixture containing a real account name, balance or address. Crop or redact.
- Never add an outbound request. The only one that exists is the user-initiated Check IP action
  (ADR-0010), and adding a second is an ADR-level decision.
- Never extend the capture pipeline to return OCR text, balances or names. It returns a state, a
  score and matched phrases.
- Keep game windows sandboxed with no preload bridge. If a feature wants Node in a game window, the
  feature is wrong.
- Report a security concern in the issue tracker without reproducing a live exploit.

## Incomplete work

Read `../INCOMPLETE_WORK.md` before proposing a feature and update it when an unfinished capability
lands. Game input, multi-account coordination, match completion, device-identity controls, and
credential import are not implemented in the current tree. Contributions in those areas need clear
module contracts, tests, diagnostics, and corresponding documentation updates.
