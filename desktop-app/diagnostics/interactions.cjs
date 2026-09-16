const electron = require('electron');
const { app, BrowserWindow } = electron;
const Module = require('node:module');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'output');
fs.mkdirSync(output, { recursive: true });
let tray;
let menu;
let windowOptions;
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron' && parent?.filename === path.resolve(__dirname, '../src/main.js')) {
    return { ...electron,
      BrowserWindow: function (options) { windowOptions = options; return new BrowserWindow(options); },
      Tray: function (icon) {
        assert.equal(icon.isEmpty(), false);
        tray = new electron.Tray(icon);
        const setContextMenu = tray.setContextMenu.bind(tray);
        tray.setContextMenu = (value) => { menu = value; setContextMenu(value); };
        return tray;
      },
    };
  }
  return originalLoad.call(this, request, parent, ...rest);
};
require('../src/main.js');
Module._load = originalLoad;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    await delay(2500);
    const win = BrowserWindow.getAllWindows()[0];
    const evaluate = (source) => win.webContents.executeJavaScript(source);
    assert.equal(win.isVisible(), true);
    assert.equal(windowOptions.skipTaskbar, true);
    assert.equal(tray.isDestroyed(), false);
    console.log('TRAY', JSON.stringify(tray.getBounds()));
    const current = () => evaluate('decodeURIComponent(document.querySelector("video").currentSrc)');
    const state = await evaluate('({ time: document.querySelector("video").currentTime, width: document.querySelector("video").videoWidth, paused: document.querySelector("video").paused })');
    assert.ok(state.time > 0 && state.width > 0 && !state.paused);
    fs.writeFileSync(path.join(output, 'v0.2.0-idle.png'), (await win.webContents.capturePage()).toPNG());

    menu.getMenuItemById('visibility').click();
    await delay(150);
    assert.equal(win.isVisible(), false);
    assert.equal(await evaluate('document.querySelector("video").paused'), true);
    assert.equal(tray.isDestroyed(), false);
    menu.getMenuItemById('visibility').click();
    await delay(250);
    assert.equal(win.isVisible(), true);
    assert.equal(await evaluate('document.querySelector("video").paused'), false);
    win.close();
    assert.equal(win.isDestroyed(), false);
    assert.equal(win.isVisible(), false);
    tray.emit('click');
    await delay(150);
    assert.equal(win.isVisible(), true);
    console.log('PASS: native tray, no taskbar button, hide/show, close-to-tray and tray-click restore');

    for (const name of ['点击回应-害羞惊讶', '原地专心玩魔方', '吃西瓜', '放烟花', '是啊，吃什么']) {
      menu.getMenuItemById(`action:${name}`).click();
      await delay(180);
      assert.ok((await current()).endsWith(`${name}.webm`), name);
      assert.equal(await evaluate('document.querySelector("video").error'), null);
    }
    menu.getMenuItemById('action:螃蟹走路').click();
    await delay(400);
    const [beforeX] = win.getPosition();
    await evaluate('document.querySelector("video").currentTime = 5');
    await delay(350);
    const [afterX] = win.getPosition();
    assert.notEqual(beforeX, afterX, '影片中段應帶動視窗行走');
    const roaming = menu.getMenuItemById('roaming');
    roaming.click({ checked: false });
    await delay(150);
    const stopped = win.getPosition();
    await delay(150);
    assert.deepEqual(win.getPosition(), stopped);
    assert.ok((await current()).endsWith('待机呼吸休闲.webm'));
    console.log('PASS: five category/menu actions and synchronized walking, stop roaming');

    await evaluate(`window.pointerTrace = []; for (const type of ['pointerdown', 'pointermove', 'pointerup', 'lostpointercapture']) document.addEventListener(type, event => window.pointerTrace.push({ type, src: decodeURIComponent(document.querySelector('video').src) }));`);
    const [pointerX, pointerY] = win.getPosition();
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 210, y: 150, globalX: pointerX + 210, globalY: pointerY + 150, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 230, y: 160, globalX: pointerX + 230, globalY: pointerY + 160, modifiers: ['leftButtonDown'] });
    await delay(200);
    const trace = await evaluate('window.pointerTrace');
    assert.ok(trace.some((event) => event.type === 'pointermove' && event.src.endsWith('被鼠标拖拽悬空反馈.webm')));
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 230, y: 160, globalX: pointerX + 230, globalY: pointerY + 160, button: 'left', clickCount: 1 });
    await delay(200);
    assert.ok((await current()).endsWith('待机呼吸休闲.webm'));
    console.log('PASS: injected pointer selects drag animation; release/capture loss returns to idle');
    win.webContents.send('pet:command', { type: 'action', action: { kind: 'drag', name: '被鼠标拖拽悬空反馈' } });
    await delay(1500);
    fs.writeFileSync(path.join(output, 'v0.2.0-drag.png'), (await win.webContents.capturePage()).toPNG());
    menu.getMenuItemById('action:待机呼吸休闲').click();

    const decoded = await evaluate(`(async () => {
      const config = await window.petAPI.getConfig();
      const a = config.animations;
      const names = [...a.idle, ...a.turn, ...a.drag, ...a.clicks, ...a.moves.actions.map(x => x.name), ...a.categories.flatMap(x => x.actions)];
      const probe = document.createElement('video');
      probe.muted = true;
      for (const name of names) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('decode timeout: ' + name)), 4000);
          probe.onloadeddata = () => { clearTimeout(timer); resolve(); };
          probe.onerror = () => { clearTimeout(timer); reject(new Error('decode failed: ' + name)); };
          probe.src = './assets/' + encodeURIComponent(name) + '.webm';
          probe.load();
        });
        if (!probe.videoWidth || !Number.isFinite(probe.duration)) throw new Error('invalid video: ' + name);
      }
      probe.removeAttribute('src'); probe.load();
      return names.length;
    })()`);
    assert.equal(decoded, 91);
    console.log('PASS: all 91 bundled WebM files decoded in Electron');
    menu.getMenuItemById('quit').click();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
setTimeout(() => { console.error('interaction smoke timeout'); app.exit(2); }, 55000).unref();
