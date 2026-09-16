const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('聊天 overlay 靠近角色頭頂，並在空間不足時限制在同一螢幕工作區', () => {
  const { placeBubble } = require('../src/chat/window.js');
  assert.deepEqual(placeBubble(
    { x: -900, y: 20, width: 420, height: 300 }, { width: 380, height: 320 }, { x: -1280, y: 0, width: 1280, height: 1024 },
  ), { x: -880, y: 0, width: 380, height: 320 });
  assert.deepEqual(placeBubble(
    { x: 1500, y: 900, width: 420, height: 300 }, { width: 380, height: 320 }, { x: 0, y: 0, width: 1920, height: 1040 },
  ), { x: 1520, y: 694, width: 380, height: 320 });
});

test('聊天 overlay 可套用每隻桌寵保存的水平與垂直位移，仍不越出工作區', () => {
  const { placeBubble } = require('../src/chat/window.js');
  assert.deepEqual(placeBubble(
    { x: 500, y: 600, width: 420, height: 300 }, { width: 380, height: 320 }, { x: 0, y: 0, width: 1920, height: 1040 }, { x: 80, y: -160 },
  ), { x: 600, y: 234, width: 380, height: 320 });
  assert.deepEqual(placeBubble(
    { x: 1500, y: 900, width: 420, height: 300 }, { width: 380, height: 320 }, { x: 0, y: 0, width: 1920, height: 1040 }, { x: 500, y: 500 },
  ), { x: 1540, y: 720, width: 380, height: 320 });
});

test('每隻桌寵只建立一個泡泡，位置和置頂狀態隨桌寵同步', () => {
  const { createChatWindows } = require('../src/chat/window.js');
  const created = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler) => { this.windowOpenHandler = handler; };
      this.destroyed = false;
      created.push(this);
    }
    setMenu() {}
    setBounds(bounds) { this.bounds = bounds; }
    setAlwaysOnTop(value) { this.topmost = value; }
    loadFile() { return Promise.resolve(); }
    showInactive() { this.visible = true; }
    focus() { this.focused = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    isDestroyed() { return this.destroyed; }
  }
  const petWindow = { getBounds: () => ({ x: 100, y: 120, width: 420, height: 300 }), isAlwaysOnTop: () => true, isVisible: () => true };
  const windows = createChatWindows({ BrowserWindow: Window, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) }, onClose() {} });

  const first = windows.open('a', petWindow);
  const same = windows.open('a', petWindow);
  assert.equal(first, same);
  assert.equal(created.length, 1);
  assert.deepEqual(first.bounds, { x: 120, y: 0, width: 380, height: 320 });
  assert.equal(first.topmost, true);
  assert.equal(first.options.transparent, true);
  assert.equal(first.options.hasShadow, false);
  assert.equal(windows.petIdForSender(first.webContents), 'a');
  const navigation = { prevented: false, preventDefault() { this.prevented = true; } };
  first.webContents.emit('will-navigate', navigation);
  assert.equal(navigation.prevented, true);
  assert.deepEqual(first.windowOpenHandler(), { action: 'deny' });
  windows.hide('a');
  assert.equal(first.visible, false);
  windows.destroy('a');
  assert.equal(windows.petIdForSender(first.webContents), null);
});

test('聊天 overlay 使用各桌寵保存的名稱與尺寸', () => {
  const { createChatWindows } = require('../src/chat/window.js');
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.destroyed = false; }
    setMenu() {}
    setBounds(bounds) { this.bounds = bounds; }
    setAlwaysOnTop() {}
    setTitle(title) { this.title = title; }
    loadFile() { return Promise.resolve(); }
    showInactive() {}
    isDestroyed() { return this.destroyed; }
  }
  const petWindow = { getBounds: () => ({ x: 100, y: 600, width: 420, height: 300 }), isAlwaysOnTop: () => true, isVisible: () => true };
  const windows = createChatWindows({ BrowserWindow: Window, screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) } });
  const overlay = windows.open('a', petWindow, { name: '夏奈', chatSize: { width: 500, height: 440 } });
  assert.deepEqual(overlay.bounds, { x: 60, y: 274, width: 500, height: 440 });
  assert.equal(overlay.title, '和夏奈聊天');
});

test('桌寵在聊天 HTML 載入期間隱藏時，聊天 overlay 不會重新顯示', async () => {
  const { createChatWindows } = require('../src/chat/window.js');
  let finishLoad;
  let petVisible = true;
  class Window extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      this.destroyed = false;
    }
    setMenu() {}
    setBounds() {}
    setAlwaysOnTop() {}
    loadFile() { return new Promise((resolve) => { finishLoad = resolve; }); }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    isDestroyed() { return this.destroyed; }
  }
  const petWindow = {
    getBounds: () => ({ x: 100, y: 400, width: 420, height: 300 }),
    isAlwaysOnTop: () => true,
    isVisible: () => petVisible,
  };
  const windows = createChatWindows({
    BrowserWindow: Window,
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
  });

  const overlay = windows.open('a', petWindow);
  petVisible = false;
  windows.hide('a');
  finishLoad();
  await new Promise(setImmediate);

  assert.equal(overlay.visible, false);
});
