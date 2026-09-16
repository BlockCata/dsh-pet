function hitsAlpha(mask, rect, x, y) {
  if (!mask || x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height) return false;
  let column = Math.floor((x - rect.x) / rect.width * mask.width);
  const row = Math.floor((y - rect.y) / rect.height * mask.height);
  if (mask.mirrored) column = mask.width - 1 - column;
  return mask.alpha[row * mask.width + column] > 16;
}

module.exports = { hitsAlpha };
