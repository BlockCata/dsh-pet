const test = require('node:test');
const assert = require('node:assert/strict');
const { pickNextAnimation } = require('../src/animation.js');

test('選擇下一個動畫時避免連續播放同一個動畫', () => {
  const animations = ['待機呼吸休閒', '東張西望'];

  const next = pickNextAnimation(animations, '待機呼吸休閒', () => 0);

  assert.equal(next, '東張西望');
});
