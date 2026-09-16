const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

async function exerciseChatUI(source) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const el = (id) => document.getElementById(id);
  const calls = [];
  const fixturePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2nAAAAABJRU5ErkJggg==';
  const fixtureBytes = Uint8Array.from(atob(fixturePng), (byte) => byte.charCodeAt(0));
  let eventListener;
  let resolveSend;
  let observeAttachments;
  let attachmentCalls = 0;
  let copiedText = '';
  const attachmentCallCounts = new Map();
  const attachmentResolvers = new Map();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { copiedText = text; } }, configurable: true });
  window.IntersectionObserver = class {
    constructor(callback) { observeAttachments = callback; }
    observe() {}
    unobserve() {}
  };
  window.chatAPI = {
    getInfo: async () => ({ name: '夏奈', chatSize: { width: 500, height: 440 } }),
    getMessages: async () => [
      { id: 'earlier-user', role: 'user', text: '較早的訊息。', createdAt: '2026-09-13T07:00:00.000Z', complete: true },
      {
        id: 'history-user', role: 'user', text: '這是已保存的圖片。', createdAt: '2026-09-13T07:15:00.000Z', complete: true, attachments: [
          { id: 'history-image', name: 'history.png', mimeType: 'image/png' },
          { id: 'queue-one', name: 'queue-one.png', mimeType: 'image/png' },
          { id: 'queue-two', name: 'queue-two.png', mimeType: 'image/png' },
          { id: 'queue-three', name: 'queue-three.png', mimeType: 'image/png' },
          { id: 'late-image', name: 'late.png', mimeType: 'image/png' },
        ],
      },
      { id: 'history-assistant', role: 'assistant', text: '你好，我在這裡。', createdAt: 'invalid', complete: true, sources: [{ id: 'history-source', title: '歷史公開來源', url: 'https://example.com/history', retrievedAt: '2026-09-13T07:15:00.000Z' }, { title: '沒有識別碼的歷史來源', url: 'https://example.com/unopenable', retrievedAt: '2026-09-13T07:15:00.000Z' }] },
    ],
    getAttachment: async ({ messageId, attachmentId }) => {
      attachmentCalls++;
      attachmentCallCounts.set(attachmentId, (attachmentCallCounts.get(attachmentId) || 0) + 1);
      check(messageId === 'history-user', 'renderer 必須只以訊息與附件識別碼讀取歷史附件');
      if (['queue-one', 'queue-two', 'late-image'].includes(attachmentId)) {
        return new Promise((resolve) => attachmentResolvers.set(attachmentId, () => resolve({ mimeType: 'image/png', data: fixturePng })));
      }
      return { mimeType: 'image/png', data: fixturePng };
    },
    send: async (request) => {
      calls.push(request);
      await new Promise((resolve) => { resolveSend = resolve; });
    },
    confirmSearch: async (request) => { calls.push({ confirmSearch: request }); },
    cancel: async () => { calls.push('cancel'); },
    collapse: async () => { calls.push('collapse'); },
    openSource: async (request) => { calls.push({ opened: request }); },
    resize: async (chatSize) => { calls.push({ resize: chatSize }); return { name: '夏奈', chatSize }; },
    onEvent: (callback) => { eventListener = callback; return () => { eventListener = null; }; },
  };
  source(); await tick();
  const overlay = el('chat-overlay');
  check(overlay?.contains(el('chat-form')), '聊天控制項必須置於程式內聊天 overlay');
  check(getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)', 'overlay 視窗背景必須透明，不能呈現右側不透明面板');
  check(getComputedStyle(overlay).borderRadius !== '0px', '聊天 overlay 必須以圓角泡泡呈現');
  check(getComputedStyle(overlay).backgroundColor === 'rgb(255, 250, 250)', '聊天外框必須保留原本輕量的淺色桌寵樣式');
  check(getComputedStyle(document.querySelector('header')).backgroundColor === 'rgb(252, 233, 238)', '標題列不可改成深色網站面板');
  check(getComputedStyle(el('chat-form')).backgroundColor === 'rgb(255, 255, 255)', '輸入區不可改成深色網站面板');
  check(getComputedStyle(document.querySelector('[data-message-id="history-assistant"]')).backgroundColor === 'rgb(255, 255, 255)', '助理回覆泡泡必須使用白色背景');
  check(!document.getElementById('chat-mode'), '單一聊天入口不得顯示或保留一般／聯網模式選單');
  const resizeHandle = el('chat-resize-handle');
  check(resizeHandle, '聊天泡泡必須提供右下角尺寸調整控制點');
  resizeHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 100, clientY: 100 }));
  document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 120, clientY: 120 }));
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 120, clientY: 120 }));
  await tick();
  check(calls.some((call) => call.resize?.width === 520 && call.resize?.height === 460), '拖曳控制點必須經由受限 API 保存聊天框尺寸');
  check(document.title === '和夏奈聊天' && document.querySelector('h1').textContent === '和夏奈聊天', '聊天框標題必須使用桌寵名稱');
  const historicalSource = document.querySelector('[data-message-id="history-assistant"] .sources button');
  check(historicalSource?.textContent.includes('歷史公開來源') && historicalSource.textContent.includes('2026/09/13 15:15'), '歷史來源必須保留標題、網址與擷取時間');
  const unopenableHistoricalSource = [...document.querySelectorAll('[data-message-id="history-assistant"] .sources button')].find((button) => button.textContent.includes('沒有識別碼的歷史來源'));
  check(unopenableHistoricalSource?.disabled, '缺少 source id 的歷史來源不得提供開啟操作');
  historicalSource.click(); await tick();
  check(calls.at(-1).opened?.messageId === 'history-assistant' && calls.at(-1).opened?.sourceId === 'history-source' && !Object.hasOwn(calls.at(-1).opened, 'url'), '歷史來源開啟只能傳送訊息與來源識別碼');
  check(el('chat-messages').textContent.includes('你好，我在這裡。'), '必須顯示既有訊息');
  const historyImage = [...document.querySelectorAll('[data-message-id="history-user"] img')].find((image) => image.dataset.attachmentId === 'history-image');
  check(historyImage?.alt === 'history.png', '已保存附件必須在其使用者訊息內顯示圖片');
  check(attachmentCalls === 0, '尚未進入 viewport 的歷史附件不得立即讀取');
  observeAttachments([{ target: historyImage, isIntersecting: true }]); await tick();
  if (!historyImage.complete) await new Promise((resolve, reject) => { historyImage.addEventListener('load', resolve, { once: true }); historyImage.addEventListener('error', reject, { once: true }); });
  check(historyImage.naturalWidth > 0, '隔離 fixture 的歷史圖片必須實際解碼');
  observeAttachments([{ target: historyImage, isIntersecting: false }]);
  check(!historyImage.hasAttribute('src'), '離開 viewport 的歷史附件必須釋放圖片來源');
  check(getComputedStyle(historyImage).maxWidth === '100%', '圖片不可超出聊天泡泡寬度');
  const historyTime = document.querySelector('[data-message-id="history-user"] time');
  check(historyTime?.dateTime === '2026-09-13T07:15:00.000Z' && historyTime.textContent === '2026/09/13 15:15', '有效歷史時間必須以語意化本機時間顯示');
  const historyMessage = document.querySelector('[data-message-id="history-user"]');
  check(document.querySelector('[data-message-id="history-assistant"] time')?.textContent === '時間不詳', '缺失或無效時間不可顯示 Invalid Date');
  const messageMeta = historyMessage.querySelector('.message-meta');
  const copyMessage = historyMessage.querySelector('[data-message-action="copy"]');
  const editMessage = historyMessage.querySelector('[data-message-action="edit"]');
  check(copyMessage?.getAttribute('aria-label') === '複製訊息', '每則訊息必須提供可用的複製操作');
  check(editMessage?.getAttribute('aria-label') === '編輯訊息', '最新使用者訊息必須在訊息旁提供既有編輯操作');
  check(document.querySelector('[data-message-id="earlier-user"] [data-message-action="edit"]')?.hidden, '較早的使用者訊息不得顯示編輯操作');
  check(getComputedStyle(messageMeta).opacity === '0', '時間與操作列未聚焦時必須隱藏');
  copyMessage.focus();
  copyMessage.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 160));
  check(messageMeta.style.opacity === '1', '鍵盤聚焦訊息操作時必須顯示時間與操作列');
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  let fallbackText = '';
  document.execCommand = (command) => { fallbackText = document.activeElement.value; return command === 'copy'; };
  copyMessage.click(); await tick();
  check(fallbackText === '這是已保存的圖片。', 'Clipboard API 不可用時，複製操作必須走本機選取 fallback');
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { copiedText = text; } }, configurable: true });
  copyMessage.click(); await tick();
  check(copiedText === '這是已保存的圖片。', '複製操作必須複製該則訊息的純文字');
  editMessage.click(); await tick();
  check(el('chat-input').value === '這是已保存的圖片。', '訊息旁編輯操作必須沿用既有的最新訊息編輯流程');
  editMessage.click(); await tick();
  check(el('chat-input').value === '', '再次點擊訊息旁編輯操作必須取消既有編輯流程');
  const queueImages = ['queue-one', 'queue-two', 'queue-three'].map((attachmentId) => [...document.querySelectorAll('[data-message-id="history-user"] img')].find((image) => image.dataset.attachmentId === attachmentId));
  check(queueImages.every(Boolean), '三張延遲載入圖片必須保留各自的受限附件識別碼');
  observeAttachments(queueImages.map((target) => ({ target, isIntersecting: true })));
  observeAttachments([{ target: queueImages[2], isIntersecting: false }]);
  attachmentResolvers.get('queue-one')(); attachmentResolvers.get('queue-two')(); await tick();
  observeAttachments([{ target: queueImages[2], isIntersecting: true }]); await tick();
  check(attachmentCallCounts.get('queue-three') === 1, '離開 viewport 的 queued 圖片重新進入後必須重新排程載入');
  const lateImage = [...document.querySelectorAll('[data-message-id="history-user"] img')].find((image) => image.dataset.attachmentId === 'late-image');
  observeAttachments([{ target: lateImage, isIntersecting: true }]); await tick();
  check(attachmentCallCounts.get('late-image') === 1, 'reset 前必須已開始讀取一張歷史圖片');
  const transfer = new DataTransfer();
  transfer.items.add(new File([fixtureBytes], 'preview.png', { type: 'image/png' }));
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: transfer });
  el('chat-input').dispatchEvent(paste);
  await new Promise((resolve) => setTimeout(resolve, 50));
  check(el('chat-attachment-list').querySelector('img')?.alt === 'preview.png', '貼上的已選取圖片必須在送出前可預覽');
  el('chat-input').value = '<img src=x onerror=alert(1)>你好';
  el('chat-send').click(); await tick();
  const firstRequest = calls.find((call) => call.text === '<img src=x onerror=alert(1)>你好');
  check(firstRequest && !Object.hasOwn(firstRequest, 'mode'), 'renderer 送出文字時不得決定或傳送聊天模式');
  check(firstRequest?.attachments?.[0]?.name === 'preview.png', '僅已選取圖片可經由受限 API 附加送出');
  check(el('chat-messages').textContent.includes('<img src=x onerror=alert(1)>你好'), '使用者訊息必須立即顯示');
  check([...document.querySelectorAll('[data-role="user"]')].at(-1)?.querySelector('img')?.alt === 'preview.png', '送出後圖片必須留在該使用者訊息內');
  check(document.querySelector('[data-role="user"] .reply-text img') === null, '訊息文字不可作為 HTML 插入');
  check([...document.querySelectorAll('[data-role="user"]')].at(-1)?.querySelector('time')?.textContent === '時間不詳', '暫時訊息不可偽造 renderer 時鐘為正式時間');
  const requestId = firstRequest.requestId;
  eventListener({ type: 'search-confirmation', requestId, query: 'token=private-value' });
  const confirmation = document.querySelector('[data-search-confirmation]');
  check(confirmation?.textContent.includes('敏感資料') && !confirmation.textContent.includes('private-value'), '敏感確認只能顯示固定文字，不可顯示 query');
  confirmation.querySelector('[data-search-confirm="approve"]').click(); await tick();
  check(calls.some((call) => call.confirmSearch?.requestId === requestId && call.confirmSearch?.approved === true && Object.keys(call.confirmSearch).length === 2), '同意只能送出 scoped requestId 與 approved');
  eventListener({ type: 'search-confirmation', requestId });
  document.querySelector('[data-search-confirm="decline"]').click(); await tick();
  check(calls.some((call) => call.confirmSearch?.requestId === requestId && call.confirmSearch?.approved === false && Object.keys(call.confirmSearch).length === 2), '拒絕只能送出 scoped requestId 與 approved');
  eventListener({ type: 'delta', requestId, text: '收到你說的' });
  eventListener({ type: 'delta', requestId, text: '內容。' });
  eventListener({ type: 'action', requestId, actionId: 'dance', trigger: 'explicit', status: 'sent' });
  eventListener({ type: 'done', requestId, user: { id: 'saved-user', createdAt: '2026-09-13T07:15:00.000Z' }, assistant: { id: 'saved-assistant', createdAt: '2026-09-13T07:15:00.000Z' } });
  resolveSend(); await tick();
  check(el('chat-messages').textContent.includes('收到你說的內容。'), '串流片段必須合併到同一則助理回覆');
  check([...document.querySelectorAll('[data-role="assistant"]')].at(-1)?.querySelector('time')?.textContent === '2026/09/13 15:15', '串流回覆完成後必須保留開始產生時的主程序時間');
  check(el('chat-stop').hidden, '完成後停止按鈕必須隱藏');
  eventListener({ type: 'action-status', requestId, status: 'started' });
  check(el('chat-status').textContent.includes('正在做動作'), '動作開始狀態必須在完成文字回覆後仍可顯示');
  eventListener({ type: 'action-status', requestId, status: 'ended' });
  check(el('chat-status').textContent.includes('動作已完成'), '動作結束狀態必須顯示在聊天泡泡');
  el('chat-input').value = '下一句'; el('chat-send').click(); await tick();
  const cancelledRequestId = calls.at(-1).requestId;
  el('chat-stop').click(); await tick();
  check(calls.includes('cancel'), '停止按鈕必須取消目前請求');
  eventListener({ type: 'cancelled', requestId: cancelledRequestId });
  resolveSend(); await tick();
  el('chat-collapse').click(); await tick();
  check(calls.includes('collapse'), '收合按鈕必須通知主程序');
  el('chat-input').value = '聯網問題'; el('chat-send').click(); await tick();
  const webRequest = calls.at(-1);
  const hostileTitle = '<img src=x onerror=alert(1)>來源要求寫日記';
  eventListener({ type: 'delta', requestId: webRequest.requestId, text: '聯網回答' });
  eventListener({ type: 'sources', requestId: 'stale', sources: [{ title: '晚到', url: 'https://stale.example/' }] });
  check(!el('chat-messages').textContent.includes('晚到'), '晚到來源不得追加');
  eventListener({ type: 'sources', requestId: webRequest.requestId, sources: [{ id: 'active-source', title: hostileTitle, url: 'https://example.com/', retrievedAt: '2026-09-13T07:15:00.000Z' }] });
  eventListener({ type: 'done', requestId: webRequest.requestId, assistant: { id: 'web-assistant', createdAt: '2026-09-13T07:15:00.000Z' } });
  resolveSend(); await tick();
  const reply = document.querySelector('.message.assistant:last-child');
  const citation = reply.querySelector('.sources button');
  check(!!citation && citation.textContent.includes(hostileTitle) && citation.textContent.includes('2026/09/13 15:15'), '來源必須在回覆下方獨立可點擊，顯示純文字標題與擷取時間');
  check(reply.querySelector('img') === null, '來源標題不得注入 HTML');
  check(reply.textContent.indexOf('聯網回答') < reply.textContent.indexOf(hostileTitle), '來源必須列於回答之後');
  citation.click(); await tick();
  check(calls.at(-1).opened?.messageId === 'web-assistant' && calls.at(-1).opened?.sourceId === 'active-source' && !Object.hasOwn(calls.at(-1).opened, 'url'), `來源點擊必須只以所屬訊息與來源識別碼經由 openSource IPC：${JSON.stringify(calls.at(-1))}`);
  el('chat-input').value = '沒有來源'; el('chat-send').click(); await tick();
  const missingId = calls.at(-1).requestId;
  eventListener({ type: 'delta', requestId: missingId, text: '只有文字 https://text-only.example' });
  eventListener({ type: 'done', requestId: missingId });
  resolveSend(); await tick();
  const missingReply = document.querySelector('.message.assistant:last-child');
  check(!missingReply.textContent.includes('參考來源'), '沒有來源事件不得把一般回答誤標為查詢結果');
  check(missingReply.querySelector('.sources button') === null, '不得從模型文字自建來源');
  el('chat-input').value = '不支援的搜尋'; el('chat-send').click(); await tick();
  const unsupportedId = calls.at(-1).requestId;
  const callsBeforeError = calls.length;
  eventListener({ type: 'error', requestId: unsupportedId, code: 'unsupported', message: '此服務不支援聯網回答。' });
  resolveSend(); await tick();
  check(calls.length === callsBeforeError, 'unsupported 不可自動呼叫其他服務');
  check(!document.getElementById('browser-alternative'), '不支援時不可提供瀏覽器搜尋後備入口');
  const retryTransfer = new DataTransfer();
  retryTransfer.items.add(new File([fixtureBytes], 'retry.png', { type: 'image/png' }));
  const retryPaste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(retryPaste, 'clipboardData', { value: retryTransfer });
  el('chat-input').dispatchEvent(retryPaste); await new Promise((resolve) => setTimeout(resolve, 50));
  check(el('chat-attachment-list').querySelector('img')?.alt === 'retry.png', '重試圖片必須先完成輸入附件預覽');
  el('chat-input').value = '圖片被服務拒絕'; el('chat-send').click(); await tick();
  const rejectedRequest = calls.at(-1);
  eventListener({ type: 'error', requestId: rejectedRequest.requestId, code: 'unsupported', message: '此服務不支援圖片。' });
  resolveSend(); await tick();
  check(!el('chat-messages').textContent.includes('圖片被服務拒絕'), '未保存的圖片請求不得留成已送出訊息');
  check(el('chat-attachment-list').querySelector('img')?.alt === 'retry.png', '圖片被拒絕後必須保留輸入附件以便重試');
  check(!el('chat-send').disabled, '圖片被拒絕後必須可再次送出');
  el('chat-input').value = '清除中的請求'; el('chat-send').click(); await tick();
  const clearingRequest = calls.at(-1);
  eventListener({ type: 'search-confirmation', requestId: clearingRequest.requestId });
  check(document.querySelector('[data-search-confirmation]'), '敏感確認事件必須顯示控制');
  eventListener({ type: 'reset' });
  check(el('chat-messages').children.length === 0, '清除事件必須移除舊訊息與暫時訊息');
  check(!document.querySelector('[data-search-confirmation]'), 'reset 必須移除敏感確認控制');
  check(!el('chat-send').disabled, '清除事件後必須可再次送出');
  attachmentResolvers.get('late-image')(); await tick();
  el('chat-input').value = '清除後的新圖片訊息'; el('chat-send').click(); await tick();
  const afterResetRequest = calls.at(-1);
  eventListener({ type: 'done', requestId: afterResetRequest.requestId, user: {
    id: 'history-user', createdAt: '2026-09-13T07:15:00.000Z', attachments: [{ id: 'late-image', name: 'late.png', mimeType: 'image/png' }],
  }, assistant: { id: 'after-reset-assistant', createdAt: '2026-09-13T07:15:00.000Z' } });
  resolveSend(); await tick();
  const afterResetImage = document.querySelector('[data-message-id="history-user"] img');
  observeAttachments([{ target: afterResetImage, isIntersecting: true }]); await tick();
  check(attachmentCallCounts.get('late-image') === 2, 'reset 後晚到的舊圖片讀取不得填入可被新訊息使用的快取');
  return 'Chat UI checks passed';
}

async function exerciseInitialHistoryReset(source) {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  let resolveHistory;
  let eventListener;
  window.chatAPI = {
    getInfo: async () => ({ name: '夏奈', chatSize: { width: 500, height: 440 } }),
    getMessages: () => new Promise((resolve) => { resolveHistory = resolve; }),
    getAttachment: async () => ({ mimeType: 'image/png', data: '' }),
    send: async () => {}, cancel: async () => {}, collapse: async () => {}, openSource: async () => {},
    resize: async (chatSize) => ({ name: '夏奈', chatSize }),
    onEvent: (callback) => { eventListener = callback; return () => {}; },
  };
  source(); await tick();
  eventListener({ type: 'reset' });
  resolveHistory([{ id: 'stale-history', role: 'user', text: '不應復活的舊歷史', complete: true, createdAt: '2026-09-13T07:15:00.000Z' }]);
  await tick();
  if (document.getElementById('chat-messages').children.length !== 0) throw new Error('reset 後晚到的初始歷史不得重新加入訊息清單');
  if (document.getElementById('chat-status').textContent !== '聊天記錄已清除。') throw new Error('reset 後晚到的初始歷史不得覆寫清除狀態');
  return 'Initial history reset checks passed';
}

test('聊天 preload 只公開所需 IPC，且可取消事件訂閱', async () => {
  const vm = require('node:vm');
  const ipc = new EventEmitter();
  const calls = [];
  const sends = [];
  let api;
  ipc.invoke = async (...args) => { calls.push(args); return []; };
  ipc.send = (...args) => { sends.push(args); };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/chat/preload.js'), 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron');
      return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (key, value) => { api = value; assert.equal(key, 'chatAPI'); } } };
    },
  });
  assert.deepEqual(Object.keys(api).sort(), ['cancel', 'collapse', 'confirmSearch', 'editLatest', 'getAttachment', 'getInfo', 'getMessages', 'onEvent', 'openSource', 'resize', 'send']);
  await api.getInfo(); await api.resize({ width: 500, height: 440 }); await api.getMessages(); await api.getAttachment({ messageId: 'u1', attachmentId: 'image-1' }); await api.send({ requestId: 'r1', text: '你好' }); await api.editLatest({ requestId: 'r2', messageId: 'u1', text: '修正' }); await api.confirmSearch({ requestId: 'r3', approved: true, query: 'private', petId: 'other-pet' }); await api.openSource({ messageId: 'a1', sourceId: 's1', url: 'file:///C:/private', path: 'C:/private', petId: 'other-pet' }); await api.cancel(); await api.collapse();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['chat:info'], ['chat:resize', { width: 500, height: 440 }], ['chat:get'], ['chat:get-attachment', { messageId: 'u1', attachmentId: 'image-1' }], ['chat:send', { requestId: 'r1', text: '你好' }], ['chat:edit-latest', { requestId: 'r2', messageId: 'u1', text: '修正' }], ['chat:confirm-search', { requestId: 'r3', approved: true }], ['chat:open-source', { messageId: 'a1', sourceId: 's1' }]]);
  assert.deepEqual(sends, [['chat:cancel'], ['chat:collapse']]);
  const received = [];
  const unsubscribe = api.onEvent((event) => received.push(event));
  ipc.emit('chat:event', {}, { type: 'delta', requestId: 'r1', text: '回覆' });
  unsubscribe(); ipc.emit('chat:event', {}, { type: 'done', requestId: 'r1' });
  assert.deepEqual(received, [{ type: 'delta', requestId: 'r1', text: '回覆' }]);
});

test('聊天 renderer：安全呈現、串流回覆、停止與收合', { skip: process.env.PET_DESKTOP_TESTS !== '1' }, () => {
  const { spawnSync } = require('node:child_process');
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-chat-ui-'));
  try {
    const appData = path.join(fixtureDirectory, 'app-data');
    const localAppData = path.join(fixtureDirectory, 'local-app-data');
    const temp = path.join(fixtureDirectory, 'temp');
    fs.mkdirSync(appData, { recursive: true });
    fs.mkdirSync(localAppData, { recursive: true });
    fs.mkdirSync(temp, { recursive: true });
    const env = {
      ...process.env,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      PET_CHAT_UI_DATA_DIR: fixtureDirectory,
      TEMP: temp,
      TMP: temp,
      TZ: 'Asia/Taipei',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename, '--chat-ui-fixture'], { env, encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /Chat UI checks passed/);
  } finally {
    fs.rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});

if (process.versions.electron && process.argv.includes('--chat-ui-fixture')) {
  const { app, BrowserWindow } = require('electron');
  const { configureElectron } = require('../src/startup.js');
  const fixtureDirectory = process.env.PET_CHAT_UI_DATA_DIR;
  if (typeof fixtureDirectory !== 'string' || !path.isAbsolute(fixtureDirectory)) throw new Error('聊天 UI fixture 缺少隔離資料目錄。');
  const userData = path.join(fixtureDirectory, 'user-data');
  const sessionData = path.join(fixtureDirectory, 'session-data');
  const cache = path.join(fixtureDirectory, 'cache');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(sessionData, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  configureElectron(app);
  app.setPath('userData', userData);
  app.setPath('sessionData', sessionData);
  app.setPath('cache', cache);
  app.commandLine.appendSwitch('disk-cache-dir', cache);
  assert.equal(app.getPath('userData'), userData);
  assert.equal(app.getPath('sessionData'), sessionData);
  assert.equal(app.getPath('cache'), cache);
  const processFailures = [];
  app.on('child-process-gone', (_event, details) => processFailures.push(`child ${details.type}: ${details.reason} (${details.exitCode})`));
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'chat-ui-test' } });
    const pageFailures = [];
    win.webContents.on('render-process-gone', (_event, details) => pageFailures.push(`renderer: ${details.reason} (${details.exitCode})`));
    win.webContents.on('did-fail-load', (_event, code, description, url) => pageFailures.push(`load ${url}: ${description} (${code})`));
    const htmlPath = path.join(__dirname, '../chat.html');
    const rendererPath = path.join(__dirname, '../src/chat/renderer.js');
    const cssPath = path.join(__dirname, '../chat.css');
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
    const html = fs.existsSync(htmlPath)
      ? fs.readFileSync(htmlPath, 'utf8').replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/g, '').replace(/<link\b[^>]*chat\.css[^>]*>/g, `<style>${css}</style>`).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
      : '<!doctype html><body></body>';
    try {
      await win.loadURL('about:blank');
    } catch (error) {
      error.message = [...processFailures, ...pageFailures, error.message].join('\n');
      throw error;
    }
    await win.webContents.executeJavaScript(`document.open(); document.write(${JSON.stringify(html)}); document.close();`);
    const source = fs.existsSync(rendererPath) ? fs.readFileSync(rendererPath, 'utf8') : '';
    console.log(await win.webContents.executeJavaScript(`(${exerciseChatUI.toString()})(() => {\n${source}\n})`));
    console.log(await win.webContents.executeJavaScript(`(${exerciseInitialHistoryReset.toString()})(() => {\n${source}\n})`));
    win.destroy(); app.exit(0);
  }).catch((error) => { console.error(error); app.exit(1); });
}
