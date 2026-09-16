(() => {
  const api = window.chatAPI;
  const messagesElement = document.getElementById('chat-messages');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const editLast = document.getElementById('chat-edit-last');
  const stop = document.getElementById('chat-stop');
  const collapse = document.getElementById('chat-collapse');
  const status = document.getElementById('chat-status');
  const title = document.getElementById('chat-title');
  const resizeHandle = document.getElementById('chat-resize-handle');
  const attachmentInput = document.getElementById('chat-attachments');
  const attachmentList = document.getElementById('chat-attachment-list');
  const addImage = document.getElementById('chat-add-image');
  let activeRequestId = null;
  let activeAssistant = null;
  let activeUser = null;
  let chatSize = { width: 380, height: 320 };
  let resizeStart = null;
  let latestActionRequestId = null;
  let lastUserMessage = null;
  let editingMessageId = null;
  let attachments = [];
  const attachmentCache = new Map();
  const maxCachedAttachments = 12;
  const maxConcurrentAttachmentLoads = 2;
  const attachmentLoadQueue = [];
  let activeAttachmentLoads = 0;
  let attachmentGeneration = 0;
  let historyGeneration = 0;
  const renderedSources = new WeakMap();
  const attachmentObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.dataset.attachmentVisible = entry.isIntersecting ? 'true' : '';
      if (entry.isIntersecting) queueAttachmentLoad(entry.target);
      else {
        entry.target.removeAttribute('src');
        if (entry.target.dataset.attachmentState === 'queued') entry.target.dataset.attachmentState = 'idle';
      }
    }
  }, { root: messagesElement }) : null;

  function renderAttachments() {
    attachmentList.replaceChildren(...attachments.map((attachment, index) => {
      const chip = document.createElement('div'); chip.className = 'attachment-chip';
      const image = document.createElement('img'); image.src = attachment.data; image.alt = attachment.name;
      const label = document.createElement('span'); label.textContent = attachment.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除'; remove.disabled = !!activeRequestId; remove.addEventListener('click', () => { attachments.splice(index, 1); renderAttachments(); });
      chip.append(image, label, remove); return chip;
    }));
  }
  async function addFiles(files) {
    for (const file of files) {
      if (attachments.length >= 3) { setStatus('最多附加 3 張圖片。', 'error'); break; }
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setStatus('圖片需為 PNG、JPEG 或 WebP，且不得超過 5 MiB。', 'error'); continue; }
      const total = attachments.reduce((sum, attachment) => sum + attachment.byteLength, 0) + file.size;
      if (total > 10 * 1024 * 1024) { setStatus('圖片合計不得超過 10 MiB。', 'error'); continue; }
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      attachments.push({ name: file.name || 'image', mimeType: file.type, byteLength: file.size, data });
    }
    renderAttachments();
  }

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function applyInfo(info) {
    const name = typeof info?.name === 'string' && info.name.trim() ? info.name.trim() : '小女僕';
    const heading = `和${name}聊天`;
    title.textContent = heading;
    document.title = heading;
    document.getElementById('chat-overlay').setAttribute('aria-label', heading);
    if (Number.isInteger(info?.chatSize?.width) && Number.isInteger(info?.chatSize?.height)) chatSize = info.chatSize;
  }

  function scrollToLatest() {
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function setMessageTime(message, createdAt) {
    const time = message.querySelector('.message-time');
    const date = typeof createdAt === 'string' ? new Date(createdAt) : null;
    if (!time || !date || !Number.isFinite(date.getTime())) {
      if (time) { time.removeAttribute('datetime'); time.textContent = '時間不詳'; }
      return;
    }
    const pad = (value) => String(value).padStart(2, '0');
    time.dateTime = date.toISOString();
    time.textContent = `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function syncMessageActions() {
    for (const edit of messagesElement.querySelectorAll('[data-message-action="edit"]')) {
      const isLatest = edit.closest('.message')?.dataset.messageId === lastUserMessage?.id;
      edit.hidden = !isLatest;
      edit.disabled = !!activeRequestId;
      edit.setAttribute('aria-label', editingMessageId === lastUserMessage?.id ? '取消編輯' : '編輯訊息');
    }
  }

  async function copyMessage(message) {
    const text = message.querySelector('.reply-text')?.textContent || '';
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; }
    } catch {}
    if (!copied) {
      const fallback = document.createElement('textarea');
      fallback.value = text;
      fallback.setAttribute('aria-hidden', 'true');
      fallback.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(fallback);
      fallback.select();
      try { copied = document.execCommand?.('copy') === true; }
      finally { fallback.remove(); }
    }
    try {
      if (!copied) throw new Error('無法複製訊息。');
      setStatus('已複製訊息。');
    } catch {
      setStatus('無法複製訊息。', 'error');
    }
  }

  function cacheAttachment(key, value) {
    attachmentCache.delete(key);
    attachmentCache.set(key, value);
    while (attachmentCache.size > maxCachedAttachments) attachmentCache.delete(attachmentCache.keys().next().value);
  }

  function drainAttachmentLoads() {
    while (activeAttachmentLoads < maxConcurrentAttachmentLoads && attachmentLoadQueue.length) {
      const image = attachmentLoadQueue.shift();
      if (!image.isConnected || image.dataset.attachmentVisible !== 'true' || image.dataset.attachmentState !== 'queued') continue;
      image.dataset.attachmentState = 'loading';
      activeAttachmentLoads++;
      const key = image.dataset.attachmentKey;
      const generation = attachmentGeneration;
      const cached = attachmentCache.get(key);
      const finish = () => { activeAttachmentLoads--; drainAttachmentLoads(); };
      if (cached) {
        cacheAttachment(key, cached);
        if (image.isConnected && image.dataset.attachmentVisible === 'true') image.src = cached;
        image.dataset.attachmentState = 'idle';
        finish();
        continue;
      }
      api.getAttachment({ messageId: image.dataset.messageId, attachmentId: image.dataset.attachmentId }).then((result) => {
        if (result?.mimeType !== image.dataset.mimeType || typeof result?.data !== 'string') throw new Error('圖片無法載入');
        const source = `data:${result.mimeType};base64,${result.data}`;
        if (generation !== attachmentGeneration) return;
        cacheAttachment(key, source);
        if (image.isConnected && image.dataset.attachmentVisible === 'true') image.src = source;
      }).catch(() => {
        if (image.isConnected && image.dataset.attachmentVisible === 'true') image.dispatchEvent(new Event('error'));
      }).finally(() => { image.dataset.attachmentState = 'idle'; finish(); });
    }
  }

  function queueAttachmentLoad(image) {
    if (image.dataset.attachmentState === 'queued' || image.dataset.attachmentState === 'loading' || image.hasAttribute('src')) return;
    image.dataset.attachmentState = 'queued';
    attachmentLoadQueue.push(image);
    drainAttachmentLoads();
  }

  function renderMessageAttachment(message, attachment, messageId) {
    if (!attachment || typeof attachment.name !== 'string') return;
    const image = document.createElement('img');
    image.className = 'message-attachment';
    image.alt = attachment.name;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      attachmentObserver?.unobserve(image);
      image.remove();
      if (message.isConnected && !message.querySelector('.attachment-unavailable')) {
        const unavailable = document.createElement('span'); unavailable.className = 'attachment-unavailable'; unavailable.textContent = '圖片無法載入'; message.append(unavailable);
      }
    }, { once: true });
    message.insertBefore(image, message.querySelector('.message-meta'));
    if (typeof attachment.data === 'string' && attachment.data.startsWith('data:')) { image.src = attachment.data; return; }
    if (!messageId || typeof attachment.id !== 'string') return;
    const key = `${messageId}:${attachment.id}`;
    image.dataset.attachmentKey = key;
    image.dataset.messageId = messageId;
    image.dataset.attachmentId = attachment.id;
    image.dataset.mimeType = attachment.mimeType;
    if (attachmentObserver) attachmentObserver.observe(image);
    else { image.dataset.attachmentVisible = 'true'; queueAttachmentLoad(image); }
  }

  function confirmMessageAttachments(message, messageAttachments = []) {
    for (const image of message.querySelectorAll('.message-attachment')) attachmentObserver?.unobserve(image);
    message.querySelectorAll('.message-attachment, .attachment-unavailable').forEach((element) => element.remove());
    for (const attachment of messageAttachments) renderMessageAttachment(message, attachment, message.dataset.messageId);
  }

  function addMessage(role, text = '', kind = '', id = null, messageAttachments = [], createdAt) {
    const message = document.createElement('article');
    message.className = `message ${kind || role}`;
    message.dataset.role = role;
    if (id) message.dataset.messageId = id;
    message.addEventListener('focusin', () => {
      message.dataset.controlsVisible = 'true';
      const meta = message.querySelector('.message-meta');
      if (meta) { meta.style.opacity = '1'; meta.style.pointerEvents = 'auto'; meta.style.transform = 'translateY(0)'; }
    });
    message.addEventListener('focusout', () => {
      setTimeout(() => {
        if (message.contains(document.activeElement)) return;
        delete message.dataset.controlsVisible;
        const meta = message.querySelector('.message-meta');
        if (meta) { meta.style.opacity = ''; meta.style.pointerEvents = ''; meta.style.transform = ''; }
      });
    });
    const body = document.createElement('span');
    body.className = 'reply-text';
    body.textContent = text;
    message.append(body);
    if (role === 'user') for (const attachment of messageAttachments) renderMessageAttachment(message, attachment, id);
    const meta = document.createElement('div'); meta.className = 'message-meta';
    const time = document.createElement('time'); time.className = 'message-time';
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'message-action'; copy.dataset.messageAction = 'copy'; copy.setAttribute('aria-label', '複製訊息'); copy.title = '複製訊息'; copy.addEventListener('click', () => { copyMessage(message); }); actions.append(copy);
    if (role === 'user') {
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'message-action'; edit.dataset.messageAction = 'edit'; edit.hidden = true; edit.setAttribute('aria-label', '編輯訊息'); edit.title = '編輯訊息'; edit.addEventListener('click', () => { editLatestMessage(); }); actions.append(edit);
    }
    meta.append(time, actions); message.append(meta); setMessageTime(message, createdAt);
    messagesElement.append(message);
    scrollToLatest();
    return message;
  }

  function renderSources(message, sources = []) {
    message.querySelector('.sources')?.remove();
    renderedSources.set(message, sources);
    const validSources = (Array.isArray(sources) ? sources : []).flatMap((source) => {
      if (typeof source?.title !== 'string' || !source.title.trim() || typeof source.url !== 'string' || typeof source.retrievedAt !== 'string') return [];
      const retrievedAt = new Date(source.retrievedAt);
      if (!Number.isFinite(retrievedAt.getTime())) return [];
      try {
        const url = new URL(source.url);
        if (url.protocol !== 'https:' || url.username || url.password) return [];
        return [{ id: typeof source.id === 'string' && source.id ? source.id : null, title: source.title.trim(), url: url.toString(), retrievedAt }];
      } catch { return []; }
    });
    if (!validSources.length) return;
    const section = document.createElement('div');
    section.className = 'sources';
    section.textContent = '參考來源';
    for (const source of validSources) {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !message.dataset.messageId || !source.id;
      const pad = (value) => String(value).padStart(2, '0');
      const retrievedAt = `${source.retrievedAt.getFullYear()}/${pad(source.retrievedAt.getMonth() + 1)}/${pad(source.retrievedAt.getDate())} ${pad(source.retrievedAt.getHours())}:${pad(source.retrievedAt.getMinutes())}`;
      button.textContent = `${source.title}\n${source.url}\n擷取時間：${retrievedAt}`;
      if (!button.disabled) button.addEventListener('click', async () => {
        try { await api.openSource({ messageId: message.dataset.messageId, sourceId: source.id }); }
        catch { setStatus('無法開啟來源網址。', 'error'); }
      });
      section.append(button);
    }
    message.insertBefore(section, message.querySelector('.message-meta'));
    scrollToLatest();
  }

  function setGenerating(generating) {
    send.disabled = generating;
    input.disabled = generating;
    addImage.disabled = generating;
    attachmentInput.disabled = generating;
    stop.hidden = !generating;
    editLast.disabled = generating || !lastUserMessage;
    syncMessageActions();
  }

  function finishRequest(message = '可以繼續聊天。', kind = '') {
    messagesElement.querySelector('[data-search-confirmation]')?.remove();
    activeRequestId = null;
    activeAssistant = null;
    activeUser = null;
    setGenerating(false);
    setStatus(message, kind);
    input.focus();
  }

  function renderSearchConfirmation(requestId) {
    if (messagesElement.querySelector('[data-search-confirmation]')) return;
    const confirmation = document.createElement('div');
    confirmation.className = 'search-confirmation';
    confirmation.dataset.searchConfirmation = '';
    const text = document.createElement('p'); text.textContent = '這個查詢可能包含敏感資料。要繼續在隔離瀏覽器查詢嗎？';
    const controls = document.createElement('div'); controls.className = 'search-confirmation-actions';
    const choose = async (approved) => {
      for (const button of controls.querySelectorAll('button')) button.disabled = true;
      try { await api.confirmSearch({ requestId, approved }); confirmation.remove(); }
      catch (error) { for (const button of controls.querySelectorAll('button')) button.disabled = false; setStatus(error.message || '搜尋確認已失效。', 'error'); }
    };
    for (const [label, approved, action] of [['同意', true, 'approve'], ['拒絕', false, 'decline']]) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.searchConfirm = action; button.textContent = label; button.addEventListener('click', () => { choose(approved); }); controls.append(button);
    }
    confirmation.append(text, controls);
    activeAssistant?.append(confirmation);
    scrollToLatest();
  }

  function refreshLastUserMessage() {
    api.getMessages().then((messages) => {
      lastUserMessage = [...messages].reverse().find((message) => message.role === 'user' && message.complete) || null;
      const userElements = messagesElement.querySelectorAll('[data-role="user"]');
      const lastUserElement = userElements[userElements.length - 1];
      if (lastUserMessage && lastUserElement) { lastUserElement.dataset.messageId = lastUserMessage.id; setMessageTime(lastUserElement, lastUserMessage.createdAt); }
      editLast.disabled = !lastUserMessage || !!activeRequestId;
      syncMessageActions();
    }).catch(() => {});
  }

  function editLatestMessage() {
    if (!lastUserMessage || activeRequestId) return;
    if (editingMessageId) {
      editingMessageId = null;
      input.value = '';
      editLast.textContent = '編輯上一則';
      syncMessageActions();
      return;
    }
    editingMessageId = lastUserMessage.id;
    const previous = messagesElement.querySelector(`[data-message-id="${editingMessageId}"]`);
    if (previous?.nextElementSibling?.dataset.role === 'assistant') previous.nextElementSibling.remove();
    input.value = lastUserMessage.text;
    editLast.textContent = '取消編輯';
    syncMessageActions();
    input.focus();
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || activeRequestId) return;
    const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    activeRequestId = requestId;
    input.value = '';
    let userMessage;
    if (editingMessageId) {
      const message = messagesElement.querySelector(`[data-message-id="${editingMessageId}"] .reply-text`);
      if (message) message.textContent = text;
    } else { userMessage = addMessage('user', text, '', null, attachments); activeUser = userMessage; }
    activeAssistant = addMessage('assistant');
    setGenerating(true);
    setStatus('小女僕正在思考…');
    try {
      if (editingMessageId) await api.editLatest({ requestId, messageId: editingMessageId, text });
      else await api.send({ requestId, text, attachments: attachments.map((attachment) => ({ name: attachment.name, mimeType: attachment.mimeType, data: attachment.data.split(',')[1] })) });
      if (activeRequestId === requestId) {
        attachments = []; renderAttachments();
        editingMessageId = null;
        editLast.textContent = '編輯上一則';
        syncMessageActions();
      }
    } catch (error) {
      if (activeRequestId === requestId) {
        activeAssistant?.remove();
        userMessage?.remove();
        finishRequest(error.message || '無法送出訊息。', 'error');
      }
    }
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
  addImage.addEventListener('click', () => attachmentInput.click());
  attachmentInput.addEventListener('change', () => { addFiles(attachmentInput.files).catch(() => setStatus('無法讀取圖片。', 'error')); attachmentInput.value = ''; });
  input.addEventListener('paste', (event) => { const files = [...event.clipboardData?.items || []].filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean); if (files.length) { event.preventDefault(); addFiles(files).catch(() => setStatus('無法讀取圖片。', 'error')); } });
  editLast.addEventListener('click', editLatestMessage);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); submit();
    }
  });
  stop.addEventListener('click', async () => {
    if (!activeRequestId) return;
    stop.disabled = true;
    try { await api.cancel(); } finally { stop.disabled = false; }
  });
  collapse.addEventListener('click', () => api.collapse());
  resizeHandle.addEventListener('pointerdown', (event) => {
    resizeStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, size: chatSize };
    resizeHandle.setPointerCapture?.(event.pointerId);
  });
  document.addEventListener('pointermove', async (event) => {
    if (!resizeStart || event.pointerId !== resizeStart.pointerId) return;
    const size = {
      width: Math.max(280, Math.min(640, resizeStart.size.width + event.clientX - resizeStart.x)),
      height: Math.max(220, Math.min(640, resizeStart.size.height + event.clientY - resizeStart.y)),
    };
    if (size.width === chatSize.width && size.height === chatSize.height) return;
    try { applyInfo(await api.resize(size)); }
    catch (error) { setStatus(error.message || '無法調整聊天框大小。', 'error'); }
  });
  document.addEventListener('pointerup', (event) => {
    if (resizeStart?.pointerId === event.pointerId) resizeStart = null;
  });

  api.onEvent((event) => {
    if (event.type === 'reset') {
      attachmentGeneration++;
      historyGeneration++;
      for (const image of messagesElement.querySelectorAll('.message-attachment')) attachmentObserver?.unobserve(image);
      attachmentCache.clear();
      attachmentLoadQueue.length = 0;
      messagesElement.replaceChildren();
      attachments = []; renderAttachments();
      lastUserMessage = null;
      editingMessageId = null;
      editLast.textContent = '編輯上一則';
      syncMessageActions();
      finishRequest('聊天記錄已清除。');
      return;
    }
    if (event.type === 'proactive' && event.message?.role === 'assistant' && typeof event.message.text === 'string') {
      addMessage('assistant', event.message.text, '', event.message.id, event.message.attachments, event.message.createdAt);
      return;
    }
    if (event.type === 'action') {
      if (event.requestId !== activeRequestId) return;
      latestActionRequestId = event.requestId;
      if (event.status === 'sent') setStatus('小女僕正在準備動作…');
      else setStatus('這次不適合播放動作。');
      return;
    }
    if (event.type === 'action-status') {
      if (event.requestId !== latestActionRequestId) return;
      const labels = {
        started: '小女僕正在做動作…',
        ended: '動作已完成，可以繼續聊天。',
        interrupted: '動作已暫停。',
        failed: '動作無法播放。',
      };
      setStatus(labels[event.status] || '動作狀態已更新。', event.status === 'failed' ? 'error' : '');
      return;
    }
    if (event.requestId !== activeRequestId) return;
    if (event.type === 'search-confirmation') {
      renderSearchConfirmation(event.requestId);
      setStatus('等待確認是否繼續查詢。');
    } else if (event.type === 'delta') {
      activeAssistant.querySelector('.reply-text').textContent += event.text;
      scrollToLatest();
    } else if (event.type === 'sources') {
      renderSources(activeAssistant, event.sources);
    } else if (event.type === 'done') {
      if (event.user && activeUser) { activeUser.dataset.messageId = event.user.id; setMessageTime(activeUser, event.user.createdAt); confirmMessageAttachments(activeUser, event.user.attachments); }
      if (event.assistant && activeAssistant) {
        activeAssistant.dataset.messageId = event.assistant.id;
        setMessageTime(activeAssistant, event.assistant.createdAt);
        if (renderedSources.has(activeAssistant)) renderSources(activeAssistant, renderedSources.get(activeAssistant));
      }
      if (!activeAssistant.querySelector('.reply-text').textContent) activeAssistant.remove();
      attachments = []; renderAttachments();
      editingMessageId = null;
      editLast.textContent = '編輯上一則';
      syncMessageActions();
      refreshLastUserMessage();
      finishRequest();
    } else if (event.type === 'cancelled') {
      if (!activeAssistant.querySelector('.reply-text').textContent) activeAssistant.remove();
      activeUser?.remove();
      finishRequest('已停止回覆。');
    } else if (event.type === 'error') {
      activeAssistant?.remove();
      activeUser?.remove();
      finishRequest(event.message || '服務暫時無法回覆。', 'error');
    }
  });

  api.getInfo().then(applyInfo).catch(() => {});
  const initialHistoryGeneration = historyGeneration;
  api.getMessages().then((messages) => {
    if (initialHistoryGeneration !== historyGeneration) return;
    for (const message of messages) {
      const element = addMessage(message.role, message.text, '', message.id, message.attachments, message.createdAt);
      if (message.role === 'user' && message.complete) lastUserMessage = message;
      if (message.role === 'assistant' && Array.isArray(message.sources)) renderSources(element, message.sources);
    }
    editLast.disabled = !lastUserMessage;
    syncMessageActions();
    setStatus('可以開始聊天。');
  }).catch((error) => {
    if (initialHistoryGeneration === historyGeneration) setStatus(error.message || '無法載入聊天記錄。', 'error');
  });
})();
