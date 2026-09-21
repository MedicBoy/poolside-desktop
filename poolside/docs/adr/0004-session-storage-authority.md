# ADR-0004 — One authority for session storage (defect D3)

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** `src/plist.cjs`, `src/session-cookies.cjs`, `src/saved-session.cjs`, `src/profiles.cjs`, `src/state.cjs`, `test/session-restart.cjs`, `test/saved-session.test.cjs`, `test/plist.test.cjs`

## Context

Two stores held the same session data, with no rule about which one won:

1. The Chromium profile, `persist:poolside-<id>` (ADR-0003), which owns every cookie and all site
   storage.
2. `%APPDATA%/Poolside/accounts/<id>.plist`, holding a `safeStorage`-encrypted copy of the **entire**
   cookie jar, written on every cookie change and on exit.

The duplication was not cosmetic. It put a second copy of every secret on disk. It also created a
resurrection path: a restore could reinstate a cookie the game had already rotated or revoked, so a
dead session could be replayed over a live one — a very plausible source of intermittent
"why am I signed out / why is my session stale" behaviour that would be miserable to debug later.

The declared intent (the README said the profile was authoritative) and the code disagreed, which is
worse than either choice on its own.

## Decision

**The Chromium profile is the single authority for cookie data.** The `.plist` file exists for
exactly one purpose: to carry the _session_ cookies that Chromium drops when the browser closes.

Concretely:

- Only cookies with the session flag are written to the file. Persistent cookies are never
  duplicated there. The payload declares this: `scope: "session-cookies"`.
- A stored payload has no `session` field; membership of the list _is_ the session claim. (An earlier
  version re-filtered stored cookies by that absent flag and silently restored nothing — the round
  trip is now tested.)
- Restore never overwrites a cookie the profile already has, so a rotated value always wins over the
  snapshot.
- `saveSession` still calls `cookies.flushStore()` and `flushStorageData()`. That is what makes the
  profile durable, and it is the primary persistence path, not a side effect.
- Old v1 files (whole cookie jar) are accepted and narrowed rather than rejected, so upgrading does
  not sign anyone out; the next save rewrites them as v2 and the file shrinks.

Responsibility split, enforced by module boundaries:

| Concern                                          | Module                |
| ------------------------------------------------ | --------------------- |
| Which cookies are carried, and the payload shape | `session-cookies.cjs` |
| The plist document format                        | `plist.cjs`           |
| Where the file lives, encryption, write/restore  | `saved-session.cjs`   |
| When to save, debounce, flush on quit            | `profiles.cjs`        |
| Where per-account state is declared              | `state.cjs`           |

## Consequences

### Positive

- One copy of each secret on disk. The session file contains two or three session cookies, not the
  whole jar.
- No resurrection of rotated cookies: an existing profile cookie is never clobbered by a snapshot.
- The authority question is settled, so future work cannot "fix" it in either direction by accident.
- All three policy concerns are now pure modules, so the invariants are unit-tested without Electron.

### Negative / costs

- Session cookies still depend on a file that can be deleted, corrupted, or written by a different
  Windows user (DPAPI). Those paths raise a clear error and preserve the file.
- The v1→v2 narrowing is permanent compatibility code; it can be deleted once no v1 file can exist.
- Two modules now exist where one did (`session-cookies.cjs` + `saved-session.cjs`). That split was
  forced by the then-current 200-line ceiling, and it happens to match the concern boundary.

## Alternatives considered

- **Delete the plist entirely and rely on the profile.** Rejected: Chromium genuinely drops session
  cookies on close, so the game's login would be lost on every restart.
- **Keep the full-jar copy and make the plist authoritative.** Rejected: it duplicates secrets, it
  cannot beat Chromium at restoring its own store, and it re-introduces resurrection.
- **Store the whole jar but restore selectively.** Rejected: that is the original defect — the
  secrets are still written twice, whatever the restore path filters.
- **Re-encrypt the profile ourselves.** Rejected: fighting Chromium (ADR-0003).

## Enforcement

Test-backed, at three levels:

- `test/saved-session.test.cjs` — only session cookies are selected; malformed cookies are dropped;
  a payload round-trips unchanged; a payload for another account is rejected; a v1 payload is
  narrowed not rejected; the stored shape has no `session` key.
- `test/plist.test.cjs` — the document is well formed, a hostile account name cannot break out of
  it, and the payload round-trips.
- `npm run test:persistence` — a real seed process then a real verify process prove the session
  cookie is restored from the file and the persistent cookie comes from the profile, and assert the
  file carries exactly one cookie while the persistent cookie never appears in it.
