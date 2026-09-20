// Compact, in-memory screen-state history for one open session. A record is added only when the
// recognised state changes, so a 30-second monitor does not turn into an unreadable log.
const LIMIT = 12;
function append(history, screen) {
  const prior = Array.isArray(history) ? history : [];
  if (!screen || typeof screen.state !== 'string' || screen.state === 'inspecting') return prior;
  const entry = {
    state: screen.state,
    score: typeof screen.score === 'number' ? screen.score : null,
    observedAt: screen.observedAt || new Date().toISOString()
  };
  if (prior[0]?.state === entry.state) return prior;
  return [entry, ...prior].slice(0, LIMIT);
}
module.exports = { append, LIMIT };
