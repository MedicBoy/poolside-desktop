// Locates the game surface inside the page.
//
// Defect history (D4): the probe demanded exactly one visible canvas/iframe inside an aspect range
// and otherwise returned null. The lobby draws its background as a canvas as well, so a second
// candidate was likely on the real site and the whole inspection would fail with a bare "could
// not isolate the game". It now scores every eligible surface, returns the winner plus the
// runners-up, and reports a machine-readable reason when it cannot decide. That makes a wrong
// choice diagnosable from the error message instead of a guess.
//
// The ranking must still be validated against the live site; the candidate list returned on
// failure exists so that validation takes one iteration rather than a guess.

const MIN_WIDTH = 280;
const MIN_HEIGHT = 180;
const MIN_ASPECT = 1.2;
const MAX_ASPECT = 2.1;
const MIN_COVERAGE = 0.15;
const TARGET_ASPECT = 16 / 9;

const GAME_REGION_PROBE = `(() => {
  const isVisible = el => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.01;
  };
  const blocked = [...document.querySelectorAll('input[type="password"], dialog[open], [role="dialog"]')].some(isVisible);
  if (blocked) return { ok: false, reason: 'login-or-dialog', candidates: [] };

  const viewportArea = innerWidth * innerHeight;
  const boxes = [...document.querySelectorAll('canvas, iframe')].map(el => {
    const rect = el.getBoundingClientRect();
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    const width = Math.round(right - left), height = Math.round(bottom - top);
    const aspect = height > 0 ? width / height : 0;
    const coverage = viewportArea > 0 ? (width * height) / viewportArea : 0;
    return {
      el, left, top, width, height, aspect, coverage,
      kind: el.tagName.toLowerCase(),
      visible: isVisible(el),
      clipped: rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight
    };
  });
  const describe = box => ({
    kind: box.kind, width: box.width, height: box.height,
    aspect: Number(box.aspect.toFixed(3)), coverage: Number(box.coverage.toFixed(3)),
    visible: box.visible, clipped: box.clipped
  });
  const eligible = boxes.filter(box =>
    box.visible && box.width >= ${MIN_WIDTH} && box.height >= ${MIN_HEIGHT} &&
    box.aspect >= ${MIN_ASPECT} && box.aspect <= ${MAX_ASPECT} && box.coverage >= ${MIN_COVERAGE}
  );
  const scored = eligible.map(box => {
    // Shape distance dominates: a full-bleed element loses points for not holding the game's
    // aspect ratio, which is what keeps a page-wide background canvas from outranking the game.
    const shape = 1 - Math.min(1, Math.abs(box.aspect - ${TARGET_ASPECT}) / 1.0);
    const score = 0.65 * shape + 0.35 * Math.min(1, box.coverage);
    return { box, score: Number(score.toFixed(4)) };
  }).sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { ok: false, reason: boxes.length ? 'no-eligible-surface' : 'no-surface', candidates: boxes.slice(0, 5).map(describe) };
  }
  const best = scored[0];
  return {
    ok: true,
    rect: { x: Math.round(best.box.left), y: Math.round(best.box.top), width: best.box.width, height: best.box.height },
    kind: best.box.kind,
    score: best.score,
    candidates: scored.slice(0, 3).map(item => ({ ...describe(item.box), score: item.score }))
  };
})()`;

const REGION_REASONS = {
  'login-or-dialog': 'A sign-in field or dialog is covering the game area. Finish signing in first.',
  'no-surface': 'No canvas or iframe was found on the page. Is the game page open and loaded?',
  'no-eligible-surface': 'A game surface was found but none was large enough or the right shape to capture. Bring the full game area into view.'
};

module.exports = { GAME_REGION_PROBE, REGION_REASONS, MIN_WIDTH, MIN_HEIGHT, MIN_ASPECT, MAX_ASPECT, MIN_COVERAGE };
