const test = require('node:test');
const assert = require('node:assert/strict');

const catalog = {
  dance: { kind: 'action', name: '优雅女仆舞' },
  happy: { kind: 'click', name: '点击回应-开心跃动' },
  none: null,
};

const ready = { visible: true, pointerHeld: false, dragging: false, manualActionPlaying: false, ambientEnabled: true };

test('明確動作只會播放白名單中的既有動畫一次', () => {
  const { createActionDirector } = require('../src/chat/actions.js');
  const sent = [];
  const director = createActionDirector({ catalog, sendToPet: (petId, command) => sent.push([petId, command]) });

  assert.deepEqual(director.request('a', { requestId: 'r1', actionId: 'dance', trigger: 'explicit' }, ready), { status: 'sent' });
  assert.deepEqual(director.request('a', { requestId: 'r1', actionId: 'dance', trigger: 'explicit' }, ready), { status: 'skipped', reason: 'duplicate' });
  assert.deepEqual(director.request('a', { requestId: 'r2', actionId: '../../not-an-animation', trigger: 'explicit' }, ready), { status: 'rejected', reason: 'invalid-action' });
  assert.deepEqual(sent, [['a', {
    type: 'chat-action', requestId: 'r1', action: { kind: 'action', name: '优雅女仆舞' }, trigger: 'explicit',
  }]]);
});

test('氣氛反應會受設定、拖曳優先與十五秒冷卻保護', () => {
  const { createActionDirector } = require('../src/chat/actions.js');
  const sent = [];
  let now = 1_000;
  const director = createActionDirector({ catalog, now: () => now, sendToPet: (petId, command) => sent.push([petId, command]) });

  assert.deepEqual(director.request('a', { requestId: 'r1', actionId: 'happy', trigger: 'ambient' }, { ...ready, ambientEnabled: false }), { status: 'skipped', reason: 'ambient-disabled' });
  assert.deepEqual(director.request('a', { requestId: 'r2', actionId: 'happy', trigger: 'ambient' }, { ...ready, dragging: true }), { status: 'skipped', reason: 'busy' });
  assert.deepEqual(director.request('a', { requestId: 'r3', actionId: 'happy', trigger: 'ambient' }, ready), { status: 'sent' });
  now += 14_999;
  assert.deepEqual(director.request('a', { requestId: 'r4', actionId: 'happy', trigger: 'ambient' }, ready), { status: 'skipped', reason: 'cooldown' });
  now += 1;
  assert.deepEqual(director.request('a', { requestId: 'r5', actionId: 'happy', trigger: 'ambient' }, ready), { status: 'sent' });
  assert.equal(sent.length, 2);
});

test('預設對話動作只映射到專案已登錄的舞蹈與表情動畫', () => {
  const { createActionCatalog } = require('../src/chat/actions.js');
  const animations = require('../assets/animations.json').animations;
  const available = new Set([
    ...animations.idle,
    ...animations.turn,
    ...animations.clicks,
    ...animations.moves.actions.map((entry) => entry.name),
    ...animations.categories.flatMap((entry) => entry.actions),
  ]);

  const actions = createActionCatalog(animations);

  assert.deepEqual(actions.dance, { kind: 'action', name: '优雅女仆舞', noMirror: false });
  assert.deepEqual(actions.none, null);
  for (const action of Object.values(actions)) if (action) assert.equal(available.has(action.name), true);
});

test('表演螃蟹走路只映射到既有的螃蟹走路移動動畫', () => {
  const { createActionCatalog } = require('../src/chat/actions.js');
  const animations = require('../assets/animations.json').animations;

  assert.deepEqual(createActionCatalog(animations).crab_walk, { kind: 'move', name: '螃蟹走路', noMirror: false, explicitOnly: true });
});

test('每個可獨立播放的既有素材都有明確指令，且移動不會成為氣氛反應', () => {
  const { createActionCatalog } = require('../src/chat/actions.js');
  const animations = require('../assets/animations.json').animations;
  const catalog = createActionCatalog(animations);
  const playableNames = [
    ...animations.clicks,
    ...animations.moves.actions.map((entry) => entry.name),
    ...animations.categories.flatMap((category) => category.actions),
  ];
  const catalogEntries = Object.values(catalog).filter(Boolean);

  assert.deepEqual(new Set(catalogEntries.map((entry) => entry.name)), new Set(playableNames));
  for (const name of animations.moves.actions.map((entry) => entry.name)) {
    const entry = catalogEntries.find((candidate) => candidate.name === name);
    assert.equal(entry.kind, 'move');
    assert.equal(entry.explicitOnly, true);
  }
});
