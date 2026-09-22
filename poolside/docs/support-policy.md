# Product boundary and support policy

This is the policy for the **development preview**, not a declaration that a 1.0 release has passed its validation gates. The in-app About view and generated [capability report](CAPABILITIES.md) are the current build's claim inventory.

## Preview operating boundary

| Dimension        | Boundary                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product          | A local 8 Ball Pool session workspace. It is not a completed match automation or transfer product.                                                                                             |
| Operating system | Target: serviced Windows 11 x64, currently 25H2. Windows 10 is outside the target. No clean-VM qualification has yet established a production-supported Windows matrix.                        |
| Game             | Browser-based 8ballpool.com only. Sign-in is performed by the user on the site; Poolside does not verify authentication or pairing.                                                            |
| Game language    | Recognition rules target visible English game text only. The app UI is English only; localization and other game languages are unvalidated.                                                    |
| Display          | Conservative preview target: one monitor, 100% scale, at least 1280 × 720. Other DPI scales, multi-monitor changes, remote desktop, and GPU/driver combinations are not release-qualified.     |
| Sessions         | Multiple isolated windows can be opened, but a supported maximum concurrent session count is not yet established. No 16-session reliability claim.                                             |
| Input            | Table navigation is a no-click dry run. No live game input, match coordination, result/accounting, or automated transfers.                                                                     |
| Privacy          | Data stays local except an explicit user export or game/network traffic from the browser sessions. Captures can contain sensitive information; users must inspect before retaining or sharing. |
| Distribution     | Portable development package. No signed installer, automatic updater, rollback transaction, or clean-VM installation claim.                                                                    |

## Lifetime and assistance

Each preview build is superseded by the next preview. There is no guaranteed support term, service-level agreement, security-maintenance promise, or automatic update channel before 1.0. A superseded local build does not disable itself. Back up user-owned data before replacing a build, and do not treat a portable-folder copy as a complete profile backup. The 1.0 support lifetime, minimum OS, supported display matrix, and maximum sessions must be approved from Modules O, P, and Q evidence before publication.

## Game-service rules and authorization

The current [Miniclip terms](https://www.miniclip.com/terms-and-conditions) restrict cheating involving bots or unauthorized third-party software and separately restrict third-party Coins/Virtual Items. That is a material risk for the blueprint's proposed coordinated game-input and coin-transfer milestones, not a finding that this passive session preview is authorized or prohibited. Those future capabilities remain **off**. Technical tests, local account ownership, and a user confirmation are not substitutes for a documented platform-authorization and legal/service-rule review. Do not enable or distribute live input, pairing, or transfer automation on a claim of compliance unless that gate is resolved and recorded. If it cannot be resolved, retain a manual-only workspace and revise the product scope.

## Change control

Product engineering owns this boundary. Any capability change must update `src/capability-registry.cjs`, regenerate `docs/CAPABILITIES.md` and `docs/capabilities.json`, review the README, architecture notes, incomplete-work register, and ADR-0011, and attach test/live evidence to its work item. `npm run product:check` enforces generated-report and register consistency; human release review still checks prose and screenshots.

Microsoft's [Windows 10 lifecycle notice](https://learn.microsoft.com/en-us/lifecycle/announcements/windows-10-end-of-support) records 14 October 2025 end of support. Microsoft's [Windows 11 Home/Pro lifecycle](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro) lists 25H2 service dates. Those vendor dates inform the target; they do not certify Poolside on any Windows configuration.
