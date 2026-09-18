# ADR-0009 — Error taxonomy and user-facing messages

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** `src/errors.cjs`, `src/ipc.cjs`, `src/workspace.cjs`, `src/inspection.cjs`, roadmap M4

## Context

Errors reached the user in three inconsistent ways: plain `Error` messages thrown inside the main
process, `error.message` reads on values that are `unknown` under strict checking (seven of them),
and a couple of places that swallowed a failure and reported a generic string.

Two concrete problems followed. First, a message like "Could not isolate the game" told the user
nothing they could act on. Second, the swallow-and-generic pattern destroyed the reason — a
`saveSession` failure that preserved the user's file said only that something had failed. The screen
inspection path was the worst offender: the region locator returned a bare `null`, so a failure to
find the game surface was indistinguishable from a page that had not loaded.

Debugging quality is a feature here. The user is the only person who can see a live failure, so the
message on screen _is_ the diagnostic.

## Decision

1. **Every user-facing error names a cause and a next action.** "A game surface was found but none
   was large enough or the right shape to capture. Bring the full game area into view. Surfaces
   seen: canvas 120×60 (aspect 2, 1% of view)." is the standard; "Could not isolate the game" is not.
2. **Failures carry their evidence where it is cheap.** The region probe returns
   `{ok: false, reason, candidates[]}` and `describeRegionFailure` turns that into prose, so one
   report from the user is usually enough to fix a wrong choice.
3. **Caught values are normalised before use.** `messageOf(error)` in `src/errors.cjs` is the only
   way `error.message` is read. It exists because a caught value is `unknown` under strict checking
   and seven call sites were reading it directly.
4. **Errors are returned, not thrown across IPC.** Handler exceptions become `{ok: false, error}`
   (ADR-0005), so the renderer always gets a shape it can render.
5. **No stack traces in the UI.** They go to the console and, from M4, to the log. The user gets a
   sentence.
6. **A failure that preserves the user's data says so.** "Its plist has been preserved" exists
   because the alternative is a user assuming their session file was destroyed.

## Consequences

### Positive

- A failure report from the user is often actionable without a follow-up question.
- The region-locator rewrite (defect D4) is diagnosable in one live pass precisely because of rule 2.
- `messageOf` removed a class of `undefined` reads.

### Negative / costs

- Messages are longer and some are genuinely hard to phrase for a cause we are unsure about. When the
  cause is unknown, the message says that rather than guessing — which is honest and slightly less
  satisfying to read.
- No i18n yet (roadmap M5). Every message is an English literal in a module.
- Messages are not one taxonomy with codes; they are sentences. If machine-readable error codes are
  ever needed (M4 diagnostics), this will need an addition rather than a change.

## Alternatives considered

- **Error codes plus a message catalogue.** Deferred: valuable once there is a diagnostics bundle to
  key on, premature while messages are read by exactly one person.
- **Raw exception propagation to the UI.** Rejected: leaks internals and produces unreadable output.
- **Generic messages with a log file.** Rejected: the user is the only observer of live behaviour, and
  the log (M4) does not exist yet.

## Enforcement

Test-backed where it can be. `npm run test:desktop` asserts the _content_ of failures: a login field
produces a message matching `/sign-in field or dialog/`, and an unusable surface produces one
matching `/large enough/` that also names the `120×60` surface it saw. `test/architecture.test.cjs`
keeps `errors.cjs` small and truthfully declared as a pure module.
