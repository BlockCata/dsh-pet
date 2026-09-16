const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const animation = require('../src/animation.js');
const projectConfig = require('../assets/animations.json');

const config = {
  animationWeights: { idle: 10, turn: 5, move: 5 },
  animations: {
    idle: ['idle'], turn: ['turn'], drag: ['drag'], clicks: ['happy', 'shy'],
    moves: { default: { minDist: 60, maxDist: 240, margin: 20, leadSec: 2, tailSec: 2 }, actions: [{ name: 'walk' }] },
    categories: [{ id: 'play', weight: 70, actions: ['cube'] }, { id: 'text', weight: 10, noMirror: true, actions: ['text'] }],
  },
};

test('隨機鏈遵守分類權重，關閉漫遊後不抽到移動', () => {
  assert.equal(typeof animation.selectNext, 'function');
  assert.equal(animation.selectNext(config, '', false, true, () => 0.17).kind, 'move');
  assert.equal(animation.selectNext(config, '', false, false, () => 0.17).name, 'cube');
  assert.equal(animation.selectNext(config, '', false, true, () => 0.99).name, 'text');
});

test('朝右時不隨機播放會被鏡像的文字動畫', () => {
  assert.equal(typeof animation.selectNext, 'function');
  assert.equal(animation.selectNext(config, '', true, true, () => 0.99).name, 'cube');
});

test('行走在前後停留段不移動，中段按照影片時間前進', () => {
  assert.equal(typeof animation.walkProgress, 'function');
  for (const [time, want] of [[0, 0], [2, 0], [5, 0.5], [8, 1], [10, 1]]) {
    assert.equal(animation.walkProgress(time, 10, { leadSec: 2, tailSec: 2 }), want);
  }
  assert.equal(animation.walkProgress(1, NaN, { leadSec: 2, tailSec: 2 }), 0);
});

test('行走遇到左側邊界反向，負座標螢幕仍保持在工作區', () => {
  assert.equal(typeof animation.planMove, 'function');
  const plan = animation.planMove({ x: -1900, y: 50, width: 420, height: 300 },
    { x: -1920, y: 0, width: 1920, height: 1080 }, config.animations.moves.default, -1, () => 0);
  assert.equal(plan.direction, 1);
  assert.equal(plan.startX, -1900);
  assert.ok(plan.targetX > -1900 && plan.targetX <= -440);
});

test('行走計畫遵守每隻桌寵設定的左右漫遊範圍', () => {
  const plan = animation.planMove({ x: 100, y: 50, width: 420, height: 300 },
    { x: 0, y: 0, width: 1920, height: 1080 },
    { minDist: 60, maxDist: 60, margin: 20 }, 1, () => 0,
    { left: 25, right: 75 });
  assert.equal(plan.startX, 500);
  assert.equal(plan.targetX, 546.7532467532468);
  assert.ok(plan.targetX <= 1440 - 420 - 20);
});

test('自動漫遊只從專案既有移動動畫清單選擇走路動畫', () => {
  const names = projectConfig.animations.moves.actions.map(({ name }) => name);
  assert.deepEqual(names, ['螃蟹走路', '原地漂浮踏步', '原地左转奔跑']);
  for (const name of names) assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', `${name}.webm`)));
});
