const test = require('node:test');
const assert = require('node:assert/strict');

test('上下文保留最近完整對話與最相關日記，且日記標示為參考記憶', () => {
  const { selectContext } = require('../src/memory/context.js');
  const context = selectContext({
    query: '我喜歡什麼顏色？', mode: 'diary-30d',
    messages: [
      { role: 'user', text: '今天心情很好', complete: true },
      { role: 'assistant', text: '太好了', complete: true },
    ],
    diaries: [
      { id: 'd1', text: '使用者明示喜歡藍色。', createdAt: '2026-09-09T00:00:00.000Z' },
      { id: 'd2', text: '使用者今天心情很好。', createdAt: '2026-09-08T00:00:00.000Z' },
    ],
  });
  assert.equal(context[0].role, 'user');
  assert.match(context[0].text, /可能有誤的參考記憶/);
  assert.match(context[0].text, /喜歡藍色/);
  assert.deepEqual(context.slice(-2).map((item) => item.text), ['今天心情很好', '太好了']);
});

test('off 與 browser 模式不帶入任何已保存記憶', () => {
  const { selectContext } = require('../src/memory/context.js');
  for (const mode of ['off', 'browser']) {
    assert.deepEqual(selectContext({ query: '測試', mode, messages: [{ role: 'user', text: '舊內容', complete: true }], diaries: [{ id: 'd', text: '舊日記' }] }), []);
  }
});

test('日記與最近對話合計最多帶入 6,000 字元，且保留最新對話', () => {
  const { selectContext } = require('../src/memory/context.js');
  const context = selectContext({
    query: '藍色', mode: 'diary-30d',
    messages: Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `${index}`.repeat(300), complete: true })),
    diaries: Array.from({ length: 5 }, (_, index) => ({ id: `d${index}`, text: `藍色${'日'.repeat(1498)}`, createdAt: `2026-09-0${index + 1}T00:00:00.000Z` })),
  });
  assert.ok(context.reduce((total, message) => total + message.text.length, 0) <= 6000);
  assert.equal(context.at(-1).text, '19'.repeat(300));
});

test('記憶上下文只保留有效的訊息建立時間', () => {
  const { selectContextForMemory } = require('../src/memory/context.js');
  const context = selectContextForMemory({
    policy: { mode: 'diary-30d' },
    messages: [
      { id: 'valid', role: 'user', text: '有時間的舊訊息', complete: true, createdAt: '2026-09-13T16:20:00.000Z' },
      { id: 'invalid', role: 'assistant', text: '無效時間的舊訊息', complete: true, createdAt: 'not-a-time' },
    ],
    diaries: [],
  }, { query: '現在幾點', mode: 'chat', messages: [] });

  assert.equal(context.find((message) => message.id === 'valid').createdAt, '2026-09-13T16:20:00.000Z');
  assert.equal(Object.hasOwn(context.find((message) => message.id === 'invalid'), 'createdAt'), false);
});
