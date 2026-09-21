// Coordinate frames for a capture.
//
// Four coordinate systems meet in the capture path, and until now nothing owned their conversion:
//
//   1. **page CSS pixels** — what `game-region.cjs`'s probe reports, clamped to the page viewport.
//   2. **capture DIPs** — what `webContents.capturePage(rect)` takes, which is CSS pixels ÷ the zoom factor.
//   3. **captured image pixels** — what the OCR worker sees, at the display's device scale factor.
//   4. **the resized image** handed to the recogniser, a fixed 1200 px wide.
//
// A disagreement between any two of them does not fail loudly. It crops the wrong rectangle, or a
// plausible-looking rectangle at the wrong density, and OCR then returns a confident answer read from
// the wrong pixels — the failure mode D5 forbids and the one hardest to notice, because the output looks
// like a normal result. So every conversion lives in this module, and the achieved scale is reported
// rather than assumed.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

/**
 * A capture that has come back, with the density it actually arrived at.
 *
 * Declared as a named typedef rather than inferred: `ReturnType<typeof checkCapture>` does not resolve into a
 * usable object type in a JSDoc position, and a conditional type there collapses to `never`.
 * @typedef {object} CaptureFrame
 * @property {number} width
 * @property {number} height
 * @property {number} scale achieved pixels per page pixel
 * @property {number} expectedScale `zoom × deviceScaleFactor`
 * @property {boolean} matched whether the achieved density is within tolerance of the expected one
 * @property {number} zoom
 * @property {number} deviceScaleFactor
 * @property {{x: number, y: number, width: number, height: number}} pageRect what was asked for, in page pixels
 */

/**
 * How far the achieved density may differ from the expected one before it is reported. Chromium rounds
 * DIP rects to whole device pixels, so an exact match is not available; 2 % covers that rounding without
 * hiding a real scaling difference (125 % display scaling is a 25 % difference).
 */
const DENSITY_TOLERANCE = 0.02;

/** @param {unknown} value @returns {boolean} */
function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** @param {string} reason @param {string} message */
function refusal(reason, message) {
  return { ok: /** @type {const} */ (false), reason, message };
}

/**
 * Convert a region reported in page CSS pixels into the rect `capturePage` takes.
 *
 * The three rounding rules are deliberate, not incidental:
 * - **floor the origin** — a crop that starts even one pixel late loses text at the edge. Text lost at an
 *   edge is a missing term, a missing term is unrecognized, and an unrecognized result from a misaligned crop is the
 *   result the classifier cannot debug.
 * - **round the extent** — the region's own width is a measurement, and rounding it is symmetric.
 * - **never below one pixel** — `sharp.extract()` refuses a zero-sized rectangle, and a caller that has to
 *   guard against that will not.
 *
 * @param {{x: number, y: number, width: number, height: number}} pageRect
 * @param {number} zoomFactor `webContents.getZoomFactor()`
 * @returns {{ok: true, rect: {x: number, y: number, width: number, height: number}, zoom: number} | {ok: false, reason: string, message: string}}
 */
function toCaptureRect(pageRect, zoomFactor) {
  if (!pageRect || typeof pageRect !== 'object') return refusal('no-region', 'No game region was measured.');
  const { x, y, width, height } = /** @type {{x: number, y: number, width: number, height: number}} */ (pageRect);
  if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) {
    return refusal('malformed-region', 'The measured game region was not four finite numbers.');
  }
  if (!isPositiveNumber(zoomFactor)) return refusal('bad-zoom', 'The page zoom factor is not a positive number.');
  if (width <= 0 || height <= 0) return refusal('empty-region', 'The measured game region has no area.');
  const rect = {
    x: Math.floor(x * zoomFactor),
    y: Math.floor(y * zoomFactor),
    width: Math.max(1, Math.round(width * zoomFactor)),
    height: Math.max(1, Math.round(height * zoomFactor))
  };
  if (rect.width < 1 || rect.height < 1) return refusal('empty-region', 'The measured game region is under one pixel wide or tall.');
  return { ok: true, rect, zoom: zoomFactor };
}

/**
 * The inverse, for reporting. Evidence quoted in DIPs is useless to someone looking at the page, so a
 * failure message names the region in the coordinates the page itself uses.
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {number} zoomFactor
 */
function toPageRect(rect, zoomFactor) {
  return {
    x: rect.x / zoomFactor,
    y: rect.y / zoomFactor,
    width: rect.width / zoomFactor,
    height: rect.height / zoomFactor
  };
}

/**
 * Clip a rectangle to the bounds it must fit inside.
 *
 * A region that extends past the capture is **clipped and flagged**, not refused: the probe already clamps
 * to the viewport, so a partial overlap means the surface is partly scrolled out of view, and a clipped
 * capture still carries the text in the visible part. A rectangle with nothing left inside the bounds *is*
 * refused, because an empty crop would be handed to the recogniser as a blank image and read as
 * unrecognized — which looks like a recognition failure rather than a measurement one.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {{width: number, height: number}} bounds
 */
function clampRect(rect, bounds) {
  if (!rect || !bounds || !isPositiveNumber(bounds.width) || !isPositiveNumber(bounds.height)) {
    return refusal('no-bounds', 'There were no bounds to clip the region against.');
  }
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.height, rect.y + rect.height);
  if (!(right - left >= 1 && bottom - top >= 1)) {
    return refusal('outside-frame', 'The region lies entirely outside the game surface.');
  }
  const clipped = left !== rect.x || top !== rect.y || right !== rect.x + rect.width || bottom !== rect.y + rect.height;
  return { ok: /** @type {const} */ (true), rect: { x: left, y: top, width: right - left, height: bottom - top }, clipped };
}

/**
 * The frame for a capture that has just come back: what was asked for, and what actually arrived.
 *
 * `matched` is the honesty check. `capturePage` returns an image at the display's device scale factor, so
 * the image's density is not the page's; when it is not what the caller expected, that is a note on the
 * observation rather than a failure, because the *area* is still the region that was requested — only the
 * density differs, and a density difference is what makes small text unreadable.
 *
 * @param {{pageRect: {x: number, y: number, width: number, height: number}, zoom: number, imageWidth: number, imageHeight: number, deviceScaleFactor?: number}} input
 * @returns {{ok: true, frame: CaptureFrame, notes: string[]} | {ok: false, reason: string, message: string}}
 */
function checkCapture(input) {
  const { pageRect, zoom, imageWidth, imageHeight } = input;
  const factor = isPositiveNumber(input.deviceScaleFactor) ? Number(input.deviceScaleFactor) : 1;
  if (!isPositiveNumber(imageWidth) || !isPositiveNumber(imageHeight)) {
    return refusal('empty-image', 'The capture returned no pixels.');
  }
  if (!isPositiveNumber(pageRect && pageRect.width))
    return refusal('no-region', 'There was no page region to compare the capture against.');
  const expectedScale = zoom * factor;
  const scale = imageWidth / pageRect.width;
  const matched = Math.abs(scale - expectedScale) / expectedScale <= DENSITY_TOLERANCE;
  /** @type {string[]} */
  const notes = [];
  if (!matched) {
    notes.push(`the capture is ${scale.toFixed(3)}x the page where ${expectedScale.toFixed(3)}x was expected`);
  }
  if (scale < 1) notes.push(`it was captured below the page's own scale, so small text may be unreadable`);
  return {
    ok: /** @type {const} */ (true),
    frame: {
      width: imageWidth,
      height: imageHeight,
      scale,
      expectedScale,
      matched,
      zoom,
      deviceScaleFactor: factor,
      pageRect: { ...pageRect }
    },
    notes
  };
}

/** One line describing a frame, for a log or an observation. */
/** @param {CaptureFrame|null} frame */
function describeFrame(frame) {
  if (!frame) return 'no capture frame';
  const density = `${frame.scale.toFixed(3)}x the page`;
  const agreement = frame.matched ? 'as expected' : `expected ${frame.expectedScale.toFixed(3)}x`;
  return `${frame.width}×${frame.height} px at ${density} (${agreement}), from a ${frame.pageRect.width}×${frame.pageRect.height} region at zoom ${frame.zoom}`;
}

module.exports = { toCaptureRect, toPageRect, clampRect, checkCapture, describeFrame, DENSITY_TOLERANCE };
