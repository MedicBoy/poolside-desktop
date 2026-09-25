// Pure decision and coordinate transform for a future input adapter; never dispatches input.

/** @param {any} observation @param {any} frame @param {{name?: string, screen?: string, generation?: number, now?: number, maxAgeMs?: number}} [options] */
function resolveControl(observation, frame, { name, screen, generation, now = Date.now(), maxAgeMs = 2000 } = {}) {
  const refuse = reason => ({ ok: false, reason });
  if (!observation || !Number.isFinite(Date.parse(observation.observedAt))) return refuse('missing-observation');
  const age = now - Date.parse(observation.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return refuse('stale-observation');
  if (
    observation.screen?.state !== screen ||
    !Number.isFinite(observation.screen.confidence) ||
    observation.screen.confidence < 0.9 ||
    observation.contradictions?.length
  )
    return refuse('screen-uncertain');
  if (!Number.isSafeInteger(generation) || observation.capture?.generation !== generation) return refuse('generation-changed');
  if (
    !frame?.matched ||
    !frame.pageRect ||
    !(frame.pageRect.width > 0) ||
    !(frame.pageRect.height > 0) ||
    !observation.capture?.matched ||
    !/^[a-f0-9]{64}$/.test(observation.capture.sha256 || '')
  )
    return refuse('frame-unmatched');
  if (
    observation.capture.width !== frame.width ||
    observation.capture.height !== frame.height ||
    ['x', 'y', 'width', 'height'].some(key => observation.capture.pageRect?.[key] !== frame.pageRect[key])
  )
    return refuse('frame-moved');
  const matches = (observation.controls || []).filter(control => control.name === name && control.screen === screen);
  if (matches.length !== 1) return refuse('control-ambiguous');
  const control = matches[0];
  if (!control.verified || !control.visible || control.disabled !== false || control.confidence < 0.95) return refuse('control-unverified');
  const box = control.bounds;
  if (
    !box ||
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0 ||
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > 1 ||
    box.y + box.height > 1
  )
    return refuse('control-outside-surface');
  return {
    ok: true,
    pagePoint: {
      x: frame.pageRect.x + (box.x + box.width / 2) * frame.pageRect.width,
      y: frame.pageRect.y + (box.y + box.height / 2) * frame.pageRect.height
    }
  };
}

module.exports = { resolveControl };
