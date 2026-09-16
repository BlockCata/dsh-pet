const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMemoryStore } = require('../src/memory/store.js');

function fixtureStore(now = () => new Date('2026-09-09T00:00:00.000Z')) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-memory-'));
  return { directory, store: createMemoryStore({ directory, now }) };
}

test('每隻桌寵的記憶隔離，清除一隻不影響另一隻', () => {
  const { store } = fixtureStore();
  store.append('a', [{ id: 'a1', role: 'user', text: '我喜歡藍色', createdAt: '2026-09-09T00:00:00.000Z', complete: true }]);
  store.append('b', [{ id: 'b1', role: 'user', text: '我喜歡紅色', createdAt: '2026-09-09T00:00:00.000Z', complete: true }]);
  store.clear('a');
  assert.deepEqual(store.read('a').messages, []);
  assert.deepEqual(store.read('b').messages.map((message) => message.text), ['我喜歡紅色']);
});

test('diary-30d 只清除已摘要且超過 30 天的原文', () => {
  const now = () => new Date('2026-10-09T00:00:00.000Z');
  const { store } = fixtureStore(now);
  store.append('a', [
    { id: 'old', role: 'user', text: '舊訊息', createdAt: '2026-09-08T00:00:00.000Z', complete: true },
    { id: 'recent', role: 'assistant', text: '新訊息', createdAt: '2026-09-09T00:00:00.000Z', complete: true },
  ]);
  const memory = store.read('a');
  assert.equal(store.commitDiary('a', { expectedRevision: memory.revision, diary: { id: 'd1', text: '日記', createdAt: '2026-10-09T00:00:00.000Z', sourceMessageIds: ['old'] }, summarizedThrough: 'old' }), true);
  store.prune('a');
  assert.deepEqual(store.read('a').messages.map((message) => message.id), ['recent']);
});

test('diary-30d 關閉自動日記時，到期原文不等待摘要即可清理', () => {
  const now = () => new Date('2026-10-09T00:00:00.000Z');
  const { store } = fixtureStore(now);
  store.setPolicy('a', { mode: 'diary-30d', autoDiary: false });
  store.append('a', [{ id: 'old', role: 'user', text: '舊原文', createdAt: '2026-09-08T00:00:00.000Z', complete: true }]);
  store.prune('a');
  assert.deepEqual(store.read('a').messages, []);
});

test('diary-only 只在日記成功提交後移除其來源原文', () => {
  const { store } = fixtureStore();
  store.setPolicy('a', { mode: 'diary-only', autoDiary: true });
  store.append('a', [
    { id: 'm1', role: 'user', text: '來源一', complete: true, createdAt: '2026-09-09T00:00:00.000Z' },
    { id: 'm2', role: 'assistant', text: '來源二', complete: true, createdAt: '2026-09-09T00:00:00.000Z' },
  ]);
  const memory = store.read('a');
  assert.equal(store.commitDiary('a', { expectedRevision: memory.revision, diary: { id: 'd1', text: '日記', createdAt: '2026-09-09T00:00:00.000Z', sourceMessageIds: ['m1', 'm2'] }, summarizedThrough: 'm2' }), true);
  assert.deepEqual(store.read('a').messages, []);
});

test('原文因日記模式或關閉保存而刪除時，圖片附件一併清理', () => {
  const { createAttachmentStore } = require('../src/chat/attachments.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-memory-'));
  const attachments = createAttachmentStore({ directory });
  const store = createMemoryStore({ directory, attachmentStore: attachments });
  const image = attachments.stage('a', [{ name: 'image.png', mimeType: 'image/png', bytes: Buffer.from([137, 80, 78, 71]) }])[0];
  store.setPolicy('a', { mode: 'diary-only', autoDiary: true });
  store.append('a', [{ id: 'm1', role: 'user', text: '圖片原文', attachments: [image], complete: true, createdAt: '2026-09-09T00:00:00.000Z' }]);
  const memory = store.read('a');
  store.commitDiary('a', { expectedRevision: memory.revision, diary: { id: 'd1', text: '日記', createdAt: '2026-09-09T00:00:00.000Z', sourceMessageIds: ['m1'] }, summarizedThrough: 'm1' });
  assert.throws(() => attachments.read('a', image), /找不到附件/);
  store.setPolicy('a', { mode: 'off', autoDiary: false });
});

test('off 模式不讀取或建立磁碟上的私人記憶', () => {
  const { directory, store } = fixtureStore();
  store.setPolicy('a', { mode: 'off', autoDiary: false });
  store.append('a', [{ id: 'a1', role: 'user', text: '只留在記憶體', createdAt: '2026-09-09T00:00:00.000Z', complete: true }]);
  assert.deepEqual(store.read('a').messages.map((message) => message.text), ['只留在記憶體']);
  assert.equal(fs.existsSync(path.join(directory, 'memory')), false);
});

test('重啟後切換到 off 不載入既有記憶，並只刪除該桌寵受控檔案', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-memory-'));
  createMemoryStore({ directory }).append('a', [{ id: 'a1', role: 'user', text: '既有私人資料', complete: true, createdAt: '2026-09-09T00:00:00.000Z' }]);
  createMemoryStore({ directory }).append('b', [{ id: 'b1', role: 'user', text: '其他桌寵', complete: true, createdAt: '2026-09-09T00:00:00.000Z' }]);
  const store = createMemoryStore({ directory });
  store.setPolicy('a', { mode: 'off', autoDiary: false });
  assert.deepEqual(store.read('a').messages, []);
  assert.deepEqual(createMemoryStore({ directory }).read('b').messages.map((message) => message.text), ['其他桌寵']);
});

test('保存的聊天訊息會取得獨立 ID，重新啟動後仍能讀取', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-memory-'));
  createMemoryStore({ directory }).append('a', [{ role: 'user', text: '你好', complete: true, createdAt: '2026-09-09T00:00:00.000Z' }]);
  const restored = createMemoryStore({ directory }).read('a');
  assert.equal(typeof restored.messages[0].id, 'string');
  assert.equal(restored.messages[0].text, '你好');
});

test('複製記憶可選擇完整獨立快照或只保留策略', () => {
  const { store } = fixtureStore();
  store.append('a', [{ id: 'm1', role: 'user', text: '原始記憶', createdAt: '2026-09-09T00:00:00.000Z', complete: true }]);
  const source = store.read('a');
  store.commitDiary('a', { expectedRevision: source.revision, diary: { id: 'd1', text: '原始日記', createdAt: '2026-09-09T00:00:00.000Z', sourceMessageIds: ['m1'] }, summarizedThrough: 'm1' });
  store.clone('a', 'b', { includeMemory: true });
  store.clone('a', 'c', { includeMemory: false });
  store.clear('a');
  assert.deepEqual(store.read('b').messages.map((message) => message.text), ['原始記憶']);
  assert.deepEqual(store.read('b').diaries.map((diary) => diary.text), ['原始日記']);
  assert.deepEqual(store.read('c').messages, []);
  assert.deepEqual(store.read('c').diaries, []);
});

test('複製記憶保留可供 UI 顯示缺失提示的圖片中繼資料，但目標桌寵不能讀取來源檔案', () => {
  const { createAttachmentStore } = require('../src/chat/attachments.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-memory-'));
  const attachments = createAttachmentStore({ directory });
  const store = createMemoryStore({ directory, attachmentStore: attachments });
  const source = attachments.stage('a', [{ name: 'source.png', mimeType: 'image/png', bytes: Buffer.from([137, 80, 78, 71]) }])[0];
  store.append('a', [{ id: 'image-message', role: 'user', text: '原始圖片', attachments: [source], complete: true, createdAt: '2026-09-13T16:20:00.000Z' }]);

  store.clone('a', 'b', { includeMemory: true });
  const cloned = store.read('b').messages[0].attachments[0];

  assert.deepEqual(cloned, { id: source.id, name: 'source.png', mimeType: 'image/png', unavailable: true });
  assert.equal(Object.hasOwn(cloned, 'file'), false);
  assert.throws(() => attachments.read('b', cloned), /找不到附件/);
  assert.deepEqual(attachments.read('a', source), Buffer.from([137, 80, 78, 71]));
});

test('可編輯或刪除單筆日記，選擇刪來源時只移除該日記關聯原文', () => {
  const { store } = fixtureStore();
  store.append('a', [
    { id: 'm1', role: 'user', text: '來源一', complete: true, createdAt: '2026-09-09T00:00:00.000Z' },
    { id: 'm2', role: 'user', text: '來源二', complete: true, createdAt: '2026-09-09T00:00:00.000Z' },
  ]);
  const memory = store.read('a');
  store.commitDiary('a', { expectedRevision: memory.revision, diary: { id: 'd1', text: '舊日記', createdAt: '2026-09-09T00:00:00.000Z', sourceMessageIds: ['m1'] }, summarizedThrough: 'm1' });
  store.editDiary('a', 'd1', '新日記');
  store.deleteDiary('a', 'd1', { deleteSources: true });
  assert.deepEqual(store.read('a').diaries, []);
  assert.deepEqual(store.read('a').messages.map((message) => message.id), ['m2']);
});

test('移除桌寵會刪除其專屬記憶，其他桌寵不受影響', () => {
  const { directory, store } = fixtureStore();
  store.append('a', [{ id: 'a1', role: 'user', text: 'A', complete: true, createdAt: '2026-09-09T00:00:00.000Z' }]);
  store.append('b', [{ id: 'b1', role: 'user', text: 'B', complete: true, createdAt: '2026-09-09T00:00:00.000Z' }]);
  store.remove('a');
  assert.deepEqual(store.read('b').messages.map((message) => message.text), ['B']);
  assert.deepEqual(createMemoryStore({ directory }).read('a').messages, []);
});

test('只能修正最後一則使用者訊息，並失效其對應回答與衍生日記', () => {
  const { store } = fixtureStore();
  store.append('a', [
    { id: 'u1', role: 'user', text: '保留的舊問題', requestId: 'r1', complete: true, createdAt: '2026-09-09T00:00:00.000Z' },
    { id: 'a1', role: 'assistant', text: '保留的舊回答', requestId: 'r1', complete: true, createdAt: '2026-09-09T00:00:01.000Z' },
    { id: 'u2', role: 'user', text: '傳錯的內容', requestId: 'r2', complete: true, createdAt: '2026-09-09T00:01:00.000Z' },
    { id: 'a2', role: 'assistant', text: '要失效的回答', requestId: 'r2', complete: true, createdAt: '2026-09-09T00:01:01.000Z' },
  ]);
  const before = store.read('a');
  store.commitDiary('a', { expectedRevision: before.revision, diary: { id: 'keep', text: '保留的日記', createdAt: '2026-09-09T00:02:00.000Z', sourceMessageIds: ['u1', 'a1'] }, summarizedThrough: 'a1' });
  const summarized = store.read('a');
  store.commitDiary('a', { expectedRevision: summarized.revision, diary: { id: 'drop', text: '錯誤衍生日記', createdAt: '2026-09-09T00:02:00.000Z', sourceMessageIds: ['u2', 'a2'] }, summarizedThrough: 'a2' });

  const result = store.editLatestUserMessage('a', 'u2', '已修正的內容', 'new-r2');

  assert.deepEqual(result.invalidatedDiaryIds, ['drop']);
  assert.deepEqual(result.memory.messages.map(({ id, text }) => ({ id, text })), [
    { id: 'u1', text: '保留的舊問題' }, { id: 'a1', text: '保留的舊回答' }, { id: 'u2', text: '已修正的內容' },
  ]);
  assert.equal(result.memory.messages.find((message) => message.id === 'u2').createdAt, '2026-09-09T00:01:00.000Z');
  assert.deepEqual(result.memory.diaries.map((diary) => diary.id), ['keep']);
  assert.throws(() => store.editLatestUserMessage('a', 'u1', '不可改舊訊息'), /最後一則/);
});
