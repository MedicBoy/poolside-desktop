// OCR anchors for visible navigation controls. An anchor is text geometry, not a verified button.

const LOBBY_PLAY = { left: 0.17, right: 0.36, top: 0.38, bottom: 0.67 };

function normalizedBox(box, bounds) {
  if (!box || !(bounds?.width > 0) || !(bounds?.height > 0)) return null;
  const { x, y, width, height } = box;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (x < 0 || y < 0 || x + width > bounds.width || y + height > bounds.height) return null;
  return { x: x / bounds.width, y: y / bounds.height, width: width / bounds.width, height: height / bounds.height };
}

function controlCandidates(cells, bounds, state) {
  if (state !== 'lobby' || !Array.isArray(cells)) return [];
  return cells.flatMap(cell => {
    if (cell?.text?.trim().toLowerCase() !== 'play' || !Number.isFinite(cell.confidence) || cell.confidence < 80) return [];
    const box = normalizedBox(cell.box, bounds);
    if (!box) return [];
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    if (centerX < LOBBY_PLAY.left || centerX > LOBBY_PLAY.right || centerY < LOBBY_PLAY.top || centerY > LOBBY_PLAY.bottom) return [];
    return [
      {
        name: 'open-1-on-1',
        screen: 'lobby',
        tableTarget: null,
        bounds: box,
        confidence: Number((cell.confidence / 100).toFixed(2)),
        visible: true,
        disabled: null,
        verified: false,
        evidence: 'ocr-label',
        reviewer: null
      }
    ];
  });
}

module.exports = { normalizedBox, controlCandidates };
