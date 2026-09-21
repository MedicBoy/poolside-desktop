# ADR-0016 — UI Timeline, Telemetry Layers and What May Leave the Machine

- **Status:** Accepted
- **Date:** 2026-09-18
- **Milestone:** M4 (UI timeline and analytics dashboard)
- **Supersedes:** nothing
- **Related:** ADR-0010 (telemetry is local-only), ADR-0013 (profile lifecycle), ADR-0009 (error taxonomy)

## Context

By the end of M3 the app recorded two bounded histories and neither was readable as a sequence:

- `session-fsm.cjs` keeps the last **50 transitions per session** — `{at, from, to, event, reason}`, oldest first.
- `workspace.cjs` keeps the last **100 activity entries** — `{id, at, message, kind}`, newest first.

Both were recorded "for M4's timeline", and both were visible only in their own panel. Answering _"what happened
before this session degraded"_ therefore meant reading two lists with different shapes and opposite orderings and
merging them by eye — the exact work a diagnostic view exists to remove.

Separately, four subsystems each measured something about a profile or a session, and each landed in a different
place in the snapshot: `profile-diagnostics.cjs` measured size (`directoryBytes`, `quotaBytes`, `overQuota`,
`truncated`, `unreadable`), the profile manager counted `generation` and recorded `corruption` history,
`recovery-policy.cjs`'s health record flagged crashes (`failures`, `attempts`, `exhausted`, `lastFailureReason`),
and `session-fsm.cjs` held the state and the reason for it. The dashboard re-derived the same joins four times.

ADR-0010 already constrains what any of this may become: telemetry is local, and a diagnostics bundle must carry
**no cookies, no credentials, no addresses, no account names** — verified by an automated scanner rather than by
inspection. That record is `Accepted` and standing; M4 does not re-decide it. It does, however, have to be
satisfiable, which means the code that assembles a payload and the code that decides what may leave the machine
have to be written together.

## Decision

### 1. The timeline is a view over the rings, never a third store

`timeline-engine.cjs` compiles the compiled stream from the two existing rings. Nothing appends to a timeline.
A future source of history is added to `compile` rather than to a parallel store, because a second history of the
same events drifts from the first and then disagrees with it in the one situation that matters — when something
has already gone wrong.

Consequence: the timeline loses nothing that the rings already lose. It is bounded because they are.

### 2. Two schemas, normalised once, and an explicit ordering rule

The engine is the only place that knows both source shapes. It normalises each into one entry:

| Field                              | From a transition                                                           | From an activity entry                        |
| ---------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| `at`                               | the transition's ISO timestamp                                              | the entry's ISO timestamp                     |
| `source`                           | `session`                                                                   | `activity`                                    |
| `accountId` / `accountName`        | the session's account                                                       | `null` — an activity entry is not per-account |
| `kind`                             | `transition`                                                                | `activity`                                    |
| `level`                            | `warning` if `to` is in `session-fsm.cjs`'s `UNHEALTHY_STATES`, else `info` | the entry's `kind`, when it is a known level  |
| `from` / `to` / `event` / `reason` | the transition's fields                                                     | `null`                                        |
| `message`                          | `null`                                                                      | the entry's message                           |
| `seq`                              | assigned on compile                                                         | assigned on compile                           |

Ordering is **timestamp, then source (a transition precedes an activity entry recorded in the same millisecond,
because the transition is the cause), then arrival**. `toISOString()` is fixed-width, so lexicographic order is
chronological order and no date parsing is needed to sort. `seq` exists so a view can key rows without depending
on index stability.

Severity comes from `session-fsm.cjs`'s own `UNHEALTHY_STATES` rather than a second list here, so the timeline
cannot disagree with the machine that made the transition.

### 3. Bounded twice, and the newest entries win

`compile` bounds at `MAX_ENTRIES = 400`. The snapshot carries a further cap of `TIMELINE_VIEW_LIMIT = 100`,
because the snapshot is broadcast on every state change and the full stream would put a few hundred kilobytes on
the wire repeatedly.

Both caps keep the **newest** entries. A timeline that dropped the most recent failure in order to stay within a
budget would be a timeline that is useless exactly when it is needed.

### 4. Reading the stream is a separate module from building it

`index`, `query`, `failures` and `summarise` live in `timeline-query.cjs`; `compile` and the two source adapters
live in `timeline-engine.cjs`. Neither throws on an unusable input — a `null` session, a non-array, a string where
an object was expected — because this is the module a caller reaches for _while_ something is already failing.

### 5. The dashboard's metrics are collated into layers that differ by sensitivity

`dashboard-telemetry.cjs` produces four declared layers:

| Layer      | Contains                                                                  |
| ---------- | ------------------------------------------------------------------------- |
| `summary`  | counts only — no identifier appears in it                                 |
| `sessions` | per account: state, reason, crash flags                                   |
| `storage`  | per account: generation, measured size, ceiling, corruption history       |
| `export`   | the anonymised projection — the only layer permitted to leave the machine |

`export` is produced by `telemetry-redaction.cjs`, deliberately a separate module. What the dashboard _shows_ and
what may _leave_ the machine are different questions, and merging them is how a redaction rule ends up applied to
one field and not the next.

An unmeasured value is `null`, never `0`. A profile nobody has measured is _unknown_, and rendering it as empty
is a claim the code has not earned — the same rule ADR-0013 applies to `carryOverBytes`.

### 6. Preservation rules: in memory, bounded, and nothing written unless asked

There is no log file, so there is no rotation policy to get wrong:

1. Both rings live in memory and die with the process. The retention policy **is** the ring size (100 activity
   entries, 50 transitions per session).
2. Nothing is written to disk by the timeline or the dashboard. The only thing that leaves the machine is a
   payload a user explicitly asks for, through `diagnostics:preview`.
3. The activity feed keeps entries newest-first and the FSM keeps transitions oldest-first, as built. The
   timeline is the only component that presents a single order, and it presents one order for both.

The cost is real and stated: **a crash loses the timeline**, because it was never on disk. That is the price of
ADR-0010's local-only rule and it is deferred, not hidden — durable structured logging is M4's remainder.

### 7. A payload that fails its own scan is refused, not annotated

`diagnostics:preview` assembles the `export` layer, redacts the timeline into it, and then scans the whole
payload for account names (by literal) and for addresses, filesystem paths and token-shaped strings (by shape).
If anything is found, the handler **throws** rather than returning a payload with a warning attached:

```
The diagnostics payload was refused: it still carries 2 item(s) that must not leave this machine
(payload.sessions[0].reason:path, payload.timeline[3].message:ipv4).
```

The export is also clean **by construction**, which is the part that was missing in the first draft: every string
is rewritten — names become `account N`, forbidden shapes become `[redacted:<kind>]` — while the useful part
survives. `'Main failed at C:\Users\…'` becomes `'account 1 failed at [redacted:path]'`. A projection that
merely copies fields across produced an export containing a path, and a scanner that finds that later is a
scanner that has to be believed.

Account _identifiers_ become sequential references rather than being preserved, and the profile's filesystem
`path` is dropped entirely rather than cleaned, because it embeds the Windows user name and nothing needs it.

### 8. The scanner is a floor, and says so

`findSecrets` proves the absence of the shapes it knows: IPv4 and IPv6 addresses, Windows and POSIX paths, and
`[A-Za-z0-9_-]{40,}` (long enough to skip a UUID at 36 and an ISO timestamp at 24, short enough to catch a cookie
or a key), plus the account names a caller supplies as literals. Names are matched with `split`/`join` rather than
a pattern, because a name is user input and can contain any character a regex treats as syntax.

It cannot prove the absence of a secret it does not recognise. ADR-0010 says exactly that, and this record does
not upgrade it: the scan is a floor under the export, not a guarantee about it.

## Consequences

**Good**

- One ordered history replaces two lists with opposite orderings, so "what happened before the failure" is a
  query rather than a merge by eye.
- The dashboard's joins are computed once, in one place, with one rule for an unmeasured value.
- The redaction rules are enforced where the payload is assembled, and the refusal is loud.
- A bug in either half is found by a test that runs without Electron: every timeline test is a record in and a
  rectangle of entries out.

**Costs**

- The timeline is derived on every snapshot, so a publish costs a bounded sort (~500 entries worst case). It is
  bounded by design, but it is not free.
- Because the timeline is in memory only, a hard crash loses the history that would explain it. Durable logging is
  M4's remainder.
- Two redaction passes exist (the export projection and the timeline's), and the guard between them is a test
  rather than a type. Composing them wrongly once already produced a payload that carried a path.

## Enforcement

1. `test/timeline-engine.test.cjs` — compilation, the same-millisecond ordering rule, severities from
   `UNHEALTHY_STATES`, both bounds keeping the newest, composable queries, and redaction that survives a name
   containing regex syntax. It also asserts nothing throws when handed `null`, a string, or a list of `null`s.
2. `test/dashboard-telemetry.test.cjs` — the layer shapes, `null`-not-`0` for unmeasured values, and the
   **negative control**: `findSecrets` must find planted names, an address, a path and an opaque token in an
   unredacted payload, and must find nothing in the export of that same payload. A scanner that finds nothing
   proves nothing unless it is shown finding something.
3. `test/architecture.test.cjs` — the six modules are declared pure (no `electron` import) and under the 300-line
   ceiling; the local require graph stays acyclic.
4. `src/self-test.cjs` — the desktop suite calls `diagnostics:preview` through the real IPC bridge and asserts the
   payload is returned, that it reports itself clean, and that neither of the suite's account names nor a
   filesystem path appears anywhere in it.
5. `src/ipc.cjs` — the refusal is in the handler, not in a caller, so no future caller can forget it.

## Not decided here

M4's roadmap section also requires a diagnostics **bundle** (versions, environment, per-session state, frame
timings), frame-timing instrumentation from `did-finish-load` to first non-blank frame, opt-in crash reporting to
a local file, and validation of the bundle against three scripted failure scenarios. None of that is decided or
built by this record. What exists is the collation, the ordering, and the redaction floor those pieces will
assemble through — and the scanner that will have to stay green when they do.
