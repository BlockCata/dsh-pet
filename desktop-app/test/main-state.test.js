const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

async function boot({ holdLoad = false, streamReply, initialPets, initialMemory = {}, attachmentStore, browserSearch, browserReader } = {}) {
  const windows = [];
  const handlers = new Map();
  const saves = [];
  const errors = [];
  const aiCalls = [];
  const aiTests = [];
  const aiModelRequests = [];
  const memoryWrites = [];
  const memoryClones = [];
  const memoryCalls = [];
  const diaryCalls = [];
  const diarySchedules = [];
  const careCalls = [];
  const browserFactoryCalls = [];
  let careDeliver;
  const opened = [];
  let aiSettings = { provider: 'gemini', model: 'gemini-2.5-flash-lite', providers: {
    gemini: { hasKey: false, model: 'gemini-2.5-flash-lite' }, openai: { hasKey: false, model: '' }, deepseek: { hasKey: false, model: '' },
  } };
  let failSave = false;
  let menu;
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
  const stored = { version: 1, pets: initialPets || [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true }] };
  const memories = new Map();
  const memoryFor = (petId) => {
    if (!memories.has(petId)) memories.set(petId, structuredClone(initialMemory[petId] || { messages: [], diaries: [], policy: { mode: 'diary-30d' } }));
    return memories.get(petId);
  };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.bounds = options; this.visible = false;
      this.webContents = new EventEmitter(); this.messages = [];
      this.webContents.send = (channel, value) => this.messages.push([channel, value]);
      windows.push(this);
    }
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds }; }
    setPosition(x, y) { this.setBounds({ x, y }); }
    isVisible() { return this.visible; }
    showInactive() { if (!this.visible) { this.visible = true; this.emit('show'); } }
    hide() { if (this.visible) { this.visible = false; this.emit('hide'); } }
    setAlwaysOnTop(flag, level) { this.topmost = flag; this.topmostLevel = level; }
    isAlwaysOnTop() { return this.topmost !== false; }
    setMenu() {}
    setIgnoreMouseEvents() {}
    destroy() { this.destroyed = true; this.emit('closed'); }
    loadFile() {
      if (holdLoad) return new Promise((_resolve, reject) => { this.rejectLoad = reject; });
      queueMicrotask(() => this.webContents.emit('did-finish-load')); return Promise.resolve();
    }
    isDestroyed() { return !!this.destroyed; }
  }
  const app = new EventEmitter();
  Object.assign(app, { commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: () => 'test-profile', quit: () => app.emit('before-quit') });
  const ipc = new EventEmitter();
  const powerMonitor = new EventEmitter();
  ipc.handle = (channel, handler) => handlers.set(channel, handler);
  const screen = new EventEmitter();
  Object.assign(screen, { getAllDisplays: () => [display], getPrimaryDisplay: () => display, getDisplayMatching: () => display,
    getCursorScreenPoint: () => ({ x: 110, y: 210 }) });
  const electron = { app, ipcMain: ipc, powerMonitor, screen, BrowserWindow: Window,
    shell: { openExternal: async (url) => { opened.push(url); } },
    Menu: { buildFromTemplate: (items) => ({ items }) },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    Tray: class extends EventEmitter { setContextMenu(value) { menu = value; } setToolTip() {} destroy() {} },
    dialog: { showErrorBox: (...args) => errors.push(args) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
  };
  const root = path.join(__dirname, '..', 'src');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), {
    __dirname: root, console, Buffer, setInterval() { return 1; }, clearInterval() {},
    require(name) {
      if (name === 'electron') return electron;
      if (name === './startup.js') return { configureElectron() {} };
      if (name === './settings-store.js') return { ...require('../src/settings-store.js'),
        loadSettings: () => structuredClone(stored), saveSettings: (_file, state) => {
          if (failSave) throw new Error('EACCES fixture');
          saves.push(JSON.parse(JSON.stringify(state)));
        } };
      if (name === './ai/config-store.js') return { normalizeBaseUrl: require('../src/ai/config-store.js').normalizeBaseUrl, createConfigStore: () => ({
        getPublic: () => structuredClone(aiSettings),
        save: (value) => {
          aiCalls.push(['save', value]);
          aiSettings = { ...aiSettings, provider: value.provider, model: value.model, providers: {
            ...aiSettings.providers, [value.provider]: { hasKey: value.key !== undefined || aiSettings.providers[value.provider].hasKey, model: value.model },
          } };
          return structuredClone(aiSettings);
        },
        removeKey: (provider) => {
          aiCalls.push(['remove', provider]);
          aiSettings.providers[provider].hasKey = false;
          return structuredClone(aiSettings);
        },
        getConnection: () => ({ provider: aiSettings.provider, model: aiSettings.model, key: 'fixture-secret' }),
      }) };
      if (name === './memory/store.js') return { createMemoryStore: () => ({
        read: (petId) => structuredClone(memoryFor(petId)),
        append: (petId, messages) => { memoryFor(petId).messages.push(...structuredClone(messages)); memoryWrites.push([petId, messages]); },
        clone: (source, target, options) => memoryClones.push([source, target, options]),
        setPolicy: (petId, policy) => {
          const memory = memoryFor(petId);
          memory.policy = structuredClone(policy);
          if (policy.mode === 'off') { memory.messages = []; memory.diaries = []; }
          memoryCalls.push(['setPolicy', petId, policy]);
          return structuredClone(memory);
        },
        clear: (petId) => { const memory = memoryFor(petId); memory.messages = []; memory.diaries = []; memoryCalls.push(['clear', petId]); return { messages: [], diaries: [] }; },
        editDiary: (petId, diaryId, text) => { memoryCalls.push(['editDiary', petId, diaryId, text]); },
        deleteDiary: (petId, diaryId, options) => { memoryCalls.push(['deleteDiary', petId, diaryId, options]); },
        editLatestUserMessage: (petId, messageId, text, requestId) => {
          const memory = memoryFor(petId);
          const message = memory.messages.find((item) => item.id === messageId && item.role === 'user');
          if (!message) throw new Error('找不到可修正的使用者訊息。');
          message.text = text;
          message.requestId = requestId;
          return { memory: structuredClone(memory) };
        },
        prune() {}, remove() {},
      }) };
      if (name === './chat/attachments.js' && attachmentStore) return { createAttachmentStore: () => attachmentStore };
      if (name === './memory/diary.js') return { createDiaryWorker: () => ({ schedule: (petId) => diarySchedules.push(petId), cancel() {}, runNow: (petId) => { diaryCalls.push(petId); } }) };
      if (name === './chat/care.js') return { createCareController: ({ deliver }) => {
        careDeliver = deliver;
        return ({
        sync: (...args) => careCalls.push(['sync', ...args]), acknowledge: (...args) => careCalls.push(['acknowledge', ...args]), pause: (...args) => careCalls.push(['pause', ...args]), dispose: (...args) => careCalls.push(['dispose', ...args]),
        });
      } };
      if (name === './ai/providers.js') return {
        testConnection: async (connection) => { aiTests.push(connection); return { ok: true }; },
        listModels: async (connection) => { aiModelRequests.push(connection); return ['Furen-max', 'Furen-large']; },
        streamReply: streamReply || async function* () { yield { type: 'done' }; },
      };
      if (name === './browser-search/service.js') throw new Error('production main must not load active browser-search service');
      if (name === './browser-search/blocked.js') return { createBlockedBrowserSearch: (...args) => {
        browserFactoryCalls.push(args);
        return browserReader || { async search() { return { status: 'blocked', sources: [] }; }, cancel() {}, dispose() {} };
      } };
      if (name === './browser-search/coordinator.js') return { createWebQueryCoordinator: (input) => browserSearch || require('../src/browser-search/coordinator.js').createWebQueryCoordinator(input) };
      return require(name.startsWith('.') ? path.resolve(root, name) : name);
    },
  });
  await new Promise(setImmediate);
  const find = (id, items = menu.items) => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.submenu) { const match = find(id, item.submenu); if (match) return match; }
    }
  };
  const findAll = (id, items = menu.items, found = []) => {
    for (const item of items) {
      if (item.id === id) found.push(item);
      if (item.submenu) findAll(id, item.submenu, found);
    }
    return found;
  };
  return { app, ipc, powerMonitor, handlers, windows, saves, errors, aiCalls, aiTests, aiModelRequests, memoryWrites, memoryClones, memoryCalls, diaryCalls, diarySchedules, careCalls, browserFactoryCalls, opened, deliverCare: (petId = 'a') => careDeliver(petId), find, findAll, failSave: () => { failSave = true; } };
}

function chatPreloadApi(ipcRenderer) {
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/chat/preload.js'), 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron');
      return { ipcRenderer, contextBridge: { exposeInMainWorld: (_key, value) => { api = value; } } };
    },
  });
  return api;
}

function responseFromChunks(chunks) {
  let index = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { done: false, value: Buffer.from(chunks[index++]) }
          : { done: true, value: undefined },
        releaseLock() {},
      }),
    },
  };
}

function createRaceAttachmentStore() {
  let sequence = 0;
  const staged = new Map();
  return {
    stage(petId, inputs) {
      return inputs.map((input) => {
        const attachment = { id: `fixture-${++sequence}`, name: input.name, mimeType: input.mimeType };
        staged.set(attachment.id, { petId, attachment, bytes: input.bytes });
        return attachment;
      });
    },
    read(petId, attachment) {
      const record = staged.get(attachment?.id);
      if (!record || record.petId !== petId) throw new Error('找不到附件。');
      return record.bytes;
    },
    prune(petId, retainedAttachments) {
      const retained = new Set(retainedAttachments.map((attachment) => attachment.id));
      for (const [id, record] of staged) if (record.petId === petId && !retained.has(id)) staged.delete(id);
    },
    discard(petId, attachments) {
      const discarded = new Set(attachments.map((attachment) => attachment.id));
      for (const [id, record] of staged) if (record.petId === petId && discarded.has(id)) staged.delete(id);
    },
    removePet(petId) {
      for (const [id, record] of staged) if (record.petId === petId) staged.delete(id);
    },
  };
}

test('來源開啟只接受所屬 assistant 訊息內已保存的 source id', async () => {
  const env = await boot({
    initialPets: [
      { id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true },
      { id: 'b', size: 100, x: 300, y: 200, displayId: 1, visible: true, roaming: true },
    ],
    initialMemory: {
      a: { policy: { mode: 'diary-30d' }, diaries: [], messages: [
        { id: 'history-assistant', role: 'assistant', text: '已保存回答', complete: true, sources: [{ id: 'history-source', title: '公開來源', url: 'https://EXAMPLE.com/history', retrievedAt: '2026-09-14T00:00:00.000Z' }, { title: '沒有識別碼', url: 'https://example.com/no-id', retrievedAt: '2026-09-14T00:00:00.000Z' }] },
        { id: 'pending-assistant', role: 'assistant', text: '尚未完成回答', complete: false, sources: [{ id: 'pending-source', title: '進行中來源', url: 'https://example.com/pending', retrievedAt: '2026-09-14T00:00:00.000Z' }] },
        { id: 'user-with-source', role: 'user', text: '不可信', complete: true, sources: [{ id: 'user-source', title: '使用者來源', url: 'https://example.com/user', retrievedAt: '2026-09-14T00:00:00.000Z' }] },
        { id: 'unsafe-assistant', role: 'assistant', text: '不安全來源', complete: true, sources: [{ id: 'unsafe-source', title: '本機來源', url: 'file:///C:/private', retrievedAt: '2026-09-14T00:00:00.000Z' }] },
        { id: 'http-assistant', role: 'assistant', text: 'HTTP 來源', complete: true, sources: [{ id: 'http-source', title: 'HTTP 來源', url: 'http://example.com/insecure', retrievedAt: '2026-09-14T00:00:00.000Z' }] },
        { id: 'credentialed-assistant', role: 'assistant', text: '含帳密來源', complete: true, sources: [{ id: 'credentialed-source', title: '含帳密來源', url: 'https://reader:secret@example.com/private', retrievedAt: '2026-09-14T00:00:00.000Z' }] },
      ] },
      b: { policy: { mode: 'diary-30d' }, diaries: [], messages: [{ id: 'other-assistant', role: 'assistant', text: '另一隻桌寵', complete: true, sources: [{ id: 'other-source', title: '其他來源', url: 'https://example.com/other', retrievedAt: '2026-09-14T00:00:00.000Z' }] }] },
    },
  });
  for (const chat of env.findAll('chat')) chat.click();
  await new Promise(setImmediate);
  const apiFor = (sender) => chatPreloadApi({
    invoke: async (channel, ...args) => env.handlers.get(channel)({ sender }, ...args),
  });
  const [bubbleA, bubbleB] = env.windows.slice(-2);
  const apiA = apiFor(bubbleA.webContents);
  assert.equal(typeof apiA.openSource, 'function');
  await apiA.openSource({ messageId: 'history-assistant', sourceId: 'history-source', url: 'file:///C:/private', path: 'C:/private', petId: 'b' });
  assert.deepEqual(env.opened, ['https://example.com/history']);
  await apiA.openSource({ messageId: 'pending-assistant', sourceId: 'pending-source' });
  assert.deepEqual(env.opened, ['https://example.com/history', 'https://example.com/pending']);
  for (const request of [
    { messageId: 'missing', sourceId: 'history-source' },
    { messageId: 'history-assistant', sourceId: 'missing' },
    { messageId: 'history-assistant', sourceId: 'no-id' },
    { messageId: 'user-with-source', sourceId: 'user-source' },
    { messageId: 'unsafe-assistant', sourceId: 'unsafe-source' },
    { messageId: 'http-assistant', sourceId: 'http-source' },
    { messageId: 'credentialed-assistant', sourceId: 'credentialed-source' },
  ]) await assert.rejects(() => apiA.openSource(request), /(來源|訊息)/);
  await assert.rejects(() => apiFor(bubbleB.webContents).openSource({ messageId: 'history-assistant', sourceId: 'history-source' }), /(來源|訊息)/);
  await assert.rejects(() => apiFor(env.windows[0].webContents).openSource({ messageId: 'history-assistant', sourceId: 'history-source' }), /不允許的聊天請求/);
  assert.deepEqual(env.opened, ['https://example.com/history', 'https://example.com/pending']);
});

test('移除桌寵會 bounded-await chat disposal 並回報固定 cleanup failure', async () => {
  let releaseDispose;
  const env = await boot({
    browserSearch: {
      search: () => new Promise(() => {}),
      cancel() {},
      dispose: () => new Promise((resolve) => { releaseDispose = resolve; }),
    },
    streamReply: async function* ({ signal }) {
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  const chat = env.windows[1];
  const pending = env.handlers.get('chat:send')({ sender: chat.webContents }, { requestId: 'remove-dispose', text: '進行中', mode: 'chat' });
  await new Promise(setImmediate);
  env.app.emit('second-instance'); await new Promise(setImmediate);
  const removal = env.handlers.get('settings:remove')({ sender: env.windows.at(-1).webContents }, 'a');
  const result = await Promise.race([removal.then(() => 'removed', (error) => error), new Promise((resolve) => setTimeout(() => resolve('timeout'), 250))]);
  releaseDispose();
  await pending;
  assert.equal(result?.code, 'browser-search-parser-cleanup-failed');
});

test('before-quit 會阻止立即退出、bounded-await disposal 並回報固定 cleanup failure', async () => {
  let releaseDispose;
  const env = await boot({
    browserSearch: { dispose: () => new Promise((resolve) => { releaseDispose = resolve; }), cancel() {} },
    streamReply: async function* ({ signal }) {
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  const chat = env.windows[1];
  const pending = env.handlers.get('chat:send')({ sender: chat.webContents }, { requestId: 'quit-dispose', text: '進行中', mode: 'chat' });
  await new Promise(setImmediate);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  env.app.emit('before-quit', event);
  await new Promise((resolve) => setTimeout(resolve, 250));
  releaseDispose();
  await pending;
  assert.equal(event.prevented, true);
  assert.ok(env.errors.some((args) => args.some((value) => String(value).includes('browser-search-parser-cleanup-failed'))));
});

test('移除或 memory-policy off 的 pending disposal 期間 send 不會建立新 session', async () => {
  for (const label of ['remove', 'memory-off']) {
    let releaseDispose;
    let streamCalls = 0;
    const env = await boot({
      initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
      browserSearch: { dispose: () => new Promise((resolve) => { releaseDispose = resolve; }), cancel() {} },
      streamReply: async function* (request) {
        if (request.mode === 'greeting') { yield { type: 'done' }; return; }
        if (streamCalls++ === 0) await new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
        else yield { type: 'done' };
      },
    });
    env.find('chat').click(); await new Promise(setImmediate);
    const bubble = env.windows[1];
    const pending = env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: `active-${label}`, text: '進行中', mode: 'chat' });
    await new Promise(setImmediate);
    env.app.emit('second-instance'); await new Promise(setImmediate);
    const settings = env.windows.at(-1);
    const disposal = label === 'remove'
      ? env.handlers.get('settings:remove')({ sender: settings.webContents }, 'a')
      : env.handlers.get('settings:memory-policy')({ sender: settings.webContents }, 'a', { mode: 'off', autoDiary: false });
    await new Promise(setImmediate);
    await assert.rejects(
      () => env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: `late-${label}`, text: '晚到送出', mode: 'chat' }),
      (error) => error.code === 'browser-search-parser-cleanup-failed',
      label,
    );
    releaseDispose();
    await Promise.all([pending, disposal]);
    assert.deepEqual(env.memoryWrites, [], label);
  }
});

test('before-quit snapshot 後的 late send 仍受 disposal barrier 阻擋', async () => {
  let releaseDispose;
  let streamCalls = 0;
  const env = await boot({
    browserSearch: { dispose: () => new Promise((resolve) => { releaseDispose = resolve; }), cancel() {} },
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      if (streamCalls++ === 0) await new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      else yield { type: 'done' };
    },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  const bubble = env.windows[1];
  const pending = env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'quit-active', text: '進行中', mode: 'chat' });
  await new Promise(setImmediate);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  env.app.emit('before-quit', event);
  await new Promise(setImmediate);
  assert.throws(
    () => env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'quit-late', text: '結束後送出', mode: 'chat' }),
    (error) => error.code === 'chat-quitting',
  );
  releaseDispose();
  await pending;
  assert.equal(event.prevented, true);
});

test('before-quit 無既有 session 時的 late send 也回傳固定 quitting failure', async () => {
  const env = await boot({
    streamReply: async function* () { yield { type: 'done' }; },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  const bubble = env.windows[1];
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  env.app.emit('before-quit', event);

  assert.throws(
    () => env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'quit-no-session-send', text: '結束後送出', mode: 'chat' }),
    (error) => error.code === 'chat-quitting',
  );
  assert.deepEqual(env.memoryWrites, []);
  assert.equal(bubble.messages.some(([channel, value]) => channel === 'chat:event' && ['sources', 'delta', 'done'].includes(value.type)), false);
  assert.equal(event.prevented, true);
});

test('before-quit 無既有 session 時的 late edit 不會改寫 memory', async () => {
  const env = await boot({
    initialMemory: { a: {
      messages: [
        { id: 'u1', role: 'user', text: '原問題', requestId: 'old', complete: true },
        { id: 'a1', role: 'assistant', text: '原回答', requestId: 'old', complete: true },
      ],
      diaries: [], policy: { mode: 'diary-30d' },
    } },
    streamReply: async function* () { yield { type: 'done' }; },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  const bubble = env.windows[1];
  const careCallCount = env.careCalls.length;
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  env.app.emit('before-quit', event);

  assert.throws(
    () => env.handlers.get('chat:edit-latest')({ sender: bubble.webContents }, { requestId: 'quit-no-session-edit', messageId: 'u1', text: '結束後修改', mode: 'chat' }),
    (error) => error.code === 'chat-quitting',
  );
  assert.deepEqual(env.memoryWrites, []);
  assert.deepEqual(env.memoryCalls, []);
  assert.deepEqual(env.careCalls.slice(careCallCount), []);
  assert.equal(bubble.messages.some(([channel, value]) => channel === 'chat:event' && ['sources', 'delta', 'done'].includes(value.type)), false);
  assert.equal(event.prevented, true);
});

test('主程序透過記憶上下文把舊訊息時間送入真正的 provider 請求內容', async () => {
  const { streamReply: serializeProvider } = require('../src/ai/providers.js');
  let body;
  const env = await boot({
    initialMemory: { a: {
      messages: [{ id: 'historic', role: 'user', text: '有時間的歷史訊息', complete: true, createdAt: '2026-09-13T16:20:00.000Z' }],
      diaries: [], policy: { mode: 'diary-30d' },
    } },
    streamReply: async function* (request) {
      for await (const event of serializeProvider({
        ...request,
        fetchImpl: async (_url, options) => {
          body = JSON.parse(options.body);
          return responseFromChunks(['data: {"candidates":[{"content":{"parts":[{"text":"收到"}]}}]}\n\n']);
        },
      })) yield event;
    },
  });
  env.find('chat').click();
  await new Promise(setImmediate);

  await env.handlers.get('chat:send')({ sender: env.windows[1].webContents }, { requestId: 'time-context', text: '新的問題', mode: 'chat' });

  assert.ok(body.contents.some((message) => message.parts[0].text === '訊息時間：2026-09-13T16:20:00.000Z\n有時間的歷史訊息'));
});

test('聊天附件只可由所屬聊天視窗以訊息與附件識別碼讀取', async () => {
  const pets = [
    { id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true },
    { id: 'b', size: 100, x: 300, y: 200, displayId: 1, visible: true, roaming: true },
  ];
  const env = await boot({ initialPets: pets });
  for (const chat of env.findAll('chat')) chat.click();
  await new Promise(setImmediate);
  const [bubbleA, bubbleB] = env.windows.slice(-2);
  await env.handlers.get('chat:send')({ sender: bubbleA.webContents }, {
    requestId: 'image-a', text: '圖片', mode: 'chat', attachments: [{ name: 'fixture.png', mimeType: 'image/png', data: 'cG5n' }],
  });
  const message = (await env.handlers.get('chat:get')({ sender: bubbleA.webContents })).find((item) => item.requestId === 'image-a' && item.role === 'user');
  const attachment = message.attachments[0];

  assert.deepEqual(JSON.parse(JSON.stringify(await env.handlers.get('chat:get-attachment')({ sender: bubbleA.webContents }, { messageId: message.id, attachmentId: attachment.id }))), { mimeType: 'image/png', data: 'cG5n' });
  assert.throws(() => env.handlers.get('chat:get-attachment')({ sender: bubbleA.webContents }, { messageId: message.id, attachmentId: '../not-an-attachment', path: 'C:\\private.png', petId: 'b' }), /找不到附件/);
  assert.throws(() => env.handlers.get('chat:get-attachment')({ sender: bubbleB.webContents }, { messageId: message.id, attachmentId: attachment.id }), /找不到附件/);
});

test('清除或關閉保存後，舊請求的 finally 不得裁剪新請求尚未保存的附件', async () => {
  for (const [label, reset] of [
    ['清除記憶', async (env, settingsSender) => env.handlers.get('settings:memory-clear')(settingsSender, 'a')],
    ['關閉保存', async (env, settingsSender) => env.handlers.get('settings:memory-policy')(settingsSender, 'a', { mode: 'off', autoDiary: false })],
  ]) {
    let releaseOld;
    let releaseNew;
    const oldGate = new Promise((resolve) => { releaseOld = resolve; });
    const newGate = new Promise((resolve) => { releaseNew = resolve; });
    const env = await boot({
      attachmentStore: createRaceAttachmentStore(),
      streamReply: async function* ({ messages }) {
        const text = messages.at(-1).text;
        if (text === '舊請求') { await oldGate; yield { type: 'done' }; return; }
        await newGate; yield { type: 'done' };
      },
    });
    env.find('chat').click(); await new Promise(setImmediate);
    const bubble = env.windows[1];
    const oldRequest = env.handlers.get('chat:send')({ sender: bubble.webContents }, {
      requestId: `old-${label}`, text: '舊請求', mode: 'chat', attachments: [{ name: 'old.png', mimeType: 'image/png', data: 'b2xk' }],
    });
    await new Promise(setImmediate);
    env.app.emit('second-instance'); await new Promise(setImmediate);
    const settingsSender = { sender: env.windows.at(-1).webContents };
    await reset(env, settingsSender);
    const newRequest = env.handlers.get('chat:send')({ sender: bubble.webContents }, {
      requestId: `new-${label}`, text: '新請求', mode: 'chat', attachments: [{ name: 'new.png', mimeType: 'image/png', data: 'bmV3' }],
    });
    await new Promise(setImmediate);
    releaseOld(); await oldRequest;
    releaseNew(); await newRequest;
    const message = (await env.handlers.get('chat:get')({ sender: bubble.webContents })).find((entry) => entry.requestId === `new-${label}` && entry.role === 'user');
    const attachment = message.attachments[0];
    assert.deepEqual(JSON.parse(JSON.stringify(await env.handlers.get('chat:get-attachment')({ sender: bubble.webContents }, { messageId: message.id, attachmentId: attachment.id }))), { mimeType: 'image/png', data: 'bmV3' }, label);
  }
});

test('游標已離开角色而拒絕拖曳時，明確通知 renderer 取消，避免卡在動畫結尾', async () => {
  const env = await boot();
  const win = env.windows[0];
  env.ipc.emit('pet:begin-drag', { sender: win.webContents });
  assert.ok(win.messages.some(([channel, command]) => channel === 'pet:command' && command.type === 'drag-end' && command.cancelled === true));
});

test('漫遊中退出仍儲存最新座標，而不是等下一段動畫', async () => {
  const env = await boot();
  const win = env.windows[0];
  await env.handlers.get('pet:begin-walk')({ sender: win.webContents }, '螃蟹走路', 1);
  env.ipc.emit('pet:walk-progress', { sender: win.webContents }, 0.5);
  const movedX = win.getBounds().x;
  assert.notEqual(movedX, 100);
  env.app.quit();
  assert.equal(env.saves.at(-1).pets[0].x, movedX);
});

test('原生選單存檔失敗會顯示錯誤並還原核取狀態，不讓例外逸出', async () => {
  const env = await boot();
  env.failSave();
  assert.doesNotThrow(() => env.find('roaming').click({ checked: false }));
  assert.equal(env.find('roaming').checked, true);
  assert.equal(env.errors.length, 1);
  assert.match(env.errors[0][1], /EACCES fixture/);
});

test('新增桌寵尚未載入就退出，正常取消載入不彈出阻塞錯誤視窗', async () => {
  const env = await boot({ holdLoad: true });
  env.app.quit();
  env.windows[0].rejectLoad(new Error('ERR_ABORTED'));
  await new Promise(setImmediate);
  assert.equal(env.errors.length, 0);
});

test('設定可切換單隻桌寵是否永遠置頂', async () => {
  const env = await boot();
  env.app.emit('second-instance');
  await new Promise(setImmediate);
  const settingsWindow = env.windows[1];
  await env.handlers.get('settings:update')({ sender: settingsWindow.webContents }, 'a', { alwaysOnTop: false });
  assert.equal(env.windows[0].topmost, false);
  await env.handlers.get('settings:update')({ sender: settingsWindow.webContents }, 'a', { alwaysOnTop: true });
  assert.equal(env.windows[0].topmost, true);
});

test('置頂桌寵與聊天泡泡用 Windows 較高層級，隱藏恢復後重新套用', async () => {
  const env = await boot();
  const petWindow = env.windows[0];
  env.find('chat').click();
  await new Promise(setImmediate);
  const bubble = env.windows[1];

  assert.equal(petWindow.topmostLevel, 'screen-saver');
  assert.equal(bubble.topmostLevel, 'screen-saver');
  petWindow.hide();
  petWindow.showInactive();
  assert.equal(petWindow.topmostLevel, 'screen-saver');
  assert.equal(bubble.topmostLevel, 'screen-saver');
});

test('設定視窗可複製桌寵，記憶快照預設不包含內容', async () => {
  const env = await boot();
  env.app.emit('second-instance'); await new Promise(setImmediate);
  const settingsWindow = env.windows[1];
  const result = await env.handlers.get('settings:duplicate')({ sender: settingsWindow.webContents }, 'a', { includeMemory: false });
  assert.equal(result.state.pets.length, 2);
  assert.notEqual(result.petId, 'a');
  assert.equal(env.memoryClones.length, 1);
  assert.equal(env.memoryClones[0][0], 'a');
  assert.equal(env.memoryClones[0][1], result.petId);
  assert.equal(env.memoryClones[0][2].includeMemory, false);
});

test('設定視窗可讀取與管理單隻桌寵的本機記憶', async () => {
  const env = await boot();
  env.app.emit('second-instance'); await new Promise(setImmediate);
  const settingsWindow = env.windows[1];
  const sender = { sender: settingsWindow.webContents };

  assert.deepEqual(await env.handlers.get('settings:memory-get')(sender, 'a'), { messages: [], diaries: [], policy: { mode: 'diary-30d' } });
  await env.handlers.get('settings:memory-policy')(sender, 'a', { mode: 'diary-only', autoDiary: false });
  await env.handlers.get('settings:diary-run')(sender, 'a');
  await env.handlers.get('settings:diary-edit')(sender, 'a', 'd1', '修訂日記');
  await env.handlers.get('settings:diary-delete')(sender, 'a', 'd1', { deleteSources: true });
  await env.handlers.get('settings:memory-clear')(sender, 'a');

  assert.deepEqual(env.memoryCalls, [
    ['setPolicy', 'a', { mode: 'diary-only', autoDiary: false }],
    ['editDiary', 'a', 'd1', '修訂日記'],
    ['deleteDiary', 'a', 'd1', { deleteSources: true }],
    ['clear', 'a'],
  ]);
  assert.deepEqual(env.diaryCalls, ['a']);
  assert.throws(() => env.handlers.get('settings:memory-get')({ sender: env.windows[0].webContents }, 'a'), /請從設定視窗操作/);
});

test('記憶策略轉 off 會失效舊聊天、重設 bubble，並允許立即重新送出', async () => {
  const env = await boot({
    initialMemory: { a: { messages: [{ id: 'old-user', role: 'user', text: '舊對話', requestId: 'old', complete: true }], diaries: [], policy: { mode: 'diary-30d' } } },
    streamReply: async function* ({ messages, signal }) {
      if (messages.at(-1).text === '進行中') {
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        yield { type: 'delta', text: '晚到內容' }; yield { type: 'done' };
      } else { yield { type: 'delta', text: '新回答' }; yield { type: 'done' }; }
    },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  const bubble = env.windows[1];
  const settingsSender = (() => { env.app.emit('second-instance'); return { sender: env.windows[2].webContents }; })();
  const pending = env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'active', text: '進行中', mode: 'chat' });
  await new Promise(setImmediate);

  await env.handlers.get('settings:memory-policy')(settingsSender, 'a', { mode: 'off', autoDiary: false });
  await pending;
  assert.ok(bubble.messages.some(([channel, event]) => channel === 'chat:event' && event.type === 'reset'));
  assert.deepEqual(await env.handlers.get('chat:get')({ sender: bubble.webContents }), []);

  await env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'new', text: '新問題', mode: 'chat' });
  assert.deepEqual((await env.handlers.get('chat:get')({ sender: bubble.webContents })).map((message) => message.text), ['新問題', '新回答']);
  assert.equal(bubble.messages.some(([channel, event]) => channel === 'chat:event' && event.text === '晚到內容'), false);

  const resetCount = bubble.messages.filter(([channel, event]) => channel === 'chat:event' && event.type === 'reset').length;
  await env.handlers.get('settings:memory-clear')(settingsSender, 'a');
  assert.equal(bubble.messages.filter(([channel, event]) => channel === 'chat:event' && event.type === 'reset').length, resetCount + 1);
  await env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'after-clear', text: '清除後問題', mode: 'chat' });
  assert.deepEqual((await env.handlers.get('chat:get')({ sender: bubble.webContents })).map((message) => message.text), ['清除後問題', '新回答']);
});

test('右鍵選單開啟每隻桌寵唯一的頭頂聊天 overlay，隱藏桌寵時一併收合', async () => {
  const env = await boot();
  env.find('chat').click();
  await new Promise(setImmediate);
  const bubble = env.windows[1];
  const { x, y, width, height } = bubble.getBounds();
  assert.deepEqual({ x, y, width, height }, { x: 120, y: 0, width: 380, height: 320 });
  assert.equal(bubble.topmost, true);
  await env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'r1', text: '測試', mode: 'chat' });
  assert.ok(bubble.messages.some(([channel, event]) => channel === 'chat:event' && event.type === 'done' && event.requestId === 'r1'));
  assert.equal(env.memoryWrites.length, 1);
  assert.throws(() => env.handlers.get('chat:get')({ sender: env.windows[0].webContents }), /不允許的聊天請求/);
  env.find('chat').click();
  assert.equal(env.windows.length, 2);
  env.windows[0].hide();
  assert.equal(bubble.visible, false);
});

test('未設定可用 AI 時，啟動問候不自行打開泡泡或改用固定文案', async () => {
  const env = await boot();
  assert.equal(env.windows.length, 1);

  env.find('chat').click();
  await new Promise(setImmediate);
  const bubble = env.windows[1];
  assert.equal(bubble.messages.filter(([channel, event]) => channel === 'chat:event' && event.type === 'proactive').length, 0);

  env.find('chat').click();
  assert.equal(bubble.messages.filter(([channel, event]) => channel === 'chat:event' && event.type === 'proactive').length, 0);
});

test('真正啟動時以 AI 產生一次問候但不開泡泡，收合重開不重複發送', async () => {
  const env = await boot({
    streamReply: async function* ({ mode }) {
      if (mode === 'greeting') { yield { type: 'delta', text: '早安，今天也一起努力吧。' }; yield { type: 'done' }; }
      else yield { type: 'done' };
    },
  });
  await new Promise(setImmediate);

  assert.equal(env.windows.length, 1);
  assert.ok(env.memoryWrites.some(([, messages]) => messages.some((message) => message.text === '早安，今天也一起努力吧。')));
  env.find('chat').click();
  await new Promise(setImmediate);
  const bubble = env.windows[1];
  assert.ok((await env.handlers.get('chat:get')({ sender: bubble.webContents })).some((message) => message.text === '早安，今天也一起努力吧。'));
  env.ipc.emit('chat:collapse', { sender: bubble.webContents });
  env.find('chat').click();
  assert.equal(env.memoryWrites.filter(([, messages]) => messages.some((message) => message.text === '早安，今天也一起努力吧。')).length, 1);
});

test('主動關心設定隨桌寵可見狀態同步，使用者送出聊天後解除等待', async () => {
  const env = await boot();
  env.app.emit('second-instance'); await new Promise(setImmediate);
  const settingsWindow = env.windows[1];
  await env.handlers.get('settings:update')({ sender: settingsWindow.webContents }, 'a', { careEnabled: true });
  assert.ok(env.careCalls.some((call) => call[0] === 'sync' && call[1] === 'a' && call[2].enabled === true && call[2].visible === true));
  env.find('chat').click(); await new Promise(setImmediate);
  const bubble = env.windows.at(-1);
  await env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'reply', text: '我很好', mode: 'chat' });
  assert.ok(env.careCalls.some((call) => call[0] === 'acknowledge' && call[1] === 'a'));
});

test('系統休眠會暫停主動關心，恢復後重新從新的等待區間排程', async () => {
  const env = await boot();
  env.app.emit('second-instance');
  await new Promise(setImmediate);
  const settingsWindow = env.windows[1];
  await env.handlers.get('settings:update')({ sender: settingsWindow.webContents }, 'a', { careEnabled: true });

  env.powerMonitor.emit('suspend');
  assert.ok(env.careCalls.some((call) => call[0] === 'sync' && call[1] === 'a' && call[2].visible === false));
  env.powerMonitor.emit('resume');
  assert.ok(env.careCalls.filter((call) => call[0] === 'sync' && call[1] === 'a').at(-1)[2].visible === true);
});

test('主動關心到期後才請求 AI，並只描述桌寵已成功播放的最近動作', async () => {
  const requests = [];
  const env = await boot({
    streamReply: async function* (request) {
      requests.push(request);
      if (request.mode === 'chat') { yield { type: 'action', actionId: 'dance', trigger: 'explicit' }; yield { type: 'done' }; return; }
      if (request.mode === 'proactive') { yield { type: 'delta', text: '我剛剛跳完舞，想問你今天好嗎？' }; yield { type: 'done' }; }
      else yield { type: 'done' };
    },
  });
  env.find('chat').click();
  await new Promise(setImmediate);
  const petWindow = env.windows[0];
  const bubble = env.windows[1];
  await env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'dance', text: '跳舞', mode: 'chat' });
  env.ipc.emit('pet:action-status', { sender: petWindow.webContents }, { requestId: 'dance', state: 'started' });

  await env.deliverCare();

  const careRequest = requests.find((request) => request.mode === 'proactive');
  assert.match(careRequest.messages[0].text, /优雅女仆舞/);
  assert.ok(bubble.messages.some(([channel, event]) => channel === 'chat:event' && event.type === 'proactive' && event.message.text === '我剛剛跳完舞，想問你今天好嗎？'));
});

test('聊天提出白名單動作時，只會由主程序轉交給所屬桌寵 renderer', async () => {
  const env = await boot({
    streamReply: async function* () {
      yield { type: 'delta', text: '好，我來跳舞。' };
      yield { type: 'action', actionId: 'dance', trigger: 'explicit' };
      yield { type: 'done' };
    },
  });
  env.find('chat').click();
  await new Promise(setImmediate);
  const petWindow = env.windows[0];
  const bubble = env.windows[1];

  await env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'r-dance', text: '請跳一支舞', mode: 'chat' });

  assert.deepEqual(petWindow.messages.find(([channel, command]) => channel === 'pet:command' && command.type === 'chat-action'), [
    'pet:command', { type: 'chat-action', requestId: 'r-dance', action: { kind: 'action', name: '优雅女仆舞', noMirror: false }, trigger: 'explicit' },
  ]);
  assert.ok(bubble.messages.some(([channel, event]) => channel === 'chat:event' && event.type === 'action' && event.status === 'sent'));
  env.ipc.emit('pet:action-status', { sender: petWindow.webContents }, { requestId: 'r-dance', state: 'started' });
  env.ipc.emit('pet:action-status', { sender: petWindow.webContents }, { requestId: 'r-dance', state: 'ended' });
  assert.ok(bubble.messages.some(([channel, event]) => channel === 'chat:event' && event.type === 'action-status' && event.status === 'started'));
  assert.ok(bubble.messages.some(([channel, event]) => channel === 'chat:event' && event.type === 'action-status' && event.status === 'ended'));
});

test('聊天會把完整既有動作清單交給 AI，並能派送螃蟹走路給所屬桌寵', async () => {
  let actionChoices;
  const env = await boot({
    streamReply: async function* (request) {
      actionChoices = request.actionChoices;
      yield { type: 'action', actionId: 'crab_walk', trigger: 'explicit' };
      yield { type: 'done' };
    },
  });
  env.find('chat').click();
  await new Promise(setImmediate);
  const petWindow = env.windows[0];
  const bubble = env.windows[1];

  await env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'r-crab', text: '表演螃蟹走路', mode: 'chat' });

  assert.ok(actionChoices.some((choice) => choice.id === 'crab_walk' && choice.name === '螃蟹走路' && choice.kind === 'move'));
  assert.deepEqual(petWindow.messages.find(([channel, command]) => channel === 'pet:command' && command.type === 'chat-action'), [
    'pet:command', { type: 'chat-action', requestId: 'r-crab', action: { kind: 'move', name: '螃蟹走路', noMirror: false }, trigger: 'explicit' },
  ]);
});

test('聊天 preload 的 cancel 與 collapse 只會送到所屬聊天泡泡的主程序 handler', async () => {
  let aborts = 0;
  const env = await boot({
    streamReply: async function* ({ signal }) {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      aborts++;
    },
  });
  env.find('chat').click();
  await new Promise(setImmediate);
  const petWindow = env.windows[0];
  const bubble = env.windows[1];
  const apiFor = (sender) => chatPreloadApi({
    send: (channel, ...args) => env.ipc.emit(channel, { sender }, ...args),
    on() {}, removeListener() {},
  });
  const wrongApi = apiFor(petWindow.webContents);
  const bubbleApi = apiFor(bubble.webContents);
  const pending = env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'r1', text: '測試', mode: 'chat' });
  await new Promise(setImmediate);

  wrongApi.cancel();
  wrongApi.collapse();
  await new Promise(setImmediate);
  assert.equal(aborts, 0);
  assert.equal(bubble.visible, true);

  bubbleApi.cancel();
  await pending;
  assert.equal(aborts, 1);
  bubbleApi.collapse();
  assert.equal(bubble.visible, false);
});

test('只有設定視窗可讀寫遮蔽後的 AI 設定', async () => {
  const env = await boot();
  env.app.emit('second-instance');
  await new Promise(setImmediate);
  const petWindow = env.windows[0];
  const settingsWindow = env.windows[1];

  assert.deepEqual(await env.handlers.get('settings:ai-get')({ sender: settingsWindow.webContents }), {
    provider: 'gemini', model: 'gemini-2.5-flash-lite', providers: {
      gemini: { hasKey: false, model: 'gemini-2.5-flash-lite' }, openai: { hasKey: false, model: '' }, deepseek: { hasKey: false, model: '' },
    },
  });
  await env.handlers.get('settings:ai-save')({ sender: settingsWindow.webContents }, { provider: 'deepseek', model: 'deepseek-v4-flash', key: 'fixture-secret' });
  assert.deepEqual(env.aiCalls, [['save', { provider: 'deepseek', model: 'deepseek-v4-flash', key: 'fixture-secret' }]]);
  await env.handlers.get('settings:ai-test')({ sender: settingsWindow.webContents });
  assert.deepEqual(env.aiTests, [{ provider: 'deepseek', model: 'deepseek-v4-flash', key: 'fixture-secret' }]);
  assert.throws(() => env.handlers.get('settings:ai-get')({ sender: petWindow.webContents }), /請從設定視窗操作/);
});

test('只有設定視窗可用當次輸入的自訂 API 金鑰載入模型清單', async () => {
  const env = await boot();
  env.app.emit('second-instance');
  await new Promise(setImmediate);
  const settingsWindow = env.windows[1];
  const result = await env.handlers.get('settings:ai-models')({ sender: settingsWindow.webContents }, {
    baseUrl: 'https://custom-provider.test/aihub/v1', key: 'fixture-iai-key',
  });

  assert.deepEqual(result, ['Furen-max', 'Furen-large']);
  assert.equal(env.aiModelRequests.length, 1);
  assert.equal(env.aiModelRequests[0].provider, 'custom');
  assert.equal(env.aiModelRequests[0].baseUrl, 'https://custom-provider.test/aihub/v1');
  assert.equal(env.aiModelRequests[0].key, 'fixture-iai-key');
  assert.throws(() => env.handlers.get('settings:ai-models')({ sender: env.windows[0].webContents }, { baseUrl: 'https://example.test/v1', key: 'fixture' }), /請從設定視窗操作/);
});

test('main production factory only constructs the blocked browser adapter without runtime inputs', async () => {
  const env = await boot({
    initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
    streamReply: async function* (request) {
      if (request.mode === 'greeting') yield { type: 'done' };
      else { yield { type: 'search-decision', decision: { type: 'search', query: '公開資料' } }; yield { type: 'done' }; }
    },
  });
  env.find('chat').click();
  await new Promise(setImmediate);

  assert.equal(env.browserFactoryCalls.length, 1);
  assert.deepEqual(env.browserFactoryCalls[0], []);
  assert.deepEqual(env.diarySchedules, []);
});

test('production main 維持 blocked，且 renderer source IPC 只提交兩個識別碼', async () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /browser-search\/(?:production|service)\.js/);
  assert.doesNotMatch(main, /process\.(?:env|argv)/);
  assert.doesNotMatch(main, /createPinnedBrowserSearch|verified\s*:/);

  let invocation;
  const api = chatPreloadApi({ invoke: async (...args) => { invocation = args; } });
  await api.openSource({ messageId: 'message-1', sourceId: 'source-1', url: 'https://evil.example', headers: { authorization: 'secret' }, body: 'private' });
  assert.deepEqual(JSON.parse(JSON.stringify(invocation)), ['chat:open-source', { messageId: 'message-1', sourceId: 'source-1' }]);
});

test('休眠、移除、關閉 capability、收合與結束都取消搜尋且拒絕晚到寫回', async () => {
  const cases = [
    ['休眠', async (env) => env.powerMonitor.emit('suspend')],
    ['移除桌寵', async (env) => { env.app.emit('second-instance'); await new Promise(setImmediate); return env.handlers.get('settings:remove')({ sender: env.windows.at(-1).webContents }, 'a'); }],
    ['關閉 capability', async (env) => { env.app.emit('second-instance'); await new Promise(setImmediate); return env.handlers.get('settings:update')({ sender: env.windows.at(-1).webContents }, 'a', { webQueryEnabled: false }); }],
    ['收合', async (env, bubble) => env.ipc.emit('chat:collapse', { sender: bubble.webContents })],
    ['結束', async (env) => env.app.emit('before-quit')],
  ];
  for (const [label, stop] of cases) {
    let releaseSearch;
    let markSearchStarted;
    const searchStarted = new Promise((resolve) => { markSearchStarted = resolve; });
    const cancellations = [];
    const env = await boot({
      initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
      browserSearch: {
        search: () => { markSearchStarted(); return new Promise((resolve) => { releaseSearch = resolve; }); },
        cancel: (petId, requestId) => { cancellations.push([petId, requestId]); releaseSearch({ status: 'ok', sources: [{ title: '晚到來源', url: 'https://example.com/', retrievedAt: '2026-09-15T00:00:00.000Z', text: '晚到內容' }] }); },
        dispose() {},
      },
      streamReply: async function* (request) {
        if (request.mode === 'greeting') { yield { type: 'done' }; return; }
        if (request.mode === 'search-protocol') { yield { type: 'search-decision', decision: { type: 'search', query: '公開資料' } }; yield { type: 'done' }; return; }
        yield { type: 'delta', text: '不應保存的回答' }; yield { type: 'done' };
      },
    });
    env.find('chat').click(); await new Promise(setImmediate);
    const bubble = env.windows[1];
    const pending = env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: `lifecycle-${label}`, text: '查詢' });
    await Promise.race([searchStarted, new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`${label} search did not start`)), 100))]);
    await stop(env, bubble);
    await pending;
    assert.deepEqual(cancellations, [['a', `lifecycle-${label}`]], label);
    assert.deepEqual(env.memoryWrites, [], label);
    assert.equal(bubble.messages.some(([channel, event]) => channel === 'chat:event' && ['sources', 'delta', 'done'].includes(event.type)), false, label);
  }
});

test('main 只信任 pet webQueryEnabled，capability 直答仍保留動作與 diary 排程', async () => {
  const requests = [];
  const enabled = await boot({
    initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
    streamReply: async function* (request) {
      requests.push(request);
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      assert.equal(request.mode, 'search-protocol');
      assert.equal(request.allowActions, true);
      yield { type: 'search-decision', decision: { type: 'answer' } };
      yield { type: 'delta', text: '好，我來跳舞。' };
      yield { type: 'action', actionId: 'dance', trigger: 'explicit' };
      yield { type: 'done' };
    },
  });
  enabled.find('chat').click();
  await new Promise(setImmediate);
  await enabled.handlers.get('chat:send')({ sender: enabled.windows[1].webContents }, { requestId: 'trusted-enabled', text: '請跳舞' });
  assert.equal(enabled.windows[1].messages.filter(([channel, event]) => channel === 'chat:event' && event.type === 'action').length, 1);
  assert.deepEqual(enabled.diarySchedules, ['a']);

  let disabledMode;
  const disabled = await boot({
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      disabledMode = request.mode;
      assert.equal(request.allowActions, undefined);
      yield { type: 'done' };
    },
  });
  disabled.find('chat').click();
  await new Promise(setImmediate);
  await disabled.handlers.get('chat:send')({ sender: disabled.windows[1].webContents }, { requestId: 'renderer-web', text: '一般聊天', mode: 'web' });
  assert.equal(disabledMode, 'chat');
});

test('main 只讓所屬聊天視窗確認並外送保存的敏感搜尋 query', async () => {
  const browserCalls = [];
  let modelCalls = 0;
  const env = await boot({
    initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
    browserSearch: { async search(request) { browserCalls.push(request); return { status: 'ok', sources: [{ title: '公開來源', url: 'https://example.com/', retrievedAt: '2026-09-15T00:00:00.000Z', coverage: 'page', text: '公開內容' }] }; }, cancel() {}, dispose() {} },
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      modelCalls++;
      if (modelCalls === 1) yield { type: 'search-decision', decision: { type: 'search', query: 'password=private-value' } };
      else { yield { type: 'search-decision', decision: { type: 'answer' } }; yield { type: 'delta', text: '完成。' }; }
      yield { type: 'done' };
    },
  });
  env.find('chat').click();
  await new Promise(setImmediate);
  const petWindow = env.windows[0];
  const bubble = env.windows[1];
  const pending = env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'sensitive-main', text: '查詢' });
  await new Promise(setImmediate);

  const confirmation = bubble.messages.find(([channel, event]) => channel === 'chat:event' && event.type === 'search-confirmation');
  assert.deepEqual(confirmation, ['chat:event', { requestId: 'sensitive-main', type: 'search-confirmation' }]);
  assert.equal(typeof env.handlers.get('chat:confirm-search'), 'function');
  assert.throws(() => env.handlers.get('chat:confirm-search')({ sender: petWindow.webContents }, { requestId: 'sensitive-main', approved: true }), /不允許/);
  assert.equal(browserCalls.length, 0);
  await env.handlers.get('chat:confirm-search')({ sender: bubble.webContents }, { requestId: 'sensitive-main', approved: true, query: 'injected' });
  await pending;
  assert.deepEqual(browserCalls.map(({ query, sensitiveQueryApproved }) => ({ query, sensitiveQueryApproved })), [
    { query: 'password=private-value', sensitiveQueryApproved: true },
  ]);
  assert.equal((await env.handlers.get('chat:get')({ sender: bubble.webContents })).at(-1).text, '完成。');
});

test('main 關閉 web capability 會取消既有 chat session 與 browser search', async () => {
  const cancellations = [];
  let releaseSearch;
  let markSearchStarted;
  const searchStarted = new Promise((resolve) => { markSearchStarted = resolve; });
  const env = await boot({
    initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
    browserSearch: {
      search: () => { markSearchStarted(); return new Promise((resolve) => { releaseSearch = resolve; }); },
      cancel: (petId, requestId) => { cancellations.push([petId, requestId]); releaseSearch({ status: 'cancelled', sources: [] }); },
      dispose() {},
    },
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      yield { type: 'search-decision', decision: { type: 'search', query: '公開資料' } };
      yield { type: 'done' };
    },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  const bubble = env.windows[1];
  const pending = env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'capability-off', text: '查詢' });
  await Promise.race([searchStarted, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('browser search did not start')), 100))]);
  env.app.emit('second-instance'); await new Promise(setImmediate);
  await env.handlers.get('settings:update')({ sender: env.windows[2].webContents }, 'a', { webQueryEnabled: false });
  await pending;
  assert.deepEqual(cancellations, [['a', 'capability-off']]);
});

test('main web 搜尋回合不暫存 renderer 附件', async () => {
  const staged = [];
  const env = await boot({
    initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
    attachmentStore: {
      stage: (...args) => { staged.push(args); return [{ id: 'staged-image' }]; },
      discard() {}, read() { throw new Error('搜尋不應讀取附件'); },
    },
    browserSearch: { async search() { return { status: 'blocked', sources: [] }; }, cancel() {}, dispose() {} },
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      yield { type: 'search-decision', decision: { type: 'search', query: '公開資料' } };
      yield { type: 'done' };
    },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  await env.handlers.get('chat:send')({ sender: env.windows[1].webContents }, {
    requestId: 'web-image', text: '查詢', attachments: [{ name: 'secret.png', mimeType: 'image/png', data: 'c2VjcmV0' }],
  });
  assert.deepEqual(staged, []);
});

test('main web 搜尋 send 不會 acknowledge care', async () => {
  const env = await boot({
    initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
    browserSearch: { async search() { return { status: 'blocked', sources: [] }; }, cancel() {}, dispose() {} },
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      yield { type: 'search-decision', decision: { type: 'search', query: '公開資料' } };
      yield { type: 'done' };
    },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  await env.handlers.get('chat:send')({ sender: env.windows[1].webContents }, { requestId: 'web-care-send', text: '查詢' });
  assert.equal(env.careCalls.some(([type, petId]) => type === 'acknowledge' && petId === 'a'), false);
});

test('main web 搜尋 edit-latest 不會 acknowledge care', async () => {
  const env = await boot({
    initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
    initialMemory: { a: { messages: [{ id: 'u1', role: 'user', text: '原問題', requestId: 'old', complete: true }], diaries: [], policy: { mode: 'diary-30d' } } },
    browserSearch: { async search() { return { status: 'blocked', sources: [] }; }, cancel() {}, dispose() {} },
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      yield { type: 'search-decision', decision: { type: 'search', query: '公開資料' } };
      yield { type: 'done' };
    },
  });
  env.find('chat').click(); await new Promise(setImmediate);
  await env.handlers.get('chat:edit-latest')({ sender: env.windows[1].webContents }, { requestId: 'web-care-edit', messageId: 'u1', text: '修正查詢' });
  assert.equal(env.careCalls.some(([type, petId]) => type === 'acknowledge' && petId === 'a'), false);
});

test('收合聊天泡泡會使敏感搜尋確認失效且不外送', async () => {
  let browserCalls = 0;
  const env = await boot({
    initialPets: [{ id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true }],
    browserSearch: { async search() { browserCalls++; return { status: 'blocked', sources: [] }; }, cancel() {}, dispose() {} },
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      yield { type: 'search-decision', decision: { type: 'search', query: 'secret=private-value' } };
      yield { type: 'done' };
    },
  });
  env.find('chat').click();
  await new Promise(setImmediate);
  const bubble = env.windows[1];
  const pending = env.handlers.get('chat:send')({ sender: bubble.webContents }, { requestId: 'collapse-sensitive', text: '查詢' });
  await new Promise(setImmediate);
  env.ipc.emit('chat:collapse', { sender: bubble.webContents });
  assert.throws(() => env.handlers.get('chat:confirm-search')({ sender: bubble.webContents }, { requestId: 'collapse-sensitive', approved: true }), /失效/);
  await pending;
  assert.equal(browserCalls, 0);
});

test('main 將兩隻桌寵的 Web query 經同一個 coordinator 依 FIFO 執行', async () => {
  const starts = [];
  const pending = new Map();
  const reader = {
    search(request) {
      starts.push(request.requestId);
      return new Promise((resolve) => { pending.set(request.requestId, resolve); });
    },
    cancel() {},
    dispose() {},
  };
  const env = await boot({
    initialPets: [
      { id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true },
      { id: 'b', size: 100, x: 220, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true },
    ],
    browserReader: reader,
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      if (request.sourceExcerpts) { yield { type: 'search-decision', decision: { type: 'answer' } }; yield { type: 'delta', text: '完成。' }; yield { type: 'done' }; return; }
      yield { type: 'search-decision', decision: { type: 'search', query: '公開資料' } };
      yield { type: 'done' };
    },
  });
  const [firstChat, secondChat] = env.findAll('chat');
  firstChat.click();
  secondChat.click();
  await new Promise(setImmediate);
  const first = env.handlers.get('chat:send')({ sender: env.windows[2].webContents }, { requestId: 'a-first', text: '第一個' });
  await new Promise(setImmediate);
  const second = env.handlers.get('chat:send')({ sender: env.windows[3].webContents }, { requestId: 'b-second', text: '第二個' });
  await new Promise(setImmediate);

  assert.deepEqual(starts, ['a-first']);
  pending.get('a-first')({ status: 'ok', sources: [{ title: '來源 A', url: 'https://example.com/a', retrievedAt: '2026-09-16T00:00:00.000Z', text: '內容 A' }] });
  await first;
  await new Promise(setImmediate);
  assert.deepEqual(starts, ['a-first', 'b-second']);
  pending.get('b-second')({ status: 'ok', sources: [{ title: '來源 B', url: 'https://example.com/b', retrievedAt: '2026-09-16T00:00:00.000Z', text: '內容 B' }] });
  await second;
  assert.equal(env.memoryWrites.length, 2);
});

test('lifecycle 取消 queued Web query 並 dispose active Web query，不會寫回或發送晚到事件', async () => {
  const starts = [];
  const pending = new Map();
  const disposed = [];
  const reader = {
    search(request) {
      starts.push(request.requestId);
      return new Promise((resolve) => { pending.set(request.requestId, resolve); });
    },
    cancel() {},
    dispose(petId) {
      disposed.push(petId);
      pending.get('active-a')?.({ status: 'ok', sources: [{ title: '晚到來源', url: 'https://example.com/late', retrievedAt: '2026-09-16T00:00:00.000Z', text: '晚到內容' }] });
    },
  };
  const env = await boot({
    initialPets: [
      { id: 'a', size: 100, x: 100, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true },
      { id: 'b', size: 100, x: 220, y: 200, displayId: 1, visible: true, roaming: true, webQueryEnabled: true },
    ],
    browserReader: reader,
    streamReply: async function* (request) {
      if (request.mode === 'greeting') { yield { type: 'done' }; return; }
      yield { type: 'search-decision', decision: { type: 'search', query: '公開資料' } };
      yield { type: 'done' };
    },
  });
  const [firstChat, secondChat] = env.findAll('chat');
  firstChat.click();
  secondChat.click();
  await new Promise(setImmediate);
  const firstBubble = env.windows[2];
  const secondBubble = env.windows[3];
  const active = env.handlers.get('chat:send')({ sender: firstBubble.webContents }, { requestId: 'active-a', text: '第一個' });
  await new Promise(setImmediate);
  const queued = env.handlers.get('chat:send')({ sender: secondBubble.webContents }, { requestId: 'queued-b', text: '第二個' });
  await new Promise(setImmediate);

  env.ipc.emit('chat:collapse', { sender: secondBubble.webContents });
  env.app.emit('second-instance');
  await new Promise(setImmediate);
  await env.handlers.get('settings:remove')({ sender: env.windows.at(-1).webContents }, 'a');
  await Promise.all([active, queued]);

  assert.deepEqual(starts, ['active-a']);
  assert.deepEqual(disposed, ['a']);
  assert.deepEqual(env.memoryWrites, []);
  for (const bubble of [firstBubble, secondBubble]) {
    assert.equal(bubble.messages.some(([channel, event]) => channel === 'chat:event' && ['delta', 'sources', 'done'].includes(event.type)), false);
  }
});
