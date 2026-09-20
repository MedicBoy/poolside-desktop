// Recognise a prolonged local loading/connecting observation. This reports a condition; it never acts on the game.
const STUCK_STATES = new Set(['loading', 'connecting', 'unknown']);
const STUCK_AFTER_MS = 45000;
function observe(current, screen, now = Date.now()) {
  if (!screen || !STUCK_STATES.has(screen.state)) return null;
  const since = current?.state === screen.state && current.since ? current.since : screen.observedAt || new Date(now).toISOString();
  if (now - Date.parse(since) < STUCK_AFTER_MS) return { state: screen.state, since, message: '' };
  return {
    state: screen.state,
    since,
    message: `The screen has remained ${screen.state} for at least 45 seconds. Reload page is available.`
  };
}
module.exports = { observe, STUCK_AFTER_MS, STUCK_STATES };
