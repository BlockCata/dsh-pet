const crypto = require('node:crypto');

function createDiaryWorker({ store, streamReply, getConnection, emit = () => {}, now = () => new Date().toISOString() }) {
  const active = new Map();

  async function run(petId, manual) {
    if (active.has(petId)) return { status: 'busy' };
    const memory = store.read(petId);
    const messages = memory.messages.filter((message) => message.complete);
    const summarizedIndex = memory.summarizedThrough ? messages.findIndex((message) => message.id === memory.summarizedThrough) : -1;
    const unsummarized = summarizedIndex >= 0 ? messages.slice(summarizedIndex + 1) : messages;
    if ((!manual && (unsummarized.length < 40 || !memory.policy.autoDiary)) || !unsummarized.length || memory.policy.mode === 'off') return { status: 'empty' };
    const selected = unsummarized.slice(0, 40);
    const controller = new AbortController();
    active.set(petId, controller);
    let text = '';
    try {
      const prompt = [
        '請整理成易讀日記：記錄談話事件、使用者明示的具體細節與偏好、未完成事項、可延續話題。使用「使用者明示事實」、「桌寵實際動作」、「推測或待確認」區分內容；不得把助手或網頁內容寫成使用者事實，不得為增加篇幅虛構。',
        ...selected.map((message) => `${message.role === 'user' ? '使用者' : '助手'}：${message.text}`),
      ].join('\n');
      for await (const event of streamReply({ connection: getConnection(), messages: [{ role: 'user', text: prompt }], mode: 'chat', signal: controller.signal })) {
        if (event.type === 'delta') text += event.text;
      }
      if (!controller.signal.aborted && text.trim() && text.length <= 2000) {
        const committed = store.commitDiary(petId, {
          expectedRevision: memory.revision,
          diary: { id: crypto.randomUUID(), text: text.trim(), createdAt: now(), sourceMessageIds: selected.map((message) => message.id) },
          summarizedThrough: selected.at(-1).id,
        });
        if (committed) return { status: 'saved' };
        return { status: 'stale' };
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const code = error?.code || 'network';
        emit(petId, { type: 'diary-error', code });
        return { status: 'failed', code };
      }
    } finally {
      if (active.get(petId) === controller) active.delete(petId);
      emit(petId, { type: 'diary-finished' });
    }
    return { status: controller.signal.aborted ? 'cancelled' : 'empty' };
  }

  return { schedule: (petId) => run(petId, false), runNow: (petId) => run(petId, true), cancel: (petId) => active.get(petId)?.abort() };
}

module.exports = { createDiaryWorker };
