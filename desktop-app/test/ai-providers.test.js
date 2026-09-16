const test = require('node:test');
const assert = require('node:assert/strict');

function responseFromChunks(chunks, status = 200) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  }), { status, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

function connection(provider) {
  return { provider, model: `${provider}-fixture-model`, key: `${provider}-fixture-key` };
}

function assertNoForbiddenPayloadFields(value) {
  const forbidden = new Set(['tools', 'google_search', 'web_search']);
  const visit = (item) => {
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      assert.equal(forbidden.has(key), false, `forbidden provider field: ${key}`);
      visit(child);
    }
  };
  visit(value);
}

test('Gemini 將多輪訊息轉成模型角色，並處理切開的 UTF-8 SSE 文字', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const bytes = new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"你好"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":"，世界"}]}}]}\n\n');
  const calls = [];
  const events = await collect(streamReply({
    connection: connection('gemini'),
    messages: [{ role: 'user', text: '哈囉' }, { role: 'assistant', text: '你好' }, { role: 'user', text: '再說一次' }],
    mode: 'chat',
    fetchImpl: async (...args) => { calls.push(args); return responseFromChunks([bytes.slice(0, 43), bytes.slice(43)]); },
  }));

  assert.deepEqual(events, [{ type: 'delta', text: '你好' }, { type: 'delta', text: '，世界' }, { type: 'done' }]);
  const [url, options] = calls[0];
  assert.match(url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-fixture-model:streamGenerateContent\?alt=sse$/);
  assert.equal(options.headers['x-goog-api-key'], 'gemini-fixture-key');
  assert.deepEqual(JSON.parse(options.body).contents, [
    { role: 'user', parts: [{ text: '哈囉' }] }, { role: 'model', parts: [{ text: '你好' }] }, { role: 'user', parts: [{ text: '再說一次' }] },
  ]);
});

test('所有供應商 payload 都帶有可信現在時間與各訊息的有效時間脈絡', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const messages = [
    { role: 'user', text: '昨天說過的事', createdAt: '2026-09-12T07:15:00.000Z' },
    { role: 'assistant', text: '我記得。', createdAt: '2026-09-12T07:16:00.000Z' },
    { role: 'user', text: '現在呢？', createdAt: 'invalid' },
  ];
  const timeContext = { currentTime: '2026-09-13T07:15:00.000Z', timezone: 'Asia/Taipei', utcOffset: '+08:00' };
  for (const provider of ['gemini', 'openai', 'deepseek', 'custom']) {
    let body;
    const details = provider === 'custom' ? { baseUrl: 'https://example.test/v1' } : {};
    await collect(streamReply({
      connection: { ...connection(provider), ...details }, messages, mode: 'chat', timeContext,
      fetchImpl: async (_url, options) => {
        body = JSON.parse(options.body);
        if (provider === 'custom') return Response.json({ choices: [{ message: { content: '好。' } }] });
        if (provider === 'openai') return responseFromChunks(['data: {"type":"response.completed"}\n\n']);
        if (provider === 'deepseek') return responseFromChunks(['data: [DONE]\n\n']);
        return responseFromChunks(['data: {"candidates":[{"content":{"parts":[{"text":"好"}]}}]}\n\n']);
      },
    }));
    const serialized = provider === 'gemini'
      ? body.contents.map((message) => message.parts[0].text)
      : provider === 'openai'
        ? body.input.map((message) => typeof message.content === 'string' ? message.content : message.content[0].text)
        : body.messages.filter((message) => message.role !== 'system').map((message) => message.content);
    const instruction = provider === 'gemini' ? body.systemInstruction.parts[0].text : provider === 'openai' ? body.instructions : body.messages[0].content;
    assert.match(instruction, /2026-09-13T07:15:00.000Z/);
    assert.match(instruction, /Asia\/Taipei/);
    assert.match(instruction, /不表示你已取得即時新聞或聯網資料/);
    assert.match(serialized[0], /2026-09-12T07:15:00.000Z/);
    assert.match(serialized[1], /2026-09-12T07:16:00.000Z/);
    assert.doesNotMatch(serialized[2], /Invalid Date|訊息時間/);
  }
});

test('Gemini 與 OpenAI 僅將使用者已選取的圖片以各自 API 的圖片欄位送出', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const messages = [{ role: 'user', text: '請看圖片', attachments: [{ mimeType: 'image/png', data: 'cG5n' }] }];
  let geminiBody;
  await collect(streamReply({
    connection: connection('gemini'), messages, mode: 'chat',
    fetchImpl: async (_url, options) => { geminiBody = JSON.parse(options.body); return responseFromChunks(['data: {"candidates":[{"content":{"parts":[{"text":"好"}]}}]}\n\n']); },
  }));
  assert.deepEqual(geminiBody.contents[0].parts, [{ text: '請看圖片' }, { inlineData: { mimeType: 'image/png', data: 'cG5n' } }]);

  let openaiBody;
  await collect(streamReply({
    connection: connection('openai'), messages, mode: 'chat',
    fetchImpl: async (_url, options) => { openaiBody = JSON.parse(options.body); return responseFromChunks(['data: {"type":"response.completed"}\n\n']); },
  }));
  assert.deepEqual(openaiBody.input[0].content, [
    { type: 'input_text', text: '請看圖片' },
    { type: 'input_image', image_url: 'data:image/png;base64,cG5n' },
  ]);
});

test('未確認圖片能力的服務在送出前拒絕附件，且不會呼叫網路', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  for (const provider of ['deepseek', 'custom']) {
    let calls = 0;
    const details = provider === 'custom' ? { baseUrl: 'https://example.test/v1' } : {};
    await assert.rejects(() => collect(streamReply({
      connection: { ...connection(provider), ...details },
      messages: [{ role: 'user', text: '看圖', attachments: [{ mimeType: 'image/png', data: 'cG5n' }] }], mode: 'chat',
      fetchImpl: async () => { calls += 1; throw new Error('不應送出'); },
    })), (error) => error.code === 'unsupported');
    assert.equal(calls, 0);
  }
});

test('iAI 相容服務以 GET 載入金鑰可用模型，不傳送聊天內容', async () => {
  const { listModels } = require('../src/ai/providers.js');
  let call;
  const models = await listModels({ provider: 'custom', baseUrl: 'https://custom-provider.test/aihub/v1', key: 'iai-fixture-key' }, undefined, async (...args) => {
    call = args;
    return Response.json({ object: 'list', data: [{ id: 'Furen-max', object: 'model' }, { id: 'Asr', object: 'model' }, { id: 'Furen-large', object: 'model' }] });
  });

  assert.deepEqual(models, ['Furen-max', 'Asr', 'Furen-large']);
  assert.equal(call[0], 'https://custom-provider.test/aihub/v1/models');
  assert.equal(call[1].method, 'GET');
  assert.equal(call[1].headers.authorization, 'Bearer iai-fixture-key');
  assert.equal(Object.hasOwn(call[1], 'body'), false);
});

test('iAI 相容服務使用非串流 Chat Completions，保留受限動作標記解析', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  let call;
  const events = await collect(streamReply({
    connection: { provider: 'custom', model: 'Furen-large', baseUrl: 'https://custom-provider.test/aihub/v1', key: 'iai-fixture-key' },
    messages: [{ role: 'user', text: '表演螃蟹走路' }], mode: 'chat',
    actionChoices: [{ id: 'crab_walk', name: '螃蟹走路', kind: 'move', explicitOnly: true }],
    fetchImpl: async (...args) => {
      call = args;
      return Response.json({ id: 'chatcmpl-fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '好。<!--pet-action:{"actionId":"crab_walk","trigger":"explicit"}-->' }, finish_reason: 'stop' }] });
    },
  }));

  assert.deepEqual(events, [{ type: 'delta', text: '好。' }, { type: 'action', actionId: 'crab_walk', trigger: 'explicit' }, { type: 'done' }]);
  assert.equal(call[0], 'https://custom-provider.test/aihub/v1/chat/completions');
  assert.deepEqual(JSON.parse(call[1].body).messages.at(-1), { role: 'user', content: '表演螃蟹走路' });
  assert.equal(JSON.parse(call[1].body).stream, false);
});

test('聊天回覆末尾的受限動作標記不顯示給使用者，只輸出一次白名單提案', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const events = await collect(streamReply({
    connection: connection('gemini'), messages: [{ role: 'user', text: '請跳一支舞' }], mode: 'chat',
    fetchImpl: async () => responseFromChunks([
      'data: {"candidates":[{"content":{"parts":[{"text":"好，我來跳一段。<!--pet-act"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"ion:{\\"actionId\\":\\"dance\\",\\"trigger\\":\\"explicit\\"}-->"}]}}]}\n\n',
    ]),
  }));

  assert.deepEqual(events, [
    { type: 'delta', text: '好，我來跳一段。' },
    { type: 'action', actionId: 'dance', trigger: 'explicit' },
    { type: 'done' },
  ]);
});

test('明確螃蟹走路標記會成為受限的移動動作提案', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const events = await collect(streamReply({
    connection: connection('gemini'), messages: [{ role: 'user', text: '表演螃蟹走路' }], mode: 'chat',
    actionChoices: [{ id: 'crab_walk', name: '螃蟹走路', kind: 'move', explicitOnly: true }],
    fetchImpl: async () => responseFromChunks(['data: {"candidates":[{"content":{"parts":[{"text":"好，現在開始。<!--pet-action:{\\"actionId\\":\\"crab_walk\\",\\"trigger\\":\\"explicit\\"}-->"}]}}]}\n\n']),
  }));

  assert.deepEqual(events, [
    { type: 'delta', text: '好，現在開始。' },
    { type: 'action', actionId: 'crab_walk', trigger: 'explicit' },
    { type: 'done' },
  ]);
});

test('聊天只接受呼叫端提供的既有素材動作 ID', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const events = await collect(streamReply({
    connection: connection('gemini'), messages: [{ role: 'user', text: '哼首歌' }], mode: 'chat',
    actionChoices: [{ id: 'small-00', name: '悠闲哼歌', kind: 'action', explicitOnly: true }],
    fetchImpl: async () => responseFromChunks(['data: {"candidates":[{"content":{"parts":[{"text":"好。<!--pet-action:{\\"actionId\\":\\"small-00\\",\\"trigger\\":\\"explicit\\"}-->"}]}}]}\n\n']),
  }));

  assert.deepEqual(events, [
    { type: 'delta', text: '好。' },
    { type: 'action', actionId: 'small-00', trigger: 'explicit' },
    { type: 'done' },
  ]);
});

test('模型指令會列出可用的既有素材名稱與受限 ID', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  let body;
  await collect(streamReply({
    connection: connection('gemini'), messages: [{ role: 'user', text: '哼首歌' }], mode: 'chat',
    actionChoices: [{ id: 'small-00', name: '悠闲哼歌', kind: 'action', explicitOnly: true }],
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return responseFromChunks(['data: {"candidates":[{"content":{"parts":[{"text":"好。"}]}}]}\n\n']);
    },
  }));

  assert.match(body.systemInstruction.parts[0].text, /small-00：悠闲哼歌/);
});

test('不合法的動作標記不會成為動作提案', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const events = await collect(streamReply({
    connection: connection('deepseek'), messages: [{ role: 'user', text: '你好' }], mode: 'chat',
    fetchImpl: async () => responseFromChunks([
      'data: {"choices":[{"delta":{"content":"你好<!--pet-action:{\\"actionId\\":\\"../../bad\\",\\"trigger\\":\\"explicit\\"}-->"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  }));

  assert.deepEqual(events, [{ type: 'delta', text: '你好' }, { type: 'done' }]);
});

test('角色設定檔以供應商支援的指令欄位傳給 Gemini', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  let body;
  await collect(streamReply({
    connection: connection('gemini'), messages: [{ role: 'user', text: '你好' }], mode: 'chat',
    profile: { name: '夏奈', role: '藍髮女僕', personality: '細心', speakingStyle: '使用繁體中文簡短回應' },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return responseFromChunks(['data: {"candidates":[{"content":{"parts":[{"text":"你好"}]}}]}\n\n']);
    },
  }));
  assert.match(body.systemInstruction.parts[0].text, /你正在扮演「夏奈」/);
  assert.match(body.systemInstruction.parts[0].text, /角色：藍髮女僕/);
  assert.match(body.systemInstruction.parts[0].text, /個性：細心/);
  assert.match(body.systemInstruction.parts[0].text, /說話語氣：使用繁體中文簡短回應/);
});

test('沒有角色設定檔時，聊天請求仍會要求受限動作標記', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  let body;
  await collect(streamReply({
    connection: connection('gemini'), messages: [{ role: 'user', text: '跳舞' }], mode: 'chat',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return responseFromChunks(['data: {"candidates":[{"content":{"parts":[{"text":"好"}]}}]}\n\n']);
    },
  }));
  assert.match(body.systemInstruction.parts[0].text, /<!--pet-action:/);
});

test('OpenAI Responses 與 DeepSeek Chat Completions 都轉成統一文字事件', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const cases = [
    ['openai', 'data: {"type":"response.output_text.delta","delta":"Open"}\n\ndata: {"type":"response.output_text.delta","delta":"AI"}\n\ndata: {"type":"response.completed"}\n\n', 'https://api.openai.com/v1/responses'],
    ['deepseek', 'data: {"choices":[{"delta":{"content":"Deep"}}]}\n\ndata: {"choices":[{"delta":{"content":"Seek"}}]}\n\ndata: [DONE]\n\n', 'https://api.deepseek.com/chat/completions'],
  ];
  for (const [provider, sse, endpoint] of cases) {
    let call;
    const events = await collect(streamReply({
      connection: connection(provider), messages: [{ role: 'user', text: 'hi' }], mode: 'chat',
      fetchImpl: async (...args) => { call = args; return responseFromChunks([sse]); },
    }));
    assert.deepEqual(events, [{ type: 'delta', text: provider === 'openai' ? 'Open' : 'Deep' }, { type: 'delta', text: provider === 'openai' ? 'AI' : 'Seek' }, { type: 'done' }]);
    assert.equal(call[0], endpoint);
    assert.equal(call[1].headers.authorization, `Bearer ${provider}-fixture-key`);
    assert.equal(JSON.parse(call[1].body).stream, true);
  }
});

test('服務錯誤映射為不含遠端內容的固定錯誤碼，取消會保留 AbortError', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  await assert.rejects(
    () => collect(streamReply({ connection: connection('gemini'), messages: [{ role: 'user', text: 'hi' }], mode: 'chat', fetchImpl: async () => responseFromChunks(['secret body'], 401) })),
    (error) => error.code === 'auth' && !error.message.includes('secret body'),
  );
  await assert.rejects(
    () => collect(streamReply({ connection: connection('openai'), messages: [{ role: 'user', text: 'hi' }], mode: 'chat', fetchImpl: async () => responseFromChunks(['secret body'], 429) })),
    (error) => error.code === 'quota' && !error.message.includes('secret body'),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => collect(streamReply({ connection: connection('deepseek'), messages: [{ role: 'user', text: 'hi' }], mode: 'chat', signal: controller.signal, fetchImpl: async (_url, options) => {
      assert.equal(options.signal.aborted, true);
      throw new DOMException('Aborted', 'AbortError');
    } })),
    (error) => error.name === 'AbortError',
  );
});

test('Gemini 的 HTTP 400 顯示模型或請求設定錯誤，而不是網路故障', async () => {
  const { testConnection } = require('../src/ai/providers.js');
  await assert.rejects(
    () => testConnection(connection('gemini'), undefined, async () => responseFromChunks(['private provider detail'], 400)),
    (error) => error.code === 'invalid-response' && error.message === '模型名稱或請求設定無效，請確認服務、模型與 API 設定。' && !error.message.includes('private'),
  );
});

test('所有 provider 的 payload 不含原生搜尋工具，web 模式在 fetch 前 fail-closed', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  for (const provider of ['gemini', 'openai', 'deepseek', 'custom']) {
    const providerConnection = provider === 'custom'
      ? { provider, model: 'fixture', key: 'private', baseUrl: 'https://example.test/v1' }
      : connection(provider);
    for (const mode of ['chat', 'greeting', 'proactive', 'search-protocol']) {
      let body;
      const text = mode === 'search-protocol' ? '{"type":"answer"}\n好。' : '好。';
      await collect(streamReply({
        connection: providerConnection, messages: [{ role: 'user', text: '查資料' }], mode,
        fetchImpl: async (_url, options) => {
          body = options.body;
          if (provider === 'custom') return Response.json({ choices: [{ message: { content: text } }] });
          if (provider === 'gemini') return responseFromChunks([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`]);
          if (provider === 'openai') return responseFromChunks([`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`]);
          return responseFromChunks([`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`, 'data: [DONE]\n\n']);
        },
      }));
      assert.doesNotMatch(body, /google_search|web_search/, `${provider}/${mode}`);
      assertNoForbiddenPayloadFields(JSON.parse(body));
    }

    let calls = 0;
    await assert.rejects(
      () => collect(streamReply({
        connection: providerConnection, messages: [{ role: 'user', text: '查資料' }], mode: 'web',
        fetchImpl: async () => { calls++; throw new Error('不得送出'); },
      })),
      (error) => error.code === 'unsupported',
    );
    assert.equal(calls, 0, provider);
  }
});

test('角色設定是背景指令，日常回答不要求反覆自我介紹或追問', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  let body;
  await collect(streamReply({
    connection: connection('gemini'), messages: [{ role: 'user', text: '今天天氣如何？' }], mode: 'chat',
    profile: { name: '夏奈', role: '藍髮女僕', personality: '細心', speakingStyle: '溫柔' },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return responseFromChunks(['data: {"candidates":[{"content":{"parts":[{"text":"不知道"}]}}]}\n\n']);
    },
  }));
  assert.match(body.systemInstruction.parts[0].text, /不要反覆自我介紹/);
  assert.match(body.systemInstruction.parts[0].text, /沒有必要時不要反問/);
});

test('請求無回應或總時間超限時中止並回傳固定逾時錯誤', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  await assert.rejects(
    () => collect(streamReply({
      connection: connection('gemini'), messages: [{ role: 'user', text: 'hi' }], mode: 'chat',
      timeouts: { idleMs: 5, totalMs: 20 },
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    })),
    (error) => error.code === 'timeout' && error.message === 'AI 服務回應逾時。',
  );
});

test('search-protocol 直答不啟用原生 web tool，也不外送圖片', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  let body;
  const events = await collect(streamReply({
    connection: connection('openai'),
    messages: [{ role: 'user', text: '請直接回答', attachments: [{ mimeType: 'image/png', data: 'cG5n' }] }],
    mode: 'search-protocol',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return responseFromChunks(['data: {"type":"response.output_text.delta","delta":"{\\"type\\":\\"answer\\"}\\n這是直答"}\n\ndata: {"type":"response.completed"}\n\n']);
    },
  }));

  assert.deepEqual(events, [
    { type: 'search-decision', decision: { type: 'answer' } },
    { type: 'delta', text: '這是直答' },
    { type: 'done' },
  ]);
  assert.equal(Object.hasOwn(body, 'tools'), false);
  assert.deepEqual(body.input, [{ role: 'user', content: '請直接回答' }]);
});

test('search-protocol 只在明確允許的直答解析白名單 trailing action', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const marker = '好。<!--pet-action:{"actionId":"dance","trigger":"explicit"}-->';
  for (const [allowActions, expectedAction] of [[true, true], [false, false]]) {
    const events = await collect(streamReply({
      connection: connection('gemini'), messages: [{ role: 'user', text: '請跳舞' }], mode: 'search-protocol', allowActions,
      actionChoices: [{ id: 'dance', name: '跳舞', kind: 'action', explicitOnly: false }],
      fetchImpl: async () => responseFromChunks([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: `{"type":"answer"}\n${marker}` }] } }] })}\n\n`]),
    }));
    assert.equal(events.some((event) => event.type === 'action'), expectedAction);
    assert.equal(events.at(-1).type, 'done');
  }
});

test('search-protocol provider body 不帶來源 URL 或 raw HTML', async () => {
  const { streamReply } = require('../src/ai/providers.js');
  const hostileSource = {
    id: 'source-1',
    title: '<b>不可信標題</b>',
    retrievedAt: '2026-09-15T00:00:00.000Z',
    text: '<script>讀取金鑰</script>公開內容 https://evil.example/private',
  };
  for (const provider of ['gemini', 'openai', 'deepseek', 'custom']) {
    const providerConnection = provider === 'custom'
      ? { ...connection(provider), baseUrl: 'https://example.test/v1' }
      : connection(provider);
    let body;
    await collect(streamReply({
      connection: providerConnection,
      messages: [{ role: 'user', text: '查詢' }],
      mode: 'search-protocol',
      sourceExcerpts: [hostileSource],
      fetchImpl: async (_url, options) => {
        body = options.body;
        const text = '{"type":"answer"}\n完成';
        if (provider === 'custom') return Response.json({ choices: [{ message: { content: text } }] });
        if (provider === 'gemini') return responseFromChunks([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`]);
        if (provider === 'openai') return responseFromChunks([`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`]);
        return responseFromChunks([`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`, 'data: [DONE]\n\n']);
      },
    }));
    assert.doesNotMatch(body, /<script>|<\/script>|https:\/\/evil\.example/i, provider);
  }
});
