const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function loadRenderer() {
  const elements = new Map();
  const moves = [];
  const dragCalls = [];
  const masks = [];
  const actionStatuses = [];
  let command;
  let menus = 0;
  const config = {
    animationWeights: { idle: 10, turn: 5, move: 5 },
    animations: {
      idle: ['待机呼吸休闲'], turn: ['东张西望'], drag: ['被鼠标拖拽悬空反馈'],
      clicks: ['点击回应-开心跃动'],
      moves: { default: { leadSec: 2, tailSec: 2 }, actions: [{ name: '螃蟹走路' }] },
      categories: [{ id: '文字', weight: 80, noMirror: true, actions: ['是啊，吃什么'] }],
    },
  };
  const canvasContext = {
    draws: 0,
    clearRect() {},
    drawImage() { this.draws++; },
    getImageData() { return { data: new Uint8ClampedArray(320 * 180 * 4) }; },
  };
  const maskContext = { clearRect() {}, drawImage() {}, getImageData() { return { data: new Uint8ClampedArray(320 * 180 * 4) }; } };
  for (const id of ['pet-video', 'pet-canvas', 'pet-stage', 'pet-error']) {
    elements.set(id, {
      src: '', style: {}, events: {}, dataset: {}, paused: false, width: 320, height: 180,
      requestVideoFrameCallback(callback) { this.frameCallback = callback; },
      ...(id === 'pet-canvas' ? { getContext: () => canvasContext } : {}),
      addEventListener(name, handler) { this.events[name] = handler; },
      classList: { add() {}, remove() {} },
      setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return true; },
      play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; },
    });
  }
  const context = vm.createContext({
    window: { petAPI: {
      getConfig: async () => config,
      onCommand: (callback) => { command = callback; },
      moveWindow: (dx, dy) => moves.push([dx, dy]),
      beginDrag: () => dragCalls.push('begin'), endDrag: (cancelled) => dragCalls.push(cancelled ? 'cancel' : 'end'),
      updateMask: (mask) => masks.push(mask),
      showMenu: () => menus++, stopWalk() {},
      beginWalk: async () => ({ direction: -1 }), walkProgress() {},
      actionStatus: (status) => actionStatuses.push(status),
    } },
    document: { getElementById: (id) => elements.get(id), createElement: () => ({ width: 0, height: 0, getContext: () => maskContext }) },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, console,
  });
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, filename] of html.matchAll(/<script src="([^"]+)"/g)) {
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
  }
  await new Promise(setImmediate);
  return { video: elements.get('pet-video'), canvas: elements.get('pet-canvas'), stage: elements.get('pet-stage'), moves, dragCalls, masks, actionStatuses,
    command: (value) => command(value), menus: () => menus };
}

test('HTML 所有 script 共用作用域仍能起播，動畫結束後可接續', async () => {
  const { video, canvas, masks, command } = await loadRenderer();
  assert.equal(decodeURIComponent(video.src), './assets/待机呼吸休闲.webm');
  assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 640, height: 360 });
  command({ type: 'preferences', pet: { size: 150, roaming: true, visible: true } });
  assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 960, height: 540 });
  video.frameCallback();
  assert.equal(canvas.getContext().draws, 1);
  assert.equal(masks.at(-1).width, 320);
  video.events.ended();
  assert.ok(video.src.endsWith('.webm'));
});

test('按下放開播放點擊回應，拖曳則播放懸空並回待機，不誤觸點擊', async () => {
  const { stage, video, moves, command, dragCalls } = await loadRenderer();
  const pointer = (x, y) => ({ button: 0, pointerId: 1, screenX: x, screenY: y });
  stage.events.pointerdown(pointer(100, 100));
  stage.events.pointerup(pointer(100, 100));
  command({ type: 'drag-end', moved: false, cancelled: false });
  assert.equal(decodeURIComponent(video.src), './assets/点击回应-开心跃动.webm');
  stage.events.pointerdown(pointer(100, 100));
  assert.equal(moves.length, 0);
  command({ type: 'drag-start' });
  assert.equal(decodeURIComponent(video.src), './assets/被鼠标拖拽悬空反馈.webm');
  assert.equal(video.loop, true);
  assert.deepEqual(dragCalls, ['begin', 'end', 'begin']);
  stage.events.pointerup(pointer(120, 110));
  command({ type: 'drag-end', moved: true, cancelled: false });
  assert.equal(decodeURIComponent(video.src), './assets/待机呼吸休闲.webm');
  assert.equal(video.loop, false);
});

test('右鍵不拖曳，開啟選單而非退出；隱藏時暫停、顯示後恢復', async () => {
  const harness = await loadRenderer();
  harness.stage.events.pointerdown({ button: 2, pointerId: 1, screenX: 10, screenY: 10 });
  assert.equal(harness.moves.length, 0);
  assert.equal(harness.dragCalls.length, 0);
  harness.stage.events.contextmenu({ preventDefault() {} });
  assert.equal(harness.menus(), 1);
  harness.command({ type: 'visibility', visible: false });
  assert.equal(harness.video.paused, true);
  harness.command({ type: 'visibility', visible: true });
  assert.equal(harness.video.paused, false);
});

test('轉向後鏡像角色，但手動播放文字動作維持文字正向', async () => {
  const { command, video } = await loadRenderer();
  command({ type: 'action', action: { kind: 'turn', name: '东张西望' } });
  video.events.ended();
  command({ type: 'action', action: { kind: 'idle', name: '待机呼吸休闲' } });
  assert.equal(video.style.transform, 'scaleX(-1)');
  command({ type: 'action', action: { kind: 'action', name: '是啊，吃什么', noMirror: true } });
  assert.equal(video.style.transform, 'scaleX(1)');
});

test('拖曳被拒絕或擷取取消後恢復待機，動畫結束仍能接續', async () => {
  const { stage, video, command } = await loadRenderer();
  stage.events.pointerdown({ button: 0, pointerId: 1 });
  command({ type: 'drag-end', moved: false, cancelled: true });
  assert.equal(decodeURIComponent(video.src), './assets/待机呼吸休闲.webm');
  let count = 0;
  video.play = () => { count++; return Promise.resolve(); };
  video.events.ended();
  assert.equal(count, 1);
});

test('聊天動作結束後回到待機，並回報播放生命週期', async () => {
  const { command, video, actionStatuses } = await loadRenderer();
  command({ type: 'chat-action', requestId: 'chat-dance', action: { kind: 'action', name: '优雅女仆舞', noMirror: false }, trigger: 'explicit' });
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(actionStatuses)), [{ requestId: 'chat-dance', state: 'started' }]);
  assert.equal(decodeURIComponent(video.src), './assets/优雅女仆舞.webm');

  video.events.ended();

  assert.deepEqual(JSON.parse(JSON.stringify(actionStatuses)), [
    { requestId: 'chat-dance', state: 'started' },
    { requestId: 'chat-dance', state: 'ended' },
  ]);
  assert.equal(decodeURIComponent(video.src), './assets/待机呼吸休闲.webm');
});
