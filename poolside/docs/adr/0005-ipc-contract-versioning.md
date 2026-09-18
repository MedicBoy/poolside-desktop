# ADR-0005 — IPC contract shape and versioning

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** `src/ipc.cjs`, `src/preload.cjs`, `src/ui/renderer.js`, roadmap M0/M2

## Context

The dashboard and the main process talk over Electron IPC. Two things need to be fixed: who may
call in, and what a call looks like — because the shape of that contract determines whether a
future change is a small edit or a compatibility break across a preload bridge the renderer cannot
version.

The threat that matters is a frame that is not the dashboard's own main frame reaching a handler,
for instance a webview, an iframe, or a popup. Electron's IPC does not distinguish them; the
application must.

## Decision

**Transport guard.** Every handler runs `trusted(event)` first, which requires all three of:
`sender` is the dashboard's `webContents`, `senderFrame` is that window's `mainFrame`, and the frame
URL is exactly the local `ui/index.html` file URL. Any failure throws `Request rejected.`

**Envelope.** Every handler returns `{ ok: true, value }` or `{ ok: false, error }`. Errors are
returned, never thrown across the boundary, so the renderer always receives a shape it can read.
A handler that returns nothing falls back to the current workspace snapshot.

**Channels are the contract.** Channel names are stable identifiers (`account:inspect`,
`sessions:arrange`). Adding a message is additive and safe. Changing a message's _meaning_ is a
breaking change and is done by adding a new channel, not by altering the old one's payload.

**No version field yet.** A `version` on the envelope is real work with no current consumer: the
preload bridge and the renderer ship in the same build, so they cannot drift. The rule above is what
protects a future split, and a version field will be added when something actually needs to support
two shapes at once.

## Consequences

### Positive

- The renderer cannot crash on IPC: every response is an envelope.
- The trust check is one function, tested by the self-test (which calls IPC from a real dashboard).
- Additive changes never break anything, which matches how this codebase actually evolves.

### Negative / costs

- Without a version field, a mixed-version deployment cannot be supported. Accepted: there is none.
- Payload shapes are not schema-validated (roadmap M2). A malformed payload is caught by the handler's
  own validation (`model.account`, `model.settings`) rather than by a schema layer.
- The guard means the game windows genuinely cannot call IPC — which is intended, but worth knowing
  before adding a feature that wants to.

## Alternatives considered

- **A version field on every message now.** Rejected: no consumer, and it would be a field everyone
  has to remember to bump with nothing checking it.
- **JSON Schema validation on every payload (roadmap M2).** Deferred, not rejected: the right time is
  when the config system lands and there is one place to declare schemas.
- **Trusted by channel allowlist rather than sender check.** Rejected: it answers "is this channel
  allowed" when the question is "is this caller allowed".

## Enforcement

Test-backed. `npm run test:desktop` drives real IPC from the real dashboard (add accounts, reject a
duplicate, reject an IP check on a closed window, inspect, return to game) and asserts that the
renderer has no `require` and that the transfer control is disabled. `test/architecture.test.cjs`
keeps `ipc.cjs` inside the module-size ceiling so the contract stays readable in one file.
