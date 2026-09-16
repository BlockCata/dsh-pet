const path = require('node:path');

const BUBBLE_SIZE = { width: 380, height: 320 };
const GAP = 12;
const HEAD_TOP_RATIO = 0.42;
const TOPMOST_LEVEL = 'screen-saver';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function placeBubble(petBounds, bubbleSize, workArea, offset = { x: 0, y: 0 }) {
  const width = Math.min(bubbleSize.width, workArea.width);
  const height = Math.min(bubbleSize.height, workArea.height);
  const x = petBounds.x + (petBounds.width - width) / 2 + offset.x;
  const y = petBounds.y + petBounds.height * HEAD_TOP_RATIO - GAP - height + offset.y;
  return {
    x: clamp(x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

function chatDetails(value = {}) {
  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '小女僕',
    chatSize: value.chatSize || BUBBLE_SIZE,
    chatOffset: value.chatOffset || { x: 0, y: 0 },
  };
}

function createChatWindows({ BrowserWindow, screen, onClose = () => {} }) {
  const records = new Map();

  function showIfEligible(record) {
    if (!record.loaded || record.collapsed || record.win.isDestroyed() || !record.petWindow.isVisible()) return false;
    record.win.setAlwaysOnTop(record.petWindow.isAlwaysOnTop(), record.petWindow.isAlwaysOnTop() ? TOPMOST_LEVEL : 'normal');
    record.win.showInactive();
    return true;
  }

  function sync(petId, petWindow, details) {
    const record = records.get(petId);
    if (!record || record.win.isDestroyed()) return null;
    record.petWindow = petWindow;
    if (details) record.details = chatDetails(details);
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    record.win.setBounds(placeBubble(bounds, record.details.chatSize, display.workArea, record.details.chatOffset));
    record.win.setAlwaysOnTop(petWindow.isAlwaysOnTop(), petWindow.isAlwaysOnTop() ? TOPMOST_LEVEL : 'normal');
    record.win.setTitle?.(`和${record.details.name}聊天`);
    return record.win;
  }

  function open(petId, petWindow, details) {
    const existingRecord = records.get(petId);
    const existing = existingRecord?.win;
    if (existing && !existing.isDestroyed()) {
      existingRecord.collapsed = false;
      sync(petId, petWindow, details);
      if (showIfEligible(existingRecord)) existing.focus?.();
      return existing;
    }
    const win = new BrowserWindow({
      ...chatDetails(details).chatSize, title: `和${chatDetails(details).name}聊天`, show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false,
      backgroundColor: '#00000000', webPreferences: {
        preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      },
    });
    const record = { petId, win, petWindow, details: chatDetails(details), loaded: false, collapsed: false };
    records.set(petId, record);
    win.setMenu(null);
    win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    win.webContents.on?.('will-navigate', (event) => event.preventDefault());
    win.on('closed', () => {
      if (records.get(petId) === record) records.delete(petId);
      onClose(petId);
    });
    sync(petId, petWindow, details);
    win.loadFile(path.join(__dirname, '..', '..', 'chat.html')).then(() => {
      record.loaded = true;
      showIfEligible(record);
    }).catch(() => {});
    return win;
  }

  function hide(petId) {
    const record = records.get(petId);
    if (record) record.collapsed = true;
    const win = record?.win;
    if (win && !win.isDestroyed()) win.hide();
  }

  function destroy(petId) {
    const win = records.get(petId)?.win;
    if (win && !win.isDestroyed()) win.destroy();
  }

  function petIdForSender(sender) {
    for (const [petId, record] of records) if (record.win.webContents === sender) return petId;
    return null;
  }

  function get(petId) {
    const win = records.get(petId)?.win;
    return win && !win.isDestroyed() ? win : null;
  }

  return { open, sync, hide, destroy, get, petIdForSender };
}

module.exports = { BUBBLE_SIZE, placeBubble, createChatWindows };
