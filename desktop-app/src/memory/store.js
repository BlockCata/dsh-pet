const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_POLICY = { mode: 'diary-30d', autoDiary: true };
const MODES = new Set(['diary-30d', 'diary-forever', 'diary-only', 'off']);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function emptyMemory(policy = DEFAULT_POLICY) {
  return { version: 1, revision: 0, policy: { ...policy }, messages: [], diaries: [], summarizedThrough: null };
}

function validPetId(petId) {
  if (typeof petId !== 'string' || !petId || petId.length > 200) throw new Error('桌寵識別碼無效。');
}

function cloneMissingAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((attachment) => {
    if (typeof attachment?.id !== 'string' || !attachment.id || attachment.id.length > 200
      || typeof attachment.name !== 'string' || !attachment.name.trim()
      || !IMAGE_MIME_TYPES.has(attachment.mimeType)) return [];
    const name = path.basename(attachment.name.trim()).slice(0, 160);
    return name ? [{ id: attachment.id, name, mimeType: attachment.mimeType, unavailable: true }] : [];
  });
}

function createMemoryStore({ directory, now = () => new Date(), attachmentStore = null }) {
  const cache = new Map();
  const memoryDirectory = path.join(directory, 'memory');
  const fileFor = (petId) => path.join(memoryDirectory, `${crypto.createHash('sha256').update(petId).digest('hex')}.json`);
  const persist = (petId, memory) => {
    fs.mkdirSync(memoryDirectory, { recursive: true });
    const target = fileFor(petId);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(memory), 'utf8');
    fs.renameSync(temporary, target);
  };
  const load = (petId) => {
    validPetId(petId);
    if (cache.has(petId)) return cache.get(petId);
    const target = fileFor(petId);
    let memory = emptyMemory();
    if (fs.existsSync(target)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (parsed?.version === 1 && MODES.has(parsed.policy?.mode) && Array.isArray(parsed.messages) && Array.isArray(parsed.diaries)) memory = parsed;
      } catch { throw new Error('記憶檔損壞，未覆寫原檔。'); }
    }
    cache.set(petId, memory);
    return memory;
  };
  const save = (petId, memory) => {
    cache.set(petId, memory);
    if (memory.policy.mode !== 'off') persist(petId, memory);
  };
  const copy = (memory) => structuredClone(memory);
  const pruneAttachments = (petId, memory) => attachmentStore?.prune(petId, memory.messages.flatMap((message) => message.attachments || []));

  function read(petId) { return copy(load(petId)); }
  function append(petId, messages) {
    const memory = load(petId);
    memory.messages.push(...messages.map((message) => ({ ...message, id: message.id || crypto.randomUUID() })));
    memory.revision += 1;
    save(petId, memory);
    return read(petId);
  }
  function setPolicy(petId, policy) {
    if (!MODES.has(policy?.mode) || typeof policy.autoDiary !== 'boolean') throw new Error('記憶策略無效。');
    if (policy.mode === 'off') {
      validPetId(petId);
      const memory = emptyMemory({ mode: policy.mode, autoDiary: policy.autoDiary });
      memory.revision = (cache.get(petId)?.revision || 0) + 1;
      const target = fileFor(petId);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      attachmentStore?.removePet(petId);
      save(petId, memory);
      return read(petId);
    }
    const memory = load(petId);
    memory.policy = { mode: policy.mode, autoDiary: policy.autoDiary };
    memory.revision += 1;
    save(petId, memory);
    return read(petId);
  }
  function commitDiary(petId, { expectedRevision, diary, summarizedThrough }) {
    const memory = load(petId);
    if (memory.revision !== expectedRevision || !diary?.id || !diary.text?.trim()) return false;
    memory.diaries.push({ ...diary });
    memory.summarizedThrough = summarizedThrough;
    if (memory.policy.mode === 'diary-only') {
      const sourceIds = new Set(diary.sourceMessageIds || []);
      memory.messages = memory.messages.filter((message) => !sourceIds.has(message.id));
      pruneAttachments(petId, memory);
    }
    memory.revision += 1;
    save(petId, memory);
    return true;
  }
  function clear(petId) {
    const memory = load(petId);
    memory.messages = []; memory.diaries = []; memory.summarizedThrough = null; memory.revision += 1;
    save(petId, memory);
    attachmentStore?.removePet(petId);
    return read(petId);
  }
  function remove(petId) {
    validPetId(petId);
    cache.delete(petId);
    const target = fileFor(petId);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    attachmentStore?.removePet(petId);
  }
  function editDiary(petId, diaryId, text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('日記內容無效。');
    const memory = load(petId);
    const diary = memory.diaries.find((entry) => entry.id === diaryId);
    if (!diary) throw new Error('找不到日記。');
    diary.text = text.trim();
    memory.revision += 1;
    save(petId, memory);
    return read(petId);
  }
  function deleteDiary(petId, diaryId, { deleteSources = false } = {}) {
    const memory = load(petId);
    const index = memory.diaries.findIndex((entry) => entry.id === diaryId);
    if (index < 0) throw new Error('找不到日記。');
    const [diary] = memory.diaries.splice(index, 1);
    if (deleteSources) {
      const sourceIds = new Set(diary.sourceMessageIds || []);
      memory.messages = memory.messages.filter((message) => !sourceIds.has(message.id));
      pruneAttachments(petId, memory);
    }
    memory.revision += 1;
    save(petId, memory);
    return read(petId);
  }
  function editLatestUserMessage(petId, messageId, text, requestId) {
    if (typeof messageId !== 'string' || !messageId || typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('訊息內容無效。');
    const memory = load(petId);
    const latestUser = [...memory.messages].reverse().find((message) => message.role === 'user' && message.complete);
    if (!latestUser || latestUser.id !== messageId) throw new Error('只能編輯最後一則已送出的使用者訊息。');
    const affectedIds = new Set([latestUser.id]);
    for (const message of memory.messages) {
      if (message.role === 'assistant' && message.requestId === latestUser.requestId) affectedIds.add(message.id);
    }
    const previousRequestId = latestUser.requestId;
    latestUser.text = text.trim();
    if (typeof requestId === 'string' && requestId) latestUser.requestId = requestId;
    memory.messages = memory.messages.filter((message) => message.role !== 'assistant' || message.requestId !== previousRequestId);
    const invalidatedDiaryIds = memory.diaries
      .filter((diary) => (diary.sourceMessageIds || []).some((id) => affectedIds.has(id)))
      .map((diary) => diary.id);
    memory.diaries = memory.diaries.filter((diary) => !invalidatedDiaryIds.includes(diary.id));
    pruneAttachments(petId, memory);
    const summarizedIds = new Set(memory.diaries.flatMap((diary) => diary.sourceMessageIds || []));
    memory.summarizedThrough = [...memory.messages].reverse().find((message) => summarizedIds.has(message.id))?.id || null;
    memory.revision += 1;
    save(petId, memory);
    return { memory: read(petId), invalidatedDiaryIds };
  }
  function prune(petId) {
    const memory = load(petId);
    if (memory.policy.mode !== 'diary-30d') return read(petId);
    const cutoff = now().getTime() - 30 * 24 * 60 * 60 * 1000;
    const summarized = new Set(memory.diaries.flatMap((diary) => diary.sourceMessageIds || []));
    memory.messages = memory.messages.filter((message) => {
      const expired = new Date(message.createdAt).getTime() < cutoff;
      return !expired || (memory.policy.autoDiary && !summarized.has(message.id));
    });
    pruneAttachments(petId, memory);
    memory.revision += 1;
    save(petId, memory);
    return read(petId);
  }
  function clone(sourcePetId, targetPetId, { includeMemory }) {
    validPetId(sourcePetId); validPetId(targetPetId);
    if (sourcePetId === targetPetId || cache.has(targetPetId) || fs.existsSync(fileFor(targetPetId))) throw new Error('複製目標已存在。');
    const source = load(sourcePetId);
    if (includeMemory && source.policy.mode === 'off') throw new Error('關閉保存的桌寵無法複製記憶。');
    const snapshot = copy(source);
    const target = includeMemory
      ? { ...snapshot, revision: 0, messages: snapshot.messages.map(({ attachments, ...message }) => {
        const missingAttachments = cloneMissingAttachments(attachments);
        return { ...message, ...(missingAttachments.length ? { attachments: missingAttachments } : {}) };
      }) }
      : emptyMemory(source.policy);
    cache.set(targetPetId, target);
    if (target.policy.mode !== 'off') persist(targetPetId, target);
    return copy(target);
  }
  return { read, append, setPolicy, commitDiary, clear, remove, editDiary, deleteDiary, editLatestUserMessage, prune, clone };
}

module.exports = { createMemoryStore, DEFAULT_POLICY };
