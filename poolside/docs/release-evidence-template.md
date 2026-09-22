# Poolside preview release evidence

Copy this template for one exact candidate build. Keep the record with `release-inspection.json`,
`docs/SBOM.cdx.json`, test logs, and the signed artifacts when signing exists. Do not include
browser profiles, Capture Lab images, account labels, credentials, or raw diagnostic payloads.

| Field                                              | Record                              |
| -------------------------------------------------- | ----------------------------------- |
| Poolside version and channel                       |                                     |
| Git commit and clean/dirty status                  |                                     |
| Electron and Node versions                         |                                     |
| Windows build, CPU, GPU/driver, RAM, display scale |                                     |
| Build and test date (UTC)                          |                                     |
| `npm ci`, format, lint, type check, unit tests     |                                     |
| Two-process persistence and packaged self-test     |                                     |
| Corpus gate (held-out, frozen, aggregate only)     |                                     |
| Package inspection SHA-256 and SBOM SHA-256        |                                     |
| Signing identity and verification                  | Not available for unsigned previews |
| Clean-VM install/update/rollback/uninstall         |                                     |
| 16-session stretch and 72-hour soak                |                                     |
| Known limitations and open gates                   |                                     |
| Reviewer and release decision                      |                                     |

A green local test run is not a signed or clean-machine release. Missing fields remain visibly
unverified rather than being inferred from CI or development Evidence captures.
