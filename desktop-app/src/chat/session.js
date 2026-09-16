const { randomUUID } = require('node:crypto');
const { validateSourceUrl } = require('./search.js');

const DISPOSE_TIMEOUT_MS = 100;
const CLEANUP_FAILURE_REASON = 'browser-search-parser-cleanup-failed';

function chatError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanupFailure() {
  return { status: 'blocked', reason: CLEANUP_FAILURE_REASON };
}

function disposalBarrierError() {
  return chatError(CLEANUP_FAILURE_REASON, '聊天搜尋清理失敗。');
}

function createSessions({ streamReply, getConnection, getProfile = () => null, getActionChoices = () => [], readMessages = () => [], appendMessages = () => {}, readAttachments = () => [], editStoredMessage = () => { throw chatError('invalid', '訊息無法編輯。'); }, runDiary = async () => ({ status: 'unavailable' }), selectContext = (_petId, input) => input.messages, requestAction = () => ({ status: 'skipped' }), browserSearch = { async search() { return { status: 'blocked', sources: [] }; }, cancel() {}, dispose() {} }, emit, now = () => new Date().toISOString(), timeContext = (currentTime) => ({ currentTime, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', utcOffset: '+00:00' }) }) {
  const sessions = new Map();
  const disposalBarriers = new Map();

  function sourceExcerpts(sources, existing = []) {
    const excerpts = structuredClone(existing);
    const displayed = excerpts.map(({ text, ...source }) => source);
    const initialCount = excerpts.length;
    let remaining = 18_000 - excerpts.reduce((total, source) => total + source.text.length, 0);
    for (const source of Array.isArray(sources) ? sources : []) {
      if (excerpts.length === 6 || remaining === 0) break;
      if (typeof source?.text !== 'string') continue;
      let url;
      try {
        url = validateSourceUrl(source.url);
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
      } catch { continue; }
      if (typeof source.title !== 'string' || !source.title.trim() || typeof source.retrievedAt !== 'string' || !Number.isFinite(new Date(source.retrievedAt).getTime())) continue;
      const text = source.text.slice(0, Math.min(6_000, remaining)).trim();
      if (!text) continue;
      const id = `source-${excerpts.length + 1}`;
      const safe = { id, title: source.title.trim(), url, retrievedAt: source.retrievedAt, coverage: source.coverage === 'snippet' ? 'snippet' : 'page' };
      displayed.push(safe);
      excerpts.push({ ...safe, text });
      remaining -= text.length;
    }
    return { excerpts, displayed, added: excerpts.length - initialCount };
  }

  function searchFailure(status) {
    if (status === 'needs-user') return '需要先由使用者在隔離瀏覽器完成驗證；我目前無法確認最新公開資料。';
    if (status === 'timeout') return '公開資料查詢逾時；我目前無法確認最新資訊。';
    if (status === 'empty') return '我沒有找到可驗證的公開資料，因此無法確認最新資訊。';
    if (status === 'sensitive') return '這個查詢可能包含敏感資料，我不會將它外送搜尋。';
    return '我目前無法取得可驗證的公開資料，因此無法確認最新資訊。';
  }

  function isSensitiveQuery(query) {
    return /(?:api[ _-]?key|password|token|secret|金鑰|密碼|權杖|file:|[a-z]:[\\/]|\/(?:[^/\s]+\/){1,}[^/\s]*)/i.test(query);
  }

  function invalidateConfirmation(active) {
    if (!active?.confirmation) return;
    active.confirmation.resolve(false);
    active.confirmation = null;
  }

  function stateFor(petId) {
    if (disposalBarriers.has(petId)) throw disposalBarrierError();
    let state = sessions.get(petId);
    if (!state) { state = { messages: structuredClone(readMessages(petId)), active: null }; sessions.set(petId, state); }
    return state;
  }

  function disposeBrowserSearch(petId) {
    let timer;
    const cleanup = Promise.resolve().then(() => browserSearch.dispose?.(petId)).then((result) => result?.status === 'blocked' ? cleanupFailure() : { status: 'ok' }, () => cleanupFailure());
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(cleanupFailure()), DISPOSE_TIMEOUT_MS); });
    return { result: Promise.race([cleanup, timeout]).finally(() => clearTimeout(timer)), completion: cleanup };
  }

  function messagesForRequest(state) {
    return state.messages.filter((message) => message.complete).slice(-21).map(({ id, role, text, createdAt, requestId, complete, attachments }) => ({ id, role, text, createdAt, requestId, complete, attachments }));
  }

  function requestsDiary(text) {
    return /(整理|寫).{0,8}(日記|記憶)|(日記|記憶).{0,8}(整理|寫)/.test(text);
  }

  async function send(petId, { requestId, text, mode, allowWebSearch = false, replaceMessageId, attachments = [] } = {}) {
    if (typeof petId !== 'string' || !petId || typeof requestId !== 'string' || !requestId) throw chatError('invalid', '請求識別碼無效。');
    if (typeof text !== 'string' || !text.trim()) throw chatError('invalid', '請輸入訊息。');
    if (text.length > 8000) throw chatError('invalid', '訊息最多 8,000 個字元。');
    if (mode !== 'chat') throw chatError('invalid', '此聊天模式已不提供。');
    const state = stateFor(petId);
    if (state.active) throw chatError('busy', '此桌寵正在回答，請先停止或等待完成。');
    const controller = new AbortController();
    const active = { requestId, controller };
    state.active = active;
    const createdAt = now();
    const requestTimeContext = timeContext(createdAt);
    const replacement = replaceMessageId ? state.messages.find((message) => message.id === replaceMessageId && message.role === 'user' && message.complete) : null;
    if (replaceMessageId && !replacement) throw chatError('invalid', '找不到可修正的使用者訊息。');
    const user = replacement || {
      id: randomUUID(), role: 'user', text: text.trim(), createdAt, requestId, complete: true,
      ...(attachments.length ? { attachments } : {}),
    };
    const assistant = { id: randomUUID(), role: 'assistant', text: '', createdAt, requestId, complete: false };
    if (!replacement) state.messages.push(user);
    state.messages.push(assistant);
    const discardPendingMessages = () => {
      const discarded = new Set([assistant]);
      if (!replacement) discarded.add(user);
      state.messages = state.messages.filter((message) => !discarded.has(message));
    };
    let completed = false;
    let actionRequested = false;
    try {
      const searchTurn = allowWebSearch === true;
      let hasEnteredSearch = false;
      const diaryResult = !searchTurn && requestsDiary(user.text) ? await runDiary(petId) : null;
      const connection = structuredClone(getConnection());
      let messages = selectContext(petId, { query: user.text, mode, messages: messagesForRequest(state) });
      const current = messages.find((message) => message.id === user.id);
      if (!searchTurn && current && user.attachments?.length) current.attachments = readAttachments(petId, user.attachments);
      if (searchTurn) messages = messages.map(({ attachments, ...message }) => message);
      const profile = diaryResult ? { ...(getProfile(petId) || {}), diaryResult: diaryResult.status } : getProfile(petId);
      let modelCalls = 0;
      let searches = 0;
      let sourceContext;
      let sources = [];
      while (!completed && modelCalls < 3) {
        modelCalls++;
        let decision;
        for await (const event of streamReply({ connection: structuredClone(connection), messages, profile, actionChoices: hasEnteredSearch ? [] : getActionChoices(), allowActions: !hasEnteredSearch, mode: searchTurn ? 'search-protocol' : mode, signal: controller.signal, timeContext: requestTimeContext, sourceExcerpts: sourceContext })) {
          if (sessions.get(petId) !== state || state.active !== active || controller.signal.aborted) return;
          if (searchTurn && event.type === 'search-decision') {
            decision = event.decision;
            if (decision?.type === 'search') {
              hasEnteredSearch = true;
              assistant.mode = 'web';
              assistant.sources = [];
            }
          }
          if (event.type === 'delta' && typeof event.text === 'string' && (!searchTurn || decision?.type === 'answer')) {
            assistant.text += event.text;
            emit(petId, { requestId, type: 'delta', text: event.text });
          }
          if (!searchTurn && event.type === 'done') completed = true;
          if (event.type === 'action' && !actionRequested && (!searchTurn || (!hasEnteredSearch && decision?.type === 'answer'))) {
            actionRequested = true;
            const proposal = { requestId, actionId: event.actionId, trigger: event.trigger };
            const result = requestAction(petId, proposal);
            emit(petId, { requestId, type: 'action', actionId: proposal.actionId, trigger: proposal.trigger, status: result.status });
          }
        }
        if (!searchTurn || completed) break;
        if (decision?.type === 'answer') {
          if (sources.length) {
            assistant.sources = structuredClone(sources);
            emit(petId, { requestId, type: 'sources', sources: assistant.sources });
          }
          completed = true;
          break;
        }
        if (decision?.type !== 'search' || searches === 2 || modelCalls === 3) {
          const text = searchFailure('blocked');
          assistant.text += text;
          emit(petId, { requestId, type: 'delta', text });
          completed = true;
          break;
        }
        if (isSensitiveQuery(decision.query)) {
          await new Promise((resolve) => {
            active.confirmation = { resolve };
            emit(petId, { requestId, type: 'search-confirmation' });
          });
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const text = searchFailure('sensitive');
          assistant.text += text;
          emit(petId, { requestId, type: 'delta', text });
          completed = true;
          break;
        }
        let result;
        try { result = await browserSearch.search({ petId, requestId, query: decision.query, signal: controller.signal }); }
        catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError') throw error;
          const text = searchFailure(error?.code === 'timeout' ? 'timeout' : 'blocked');
          assistant.text += text;
          emit(petId, { requestId, type: 'delta', text });
          completed = true;
          break;
        }
        if (sessions.get(petId) !== state || state.active !== active || controller.signal.aborted) return;
        if (result?.status !== 'ok') {
          const text = searchFailure(result?.status);
          assistant.text += text;
          emit(petId, { requestId, type: 'delta', text });
          completed = true;
          break;
        }
        const safeSources = sourceExcerpts(result.sources, sourceContext);
        if (!safeSources.added) {
          const text = searchFailure('empty');
          assistant.text += text;
          emit(petId, { requestId, type: 'delta', text });
          completed = true;
          break;
        }
        searches++;
        sourceContext = safeSources.excerpts;
        sources = safeSources.displayed;
      }
      if (sessions.get(petId) !== state || state.active !== active) return;
      if (controller.signal.aborted) {
        discardPendingMessages();
        emit(petId, { requestId, type: 'cancelled' });
      } else if (completed) {
        assistant.complete = true;
        if (hasEnteredSearch) appendMessages(petId, replacement ? [{ ...assistant }] : [{ ...user }, { ...assistant }], { scheduleDiary: false });
        else appendMessages(petId, replacement ? [{ ...assistant }] : [{ ...user }, { ...assistant }]);
        emit(petId, { requestId, type: 'done', user: { id: user.id, createdAt: user.createdAt, attachments: structuredClone(user.attachments || []) }, assistant: { id: assistant.id, createdAt: assistant.createdAt } });
      } else {
        discardPendingMessages();
        emit(petId, { requestId, type: 'error', code: 'invalid-response', message: 'AI 服務沒有完成回覆。' });
      }
    } catch (error) {
      if (sessions.get(petId) !== state || state.active !== active) return;
      if (controller.signal.aborted || error?.name === 'AbortError') {
        discardPendingMessages();
        emit(petId, { requestId, type: 'cancelled' });
      } else {
        discardPendingMessages();
        const code = ['auth', 'quota', 'network', 'timeout', 'unsupported', 'invalid-response'].includes(error?.code) ? error.code : 'network';
        const message = code === error?.code && typeof error.message === 'string' ? error.message : 'AI 請求失敗。';
        emit(petId, { requestId, type: 'error', code, message });
      }
    } finally {
      if (sessions.get(petId) === state && state.active === active) state.active = null;
    }
  }

  function cancel(petId) {
    const active = sessions.get(petId)?.active;
    if (active) { invalidateConfirmation(active); active.controller.abort(); browserSearch.cancel?.(petId, active.requestId); }
  }

  function confirmSearch(petId, requestId, approved) {
    const active = sessions.get(petId)?.active;
    if (!active?.confirmation || active.requestId !== requestId) return false;
    const { resolve } = active.confirmation;
    active.confirmation = null;
    resolve(approved === true);
    return true;
  }

  async function editLatest(petId, { requestId, messageId, text, mode, allowWebSearch = false } = {}) {
    if (typeof requestId !== 'string' || !requestId || typeof messageId !== 'string' || !messageId) throw chatError('invalid', '請求識別碼無效。');
    if (mode !== 'chat') throw chatError('invalid', '此聊天模式已不提供。');
    const state = stateFor(petId);
    if (state.active) {
      const active = state.active;
      invalidateConfirmation(active);
      active.controller.abort();
      browserSearch.cancel?.(petId, active.requestId);
      state.active = null;
      emit(petId, { requestId: active.requestId, type: 'cancelled' });
    }
    const result = editStoredMessage(petId, messageId, text, requestId);
    if (!result?.memory?.messages) throw chatError('invalid', '訊息無法編輯。');
    state.messages = structuredClone(result.memory.messages);
    return send(petId, { requestId, text, mode, allowWebSearch, replaceMessageId: messageId });
  }

  function dispose(petId) {
    const existing = disposalBarriers.get(petId);
    if (existing) return existing.result;
    const state = sessions.get(petId);
    if (!state) return Promise.resolve({ status: 'ok' });
    if (state.active) {
      invalidateConfirmation(state.active);
      state.active.controller.abort();
      browserSearch.cancel?.(petId, state.active.requestId);
      emit(petId, { requestId: state.active.requestId, type: 'cancelled' });
    }
    sessions.delete(petId);
    emit(petId, { type: 'reset' });
    const disposal = disposeBrowserSearch(petId);
    const barrier = { result: disposal.result };
    disposalBarriers.set(petId, barrier);
    disposal.completion.then(() => {
      if (disposalBarriers.get(petId) === barrier) disposalBarriers.delete(petId);
    });
    return disposal.result;
  }

  function getMessages(petId) {
    return structuredClone(stateFor(petId).messages);
  }

  function appendPetMessage(petId, text) {
    if (typeof petId !== 'string' || !petId || typeof text !== 'string' || !text.trim() || text.length > 8000) throw chatError('invalid', '桌寵訊息格式不正確。');
    const message = { id: randomUUID(), role: 'assistant', text: text.trim(), createdAt: now(), requestId: `pet-${randomUUID()}`, complete: true };
    const state = stateFor(petId);
    state.messages.push(message);
    appendMessages(petId, [{ ...message }]);
    emit(petId, { type: 'proactive', message: { ...message } });
    return structuredClone(message);
  }

  return { send, confirmSearch, editLatest, cancel, dispose, getMessages, appendPetMessage };
}

module.exports = { createSessions };
