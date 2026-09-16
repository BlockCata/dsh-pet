const { app, BrowserWindow, ipcMain, powerMonitor, screen, Tray, Menu, nativeImage, dialog, safeStorage, shell } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { configureElectron } = require('./startup.js');
const { buildPetMenu } = require('./menu.js');
const { planMove } = require('./animation.js');
const { petDimensions, videoRectangle, anchoredPosition, dragPosition, recoverPet } = require('./layout.js');
const { loadSettings, saveSettings, validateSettings } = require('./settings-store.js');
const { hitsAlpha } = require('./hit-test.js');
const { createConfigStore, normalizeBaseUrl } = require('./ai/config-store.js');
const { testConnection, listModels, streamReply } = require('./ai/providers.js');
const { createBlockedBrowserSearch } = require('./browser-search/blocked.js');
const { createWebQueryCoordinator } = require('./browser-search/coordinator.js');
const { DEFAULT_SEARCH_BUDGET } = require('./browser-search/budget.js');
const { createSessions } = require('./chat/session.js');
const { createChatWindows } = require('./chat/window.js');
const { createActionCatalog, createActionChoices, createActionDirector } = require('./chat/actions.js');
const { createCareController } = require('./chat/care.js');
const { createAttachmentStore } = require('./chat/attachments.js');
const { validateSourceUrl } = require('./chat/search.js');
const { createMemoryStore } = require('./memory/store.js');
const { createDiaryWorker } = require('./memory/diary.js');
const { selectContextForMemory } = require('./memory/context.js');
const config = require('../assets/animations.json');

const pets = new Map();
let state = { version: 1, pets: [], searchBudget: { ...DEFAULT_SEARCH_BUDGET } };
let settingsFile;
let aiConfigStore;
let memoryStore;
let attachmentStore;
let diaryWorker;
let chatWindows;
let chatSessions;
let actionDirector;
let careController;
let settingsWindow;
let diaryWindow;
let diaryPetId;
let tray;
let inputTimer;
let quitting = false;
let quitCleanupStarted = false;
let initialized = false;
let suspended = false;
const TOPMOST_LEVEL = 'screen-saver';

configureElectron(app);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function snapshot() {
  return { ...state, displays: screen.getAllDisplays().map((display, index) => ({
    id: display.id, label: display.label || `螢幕 ${index + 1}`, workArea: display.workArea, scaleFactor: display.scaleFactor,
  })) };
}

function notifySettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings:changed', snapshot());
}

function persistPosition() {
  try { saveSettings(settingsFile, state); }
  catch (error) { dialog.showErrorBox('桌寵設定未能儲存', error.message); }
  notifySettings();
}

function send(record, command) { record.win.webContents.send('pet:command', command); }

function actionState(record) {
  return {
    visible: record.pet.visible,
    pointerHeld: !!record.drag,
    dragging: !!record.drag?.moved,
    manualActionPlaying: false,
    ambientEnabled: record.pet.ambientReactions !== false,
  };
}

function applyAlwaysOnTop(record) {
  const enabled = record.pet.alwaysOnTop !== false;
  record.win.setAlwaysOnTop(enabled, enabled ? TOPMOST_LEVEL : 'normal');
}

function syncCare(record) {
  careController?.sync(record.pet.id, { enabled: record.pet.careEnabled, visible: record.pet.visible && !suspended });
}

function openChat(record, { sendStartupGreeting = true } = {}) {
  if (!chatWindows || !chatSessions) return;
  chatWindows.open(record.pet.id, record.win, record.pet);
}

function greetingPrompt(record) {
  const hour = new Date().getHours();
  const period = hour < 11 ? '早上' : hour < 18 ? '下午' : '晚上';
  const memory = memoryStore?.read(record.pet.id);
  const diary = Array.isArray(memory?.diaries) ? memory.diaries.at(-1)?.text : '';
  const context = typeof diary === 'string' && diary.trim() ? `可參考的最近日記：${diary.trim().slice(0, 600)}` : '沒有可參考的既有日記。';
  return `現在是${period}，這是程式真正啟動後的唯一一次問候。請以角色身分寫一句不超過 60 字、繁體中文的自然問候；${context}。不可聲稱看見、知道或替使用者做過任何未提供的事。`;
}

function chatTimeContext(currentTime) {
  const date = new Date(currentTime);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  let timezone = 'UTC';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone; } catch {}
  return { currentTime: date.toISOString(), timezone, utcOffset: `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}` };
}

async function generatePetMessage(record, mode, prompt) {
  let text = '';
  try {
    for await (const event of streamReply({
      connection: aiConfigStore.getConnection(),
      messages: [{ role: 'user', text: prompt }],
      profile: { name: record.pet.name, ...record.pet.profile },
      mode,
    })) if (event.type === 'delta') text += event.text;
  } catch { return ''; }
  return text.trim();
}

async function startStartupGreeting(record) {
  if (record.startupGreetingStarted || !record.pet.visible) return;
  record.startupGreetingStarted = true;
  const text = await generatePetMessage(record, 'greeting', greetingPrompt(record));
  if (!text.trim() || quitting || pets.get(record.pet.id) !== record) return;
  chatSessions?.appendPetMessage(record.pet.id, text.trim());
  careController?.pause(record.pet.id);
}

function carePrompt(record) {
  const action = record.lastPlayedActionName
    ? `這隻桌寵最近已實際播放的動作是「${record.lastPlayedActionName}」。`
    : '這隻桌寵近期沒有可確認的已播放動作。';
  return `你要主動關心使用者。${action} 請用繁體中文寫一句不超過 60 字、可不必回覆的自然訊息；只能描述上述已確認動作，不可捏造使用者正在做什麼或取得任何未提供資訊。`;
}

async function deliverCareMessage(petId) {
  const record = pets.get(petId);
  if (!record || !record.pet.visible) return;
  const text = await generatePetMessage(record, 'proactive', carePrompt(record));
  if (!text || quitting || pets.get(petId) !== record || !record.pet.visible) return;
  openChat(record);
  chatSessions?.appendPetMessage(petId, text);
}

function runUiAction(action) {
  try { return action(); }
  catch (error) {
    dialog.showErrorBox('桌寵設定未能儲存', error.message);
    refreshTray();
  }
}

function ignoreMouse(record, ignore) {
  if (record.ignored === ignore) return;
  record.ignored = ignore;
  record.win.setIgnoreMouseEvents(ignore, { forward: true });
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 800, height: 680, minWidth: 660, minHeight: 560, title: '藍髮小女僕 — 設定',
    autoHideMenuBar: true, backgroundColor: '#f4f7fc',
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWindow.setMenu(null);
  const win = settingsWindow;
  win.loadFile(path.join(__dirname, '..', 'settings.html')).catch((error) => {
    if (!quitting && !win.isDestroyed()) dialog.showErrorBox('設定介面載入失敗', error.message);
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function openDiary(petId) {
  const pet = state.pets.find((item) => item.id === petId);
  if (!pet) throw new Error('找不到桌寵。');
  if (diaryWindow && !diaryWindow.isDestroyed() && diaryPetId === petId) { diaryWindow.show(); diaryWindow.focus(); return; }
  if (diaryWindow && !diaryWindow.isDestroyed()) diaryWindow.close();
  const win = new BrowserWindow({ width: 520, height: 560, title: `${pet.name}的日記`, webPreferences: { preload: path.join(__dirname, 'diary-preload.js'), contextIsolation: true, nodeIntegration: false } });
  diaryWindow = win;
  diaryPetId = petId;
  win.setMenu(null);
  win.on('closed', () => { if (diaryWindow === win) { diaryWindow = null; diaryPetId = null; } });
  win.loadFile(path.join(__dirname, '..', 'diary.html')).catch(() => {});
}

function decodeChatAttachments(request) {
  const items = request?.attachments === undefined ? [] : request.attachments;
  if (!Array.isArray(items)) throw new Error('圖片附件格式無效。');
  return items.map((attachment) => {
    const data = attachment?.data;
    if (typeof data !== 'string' || !data || data.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw new Error('圖片資料無效。');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.toString('base64') !== data) throw new Error('圖片資料無效。');
    return { name: attachment?.name, mimeType: attachment?.mimeType, bytes };
  });
}

function menuFor(record) {
  return buildPetMenu(config, record.pet, {
    settings: openSettings,
    chat: () => openChat(record),
    toggleVisibility: () => runUiAction(() => updatePet(record.pet.id, { visible: !record.pet.visible })),
    setRoaming: (enabled) => runUiAction(() => updatePet(record.pet.id, { roaming: enabled })),
    play: (action) => runUiAction(() => {
      if (!record.pet.visible) updatePet(record.pet.id, { visible: true });
      finishDrag(record, true);
      send(record, { type: 'action', action });
    }),
    quit: () => app.quit(),
  });
}

function refreshTray() {
  if (!tray || quitting) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { id: 'settings', label: '桌寵設定…', click: openSettings },
    { type: 'separator' },
    ...[...pets.values()].map((record, index) => ({ label: `小女僕 ${index + 1}${record.pet.visible ? '' : '（隱藏）'}`, submenu: menuFor(record) })),
    { label: '全部顯示', enabled: pets.size > 0, click: () => runUiAction(() => commitPets(state.pets.map((pet) => ({ ...pet, visible: true })))) },
    { label: '全部隱藏', enabled: pets.size > 0, click: () => runUiAction(() => commitPets(state.pets.map((pet) => ({ ...pet, visible: false })))) },
    { type: 'separator' },
    { id: 'quit', label: '結束程式', click: () => app.quit() },
  ]));
}

function applyPet(record) {
  if (record.drag) { record.drag = null; send(record, { type: 'drag-end', moved: true, cancelled: true }); }
  record.walk = null;
  record.mask = null;
  ignoreMouse(record, true);
  const { pet, win } = record;
  applyAlwaysOnTop(record);
  win.setBounds({ x: pet.x, y: pet.y, ...petDimensions(pet.size) });
  send(record, { type: 'preferences', pet });
  if (record.ready) { if (pet.visible) win.showInactive(); else win.hide(); }
  if (pet.visible) chatWindows?.sync(record.pet.id, win, record.pet);
  else chatWindows?.hide(record.pet.id);
}

function createPet(pet) {
  const win = new BrowserWindow({
    ...petDimensions(pet.size), x: pet.x, y: pet.y,
    show: false, frame: false, transparent: true, alwaysOnTop: pet.alwaysOnTop !== false, skipTaskbar: true,
    resizable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const record = { pet, win, mask: null, walk: null, drag: null, chatAction: null, startupGreetingStarted: false, ignored: null, ready: false };
  pets.set(pet.id, record);
  applyAlwaysOnTop(record);
  ignoreMouse(record, true);
  win.webContents.once('did-finish-load', () => {
    if (quitting || win.isDestroyed()) return;
    record.ready = true;
    if (record.pet.visible) win.showInactive();
  });
  for (const eventName of ['show', 'hide']) win.on(eventName, () => {
    record.walk = null;
    if (!win.isVisible()) { finishDrag(record, true); ignoreMouse(record, true); }
    send(record, { type: 'visibility', visible: win.isVisible() });
    if (win.isVisible()) { applyAlwaysOnTop(record); chatWindows?.sync(record.pet.id, win); }
    else chatWindows?.hide(record.pet.id);
  });
  for (const eventName of ['move', 'resize']) win.on(eventName, () => chatWindows?.sync(record.pet.id, win));
  win.on('close', (event) => {
    if (!quitting) { event.preventDefault(); runUiAction(() => updatePet(record.pet.id, { visible: false })); }
  });
  win.webContents.on('render-process-gone', (_event, details) => console.error('[desktop-pet] renderer gone:', details));
  win.loadFile(path.join(__dirname, '..', 'index.html')).catch((error) => {
    if (!quitting && !win.isDestroyed()) dialog.showErrorBox('桌寵載入失敗', error.message);
  });
  return record;
}

function commitPets(nextPets) {
  const next = validateSettings({ version: 1, pets: nextPets, searchBudget: state.searchBudget });
  saveSettings(settingsFile, next);
  state = next;
  for (const [id, record] of pets) {
    if (!state.pets.some((pet) => pet.id === id)) {
      chatSessions?.dispose(id);
      actionDirector?.dispose(id);
      careController?.dispose(id);
      diaryWorker?.cancel(id);
      memoryStore?.remove?.(id);
      chatWindows?.destroy(id);
      pets.delete(id);
      record.win.destroy();
    }
  }
  for (const pet of state.pets) {
    const record = pets.get(pet.id);
    if (!record) createPet(pet);
    else {
      const changed = JSON.stringify(record.pet) !== JSON.stringify(pet);
      const webSearchDisabled = record.pet.webQueryEnabled === true && pet.webQueryEnabled !== true;
      record.pet = pet;
      if (webSearchDisabled) chatSessions?.cancel(pet.id);
      if (changed) applyPet(record);
    }
    syncCare(pets.get(pet.id));
  }
  refreshTray();
  notifySettings();
  return snapshot();
}

function commitSearchBudget(searchBudget) {
  const next = validateSettings({ version: 1, pets: state.pets, searchBudget });
  saveSettings(settingsFile, next);
  state = next;
  notifySettings();
  return snapshot();
}

function cleanupError(result) {
  if (result?.status !== 'blocked') return null;
  const error = new Error('聊天搜尋清理失敗。');
  error.code = result.reason || 'browser-search-parser-cleanup-failed';
  return error;
}

function quittingError() {
  const error = new Error('應用程式正在結束。');
  error.code = 'chat-quitting';
  return error;
}

async function removePet(petId) {
  const error = cleanupError(await chatSessions?.dispose(petId));
  if (error) throw error;
  return commitPets(state.pets.filter((pet) => pet.id !== petId));
}

function updatePet(id, patch) {
  const previous = state.pets.find((pet) => pet.id === id);
  if (!previous) throw new Error('找不到這隻桌寵。');
  const candidate = { ...previous, ...patch, id };
  if (patch.anchor) {
    if (!['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'].includes(patch.anchor)) throw new Error('定位選項無效。');
    const display = screen.getAllDisplays().find((item) => item.id === candidate.displayId);
    if (!display) throw new Error('選取的螢幕已中斷連線。');
    Object.assign(candidate, anchoredPosition(display.workArea, candidate.size, patch.anchor));
  }
  const validated = validateSettings({ version: 1, pets: [candidate] }).pets[0];
  const recovered = recoverPet(validated, screen.getAllDisplays());
  return commitPets(state.pets.map((pet) => pet.id === id ? recovered : pet));
}

function addPet() {
  const display = screen.getPrimaryDisplay();
  const position = anchoredPosition(display.workArea, 100, 'bottom-right');
  const offset = (state.pets.length % 5) * 32;
  const pet = recoverPet({ id: randomUUID(), size: 100, x: position.x - offset, y: position.y - offset,
    displayId: display.id, visible: true, roaming: true }, screen.getAllDisplays());
  return commitPets([...state.pets, pet]);
}

function duplicatePet(sourcePetId, { includeMemory = false } = {}) {
  if (typeof includeMemory !== 'boolean') throw new Error('複製選項無效。');
  const source = state.pets.find((pet) => pet.id === sourcePetId);
  if (!source) throw new Error('找不到這隻桌寵。');
  const targetId = randomUUID();
  memoryStore.clone(sourcePetId, targetId, { includeMemory });
  const copied = recoverPet({ ...source, id: targetId, x: source.x + 32, y: source.y + 32, visible: true }, screen.getAllDisplays());
  try { commitPets([...state.pets, copied]); }
  catch (error) { memoryStore.remove?.(targetId); throw error; }
  return { petId: targetId, state: snapshot() };
}

function requirePetMemory(petId) {
  if (!state.pets.some((pet) => pet.id === petId)) throw new Error('找不到這隻桌寵。');
  return memoryStore.read(petId);
}

function listCustomModels({ baseUrl, key } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, { required: true });
  if (typeof key === 'string' && key.trim()) return listModels({ provider: 'custom', baseUrl: normalizedBaseUrl, key: key.trim() });
  const connection = aiConfigStore.getConnection();
  if (connection.provider !== 'custom' || connection.baseUrl !== normalizedBaseUrl) throw new Error('請輸入此 API 網址專用的金鑰。');
  return listModels(connection);
}

async function clearPetMemory(petId) {
  requirePetMemory(petId);
  const error = cleanupError(await chatSessions?.dispose(petId));
  if (error) throw error;
  diaryWorker?.cancel(petId);
  return memoryStore.clear(petId);
}

function petFrom(event) {
  return [...pets.values()].find((record) => record.win.webContents === event.sender);
}

function finishDrag(record, cancelled = false) {
  const drag = record.drag;
  if (!drag) return;
  record.drag = null;
  const bounds = record.win.getBounds();
  Object.assign(record.pet, recoverPet({ ...record.pet, x: bounds.x, y: bounds.y }, screen.getAllDisplays()));
  record.win.setPosition(record.pet.x, record.pet.y, false);
  send(record, { type: 'drag-end', moved: drag.moved, cancelled });
  persistPosition();
}

function pollInput() {
  const cursor = screen.getCursorScreenPoint();
  for (const record of pets.values()) {
    if (!record.ready || !record.pet.visible) continue;
    const bounds = record.win.getBounds();
    if (record.drag) {
      const drag = record.drag;
      if (!drag.moved && Math.hypot(cursor.x - drag.start.x, cursor.y - drag.start.y) >= 5) {
        drag.moved = true;
        send(record, { type: 'drag-start' });
      }
      if (drag.moved) {
        const position = dragPosition(cursor, drag.offset);
        record.win.setBounds({ ...position, ...petDimensions(record.pet.size) });
        Object.assign(record.pet, position);
      }
      ignoreMouse(record, false);
    } else {
      ignoreMouse(record, !hitsAlpha(record.mask, videoRectangle(bounds), cursor.x - bounds.x, cursor.y - bounds.y));
    }
  }
}

ipcMain.handle('pet:config', (event) => {
  const record = petFrom(event);
  if (!record) throw new Error('不允許的設定請求。');
  return { ...config, preferences: record.pet };
});
ipcMain.on('pet:menu', (event) => {
  const record = petFrom(event);
  if (record) Menu.buildFromTemplate(menuFor(record)).popup({ window: record.win });
});
ipcMain.on('pet:mask', (event, mask) => {
  const record = petFrom(event);
  if (!record) return;
  if (mask === null) { record.mask = null; return; }
  if (mask.width === 320 && mask.height === 180 && mask.alpha instanceof Uint8Array && mask.alpha.length === 57600) record.mask = mask;
});
ipcMain.on('pet:begin-drag', (event) => {
  const record = petFrom(event);
  if (!record || record.drag) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = record.win.getBounds();
  if (!record.pet.visible || !hitsAlpha(record.mask, videoRectangle(bounds), cursor.x - bounds.x, cursor.y - bounds.y)) {
    send(record, { type: 'drag-end', moved: false, cancelled: true });
    return;
  }
  record.walk = null;
  record.drag = { start: cursor, offset: { x: cursor.x - bounds.x, y: cursor.y - bounds.y }, moved: false };
  ignoreMouse(record, false);
});
ipcMain.on('pet:end-drag', (event, cancelled) => { const record = petFrom(event); if (record) finishDrag(record, !!cancelled); });
ipcMain.handle('pet:begin-walk', (event, name, direction) => {
  const record = petFrom(event);
  const entry = config.animations.moves.actions.find((action) => action.name === name);
  if (!record || !entry || record.drag || !record.pet.visible) return null;
  const bounds = record.win.getBounds();
  record.walk = planMove(bounds, screen.getDisplayMatching(bounds).workArea, { ...config.animations.moves.default, ...entry.params }, direction === 1 ? 1 : -1, Math.random, record.pet.roamingRange);
  return { direction: record.walk.direction };
});
ipcMain.on('pet:walk-progress', (event, progress) => {
  const record = petFrom(event);
  if (!record?.walk || record.drag || !Number.isFinite(progress) || !record.pet.visible) return;
  const walk = record.walk;
  const x = Math.round(walk.startX + (walk.targetX - walk.startX) * Math.max(0, Math.min(1, progress)));
  if (x !== record.pet.x) { record.pet.x = x; record.win.setPosition(x, record.pet.y, false); }
});
ipcMain.on('pet:stop-walk', (event) => {
  const record = petFrom(event);
  if (record?.walk) { record.walk = null; persistPosition(); }
});
ipcMain.on('pet:action-status', (event, status) => {
  const record = petFrom(event);
  if (!record || !status || status.requestId !== record.chatAction || !['started', 'ended', 'failed', 'interrupted'].includes(status.state)) return;
  if (status.state === 'started' && record.pendingChatActionName) record.lastPlayedActionName = record.pendingChatActionName;
  if (['ended', 'failed', 'interrupted'].includes(status.state)) { record.chatAction = null; record.pendingChatActionName = null; }
  chatWindows?.get(record.pet.id)?.webContents.send('chat:event', { requestId: status.requestId, type: 'action-status', status: status.state });
});
ipcMain.handle('chat:get', (event) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  if (!petId) throw new Error('不允許的聊天請求。');
  return chatSessions.getMessages(petId);
});
ipcMain.handle('chat:get-attachment', (event, request) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  if (!petId) throw new Error('不允許的聊天請求。');
  if (typeof request?.messageId !== 'string' || !request.messageId || typeof request?.attachmentId !== 'string' || !request.attachmentId) throw new Error('找不到附件。');
  const message = chatSessions.getMessages(petId).find((item) => item.id === request.messageId);
  const attachment = message?.attachments?.find((item) => item.id === request.attachmentId);
  if (!attachment) throw new Error('找不到附件。');
  return { mimeType: attachment.mimeType, data: attachmentStore.read(petId, attachment).toString('base64') };
});
ipcMain.handle('chat:info', (event) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  const pet = state.pets.find((item) => item.id === petId);
  if (!pet) throw new Error('不允許的聊天請求。');
  return { name: pet.name, chatSize: pet.chatSize };
});
ipcMain.handle('chat:resize', (event, chatSize) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  if (!petId) throw new Error('不允許的聊天請求。');
  const snapshot = updatePet(petId, { chatSize });
  const pet = snapshot.pets.find((item) => item.id === petId);
  return { name: pet.name, chatSize: pet.chatSize };
});
ipcMain.handle('chat:send', (event, request) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  if (!petId) throw new Error('不允許的聊天請求。');
  const pet = state.pets.find((item) => item.id === petId);
  if (!pet) throw new Error('不允許的聊天請求。');
  if (quitting) throw quittingError();
  const allowWebSearch = pet.webQueryEnabled === true;
  if (!allowWebSearch && typeof request?.text === 'string' && request.text.trim()) careController?.acknowledge(petId);
  const memory = memoryStore.read(petId);
  const attachments = allowWebSearch ? [] : attachmentStore.stage(petId, decodeChatAttachments(request), { persist: memory.policy.mode !== 'off' });
  return chatSessions.send(petId, { requestId: request?.requestId, text: request?.text, mode: 'chat', allowWebSearch, attachments }).finally(() => {
    const retainedIds = new Set(memoryStore.read(petId).messages.flatMap((message) => message.attachments || []).map((attachment) => attachment.id));
    attachmentStore.discard(petId, attachments.filter((attachment) => !retainedIds.has(attachment.id)));
  });
});
ipcMain.handle('chat:edit-latest', (event, request) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  if (!petId) throw new Error('不允許的聊天請求。');
  const pet = state.pets.find((item) => item.id === petId);
  if (!pet) throw new Error('不允許的聊天請求。');
  if (quitting) throw quittingError();
  const allowWebSearch = pet.webQueryEnabled === true;
  if (!allowWebSearch && typeof request?.text === 'string' && request.text.trim()) careController?.acknowledge(petId);
  return chatSessions.editLatest(petId, { requestId: request?.requestId, messageId: request?.messageId, text: request?.text, mode: 'chat', allowWebSearch });
});
ipcMain.on('chat:cancel', (event) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  if (petId) chatSessions.cancel(petId);
});
ipcMain.handle('chat:confirm-search', (event, request) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  if (!petId) throw new Error('不允許的聊天請求。');
  if (typeof request?.requestId !== 'string' || !request.requestId || typeof request?.approved !== 'boolean') throw new Error('搜尋確認無效。');
  if (!chatSessions.confirmSearch(petId, request.requestId, request.approved)) throw new Error('搜尋確認已失效。');
  return { ok: true };
});
ipcMain.handle('chat:open-source', (event, request) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  if (!petId) throw new Error('不允許的聊天請求。');
  if (typeof request?.messageId !== 'string' || !request.messageId || typeof request?.sourceId !== 'string' || !request.sourceId) throw new Error('來源識別碼無效。');
  const message = chatSessions.getMessages(petId).find((item) => item.id === request.messageId && item.role === 'assistant');
  const source = message?.sources?.find((item) => item?.id === request.sourceId);
  if (!source) throw new Error('找不到可開啟的來源。');
  return shell.openExternal(validateSourceUrl(source.url));
});
ipcMain.on('chat:collapse', (event) => {
  const petId = chatWindows?.petIdForSender(event.sender);
  if (petId) { chatSessions.cancel(petId); careController?.pause(petId); chatWindows.hide(petId); }
});

for (const [channel, handler] of Object.entries({
  'settings:get': () => snapshot(),
  'settings:add': () => addPet(),
  'settings:duplicate': (id, options) => duplicatePet(id, options),
  'settings:update': (id, patch) => updatePet(id, patch),
  'settings:search-budget-save': (searchBudget) => commitSearchBudget(searchBudget),
  'settings:remove': (id) => removePet(id),
  'settings:memory-get': (id) => requirePetMemory(id),
  'settings:memory-policy': async (id, policy) => {
    requirePetMemory(id);
    const memory = memoryStore.setPolicy(id, policy);
    if (memory.policy.mode === 'off') {
      const error = cleanupError(await chatSessions?.dispose(id));
      if (error) throw error;
      diaryWorker?.cancel(id);
    }
    return memory;
  },
  'settings:diary-run': async (id) => {
    requirePetMemory(id);
    await diaryWorker.runNow(id);
    return memoryStore.read(id);
  },
  'settings:diary-open': (id) => { requirePetMemory(id); openDiary(id); return { ok: true }; },
  'settings:diary-edit': (id, diaryId, text) => {
    requirePetMemory(id);
    return memoryStore.editDiary(id, diaryId, text);
  },
  'settings:diary-delete': (id, diaryId, options) => {
    requirePetMemory(id);
    return memoryStore.deleteDiary(id, diaryId, options);
  },
  'settings:memory-clear': (id) => clearPetMemory(id),
  'settings:ai-get': () => aiConfigStore.getPublic(),
  'settings:ai-save': (settings) => aiConfigStore.save(settings),
  'settings:ai-remove-key': (provider) => aiConfigStore.removeKey(provider),
  'settings:ai-test': () => testConnection(aiConfigStore.getConnection()),
  'settings:ai-models': (settings) => listCustomModels(settings),
})) ipcMain.handle(channel, (event, ...args) => {
  if (event.sender !== settingsWindow?.webContents) throw new Error('請從設定視窗操作。');
  return handler(...args);
});

ipcMain.handle('diary:get', (event) => {
  if (event.sender !== diaryWindow?.webContents || !diaryPetId) throw new Error('不允許的日記請求。');
  const pet = state.pets.find((item) => item.id === diaryPetId);
  return { name: pet?.name || '小女僕', diaries: memoryStore.read(diaryPetId).diaries };
});
ipcMain.handle('diary:edit', (event, diaryId, text) => {
  if (event.sender !== diaryWindow?.webContents || !diaryPetId) throw new Error('不允許的日記請求。');
  return memoryStore.editDiary(diaryPetId, diaryId, text).diaries;
});
ipcMain.handle('diary:delete', (event, diaryId) => {
  if (event.sender !== diaryWindow?.webContents || !diaryPetId) throw new Error('不允許的日記請求。');
  return memoryStore.deleteDiary(diaryPetId, diaryId).diaries;
});
ipcMain.on('diary:close', (event) => {
  if (event.sender === diaryWindow?.webContents) diaryWindow.close();
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', openSettings);
  app.whenReady().then(() => {
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    aiConfigStore = createConfigStore({ directory: app.getPath('userData'), safeStorage });
    attachmentStore = createAttachmentStore({ directory: app.getPath('userData') });
    memoryStore = createMemoryStore({ directory: app.getPath('userData'), attachmentStore });
    diaryWorker = createDiaryWorker({
      store: memoryStore,
      streamReply,
      getConnection: () => aiConfigStore.getConnection(),
      emit: () => {},
    });
    const browserSearch = createWebQueryCoordinator({ reader: createBlockedBrowserSearch(), getBudget: () => state.searchBudget });
    const actionCatalog = createActionCatalog(config.animations);
    const actionChoices = createActionChoices(actionCatalog);
    actionDirector = createActionDirector({
      catalog: actionCatalog,
      sendToPet: (petId, command) => {
        const record = pets.get(petId);
        if (!record) return;
        record.chatAction = command.requestId;
        record.pendingChatActionName = command.action.name;
        send(record, command);
      },
    });
    careController = createCareController({
      deliver: deliverCareMessage,
    });
    chatSessions = createSessions({
      streamReply,
      getConnection: () => aiConfigStore.getConnection(),
      getProfile: (petId) => {
        const pet = state.pets.find((item) => item.id === petId);
        return pet && { name: pet.name, ...pet.profile };
      },
      getActionChoices: () => actionChoices,
      readMessages: (petId) => memoryStore.read(petId).messages,
      appendMessages: (petId, messages, options) => {
        memoryStore.append(petId, messages);
        if (options?.scheduleDiary !== false) diaryWorker.schedule(petId);
      },
      readAttachments: (petId, attachments) => attachments.map((attachment) => ({ mimeType: attachment.mimeType, data: attachmentStore.read(petId, attachment).toString('base64') })),
      editStoredMessage: (petId, messageId, text, requestId) => memoryStore.editLatestUserMessage(petId, messageId, text, requestId),
      runDiary: (petId) => diaryWorker.runNow(petId),
      requestAction: (petId, proposal) => {
        const record = pets.get(petId);
        if (!record) return { status: 'rejected' };
        return actionDirector.request(petId, proposal, actionState(record));
      },
      browserSearch,
      timeContext: chatTimeContext,
    selectContext: (petId, input) => {
      const memory = memoryStore.read(petId);
      return selectContextForMemory(memory, input);
    },
      emit: (petId, event) => chatWindows?.get(petId)?.webContents.send('chat:event', event),
    });
    chatWindows = createChatWindows({ BrowserWindow, screen, onClose: (petId) => chatSessions?.cancel(petId) });
    const saved = loadSettings(settingsFile);
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')).resize({ width: 32, height: 32 }));
    tray.setToolTip('藍髮小女僕｜按一下開啟設定，右鍵管理桌寵');
    tray.on('click', openSettings);
    if (saved) {
      state = saved;
      commitPets(saved.pets.map((pet) => recoverPet(pet, screen.getAllDisplays())));
    }
    else addPet();
    initialized = true;
    for (const record of pets.values()) startStartupGreeting(record);
    powerMonitor?.on?.('suspend', () => {
      suspended = true;
      for (const record of pets.values()) {
        chatSessions?.cancel(record.pet.id);
        syncCare(record);
      }
    });
    powerMonitor?.on?.('resume', () => {
      suspended = false;
      for (const record of pets.values()) syncCare(record);
    });
    inputTimer = setInterval(pollInput, 25);
    for (const eventName of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(eventName, () => {
      for (const record of pets.values()) finishDrag(record, true);
      runUiAction(() => commitPets(state.pets.map((pet) => recoverPet(pet, screen.getAllDisplays()))));
    });
  }).catch((error) => { dialog.showErrorBox('桌寵無法啟動', `設定檔不會被覆寫。\n${error.message}`); app.quit(); });
}
app.on('window-all-closed', () => {}); // 零隻桌寵時仍可由系統匣重新新增。
app.on('before-quit', (event) => {
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  quitting = true;
  clearInterval(inputTimer);
  event?.preventDefault?.();
  if (initialized) persistPosition();
  Promise.all([...pets.values()].map((record) => chatSessions?.dispose(record.pet.id) || { status: 'ok' })).then((results) => {
    const error = results.map(cleanupError).find(Boolean);
    if (error) dialog.showErrorBox('聊天搜尋清理失敗', error.code);
    app.quit();
  });
});
app.on('will-quit', () => tray?.destroy());
