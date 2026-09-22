# Release evidence folder, version 1

Create a folder such as `release-evidence/0.4.0-rc1/` outside any distributed application package. Put `manifest.json` at its root. All referenced files must be regular files **inside that folder**, named by relative forward-slash paths, with lowercase SHA-256 hashes. Never add profiles, cookies, tokens, passwords, raw game screenshots, account labels, or unredacted diagnostics to the folder. This directory is an evidence archive, not a shipping artifact.

The manifest records `format`, `version`, full `commit`, `channel`, `status`, arrays of `artifacts`, `reports`, `screenshots`, `matrix`, and `signoffs`. Use `poolside-release-evidence/v1`. Each artifact has `path`, `sha256`, and `signature` (`unsigned` or `verified`); a verified artifact also needs a `signer` identity and hashed `signatureReport` file. Each report has `kind`, `path`, and `sha256`. Each screenshot has `path`, `sha256`, `privacyReviewed: true`, named `reviewer`, and `reviewedAt` (ISO date/time). Matrix rows identify a configuration, pass/fail/not-run result, and a hashed `report`. Signoffs identify role, name, time, and approve/reject decision. A screenshot review is a human attestation; the tool cannot prove that pixels contain no secrets.

Run `node scripts/check-release-evidence.cjs <folder>/manifest.json` to check structure, containment, and hashes for a draft. Use `--release` for the stricter release gate; an `approved` manifest always triggers that gate even without the flag. It requires verified signatures for every artifact, passing matrix rows, privacy-reviewed screenshot(s), reports for tests, lint, typecheck, SBOM, packaging, packaged self-test, clean VM, update/rollback, soak, security/compliance review, performance, and reproducibility, and named product, QA, security, and release approvals. It will fail for the current preview: missing external evidence must remain missing, not be invented.

The validator does not substitute for certificate-chain verification, provenance review, screenshot inspection, a legal/compliance review, or reproducible-build comparison. Record those results in the linked reports and have the named release reviewers check them. Keep failed results and superseded candidates as separate immutable folders; never edit a rejected manifest into an approved one without a new candidate identity.

Example draft shape (not a release approval):

```json
{
  "format": "poolside-release-evidence/v1",
  "version": "0.4.0",
  "commit": "0000000000000000000000000000000000000000",
  "channel": "development-preview",
  "status": "draft",
  "artifacts": [],
  "reports": [],
  "screenshots": [],
  "matrix": [],
  "signoffs": []
}
```
