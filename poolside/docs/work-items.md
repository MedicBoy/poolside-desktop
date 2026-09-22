# Work-item register

[`work-items.json`](work-items.json) is the machine-checked register for all 142 stable A–Q deliverable IDs in [`MASTER_ROADMAP.md`](../MASTER_ROADMAP.md). Each record has one accountable role, explicit dependencies, the roadmap's acceptance statement, a required evidence type, status, and evidence paths. A responsible person/organization must be assigned before a funded 1.0 schedule is approved; roles here do not imply that an external reviewer has accepted the work.

`open` means the **entire acceptance statement is not yet evidenced**, not that no source code exists. `in-progress` and `blocked` likewise never imply a passed gate. `complete` requires a checked-in evidence path and review of the module's exit gate. Do not mark a live, hosted, signed, clean-VM, performance, security, or compliance gate complete from a local unit test alone.

When changing a deliverable, update the source, tests, registry if a capability mode changes, relevant docs, and the register in one review. `npm run product:check` rejects missing/extra IDs, acceptance drift, invalid or cyclic dependencies, missing owner/evidence contracts, and completed items without an existing evidence path. The separate personal milestone tracker on the user's Desktop is not shipped with the app; update that same file after each verified product update.
