const { createWorker, PSM } = require('tesseract.js');
const language = require('@tesseract.js-data/eng');
const sharp = require('sharp');

function classifyText(text) {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/come back every day/.test(s) && /play free/.test(s)) return 'lucky-promotion';
  if (/lucky/.test(s) && /play free|gold ball/.test(s)) return 'lucky-shot';
  if (/entry fee/.test(s) && /prize/.test(s)) return 'table-selection';
  if (/play/.test(s) && /special/.test(s) && /9 ball/.test(s) && /box|unlock/.test(s)) return 'lobby';
  if (/\bconnecting\b/.test(s)) return 'connecting';
  if (/\bloading\b/.test(s)) return 'loading';
  return 'unknown';
}

async function createScreenReader() {
  const worker = await createWorker('eng', 1, {
    langPath: language.langPath, gzip: true, cacheMethod: 'none',
    logger: () => {}, errorHandler: () => {}
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150' });
  return {
    async inspect(image) {
      const { data } = await worker.recognize(image);
      const pixels = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width, height, channels } = pixels.info;
      const mask = Buffer.alloc(width * height);
      for (let i = 0; i < mask.length; i++) {
        const r = pixels.data[i * channels], g = pixels.data[i * channels + 1], b = pixels.data[i * channels + 2];
        const low = Math.min(r, g, b), high = Math.max(r, g, b);
        mask[i] = low > 165 && high - low < 70 ? 0 : 255;
      }
      const filtered = await sharp(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
      const contrast = await worker.recognize(filtered);
      let state = classifyText(data.text + '\n' + contrast.data.text);
      if (state === 'unknown') {
        const bottom = await sharp(image).extract({ left: 0, top: Math.floor(height * .8), width, height: height - Math.floor(height * .8) }).resize({ width: width * 2 }).png().toBuffer();
        const details = await worker.recognize(bottom);
        const detailState = classifyText(details.data.text);
        if (['loading', 'connecting'].includes(detailState)) state = detailState;
      }
      // Return only a state; recognized account names and balances are discarded.
      return { state, observedAt: new Date().toISOString() };
    },
    close: () => worker.terminate()
  };
}
module.exports = { classifyText, createScreenReader };
