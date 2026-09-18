# ADR-0001 — CommonJS for the main process

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** `src/*.cjs`, `tsconfig.json`, `test/architecture.test.cjs`

## Context

The application was generated as CommonJS (`.cjs`) and works. The wider Node ecosystem has moved to
ESM, and Electron supports ESM in the main process, so "should we migrate?" is a question that will
keep coming up — usually in the middle of unrelated work, which is the expensive way to answer it.

The mixed-format cost is real: an ESM main process must use `.mjs` or `"type": "module"`, changes
every `require`/`__dirname` call site, and alters how Electron's own tooling and the packaged
`app.asar` resolve entry points. The benefit is hypothetical for this codebase: there is no
consumer that requires ESM, and no dependency that is ESM-only.

## Decision

The main process stays CommonJS, in `.cjs` files, with `require()` and `__dirname`.

Type checking is unaffected: `tsconfig.json` uses `module: node16`, which understands `.cjs` as
CommonJS and checks it fully.

## Consequences

### Positive

- No conversion risk in a codebase that depends on `__dirname` for `ui/index.html` and
  `preload.cjs`.
- Electron's own tooling, `@electron/packager`, and the asar layout keep working unchanged.
- `tsc --checkJs` remains fully effective.

### Negative / costs

- Two ecosystems' worth of documentation and snippets assume ESM; contributors must ignore them.
- If a future dependency is ESM-only, this decision has to be revisited rather than worked around.
- Slightly unusual for a 2026 codebase; a reviewer may ask, which is what this record is for.

## Alternatives considered

- **Migrate now.** Rejected: no forcing function, non-trivial risk, and it would be a large diff
  that touches every module for zero behavioural gain.
- **Mixed, ESM where convenient.** Rejected: the worst option for tooling and for readers.
- **Full ESM with a bundler.** Rejected: adds a build step to a project whose packaging story is
  currently "point packager at the directory", and the roadmap's M8 already has enough work.

## Enforcement

Review only. `tsconfig.json` (`module: node16`) and the `.cjs` extension keep the format consistent;
`test/architecture.test.cjs` scans `.cjs` files only, so an accidental `.mjs` in `src/` would be
silently unchecked — which is the reason to notice it in review.
