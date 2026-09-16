(() => {
  const api = window.settingsAPI;
  const el = (id) => document.getElementById(id);
  const drafts = new Map();
  const rangeDrafts = new Map();
  const chatOffsetDrafts = new Map();
  const rows = new Map();
  let state = { pets: [], displays: [] };
  let selectedId = null;
  let busy = false;
  let loaded = false;
  let revision = 0;
  let displaySignature = '';
  let renderedId = null;
  let aiSettings = { provider: 'gemini', model: '', providers: {} };
  let selectedProvider = 'gemini';
  let aiModelOptions = [];
  let petMemory = { policy: { mode: 'diary-30d', autoDiary: true }, messages: [], diaries: [] };
  let memoryPetId = null;
  let memoryRequest = 0;
  const defaultSearchBudget = { maxSearches: 2, maxCandidatePages: 3, maxExcerptChars: 18000, timeoutMs: 45000 };

  function renderSearchBudget() {
    const budget = state.searchBudget || defaultSearchBudget;
    for (const [id, value] of Object.entries({
      'search-budget-searches': budget.maxSearches,
      'search-budget-pages': budget.maxCandidatePages,
      'search-budget-excerpt': budget.maxExcerptChars,
      'search-budget-timeout': budget.timeoutMs,
    })) if (document.activeElement !== el(id)) el(id).value = value;
    el('save-search-budget').disabled = busy;
  }

  function status(message, kind = '') {
    el('status').textContent = message;
    el('status').dataset.kind = kind;
  }

  function render() {
    const pet = state.pets.find((item) => item.id === selectedId);
    const switched = renderedId !== selectedId;
    el('pet-count').textContent = state.pets.length;
    renderSearchBudget();
    for (const [id, row] of rows) {
      if (!state.pets.some((item) => item.id === id)) { row.remove(); rows.delete(id); }
    }
    state.pets.forEach((item, index) => {
      let row = rows.get(item.id);
      if (!row) {
        row = document.createElement('button');
        row.type = 'button';
        row.addEventListener('click', () => { selectedId = item.id; render(); });
        rows.set(item.id, row);
        el('pet-list').append(row);
      }
      const label = `${item.name || `小女僕 ${index + 1}`}\n${item.visible ? '顯示中' : '已隱藏'} · ${item.roaming ? '漫遊開啟' : '漫遊關閉'}`;
      if (row.textContent !== label) row.textContent = label;
      row.setAttribute('aria-current', String(item.id === selectedId));
      row.disabled = busy;
    });
    el('empty-state').hidden = !loaded || !!pet;
    el('pet-form').hidden = !pet;
    el('memory-settings').hidden = !pet;
    el('add-pet').disabled = busy || !loaded;
    el('duplicate-pet').disabled = busy || !pet;
    el('remove-pet').disabled = busy || !pet;
    el('pet-controls').disabled = busy;
    el('apply-position').disabled = busy || !pet;
    el('apply-chat-offset').disabled = busy || !pet;
    el('save-profile').disabled = busy || !pet;
    if (!pet) { renderedId = null; return; }
    el('pet-title').textContent = pet.name || `小女僕 ${state.pets.indexOf(pet) + 1}`;
    for (const key of ['size', 'visible', 'roaming', 'ambient-reactions', 'care-enabled', 'web-query-enabled']) {
      if (!switched && document.activeElement === el(key)) continue;
      if (key === 'size') el(key).value = pet[key];
      else if (key === 'ambient-reactions') el(key).checked = pet.ambientReactions !== false;
      else if (key === 'care-enabled') el(key).checked = pet.careEnabled === true;
      else if (key === 'web-query-enabled') el(key).checked = pet.webQueryEnabled === true;
      else el(key).checked = pet[key];
    }
    if (switched || document.activeElement !== el('always-on-top')) el('always-on-top').checked = pet.alwaysOnTop !== false;
    const profile = pet.profile || {};
    for (const [id, value] of Object.entries({
      'pet-name': pet.name || '小女僕', 'profile-role': profile.role || '', 'profile-personality': profile.personality || '', 'profile-speaking-style': profile.speakingStyle || '',
    })) if (switched || document.activeElement !== el(id)) el(id).value = value;
    const signature = JSON.stringify(state.displays);
    if (signature !== displaySignature) {
      el('display').replaceChildren(...state.displays.map((display) => {
        const option = document.createElement('option');
        option.value = display.id;
        option.textContent = display.label || `螢幕 ${display.id}`;
        return option;
      }));
      displaySignature = signature;
    }
    if (switched || document.activeElement !== el('display')) el('display').value = pet.displayId;
    el('display').disabled = state.displays.length === 0;
    document.querySelectorAll('[data-anchor]').forEach((button) => { button.disabled = state.displays.length === 0; });
    const draft = drafts.get(pet.id);
    const range = rangeDrafts.get(pet.id) || pet.roamingRange || { left: 0, right: 100 };
    const editingPosition = document.activeElement === el('x') || document.activeElement === el('y');
    if (switched || draft || !editingPosition) {
      for (const key of ['x', 'y']) {
        const value = String(draft ? draft[key] : pet[key]);
        if (el(key).value !== value) el(key).value = value;
      }
    }
    const chatOffset = chatOffsetDrafts.get(pet.id) || pet.chatOffset || { x: 0, y: 0 };
    const editingChatOffset = document.activeElement === el('chat-offset-x') || document.activeElement === el('chat-offset-y');
    if (switched || !editingChatOffset) {
      el('chat-offset-x').value = chatOffset.x;
      el('chat-offset-y').value = chatOffset.y;
    }
    const editingRange = document.activeElement === el('range-left') || document.activeElement === el('range-right');
    if (switched || !editingRange) {
      el('range-left').value = range.left;
      el('range-right').value = range.right;
    }
    el('position-hint').textContent = draft
      ? '位置尚未套用；背景移動不會覆蓋你的輸入。'
      : '位置需按「套用位置」儲存；其餘設定變更後自動儲存。';
    renderedId = selectedId;
    if (switched || memoryPetId !== selectedId) {
      memoryPetId = selectedId;
      petMemory = { policy: { mode: 'diary-30d', autoDiary: true }, messages: [], diaries: [] };
      loadMemory(selectedId);
    }
    renderMemory();
    renderAI();
  }

  function renderAI() {
    const provider = aiSettings.providers[selectedProvider] || { hasKey: false, model: '', baseUrl: '' };
    if (el('ai-provider').value !== selectedProvider) el('ai-provider').value = selectedProvider;
    if (document.activeElement !== el('ai-model')) el('ai-model').value = provider.model;
    const custom = selectedProvider === 'custom';
    el('ai-base-url-row').hidden = !custom;
    if (custom && document.activeElement !== el('ai-base-url')) el('ai-base-url').value = provider.baseUrl || '';
    el('ai-model-list').replaceChildren(...aiModelOptions.map((model) => {
      const option = document.createElement('option');
      option.value = model;
      return option;
    }));
    el('ai-key-status').textContent = provider.hasKey ? '金鑰已設定' : '尚未設定金鑰';
    el('ai-remove-key').disabled = busy || !provider.hasKey;
    el('ai-test').disabled = busy || !provider.hasKey;
    el('ai-save').disabled = busy || !loaded;
    el('ai-provider').disabled = busy || !loaded;
    el('ai-model').disabled = busy || !loaded;
    el('ai-key').disabled = busy || !loaded;
    el('ai-base-url').disabled = busy || !loaded;
    el('ai-load-models').disabled = busy || !loaded || !custom;
  }

  function renderMemory() {
    const policy = petMemory.policy || { mode: 'diary-30d', autoDiary: true };
    el('memory-mode').value = policy.mode;
    el('auto-diary').checked = policy.autoDiary;
    el('auto-diary').disabled = busy || !selectedId || policy.mode === 'off';
    el('run-diary').disabled = busy || !selectedId || policy.mode === 'off';
    el('view-diary').disabled = busy || !selectedId;
    el('clear-memory').disabled = busy || !selectedId;
    el('memory-mode').disabled = busy || !selectedId;
    el('copy-memory').disabled = busy || policy.mode === 'off';
    if (policy.mode === 'off') el('copy-memory').checked = false;
    el('memory-summary').textContent = `${petMemory.messages?.length || 0} 則對話 · ${petMemory.diaries?.length || 0} 篇日記`;
    const list = el('diary-list');
    const diaries = petMemory.diaries || [];
    if (!diaries.length) {
      const empty = document.createElement('p');
      empty.className = 'diary-empty';
      empty.textContent = '尚無日記。可在對話累積後自動整理，或按「立即整理日記」。';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...diaries.map((diary) => {
      const card = document.createElement('article');
      card.className = 'diary-card';
      const title = document.createElement('div');
      title.textContent = diary.createdAt ? `日記｜${new Date(diary.createdAt).toLocaleString('zh-Hant')}` : '日記';
      const editor = document.createElement('textarea');
      editor.dataset.diaryEditor = diary.id;
      editor.maxLength = 2000;
      editor.value = diary.text || '';
      const actions = document.createElement('div');
      actions.className = 'diary-actions';
      const deleteSources = document.createElement('input');
      deleteSources.type = 'checkbox';
      deleteSources.dataset.deleteSources = diary.id;
      const deleteLabel = document.createElement('label');
      deleteLabel.append(deleteSources, document.createTextNode('一併刪除來源對話'));
      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.dataset.action = 'save-diary';
      saveButton.textContent = '儲存日記';
      saveButton.disabled = busy;
      saveButton.addEventListener('click', () => {
        const text = editor.value.trim();
        if (!text) { status('日記內容不可為空白。', 'error'); return; }
        saveMemory((id) => api.editDiary(id, diary.id, text));
      });
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'danger';
      deleteButton.dataset.action = 'delete-diary';
      deleteButton.textContent = '刪除日記';
      deleteButton.disabled = busy;
      deleteButton.addEventListener('click', () => {
        const options = { deleteSources: deleteSources.checked };
        if (window.confirm(options.deleteSources ? '確定刪除此篇日記與其來源對話？此操作無法復原。' : '確定刪除此篇日記？')) {
          saveMemory((id) => api.deleteDiary(id, diary.id, options));
        }
      });
      actions.append(deleteLabel, saveButton, deleteButton);
      card.append(title, editor, actions);
      return card;
    }));
  }

  async function loadMemory(id) {
    const request = ++memoryRequest;
    try {
      const memory = await api.getMemory(id);
      if (request !== memoryRequest || selectedId !== id) return;
      petMemory = memory;
      renderMemory();
    } catch (error) {
      if (request === memoryRequest && selectedId === id) status(`記憶載入失敗：${error.message || String(error)}`, 'error');
    }
  }

  function accept(snapshot) {
    state = snapshot;
    loaded = true;
    if (!state.pets.some((pet) => pet.id === selectedId)) selectedId = state.pets[0]?.id ?? null;
    for (const id of drafts.keys()) if (!state.pets.some((pet) => pet.id === id)) drafts.delete(id);
    for (const id of rangeDrafts.keys()) if (!state.pets.some((pet) => pet.id === id)) rangeDrafts.delete(id);
    for (const id of chatOffsetDrafts.keys()) if (!state.pets.some((pet) => pet.id === id)) chatOffsetDrafts.delete(id);
    render();
  }

  function acceptAI(snapshot) {
    aiSettings = snapshot;
    selectedProvider = snapshot.provider;
  }

  async function save(action, after) {
    if (busy) return;
    busy = true;
    const started = revision;
    status('正在儲存…');
    render();
    try {
      const snapshot = await action();
      // A newer pushed snapshot can arrive while an invoke response is in flight.
      if (revision === started) accept(snapshot);
      if (after) after(snapshot);
      status('已儲存', 'success');
    } catch (error) {
      status(`儲存失敗：${error.message || String(error)}`, 'error');
    } finally {
      busy = false;
      render();
    }
  }

  function update(patch, after) {
    const id = selectedId;
    if (id) return save(() => api.updatePet(id, patch), after);
  }

  async function saveAI(action, success) {
    if (busy) return;
    busy = true;
    status('正在儲存 AI 連線…');
    render();
    try {
      acceptAI(await action());
      if (success) success();
      status('AI 連線設定已儲存', 'success');
    } catch (error) {
      status(`AI 連線設定失敗：${error.message || String(error)}`, 'error');
    } finally {
      busy = false;
      render();
    }
  }

  async function saveMemory(action, success) {
    if (busy || !selectedId) return;
    const id = selectedId;
    const request = ++memoryRequest;
    busy = true;
    status('正在儲存記憶設定…');
    render();
    try {
      const memory = await action(id);
      if (selectedId === id && request === memoryRequest && memory) { petMemory = memory; renderMemory(); }
      if (success) success();
      status('記憶設定已儲存', 'success');
    } catch (error) {
      status(`記憶設定失敗：${error.message || String(error)}`, 'error');
    } finally {
      busy = false;
      render();
    }
  }

  el('pet-form').addEventListener('submit', (event) => event.preventDefault());
  el('size').addEventListener('change', () => {
    const value = Number(el('size').value);
    if (!el('size').value || !Number.isInteger(value) || value < 50 || value > 200) {
      status('大小請輸入 50–200 的整數百分比。', 'error');
      return;
    }
    update({ size: value });
  });
  for (const key of ['visible', 'roaming']) {
    el(key).addEventListener('change', () => update({ [key]: el(key).checked }));
  }
  el('ambient-reactions').addEventListener('change', () => update({ ambientReactions: el('ambient-reactions').checked }));
  el('care-enabled').addEventListener('change', () => update({ careEnabled: el('care-enabled').checked }));
  el('web-query-enabled').addEventListener('change', () => update({ webQueryEnabled: el('web-query-enabled').checked }));
  el('always-on-top').addEventListener('change', () => update({ alwaysOnTop: el('always-on-top').checked }));
  for (const key of ['range-left', 'range-right']) {
    el(key).addEventListener('input', () => {
      rangeDrafts.set(selectedId, { left: el('range-left').value, right: el('range-right').value });
      el('range-hint').textContent = '範圍尚未套用；左界必須小於右界。';
    });
  }
  el('apply-range').addEventListener('click', () => {
    const id = selectedId;
    const draft = rangeDrafts.get(id);
    const left = Number(el('range-left').value);
    const right = Number(el('range-right').value);
    if (!el('range-left').value || !el('range-right').value || !Number.isInteger(left) || !Number.isInteger(right)
      || left < 0 || right > 100 || left >= right) {
      status('漫遊範圍請輸入 0–100 的整數，且左界小於右界。', 'error');
      return;
    }
    update({ roamingRange: { left, right } }, () => { if (rangeDrafts.get(id) === draft) rangeDrafts.delete(id); });
  });
  el('display').addEventListener('change', () => update({ displayId: Number(el('display').value), anchor: 'bottom-right' }));
  document.querySelectorAll('[data-anchor]').forEach((button) => {
    button.addEventListener('click', () => update({ displayId: Number(el('display').value), anchor: button.dataset.anchor }));
  });
  for (const key of ['x', 'y']) {
    el(key).addEventListener('input', () => {
      drafts.set(selectedId, { x: el('x').value, y: el('y').value });
      el('position-hint').textContent = '位置尚未套用；背景移動不會覆蓋你的輸入。';
    });
  }
  el('apply-position').addEventListener('click', () => {
    const id = selectedId;
    const draft = drafts.get(id);
    const x = Number(el('x').value);
    const y = Number(el('y').value);
    if (!el('x').value || !el('y').value || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      status('X、Y 請輸入有效整數，可使用負值。', 'error');
      return;
    }
    update({ x, y }, () => { if (drafts.get(id) === draft) drafts.delete(id); });
  });
  for (const key of ['chat-offset-x', 'chat-offset-y']) {
    el(key).addEventListener('input', () => {
      chatOffsetDrafts.set(selectedId, { x: el('chat-offset-x').value, y: el('chat-offset-y').value });
      el('chat-offset-hint').textContent = '位移尚未套用；垂直負值往上，正值往下。';
    });
  }
  el('apply-chat-offset').addEventListener('click', () => {
    const id = selectedId;
    const draft = chatOffsetDrafts.get(id);
    const x = Number(el('chat-offset-x').value);
    const y = Number(el('chat-offset-y').value);
    if (!el('chat-offset-x').value || !el('chat-offset-y').value || !Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 1000 || Math.abs(y) > 1000) {
      status('聊天泡泡位移請輸入 -1000–1000 的整數 DIP。', 'error');
      return;
    }
    update({ chatOffset: { x, y } }, () => { if (chatOffsetDrafts.get(id) === draft) chatOffsetDrafts.delete(id); });
  });
  el('save-profile').addEventListener('click', () => {
    const name = el('pet-name').value.trim();
    if (!name) { status('桌寵名稱不可為空白。', 'error'); return; }
    update({ name, profile: {
      role: el('profile-role').value.trim(),
      personality: el('profile-personality').value.trim(),
      speakingStyle: el('profile-speaking-style').value.trim(),
    } });
  });
  el('add-pet').addEventListener('click', () => save(() => api.addPet(), (snapshot) => {
    const id = snapshot.pets.at(-1)?.id;
    if (state.pets.some((pet) => pet.id === id)) selectedId = id;
  }));
  el('duplicate-pet').addEventListener('click', () => {
    const id = selectedId;
    if (!id) return;
    save(() => api.duplicatePet(id, { includeMemory: el('copy-memory').checked }), (result) => { selectedId = result.petId; });
  });
  el('remove-pet').addEventListener('click', () => {
    const id = selectedId;
    if (id && window.confirm(`確定移除${el('pet-title').textContent}？之後仍可新增桌寵。`)) save(() => api.removePet(id));
  });
  el('memory-mode').addEventListener('change', () => {
    const mode = el('memory-mode').value;
    if (mode === 'off' && petMemory.policy?.mode !== 'off' && !window.confirm('切換為不保存會立即刪除這隻桌寵已保存的本機對話與日記，確定繼續？')) {
      renderMemory();
      return;
    }
    const autoDiary = el('auto-diary').checked;
    saveMemory((id) => api.saveMemoryPolicy(id, { mode, autoDiary }));
  });
  el('auto-diary').addEventListener('change', () => {
    const mode = el('memory-mode').value;
    const autoDiary = el('auto-diary').checked;
    saveMemory((id) => api.saveMemoryPolicy(id, { mode, autoDiary }));
  });
  el('run-diary').addEventListener('click', () => {
    saveMemory((id) => api.runDiary(id), () => { status('日記整理已完成', 'success'); });
  });
  el('view-diary').addEventListener('click', async () => {
    if (!selectedId || busy) return;
    try { await api.openDiary(selectedId); } catch (error) { status(`無法開啟日記：${error.message || String(error)}`, 'error'); }
  });
  el('clear-memory').addEventListener('click', () => {
    if (window.confirm('確定清除這隻桌寵的所有對話與日記？此操作無法復原。')) saveMemory((id) => api.clearMemory(id));
  });
  el('save-search-budget').addEventListener('click', () => {
    const budget = {
      maxSearches: Number(el('search-budget-searches').value),
      maxCandidatePages: Number(el('search-budget-pages').value),
      maxExcerptChars: Number(el('search-budget-excerpt').value),
      timeoutMs: Number(el('search-budget-timeout').value),
    };
    if (!Number.isSafeInteger(budget.maxSearches) || budget.maxSearches < 1 || budget.maxSearches > 2
      || !Number.isSafeInteger(budget.maxCandidatePages) || budget.maxCandidatePages < 1 || budget.maxCandidatePages > 3
      || !Number.isSafeInteger(budget.maxExcerptChars) || budget.maxExcerptChars < 1000 || budget.maxExcerptChars > 18000
      || !Number.isSafeInteger(budget.timeoutMs) || budget.timeoutMs < 1000 || budget.timeoutMs > 45000) {
      status('搜尋預算超出允許範圍。', 'error');
      return;
    }
    save(() => api.saveSearchBudget(budget));
  });
  el('ai-provider').addEventListener('change', () => {
    selectedProvider = el('ai-provider').value;
    aiModelOptions = [];
    el('ai-key').value = '';
    renderAI();
  });
  el('ai-save').addEventListener('click', () => {
    const model = el('ai-model').value.trim();
    const key = el('ai-key').value;
    if (!model) {
      status('請輸入 AI 模型名稱。', 'error');
      return;
    }
    const settings = { provider: selectedProvider, model };
    if (selectedProvider === 'custom') {
      const baseUrl = el('ai-base-url').value.trim();
      if (!baseUrl) { status('請輸入自訂 API Base URL。', 'error'); return; }
      settings.baseUrl = baseUrl;
    }
    if (key) settings.key = key;
    saveAI(() => api.saveAISettings(settings), () => { el('ai-key').value = ''; });
  });
  el('ai-load-models').addEventListener('click', async () => {
    if (busy || selectedProvider !== 'custom') return;
    const baseUrl = el('ai-base-url').value.trim();
    const key = el('ai-key').value;
    if (!baseUrl) { status('請輸入自訂 API Base URL。', 'error'); return; }
    busy = true;
    status('正在載入可用模型…');
    render();
    try {
      aiModelOptions = await api.loadAIModels(key ? { baseUrl, key } : { baseUrl });
      status(`已載入 ${aiModelOptions.length} 個模型；請確認選擇的是文字聊天模型。`, 'success');
    } catch (error) {
      status(`載入模型失敗：${error.message || String(error)}`, 'error');
    } finally {
      busy = false;
      render();
    }
  });
  el('ai-remove-key').addEventListener('click', () => saveAI(() => api.removeKey(selectedProvider), () => { el('ai-key').value = ''; }));
  el('ai-test').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    status('正在測試 AI 連線…');
    render();
    try {
      await api.testAIConnection();
      status('AI 連線測試成功', 'success');
    } catch (error) {
      status(`AI 連線測試失敗：${error.message || String(error)}`, 'error');
    } finally {
      busy = false;
      render();
    }
  });

  async function load() {
    const started = revision;
    el('retry').hidden = true;
    status('正在載入設定…');
    try {
      const [snapshot, aiSnapshot] = await Promise.all([api.getState(), api.getAISettings()]);
      if (revision === started) { accept(snapshot); acceptAI(aiSnapshot); render(); }
      status('設定已載入');
    } catch (error) {
      status(`載入失敗：${error.message || String(error)}`, 'error');
      el('retry').hidden = false;
    }
  }
  el('retry').addEventListener('click', load);
  const unsubscribe = api.onChanged((snapshot) => { revision++; accept(snapshot); });
  window.addEventListener('beforeunload', unsubscribe, { once: true });
  load();
})();
