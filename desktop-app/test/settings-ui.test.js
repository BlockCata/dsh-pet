const fs = require('node:fs');
const path = require('node:path');

// Runs the actual HTML and renderer in Chromium; only the IPC boundary is a fixture.
async function exerciseUI(source) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const equal = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), message);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const el = (id) => document.getElementById(id);
  const change = (id, value, type = 'change') => {
    el(id).value = value;
    el(id).dispatchEvent(new Event(type, { bubbles: true }));
  };
  const pet = { id: 'a', name: '夏奈', profile: { role: '藍髮女僕', personality: '細心', speakingStyle: '簡短回應' }, size: 100, x: 20, y: 40, displayId: 1, visible: true, roaming: true };
  let state = { version: 1, searchBudget: { maxSearches: 2, maxCandidatePages: 3, maxExcerptChars: 18000, timeoutMs: 45000 }, pets: [pet], displays: [
    { id: 1, label: '主螢幕', workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 },
    { id: 2, label: '左螢幕', workArea: { x: -1280, y: -100, width: 1280, height: 984 }, scaleFactor: 1.5 },
  ] };
  let changed;
  let failure = '';
  let calls = [];
  let aiCalls = [];
  let aiTests = 0;
  let aiModelLoads = [];
  let memoryCalls = [];
  let memory = { policy: { mode: 'diary-30d', autoDiary: true }, messages: [{ id: 'm1', text: '測試訊息' }], diaries: [{ id: 'd1', text: '測試日記' }] };
  let aiSettings = { provider: 'gemini', model: 'gemini-2.5-flash-lite', providers: {
    gemini: { hasKey: false, model: 'gemini-2.5-flash-lite' }, openai: { hasKey: false, model: '' }, deepseek: { hasKey: false, model: '' }, custom: { hasKey: false, model: '', baseUrl: '' },
  } };
  let release;
  let hold = false;
  window.settingsAPI = {
    getState: async () => { if (failure) throw new Error(failure); return structuredClone(state); },
    onChanged: (callback) => { changed = callback; return () => {}; },
    updatePet: async (id, patch) => {
      calls.push([id, patch]);
      if (hold) await new Promise((resolve) => { release = resolve; });
      if (failure) throw new Error(failure);
      state.pets = state.pets.map((item) => item.id === id ? { ...item, ...patch } : item);
      changed(structuredClone(state));
      return structuredClone(state);
    },
    saveSearchBudget: async (budget) => {
      calls.push(['search-budget', budget]);
      state.searchBudget = structuredClone(budget);
      changed(structuredClone(state));
      return structuredClone(state);
    },
    addPet: async () => {
      if (failure) throw new Error(failure);
      state.pets.push({ ...pet, id: 'b' });
      changed(structuredClone(state));
      return structuredClone(state);
    },
    duplicatePet: async (id, options) => {
      calls.push(['duplicate', id, options]);
      const source = state.pets.find((item) => item.id === id);
      const copy = { ...source, id: 'copy' };
      state.pets.push(copy);
      changed(structuredClone(state));
      return { petId: copy.id, state: structuredClone(state) };
    },
    removePet: async (id) => {
      if (failure) throw new Error(failure);
      state.pets = state.pets.filter((item) => item.id !== id);
      changed(structuredClone(state));
      return structuredClone(state);
    },
    getMemory: async () => structuredClone(memory),
    saveMemoryPolicy: async (_id, policy) => {
      memoryCalls.push(['policy', policy]);
      memory = { ...memory, policy: structuredClone(policy) };
      return structuredClone(memory);
    },
    runDiary: async () => { memoryCalls.push(['run']); return structuredClone(memory); },
    openDiary: async () => { memoryCalls.push(['open']); return { ok: true }; },
    editDiary: async (_id, diaryId, text) => {
      memoryCalls.push(['edit', diaryId, text]);
      memory = { ...memory, diaries: memory.diaries.map((diary) => diary.id === diaryId ? { ...diary, text } : diary) };
      return structuredClone(memory);
    },
    deleteDiary: async (_id, diaryId, options) => {
      memoryCalls.push(['delete', diaryId, options]);
      memory = { ...memory, diaries: memory.diaries.filter((diary) => diary.id !== diaryId) };
      return structuredClone(memory);
    },
    clearMemory: async () => {
      memoryCalls.push(['clear']);
      memory = { ...memory, messages: [], diaries: [] };
      return structuredClone(memory);
    },
    getAISettings: async () => { if (failure) throw new Error(failure); return structuredClone(aiSettings); },
    saveAISettings: async ({ provider, model, key, baseUrl }) => {
      aiCalls.push(['save', { provider, model, key, ...(baseUrl !== undefined ? { baseUrl } : {}) }]);
      if (failure) throw new Error(failure);
      aiSettings = { ...aiSettings, provider, model, providers: {
        ...aiSettings.providers, [provider]: { hasKey: key !== undefined || aiSettings.providers[provider].hasKey, model, ...(provider === 'custom' ? { baseUrl } : {}) },
      } };
      return structuredClone(aiSettings);
    },
    removeKey: async (provider) => {
      aiCalls.push(['remove', provider]);
      if (failure) throw new Error(failure);
      aiSettings.providers[provider].hasKey = false;
      return structuredClone(aiSettings);
    },
    testAIConnection: async () => { aiTests++; if (failure) throw new Error(failure); return { ok: true }; },
    loadAIModels: async ({ baseUrl, key }) => { aiModelLoads.push({ baseUrl, key }); return ['Furen-max', 'Furen-large']; },
  };
  // executeJavaScript is the test harness, not a production script injection.
  failure = 'load failure';
  source();
  await tick();
  check(el('status').dataset.kind === 'error' && !el('retry').hidden, 'load failure must offer retry');
  failure = ''; el('retry').click();
  await tick();
  check(document.querySelectorAll('#pet-list button').length === 1, 'initial pet must render');
  check(el('pet-title').textContent === '夏奈' && el('pet-name').value === '夏奈', '設定頁必須顯示桌寵名稱');
  check(el('search-budget-searches').value === '2' && el('search-budget-pages').value === '3'
    && el('search-budget-excerpt').value === '18000' && el('search-budget-timeout').value === '45000', '搜尋預算必須載入全域預設值');
  change('search-budget-searches', '1'); change('search-budget-pages', '2'); change('search-budget-excerpt', '5000'); change('search-budget-timeout', '10000');
  el('save-search-budget').click(); await tick();
  equal(calls.at(-1), ['search-budget', { maxSearches: 1, maxCandidatePages: 2, maxExcerptChars: 5000, timeoutMs: 10000 }], '搜尋預算必須透過全域設定 API 保存');
  change('pet-name', '鈴音', 'input'); el('save-profile').click(); await tick();
  equal(calls.at(-1), ['a', { name: '鈴音', profile: { role: '藍髮女僕', personality: '細心', speakingStyle: '簡短回應' } }], '角色設定檔必須只更新目前桌寵');
  check(el('memory-mode').value === 'diary-30d' && el('auto-diary').checked, '記憶設定必須載入目前策略');
  window.confirm = () => false; change('memory-mode', 'off'); await tick();
  check(memoryCalls.length === 0 && el('memory-mode').value === 'diary-30d', '切到不保存必須先確認，取消後保留現有策略');
  window.confirm = () => true;
  change('memory-mode', 'off'); await tick();
  check(el('copy-memory').disabled && !el('copy-memory').checked, '不保存桌寵不得勾選複製對話與日記');
  change('memory-mode', 'diary-only'); await tick();
  equal(memoryCalls.at(-1), ['policy', { mode: 'diary-only', autoDiary: true }], '記憶模式必須連同自動日記設定儲存');
  el('auto-diary').checked = false; el('auto-diary').dispatchEvent(new Event('change')); await tick();
  equal(memoryCalls.at(-1), ['policy', { mode: 'diary-only', autoDiary: false }], '自動日記只更新目前桌寵的策略');
  el('run-diary').click(); await tick();
  equal(memoryCalls.at(-1), ['run'], '立即整理只在使用者點擊時執行');
  el('view-diary').click(); await tick();
  equal(memoryCalls.at(-1), ['open'], '查看日記必須另經受限 API 開啟視窗');
  check(document.querySelectorAll('[data-diary-editor]').length === 1, '已保存日記必須可於設定頁編輯');
  document.querySelector('[data-diary-editor]').value = '修訂日記'; document.querySelector('[data-action="save-diary"]').click(); await tick();
  equal(memoryCalls.at(-1), ['edit', 'd1', '修訂日記'], '日記編輯必須只送出該篇日記的新內容');
  document.querySelector('[data-delete-sources]').checked = true; window.confirm = () => true; document.querySelector('[data-action="delete-diary"]').click(); await tick();
  equal(memoryCalls.at(-1), ['delete', 'd1', { deleteSources: true }], '日記刪除可選擇一併清除其來源對話');
  window.confirm = () => true; el('clear-memory').click(); await tick();
  equal(memoryCalls.at(-1), ['clear'], '清除對話與日記必須要求確認後才執行');
  check(el('ai-provider').value === 'gemini' && el('ai-model').value === 'gemini-2.5-flash-lite', 'AI 設定必須載入目前服務與模型');
  change('ai-provider', 'deepseek');
  change('ai-model', 'deepseek-v4-flash', 'input');
  change('ai-key', 'fixture-secret', 'input');
  el('ai-save').click(); await tick();
  equal(aiCalls.at(-1), ['save', { provider: 'deepseek', model: 'deepseek-v4-flash', key: 'fixture-secret' }], 'AI 設定只送出本次輸入金鑰');
  check(el('ai-key').value === '' && el('ai-key-status').textContent.includes('已設定'), '成功保存後必須清空金鑰欄位並顯示遮蔽狀態');
  el('ai-remove-key').click(); await tick();
  equal(aiCalls.at(-1), ['remove', 'deepseek'], '清除只針對目前選取服務');
  el('ai-provider').value = 'gemini'; el('ai-provider').dispatchEvent(new Event('change'));
  el('ai-key').value = 'fixture-key'; el('ai-save').click(); await tick();
  el('ai-test').click(); await tick();
  check(aiTests === 1 && el('status').dataset.kind === 'success', '連線測試僅在使用者點擊後執行並顯示結果');
  change('ai-provider', 'custom');
  check(!el('ai-base-url-row').hidden, '選擇自訂服務時必須顯示 Base URL');
  check(!document.body.textContent.includes('iAI'), '自訂服務介面不得綁定特定服務品牌');
  change('ai-base-url', 'https://custom-provider.test/aihub/v1', 'input');
  change('ai-key', 'iai-fixture-key', 'input');
  el('ai-load-models').click(); await tick();
  equal(aiModelLoads, [{ baseUrl: 'https://custom-provider.test/aihub/v1', key: 'iai-fixture-key' }], '模型清單只可使用本次輸入的自訂服務金鑰');
  check([...el('ai-model-list').options].map((option) => option.value).includes('Furen-large'), '載入的模型必須可從下拉建議選擇，仍可手動輸入');
  change('size', '150'); await tick();
  equal(calls.at(-1), ['a', { size: 150 }], 'size must send only the changed field');
  check(el('status').dataset.kind === 'success', 'save success must be visible');
  el('x').focus(); change('x', '-420', 'input');
  state.pets[0].x = 300; state.pets[0].y = 500; changed(structuredClone(state));
  check(el('x') === document.activeElement && el('x').value === '-420' && el('y').value === '40', 'background updates must preserve coordinate pair and focus');
  el('visible').checked = false; el('visible').dispatchEvent(new Event('change')); await tick();
  equal(calls.at(-1), ['a', { visible: false }], 'visibility must not resend coordinates');
  el('roaming').checked = false; el('roaming').dispatchEvent(new Event('change')); await tick();
  equal(calls.at(-1), ['a', { roaming: false }], 'roaming must send only its own field');
  check(el('ambient-reactions').checked, '未設定時應預設允許對話氣氛動作');
  el('ambient-reactions').checked = false; el('ambient-reactions').dispatchEvent(new Event('change')); await tick();
  equal(calls.at(-1), ['a', { ambientReactions: false }], '對話氣氛動作必須只更新目前桌寵');
  check(!el('care-enabled').checked, '主動關心預設必須關閉');
  el('care-enabled').checked = true; el('care-enabled').dispatchEvent(new Event('change')); await tick();
  equal(calls.at(-1), ['a', { careEnabled: true }], '主動關心必須只更新目前桌寵');
  check(!el('web-query-enabled').checked, '未設定時網頁查詢必須預設關閉');
  check(document.querySelector('label[for="web-query-enabled"]')?.textContent.includes('查詢') && document.querySelector('label[for="web-query-enabled"]')?.textContent.includes('公開網頁摘錄') && document.querySelector('label[for="web-query-enabled"]')?.textContent.includes('目前選擇的 AI 服務'), '設定頁必須明確說明外送的資料與目前 AI 服務');
  el('web-query-enabled').checked = true; el('web-query-enabled').dispatchEvent(new Event('change')); await tick();
  equal(calls.at(-1), ['a', { webQueryEnabled: true }], '網頁查詢權限必須只更新目前桌寵');
  el('always-on-top').checked = false; el('always-on-top').dispatchEvent(new Event('change')); await tick();
  equal(calls.at(-1), ['a', { alwaysOnTop: false }], 'always-on-top must send only its own field');
  change('range-left', '20', 'input'); change('range-right', '80', 'input');
  el('apply-range').click(); await tick();
  equal(calls.at(-1), ['a', { roamingRange: { left: 20, right: 80 } }], 'roaming range must send both boundaries');
  hold = true; el('apply-position').click(); await tick();
  equal(calls.at(-1), ['a', { x: -420, y: 40 }], 'position must send both DIP coordinates');
  change('x', '-600', 'input'); release(); hold = false; await tick();
  check(el('x').value === '-600', 'editing during save must survive the response');
  el('apply-position').click(); await tick();
  check(el('status').dataset.kind === 'success', 'position save must finish');
  change('chat-offset-x', '80', 'input'); change('chat-offset-y', '-160', 'input');
  el('apply-chat-offset').click(); await tick();
  equal(calls.at(-1), ['a', { chatOffset: { x: 80, y: -160 } }], '聊天泡泡位置必須只送出該桌寵的雙軸位移');
  change('display', '2'); await tick();
  equal(calls.at(-1), ['a', { displayId: 2, anchor: 'bottom-right' }], 'display change must include bottom-right anchor');
  document.querySelector('[data-anchor="center"]').click(); await tick();
  equal(calls.at(-1), ['a', { displayId: 2, anchor: 'center' }], 'anchor must target selected display');
  const before = calls.length;
  change('size', '201'); await tick();
  check(calls.length === before && el('status').dataset.kind === 'error', 'invalid size must not be sent');
  change('x', '', 'input'); el('apply-position').click(); await tick();
  check(calls.length === before, 'blank coordinate must not become zero');
  failure = 'fixture failure'; change('size', '120'); await tick();
  check(el('status').dataset.kind === 'error' && el('status').textContent.includes(failure), 'rejection must be visible');
  failure = ''; change('x', '-777', 'input');
  el('add-pet').click(); await tick();
  check(document.querySelectorAll('#pet-list button').length === 2 && el('pet-name').value === '夏奈', 'new pet must be selected');
  el('copy-memory').checked = true; el('duplicate-pet').click(); await tick();
  equal(calls.at(-1), ['duplicate', 'b', { includeMemory: true }], '複製必須傳送來源與明確記憶選項');
  document.querySelector('#pet-list button').click();
  check(el('x').value === '-777', 'switching pets must preserve coordinate draft');
  window.confirm = () => false; el('remove-pet').click(); await tick();
  check(state.pets.length === 3, 'cancel must keep pet');
  window.confirm = () => true;
  failure = 'remove failure'; el('remove-pet').click(); await tick();
  check(state.pets.length === 3 && el('status').dataset.kind === 'error', 'failed remove must keep selection and show error');
  failure = ''; el('remove-pet').click(); await tick(); el('remove-pet').click(); await tick(); el('remove-pet').click(); await tick();
  check(state.pets.length === 0 && !el('empty-state').hidden && !el('add-pet').disabled, 'zero pets must allow adding');
  failure = 'add failure'; el('add-pet').click(); await tick();
  check(el('status').dataset.kind === 'error', 'failed add must show error');
  failure = ''; el('add-pet').click(); await tick();
  check(state.pets.length === 1 && !el('pet-form').hidden, 'add from empty must restore form');
  return 'Renderer behavior checks passed';
}

if (process.versions.electron && process.argv.includes('--settings-ui-fixture')) {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  for (const flag of ['disable-gpu', 'disable-gpu-compositing', 'disable-software-rasterizer', 'in-process-gpu']) app.commandLine.appendSwitch(flag);
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 760, height: 640,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'settings-ui-test' } });
    const htmlPath = path.join(__dirname, '../settings.html');
    const rendererPath = path.join(__dirname, '../src/settings-renderer.js');
    const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '') : '<!doctype html><body></body>';
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const source = fs.existsSync(rendererPath) ? fs.readFileSync(rendererPath, 'utf8') : '';
    console.log(await win.webContents.executeJavaScript(`(${exerciseUI.toString()})(() => {\n${source}\n})`));
    win.destroy(); app.exit(0);
  }).catch((error) => { console.error(error); app.exit(1); });
} else {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { spawnSync } = require('node:child_process');
  test('settings preload exposes only scoped IPC and removes its own event listener', async () => {
    const vm = require('node:vm');
    const { EventEmitter } = require('node:events');
    const ipc = new EventEmitter();
    const calls = [];
    let api;
    ipc.invoke = async (...args) => { calls.push(args); return { version: 1 }; };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/settings-preload.js'), 'utf8'), {
      require: (name) => {
        assert.equal(name, 'electron');
        return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (key, value) => {
          assert.equal(key, 'settingsAPI'); api = value;
        } } };
      },
    });
    assert.deepEqual(Object.keys(api).sort(), ['addPet', 'clearMemory', 'deleteDiary', 'duplicatePet', 'editDiary', 'getAISettings', 'getMemory', 'getState', 'loadAIModels', 'onChanged', 'openDiary', 'removeKey', 'removePet', 'runDiary', 'saveAISettings', 'saveMemoryPolicy', 'saveSearchBudget', 'testAIConnection', 'updatePet']);
    await api.getState(); await api.updatePet('a', { size: 150 }); await api.addPet(); await api.duplicatePet('a', { includeMemory: false }); await api.removePet('a');
    await api.getAISettings(); await api.saveAISettings({ provider: 'gemini', model: 'fixture', key: 'secret' }); await api.removeKey('gemini'); await api.testAIConnection(); await api.loadAIModels({ baseUrl: 'https://example.test/v1', key: 'secret' });
    await api.getMemory('a'); await api.saveMemoryPolicy('a', { mode: 'diary-only', autoDiary: false }); await api.runDiary('a'); await api.openDiary('a'); await api.editDiary('a', 'd1', '日記'); await api.deleteDiary('a', 'd1', { deleteSources: true }); await api.clearMemory('a'); await api.saveSearchBudget({ maxSearches: 1, maxCandidatePages: 2, maxExcerptChars: 5000, timeoutMs: 10000 });
    assert.deepEqual(calls, [
      ['settings:get'], ['settings:update', 'a', { size: 150 }], ['settings:add'], ['settings:duplicate', 'a', { includeMemory: false }], ['settings:remove', 'a'],
      ['settings:ai-get'], ['settings:ai-save', { provider: 'gemini', model: 'fixture', key: 'secret' }], ['settings:ai-remove-key', 'gemini'], ['settings:ai-test'], ['settings:ai-models', { baseUrl: 'https://example.test/v1', key: 'secret' }],
      ['settings:memory-get', 'a'], ['settings:memory-policy', 'a', { mode: 'diary-only', autoDiary: false }], ['settings:diary-run', 'a'], ['settings:diary-open', 'a'], ['settings:diary-edit', 'a', 'd1', '日記'], ['settings:diary-delete', 'a', 'd1', { deleteSources: true }], ['settings:memory-clear', 'a'], ['settings:search-budget-save', { maxSearches: 1, maxCandidatePages: 2, maxExcerptChars: 5000, timeoutMs: 10000 }],
    ]);
    const received = [];
    const unsubscribe = api.onChanged((...args) => received.push(args));
    ipc.emit('settings:changed', { sender: 'must stay private' }, { version: 1 });
    unsubscribe(); ipc.emit('settings:changed', {}, { version: 2 });
    assert.deepEqual(received, [[{ version: 1 }]]);
    ipc.invoke = async () => { throw new Error('rejected'); };
    await assert.rejects(api.getState(), /rejected/);
  });
  test('settings renderer: real DOM editing, partial IPC, synchronization, errors and empty state', { skip: process.env.PET_DESKTOP_TESTS !== '1' }, () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename, '--settings-ui-fixture'], { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /Renderer behavior checks passed/);
  });
}
