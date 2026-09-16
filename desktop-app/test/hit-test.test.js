const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('透明像素與矩形外穿透；只有不透明像素命中，含鏡像及縮放', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '../src/hit-test.js')), '不能再讓整塊透明視窗攔截滑鼠');
  const { hitsAlpha } = require('../src/hit-test.js');
  const mask = { width: 4, height: 2, alpha: Uint8Array.from([0, 255, 0, 0, 0, 0, 255, 0]), mirrored: false };
  const rect = { x: 30, y: 48, width: 360, height: 202.5 };
  assert.equal(hitsAlpha(mask, rect, 140, 70), true);
  assert.equal(hitsAlpha(mask, rect, 40, 70), false);
  assert.equal(hitsAlpha(mask, rect, 0, 0), false);
  assert.equal(hitsAlpha(mask, rect, 390, 70), false);
  assert.equal(hitsAlpha({ ...mask, mirrored: true }, rect, 140, 70), false);
  assert.equal(hitsAlpha({ ...mask, mirrored: true }, rect, 260, 70), true);
  assert.equal(hitsAlpha(mask, { x: 60, y: 96, width: 720, height: 405 }, 280, 140), true);
  assert.equal(hitsAlpha(null, rect, 140, 70), false);
});
