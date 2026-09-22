const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { contrastImage } = require('../src/game-screen.cjs');

test('optimized contrast preparation preserves every original threshold decision', async () => {
  const colors = [
    [0, 0, 0],
    [165, 165, 165],
    [166, 166, 166],
    [255, 200, 200],
    [255, 185, 185],
    [255, 184, 184],
    [255, 255, 255],
    [180, 180, 250],
    [180, 180, 249],
    [200, 220, 210]
  ];
  const raw = Buffer.from(colors.flat());
  const original = await sharp(raw, { raw: { width: colors.length, height: 1, channels: 3 } })
    .png()
    .toBuffer();
  const contrasted = await contrastImage(original);
  const decoded = await sharp(contrasted).greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(
    { width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels },
    { width: colors.length, height: 1, channels: 1 }
  );
  const expected = colors.map(([r, g, b]) => {
    const low = Math.min(r, g, b),
      high = Math.max(r, g, b);
    return low > 165 && high - low < 70 ? 0 : 255;
  });
  assert.deepEqual([...decoded.data], expected);
});

test('contrast preparation handles alpha and larger frames without leaking uninitialized bytes', async () => {
  const width = 127,
    height = 73;
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    raw[i * 4] = (i * 17) % 256;
    raw[i * 4 + 1] = (i * 41) % 256;
    raw[i * 4 + 2] = (i * 97) % 256;
    raw[i * 4 + 3] = 255;
  }
  const original = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const contrasted = await contrastImage(original);
  const { data, info } = await sharp(contrasted).greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data.length, width * height);
  assert.equal(info.channels, 1);
  for (let i = 0; i < data.length; i++) {
    const r = raw[i * 4],
      g = raw[i * 4 + 1],
      b = raw[i * 4 + 2];
    const low = Math.min(r, g, b),
      high = Math.max(r, g, b);
    assert.equal(data[i], low > 165 && high - low < 70 ? 0 : 255);
  }
});
