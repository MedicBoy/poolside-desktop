# ADR-0020 — What a claim may rest on: configuration, observation, or measurement

- **Status:** Accepted
- **Date:** 2026-09-22
- **Milestone:** M4/M5 (isolation, pairing, and the surfaces that explain them)
- **Supersedes:** nothing
- **Related:** ADR-0010 (telemetry is local-only), ADR-0012 (session identity surface), ADR-0016 (what may leave the machine), ADR-0019 (surfacing state where the eye lands)

## Context

Three surfaces added in one night all answer a version of the same question — _how do these two sessions differ?_ —
and each of them can answer it from a different place:

1. **The identity settings** the operator typed. Cheap, always available, and only as true as the browser's
   willingness to accept them: a value the browser refused leaves a session that is not what was configured, which
   is exactly the defect ADR-0019's second rule is about.
2. **What the session's own page reports** — `navigator.userAgent`, `Intl.DateTimeFormat().resolvedOptions().timeZone`,
   the viewport. Read from the live page, so it is the truth about that session rather than about the configuration.
3. **A measurement the application made** — how long a request through a route took, which address it left from,
   how far apart two releases were.

The same question therefore has three different qualities of answer, and they are easy to confuse in wording. A card
that says _"these two sessions look alike"_ from stored settings is making a claim it has not earned. A comparison
that says _"they look like one machine"_ from what the pages report is accurate about those pages and says nothing
about how a website treats them — and it would be very easy to write that as though it did.

## Decision

**Every claim on a surface is labelled by where it came from, and each source has one job.**

1. **Configuration is stated as configuration.** A note derived from stored settings says what the settings are and
   what it implies, and points at the surface that can actually observe the difference. The match card's _"neither
   account has an identity of its own"_ is a fact about the workspace; the sentence ends by naming the Sessions
   view, which reads the pages, rather than borrowing its authority (`participant-contrast.cjs`).
2. **Observation is labelled as observation, and bounded to its moment.** The comparison reads ten values from each
   open session and reports what they said, field by field, with the time implicit in the fact that it is asked for
   rather than stored. Its wording states the ceiling: what a page reports to itself on this machine, and **not** a
   promise about how any website treats it (`identity-readback.cjs`).
3. **A measurement is recorded with its time and what it was about.** A route check or a session's own exit address
   becomes _"worked 4 minutes ago"_ on the saved location it describes (`route-health.cjs`), because a measurement
   without a time is a fact frozen at a moment nobody can name.
4. **A source that did not answer is not evidence of agreement.** A value nobody reported, and a session that could
   not be read, are **excluded** from a comparison rather than counted as matches: _"we could not read this"_ must
   never be allowed to become _"these are the same"_. This is the same rule the export scanner applies to opacity
   (ADR-0010) and the same rule the pairing verdict applies to a connecting screen.

**What may be kept, and for how long, follows from the same three sources.** Configuration is durable because it is
the input the operator chose. A measurement against a saved location is durable (`lastCheckedAt`, `lastResult`,
three failure reasons) because it is what makes the next decision, and it is bounded. A **live comparison is not
stored at all**: it is a question asked and answered, and a stored answer would be a claim about a moment that has
already passed.

## Consequences

### Positive

- The operator can tell the difference between _"the application is configured this way"_, _"the session says this"_
  and _"the application measured this"_, which is the difference between three useful surfaces and one confusing one.
- A failed pairing now has somewhere to look that is not a guess: the card states the configuration, the comparison
  states what the pages report, and the verdict states what the screen readings amounted to.
- The rule that a non-answer is not agreement was already load-bearing in two other places, so it is now stated once
  and applied in four.

### Negative / costs

- More wording to keep honest, and more places where a hurried sentence could overstate. Every claim above is held
  by a test that asserts the _absence_ of the stronger wording (no "identical", no "look like one machine" in the
  configuration note; an explicit sentence about what the comparison does not promise).
- Reading ten values from two live pages is a real operation against the game's own pages. It is asked for with a
  button rather than run on a timer, and it is read-only, but it is not free and it is not invisible.

## Alternatives considered

- **One combined "how different are these sessions" score.** Rejected: a single number has to choose a source, and
  whichever it chooses, the operator cannot tell what it measured — the failure this ADR exists to prevent.
- **Storing the comparison result with the match record.** Rejected: it would be a claim about two pages at a moment
  that has passed, presented as though it were still true, and the report already carries the verdict's reason.
- **Warning from configuration alone that the two sessions "look the same".** Rejected outright: the settings do not
  know what the browser accepted, and this project has already shipped one defect where a refused value left a
  session that did not behave as configured.

## Enforcement

- `test/participant-contrast.test.cjs` asserts the configuration note never claims observation.
- `test/identity-readback.test.cjs` asserts unreported values and unreadable sessions are excluded from the match
  count, and that the verdict carries its own ceiling.
- `test/route-health.test.cjs` asserts a measurement is recorded with its time and that an unreadable exit is
  recorded as unread rather than as a failure of the address.
- `test/ui-accessibility.test.cjs` holds the static wording of both panels.
