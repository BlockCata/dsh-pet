// Test-only instrumentation: keep real windows, menus and IPC; substitute only the OS cursor input.
const electron = require('electron');
const Module = require('node:module');
const path = require('node:path');
const originalLoad = Module._load;
global.petProbe = { ignored: {}, masks: {}, cursor: null, menu: null, tray: null };
electron.ipcMain.on('pet:mask', (event, mask) => { global.petProbe.masks[event.sender.id] = mask; });
Module._load = function (request, parent, ...rest) {
  if (request === './startup.js' && parent?.filename === path.resolve(__dirname, '../src/main.js')) {
    const startup = originalLoad.call(this, request, parent, ...rest);
    return { ...startup, configureElectron(app) {
      startup.configureElectron(app);
      app.setPath('userData', process.env.PET_CONTROLS_PROFILE);
    } };
  }
  if (request === 'electron' && parent?.filename === path.resolve(__dirname, '../src/main.js')) {
    return { ...electron,
      screen: new Proxy(electron.screen, { get(target, key) {
        if (key === 'getCursorScreenPoint') return () => global.petProbe.cursor || target.getCursorScreenPoint();
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } }),
      BrowserWindow: function (options) {
        const win = new electron.BrowserWindow(options);
        const ignore = win.setIgnoreMouseEvents.bind(win);
        win.setIgnoreMouseEvents = (value, opts) => { global.petProbe.ignored[win.id] = value; ignore(value, opts); };
        return win;
      },
      Tray: function (icon) {
        const tray = new electron.Tray(icon);
        global.petProbe.tray = tray;
        const setMenu = tray.setContextMenu.bind(tray);
        tray.setContextMenu = (menu) => { global.petProbe.menu = menu; setMenu(menu); };
        return tray;
      },
    };
  }
  return originalLoad.call(this, request, parent, ...rest);
};
require('../src/main.js');
Module._load = originalLoad;
