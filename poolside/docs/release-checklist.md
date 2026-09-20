# Poolside release checklist

Use this checklist before handing a portable Poolside build to anyone. A completed checklist is evidence
for one specific build; it does not make an unsigned executable trustworthy by itself.

## Prepare the source tree

- [ ] Work from a clean, reviewed commit and record its commit ID.
- [ ] Use `npm ci` so the dependency tree comes only from `package-lock.json`.
- [ ] Run `npm run sbom:check`. If it fails, run `npm run sbom`, review the change to
      `docs/SBOM.cdx.json`, and repeat the check.
- [ ] Review dependency changes, including Electron and packages with native code, for known security
      advisories and the project's required functionality.
- [ ] Read [the threat model](threat-model.md) and record any accepted residual risks.

## Validate the build

- [ ] Run `npm run verify`.
- [ ] Run `npm run test:desktop`.
- [ ] Run `npm run test:persistence` when session persistence or profile code changed.
- [ ] Run `npm run format:check`.
- [ ] Run `npm run package` from the repository root.
- [ ] Run `npm run release:inspect` and save its output with the release notes. It hashes the exact
      `Poolside.exe` and `resources/app.asar` that form the portable build.
- [ ] Start the newly packaged `Poolside.exe` and verify the dashboard opens without a main-process
      error.

## Review the portable folder

- [ ] Confirm `resources/app.asar` contains `docs/SBOM.cdx.json` and `docs/threat-model.md`.
- [ ] Confirm no saved browser profile, plist/session file, Capture Lab image, diagnostics export,
      password, cookie, token, account label, or personal note is present in the package folder.
- [ ] Record the Poolside version, Electron version, commit ID, inspection hashes, validation results,
      known limitations, and the date.
- [ ] Test the folder on a separate clean Windows account or test machine before public distribution.

## Publish decision

- [ ] Do not claim the build is code-signed unless it has been signed with a managed certificate and
      its Windows signature has been verified.
- [ ] Keep distribution manual until a separately designed and reviewed secure update path exists.
- [ ] If any required validation or review item is incomplete, do not label the folder as a release.
