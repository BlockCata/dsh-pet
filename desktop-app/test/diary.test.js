const test = require('node:test');
const assert = require('node:assert/strict');

test('日記摘要使用 revision 保護，清除後的晚到回覆不可寫回', async () => {
  const { createDiaryWorker } = require('../src/memory/diary.js');
  let resolveReply;
  const commits = [];
  const store = {
    read: () => ({ revision: 4, policy: { mode: 'diary-30d', autoDiary: true }, messages: Array.from({ length: 40 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', text: `訊息${index}`, complete: true })) }),
    commitDiary: (_petId, input) => { commits.push(input); return false; },
  };
  const worker = createDiaryWorker({ store, getConnection: () => ({}), streamReply: async function* () { yield { type: 'delta', text: await new Promise((resolve) => { resolveReply = resolve; }) }; yield { type: 'done' }; }, emit() {} });
  const pending = worker.runNow('a');
  resolveReply('使用者喜歡藍色。');
  await pending;
  assert.equal(commits.length, 1);
  assert.equal(commits[0].expectedRevision, 4);
});

test('少於二十組完整問答時，非手動日記不會呼叫模型', async () => {
  const { createDiaryWorker } = require('../src/memory/diary.js');
  let calls = 0;
  const worker = createDiaryWorker({
    store: { read: () => ({ revision: 1, policy: { mode: 'diary-30d', autoDiary: true }, messages: Array.from({ length: 38 }, (_, index) => ({ id: `m${index}`, role: 'user', text: 'x', complete: true })) }) },
    getConnection: () => ({}), streamReply: async function* () { calls++; }, emit() {},
  });
  await worker.schedule('a');
  assert.equal(calls, 0);
});

test('自動日記會略過已摘要訊息，只整理下一批二十組問答', async () => {
  const { createDiaryWorker } = require('../src/memory/diary.js');
  const requests = [];
  const commits = [];
  const messages = Array.from({ length: 80 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', text: `訊息${index}`, complete: true }));
  const worker = createDiaryWorker({
    store: {
      read: () => ({ revision: 9, policy: { mode: 'diary-30d', autoDiary: true }, summarizedThrough: 'm39', messages }),
      commitDiary: (_petId, input) => { commits.push(input); return true; },
    },
    getConnection: () => ({}),
    streamReply: async function* (request) { requests.push(request); yield { type: 'delta', text: '新日記' }; yield { type: 'done' }; },
    emit() {},
  });

  await worker.schedule('a');

  assert.match(requests[0].messages[0].text, /訊息40/);
  assert.doesNotMatch(requests[0].messages[0].text, /訊息0/);
  assert.deepEqual(commits[0].diary.sourceMessageIds, messages.slice(40).map((message) => message.id));
});

test('手動日記以真實提交結果回傳 saved、empty 或 failed 狀態', async () => {
  const { createDiaryWorker } = require('../src/memory/diary.js');
  const saved = createDiaryWorker({
    store: {
      read: () => ({ revision: 1, policy: { mode: 'diary-30d', autoDiary: true }, messages: [{ id: 'm1', role: 'user', text: '重要偏好', complete: true }] }),
      commitDiary: () => true,
    }, getConnection: () => ({}), streamReply: async function* () { yield { type: 'delta', text: '使用者明示偏好：藍色。' }; yield { type: 'done' }; }, emit() {},
  });
  const empty = createDiaryWorker({ store: { read: () => ({ revision: 1, policy: { mode: 'diary-30d', autoDiary: true }, messages: [] }) }, getConnection: () => ({}), streamReply: async function* () {}, emit() {} });
  const failed = createDiaryWorker({ store: { read: () => ({ revision: 1, policy: { mode: 'diary-30d', autoDiary: true }, messages: [{ id: 'm1', role: 'user', text: 'x', complete: true }] }) }, getConnection: () => ({}), streamReply: async function* () { const error = new Error('offline'); error.code = 'network'; throw error; }, emit() {} });
  assert.deepEqual(await saved.runNow('a'), { status: 'saved' });
  assert.deepEqual(await empty.runNow('a'), { status: 'empty' });
  assert.deepEqual(await failed.runNow('a'), { status: 'failed', code: 'network' });
});
