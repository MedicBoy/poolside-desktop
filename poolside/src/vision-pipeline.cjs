// The capture pipeline, as one object.
//
// `vision-frame.cjs` owns the coordinates and `vision-grid.cjs` owns the text structure; this module is the
// seam a caller actually holds. One capture in, one frame out, with the transformations it will need derived
// from that frame rather than computed at each call site:
//
//   const pipeline = createVisionPipeline({ pageRect, zoom, image: { width, height } });
//   if (!pipeline.ok) throw new Error(pipeline.message);        // why the capture is unusable
//   pipeline.requested                                          // the rect capturePage should take
//   pipeline.notes                                              // density findings worth reporting
//   const grid = pipeline.read(recognisedLines);                // positioned cells, rows, telemetry
//   pipeline.text(grid)                                         // what the rule engine should read
//   const { bottomBand } = pipeline.handles();                   // crops for a second recognition pass
//
// Decoupled on purpose: this module never touches a window, a canvas or a worker. It takes measurements and
// returns rectangles, which is what makes every rule in it testable as arithmetic rather than observed
// through a running Electron app.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

const { toCaptureRect, checkCapture, describeFrame } = require('./vision-frame.cjs');
const { parseTextGrid, gridText } = require('./vision-grid.cjs');

/**
 * The band of a frame the second recognition pass reads. `game-screen.cjs` computed these inline as
 * `Math.floor(height * 0.8)` and `resize({ width: width * 2 })`; they are named here instead, so the
 * ratio the classifier depends on has one definition and a test can pin it.
 */
const BOTTOM_BAND = 0.8;
const BAND_MAGNIFY = 2;

/**
 * The transformations a capture supports, derived from the captured image.
 *
 * Each handle is in **sharp's own rectangle dialect** — `{left, top, width, height}`, not the `{x, y, …}` that
 * Electron's `capturePage` and this module's coordinate functions use. The two dialects exist, so the handle a
 * caller passes to `.extract()` is deliberately the one sharp takes, with no translation step to get wrong.
 * @param {{width: number, height: number}} imageSize
 * @param {{band?: number, magnify?: number}} [options]
 */
function handles(imageSize, options = {}) {
  const band = Number.isFinite(options.band) ? Number(options.band) : BOTTOM_BAND;
  const magnify = Number.isFinite(options.magnify) ? Number(options.magnify) : BAND_MAGNIFY;
  const top = Math.floor(imageSize.height * band);
  return {
    full: {
      name: 'full',
      rect: { left: 0, top: 0, width: imageSize.width, height: imageSize.height },
      resize: null
    },
    bottomBand: {
      name: 'bottomBand',
      rect: { left: 0, top, width: imageSize.width, height: Math.max(1, imageSize.height - top) },
      resize: { width: Math.round(imageSize.width * magnify) }
    }
  };
}

/**
 * @param {{pageRect: {x: number, y: number, width: number, height: number}, zoom: number, imageWidth?: number, imageHeight?: number, deviceScaleFactor?: number, band?: number, magnify?: number}} input
 */
function createVisionPipeline(input) {
  const requested = toCaptureRect(input.pageRect, input.zoom);
  if (!requested.ok) return { ok: /** @type {const} */ (false), stage: 'request', reason: requested.reason, message: requested.message };
  if (input.imageWidth === undefined || input.imageHeight === undefined) {
    // A caller that only wants the rect for `capturePage` gets it without inventing a frame for an image it
    // has not taken yet. `frame` and `read` are absent in this stage, which is what the absence means.
    return { ok: /** @type {const} */ (true), stage: 'request', requested: requested.rect, frame: null, notes: [] };
  }
  const checked = checkCapture({
    pageRect: input.pageRect,
    zoom: requested.zoom,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    deviceScaleFactor: input.deviceScaleFactor
  });
  if (!checked.ok) {
    return {
      ok: /** @type {const} */ (false),
      stage: 'capture',
      reason: checked.reason,
      message: checked.message,
      requested: requested.rect
    };
  }
  const captured = checked.frame;
  return {
    ok: /** @type {const} */ (true),
    stage: 'capture',
    requested: requested.rect,
    frame: captured,
    notes: checked.notes,
    handles: () => handles(captured, input),
    read: lines => parseTextGrid(lines, captured),
    text: gridText,
    describe: () => describeFrame(captured)
  };
}

module.exports = { createVisionPipeline, handles, BOTTOM_BAND, BAND_MAGNIFY };
