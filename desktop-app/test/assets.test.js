const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const config = require('../assets/animations.json');

test('91 個已登錄動畫與系統匣圖示均為原專案的未修改素材', () => {
  const { animations } = config;
  const names = [...animations.idle, ...animations.turn, ...animations.drag, ...animations.clicks,
    ...animations.moves.actions.map((entry) => entry.name), ...animations.categories.flatMap((entry) => entry.actions)];
  assert.equal(new Set(names).size, 91);
  const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  for (const name of names) {
    assert.equal(hash(path.join(__dirname, '..', 'assets', `${name}.webm`)),
      hash(path.join(__dirname, '..', '..', 'dsh-pet', 'assets', 'webm', `${name}.webm`)), name);
  }
  assert.equal(hash(path.join(__dirname, '..', 'assets', 'tray.png')),
    hash(path.join(__dirname, '..', '..', 'dsh-pet', 'assets', 'pic', 'notify-test.png')));
  assert.equal(animations.events, undefined);
});
