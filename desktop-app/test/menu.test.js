const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('選單列出原專案全部適用動畫，分類動作帶入文字保護，沒有 DSH 事件', () => {
  const modulePath = path.join(__dirname, '..', 'src', 'menu.js');
  assert.ok(fs.existsSync(modulePath), '需要系統匣與桌寵共用的選單');
  const { buildPetMenu } = require(modulePath);
  const config = require('../assets/animations.json');
  let played;
  let chatted = false;
  const items = buildPetMenu(config, { visible: true, roaming: true }, { play: (action) => { played = action; }, chat: () => { chatted = true; } });
  const flatten = (list) => list.flatMap((item) => item.submenu ? flatten(item.submenu) : [item]);
  const actions = flatten(items).filter((item) => item.id?.startsWith('action:'));
  assert.equal(actions.length, 90); // 91 個影片扣除僅拖曳時觸發的一段。
  assert.equal(actions.some((item) => item.label.startsWith('余额-')), false);
  actions.find((item) => item.label === '是啊，吃什么').click();
  assert.deepEqual(played, { kind: 'action', name: '是啊，吃什么', noMirror: true });
  assert.equal(items.find((item) => item.id === 'visibility').label, '隱藏桌寵');
  assert.equal(items.find((item) => item.id === 'roaming').checked, true);
  items.find((item) => item.id === 'chat').click();
  assert.equal(chatted, true);
  assert.equal(buildPetMenu(config, { visible: false, roaming: false }, {}).find((item) => item.id === 'visibility').label, '顯示桌寵');
});
