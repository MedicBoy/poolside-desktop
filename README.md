# Poolside

Poolside is a Windows desktop application for managing isolated browser sessions, persistent account
profiles, local screen-state recognition, per-session configuration, and operational diagnostics.

The application is built with Electron and CommonJS. Recognition runs locally with Tesseract and
Sharp. Configuration, profile lifecycle, telemetry, and UI behavior are covered by automated unit
and desktop integration tests.

## Repository layout

- `poolside/` — application source, tests, scripts, and technical documentation
- `INCOMPLETE_WORK.md` — remaining implementation and verification work
- `PROJECT_HANDOFF.md` — detailed engineering handoff and module inventory
- `ROADMAP.md` — milestone plan and acceptance criteria
- `recording-review/` and `video-review.md` — source-material review notes

## Development

Requirements:

- Windows 10 or later
- Node.js 22
- npm

```powershell
cd poolside
npm ci
npm run verify
npm run test:desktop
npm start
```

Create the portable application folder with:

```powershell
npm run package
```

Generated dependencies, logs, and packaged Electron runtimes are intentionally excluded from version
control. They are reproducible from the committed source and lockfile.

## Documentation

Start with [the application README](poolside/README.md), then consult
[the architecture guide](poolside/docs/architecture.md) and
[the decision records](poolside/docs/adr/README.md). Contribution requirements are documented in
[CONTRIBUTING.md](poolside/CONTRIBUTING.md).

## Status

The multi-session platform, profile management, configuration, diagnostics, and recognition
foundations are implemented. See [INCOMPLETE_WORK.md](INCOMPLETE_WORK.md) for the remaining product
and release work.
