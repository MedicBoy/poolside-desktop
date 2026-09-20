// The workspace-facing adapter around the persistent activity journal.
// Kept apart from workspace.cjs so persistence policy stays small and independently testable.

/** @param {import('./types.cjs').ActivityEvent[]} events @param {number} maximum */
function createWorkspaceHistory(events, maximum) {
  /** @type {any|null} */
  let journal = null;
  let status = { saved: false, entries: 0, limit: 0 };
  return {
    configure(next) {
      journal = next || null;
      status = journal ? journal.status() : status;
    },
    restore(names) {
      if (!journal) return [];
      const restored = journal.load(names);
      events.push(...restored);
      events.splice(maximum);
      status = journal.status();
      return restored;
    },
    record(entry, names) {
      if (!journal) return;
      try {
        status = journal.append(entry, names);
      } catch {
        // A journal write is optional and must never fail the user action that produced this event.
        status = { ...status, saved: false };
      }
    },
    clear() {
      if (!journal) return { ...status };
      status = journal.clear();
      events.splice(0);
      return { ...status };
    },
    status: () => ({ ...status })
  };
}

module.exports = { createWorkspaceHistory };
