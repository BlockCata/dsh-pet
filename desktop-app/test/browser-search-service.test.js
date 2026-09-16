const test = require('node:test');
const assert = require('node:assert/strict');

const { createBlockedBrowserSearch } = require('../src/browser-search/blocked');
const { createPinnedBrowserSearch } = require('../src/browser-search/service');

const SEARCH_URL = 'https://www.google.com/search?q=topic';

function body(url, bodyText = '<search />') {
  return { ok: true, kind: 'body', requestUrl: url, statusCode: 200, mediaType: 'text/html', charset: 'utf-8', body: bodyText, bodyBytes: Buffer.byteLength(bodyText) };
}

function redirect(url, location, statusCode = 302) {
  return { ok: true, kind: 'redirect', requestUrl: url, statusCode, location };
}

function blocked(code = 'url-blocked') {
  return { ok: false, status: 'blocked', code };
}

function createHarness({ responses = [body(SEARCH_URL)], candidates = [], pageResults = [], parserFactory, robotsPolicy, now = () => '2026-09-15T00:00:00.000Z', overallTimeoutMs } = {}) {
  const calls = { fetch: [], parserFactories: 0, parserDisposals: [], parseSearch: [], parsePages: [] };
  const queue = [...responses];
  let pageIndex = 0;
  const transport = {
    async fetchHop(url, options) {
      calls.fetch.push({ url, options });
      const next = queue.shift();
      return typeof next === 'function' ? next(url, options) : (next || body(url, '<page />'));
    },
  };
  const defaultParserFactory = async () => ({
    async parseSearchResults(html, baseUrl, options) {
      calls.parseSearch.push({ html, baseUrl, options });
      return candidates;
    },
    async parsePage(html, options) {
      calls.parsePages.push({ html, options });
      return pageResults[pageIndex++] || { title: '公開頁面', text: '公開內容' };
    },
    async dispose() {},
  });
  const factory = parserFactory || defaultParserFactory;
  const service = createPinnedBrowserSearch({ transport, parserFactory: async (...args) => {
    calls.parserFactories += 1;
    const parser = await factory(...args);
    const originalDispose = parser.dispose;
    parser.dispose = async (...disposeArgs) => {
      calls.parserDisposals.push(calls.parserFactories);
      return originalDispose?.(...disposeArgs);
    };
    return parser;
  }, robotsPolicy, now, overallTimeoutMs });
  return { service, calls };
}

test('service checks robots before search and candidate pages, while reusing rules per authority', async () => {
  const robotsCalls = [];
  const robotsPolicy = {
    async check(url, options) {
      robotsCalls.push({ url, options });
      return { allowed: true };
    },
    dispose() {},
  };
  const { service, calls } = createHarness({
    candidates: [{ title: '候選頁', url: 'https://public.site/public' }],
    pageResults: [{ title: '公開頁面', text: '公開內容' }],
    robotsPolicy,
  });

  const result = await service.search({ petId: 'pet-robots', requestId: 'robots-1', query: 'topic' });

  assert.equal(result.status, 'ok');
  assert.deepEqual(robotsCalls.map(({ url }) => new URL(url).hostname), ['www.google.com', 'public.site']);
  assert.deepEqual(calls.fetch.map(({ url }) => url), [SEARCH_URL, 'https://public.site/public']);
});

test('service does not fetch a target page when robots policy denies it', async () => {
  const robotsPolicy = {
    async check(url) {
      return { allowed: !url.includes('public.site'), code: 'robots-disallowed' };
    },
    dispose() {},
  };
  const { service, calls } = createHarness({
    candidates: [{ title: '拒絕頁', url: 'https://public.site/private' }],
    robotsPolicy,
  });

  const result = await service.search({ petId: 'pet-robots-deny', requestId: 'robots-2', query: 'topic' });

  assert.deepEqual(result, { status: 'empty', sources: [] });
  assert.deepEqual(calls.fetch.map(({ url }) => url), [SEARCH_URL]);
});

test('blocked browser adapter remains isolated from active service inputs', async () => {
  const calls = { transport: 0, parser: 0 };
  const service = createBlockedBrowserSearch({ transport: { fetchHop() { calls.transport += 1; } }, parserFactory: () => { calls.parser += 1; } });

  const result = await service.search({ petId: 'pet-1', requestId: 'request-1', query: '公開資料' });

  assert.deepEqual(result, { status: 'blocked', sources: [], reason: 'network-isolation-unverified' });
  assert.deepEqual(calls, { transport: 0, parser: 0 });
});

test('service uses exactly one fetchHop per hop and never exposes transport internals', async () => {
  const { service, calls } = createHarness({ candidates: [] });

  const result = await service.search({ petId: 'pet-1', requestId: 'request-1', query: '  topic  ' });

  assert.equal(result.status, 'empty');
  assert.equal(calls.fetch.length, 1);
  assert.deepEqual(calls.fetch[0].url, SEARCH_URL);
  assert.equal(calls.fetch[0].options.requestId, 'request-1');
  assert.equal(calls.fetch[0].options.hopIndex, 0);
  assert.equal(calls.fetch[0].options.purpose, 'search');
  assert.ok(calls.fetch[0].options.signal);
  assert.equal(Object.hasOwn(calls.fetch[0].options, 'address'), false);
  assert.equal(Object.hasOwn(calls.fetch[0].options, 'headers'), false);
});

test('relative redirects may complete through five hops but the sixth redirect is forbidden', async () => {
  const urls = [SEARCH_URL, ...Array.from({ length: 5 }, (_, index) => `https://www.google.com/step-${index + 1}`)];
  const responses = urls.map((url, index) => index < 5 ? redirect(url, `/step-${index + 1}`) : body(url, '<search />'));
  const success = createHarness({ responses, candidates: [] });
  const successResult = await success.service.search({ petId: 'pet-1', requestId: 'five-hops', query: 'topic' });
  assert.equal(successResult.status, 'empty');
  assert.deepEqual(success.calls.fetch.map(({ url }) => url), urls);

  const sixthResponses = urls.map((url, index) => redirect(url, `/step-${index + 1}`));
  const limited = createHarness({ responses: sixthResponses });
  const limitedResult = await limited.service.search({ petId: 'pet-1', requestId: 'sixth-hop', query: 'topic' });
  assert.deepEqual(limitedResult, { status: 'blocked', sources: [], reason: 'redirect-limit' });
  assert.equal(limited.calls.fetch.length, 6);
});

test('A to B to A redirects stop before a third fetch', async () => {
  const { service, calls } = createHarness({ responses: [
    redirect(SEARCH_URL, 'https://redirect.site/b'),
    redirect('https://redirect.site/b', SEARCH_URL),
  ] });

  const result = await service.search({ petId: 'pet-1', requestId: 'loop', query: 'topic' });

  assert.deepEqual(result, { status: 'blocked', sources: [], reason: 'redirect-loop' });
  assert.deepEqual(calls.fetch.map(({ url }) => url), [SEARCH_URL, 'https://redirect.site/b']);
});

test('invalid, missing, or unsafe redirect Locations are rejected before the next fetch', async (t) => {
  const locations = [undefined, '', 'http://redirect.example/', 'https://user:pass@redirect.example/', 'https://redirect.example:444/step', 'https://localhost/step', 'https://127.0.0.1/step', 'https://reader.local/step', 'https://reader.test/step', 'https://reader.example/step', 'https://reader.onion/step'];
  for (const location of locations) {
    await t.test(String(location), async () => {
      const { service, calls } = createHarness({ responses: [redirect(SEARCH_URL, location)] });
      const result = await service.search({ petId: 'pet-1', requestId: 'invalid-location', query: 'topic' });
      assert.deepEqual(result, { status: 'blocked', sources: [], reason: 'redirect-invalid' });
      assert.equal(calls.fetch.length, 1);
    });
  }
});

test('403 is blocked and unknown transport/parser errors never expose their messages', async () => {
  const transportError = createHarness({
    responses: [new Error('https://public.site/secret?token=abc123')],
    candidates: [],
  });
  const transportResult = await transportError.service.search({ petId: 'pet-1', requestId: 'transport-error', query: 'topic' });
  assert.deepEqual(transportResult, { status: 'blocked', sources: [], reason: 'response-invalid' });
  assert.equal(JSON.stringify(transportResult).includes('token=abc123'), false);

  const parserError = createHarness({
    parserFactory: async () => ({
      async parseSearchResults() { throw new Error('https://public.site/private?api_key=secret'); },
      async parsePage() { return { title: '不應出現', text: '不應出現' }; },
      async dispose() {},
    }),
  });
  const parserResult = await parserError.service.search({ petId: 'pet-1', requestId: 'parser-error', query: 'topic' });
  assert.deepEqual(parserResult, { status: 'blocked', sources: [], reason: 'parser-output-invalid' });
  assert.equal(JSON.stringify(parserResult).includes('api_key=secret'), false);

  const forbidden = createHarness({ responses: [{ ok: false, status: 'blocked', code: 'response-status-403' }] });
  assert.deepEqual(await forbidden.service.search({ petId: 'pet-1', requestId: 'forbidden', query: 'topic' }), {
    status: 'blocked', sources: [], reason: 'response-status-403',
  });
});

test('only the first three candidates count, including candidates rejected by transport', async () => {
  const candidates = [
    { title: '壞頁面', url: 'https://private.site/one' },
    { title: '第一頁', url: 'https://public.site/one' },
    { title: '第二頁', url: 'https://public.site/two' },
    { title: '第四頁', url: 'https://public.site/four' },
  ];
  const { service, calls } = createHarness({
    candidates,
    responses: [body(SEARCH_URL), blocked('dns-non-public'), body(candidates[1].url, '<one />'), body(candidates[2].url, '<two />'), body(candidates[3].url, '<four />')],
    pageResults: [{ title: '第一頁', text: '內容一' }, { title: '第二頁', text: '內容二' }, { title: '第四頁', text: '內容四' }],
  });

  const result = await service.search({ petId: 'pet-1', requestId: 'candidate-limit', query: 'topic' });

  assert.equal(result.status, 'ok');
  assert.deepEqual(calls.fetch.map(({ url }) => url), [SEARCH_URL, candidates[0].url, candidates[1].url, candidates[2].url]);
  assert.equal(calls.fetch.some(({ url }) => url === candidates[3].url), false);
  assert.equal(result.sources.length, 2);
});

test('search parser egress blocks the whole request, while an ordinary page failure is skipped', async () => {
  const searchBlocked = createHarness({
    candidates: [{ title: '頁面', url: 'https://public.site/page' }],
    parserFactory: async () => ({
      async parseSearchResults() { throw new Error('browser-search-parser-egress-blocked'); },
      async parsePage() { return { title: '不應出現', text: '不應出現' }; },
      async dispose() {},
    }),
  });
  assert.deepEqual(await searchBlocked.service.search({ petId: 'pet-1', requestId: 'search-egress', query: 'topic' }), {
    status: 'blocked', sources: [], reason: 'parser-egress-blocked',
  });

  const pageSkipped = createHarness({
    candidates: [{ title: '失敗頁', url: 'https://public.site/fail' }, { title: '成功頁', url: 'https://public.site/ok' }],
    responses: [body(SEARCH_URL), blocked('response-content-type'), body('https://public.site/ok', '<ok />')],
    pageResults: [{ title: '成功頁', text: '可讀內容' }],
  });
  const result = await pageSkipped.service.search({ petId: 'pet-1', requestId: 'page-failure', query: 'topic' });
  assert.equal(result.status, 'ok');
  assert.equal(result.sources[0].url, 'https://public.site/ok');
});

test('page parser egress blocks the whole request instead of skipping the poisoned page', async () => {
  const { service } = createHarness({
    candidates: [{ title: '頁面', url: 'https://public.site/page' }],
    parserFactory: async () => ({
      async parseSearchResults() { return [{ title: '頁面', url: 'https://public.site/page' }]; },
      async parsePage() { throw new Error('browser-search-parser-egress-blocked'); },
      async dispose() {},
    }),
  });

  assert.deepEqual(await service.search({ petId: 'pet-1', requestId: 'page-egress', query: 'topic' }), {
    status: 'blocked', sources: [], reason: 'parser-egress-blocked',
  });
});

test('page and aggregate text limits are enforced before sources are returned', async () => {
  const candidates = [1, 2, 3].map((id) => ({ title: `頁面 ${id}`, url: `https://public.site/${id}` }));
  const { service } = createHarness({
    candidates,
    responses: [body(SEARCH_URL), ...candidates.map((candidate) => body(candidate.url, '<page />'))],
    pageResults: candidates.map((candidate) => ({ title: candidate.title, text: '字'.repeat(7_000) })),
  });

  const result = await service.search({ petId: 'pet-1', requestId: 'text-limits', query: 'topic' });

  assert.equal(result.status, 'ok');
  assert.equal(result.sources.length, 3);
  assert.deepEqual(result.sources.map((source) => source.text.length), [6_000, 6_000, 6_000]);
  assert.equal(result.sources.reduce((total, source) => total + source.text.length, 0), 18_000);
});

test('each request receives and finally disposes its own parser instance', async () => {
  const disposed = [];
  let parserNumber = 0;
  const { service, calls } = createHarness({
    candidates: [],
    parserFactory: async () => {
      const id = ++parserNumber;
      return {
        async parseSearchResults() { return []; },
        async parsePage() { return { title: '頁面', text: '內容' }; },
        async dispose() { await new Promise(setImmediate); disposed.push(id); },
      };
    },
  });

  await service.search({ petId: 'pet-1', requestId: 'one', query: 'topic' });
  await service.search({ petId: 'pet-1', requestId: 'two', query: 'topic' });

  assert.equal(calls.parserFactories, 2);
  assert.deepEqual(disposed, [1, 2]);
  assert.deepEqual(calls.parserDisposals, [1, 2]);
});

test('a parser created after cancellation is adopted and disposed before search settles', async () => {
  let releaseParser;
  let disposed = false;
  const service = createPinnedBrowserSearch({
    overallTimeoutMs: 100,
    transport: { fetchHop: async () => body(SEARCH_URL) },
    parserFactory: () => new Promise((resolve) => {
      releaseParser = () => resolve({
        async parseSearchResults() { return []; },
        async parsePage() { return { title: 'late', text: 'late' }; },
        async dispose() { disposed = true; },
      });
    }),
  });
  const pending = service.search({ petId: 'pet-1', requestId: 'late-parser', query: 'topic' });
  await new Promise(setImmediate);
  service.cancel('pet-1', 'late-parser');
  let settled = false;
  pending.then(() => { settled = true; });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  releaseParser();
  assert.deepEqual(await pending, { status: 'cancelled', sources: [] });
  assert.equal(disposed, true);
});

test('late parser adoption also waits for dispose and timeout cleanup', async () => {
  for (const mode of ['dispose', 'timeout']) {
    let releaseParser;
    let disposed = false;
    const service = createPinnedBrowserSearch({
      overallTimeoutMs: mode === 'timeout' ? 5 : 100,
      transport: { fetchHop: async () => body(SEARCH_URL) },
      parserFactory: () => new Promise((resolve) => {
        releaseParser = () => resolve({
          async parseSearchResults() { return []; },
          async parsePage() { return { title: 'late', text: 'late' }; },
          async dispose() { disposed = true; },
        });
      }),
    });
    const pending = service.search({ petId: mode, requestId: `${mode}-parser`, query: 'topic' });
    await new Promise((resolve) => setTimeout(resolve, mode === 'timeout' ? 15 : 0));
    const cleanup = mode === 'dispose' ? service.dispose(mode) : Promise.resolve();
    releaseParser();
    await cleanup;
    assert.deepEqual(await pending, mode === 'timeout' ? { status: 'timeout', sources: [], reason: 'search-timeout' } : { status: 'cancelled', sources: [] });
    assert.equal(disposed, true, mode);
  }
});

test('parser disposal failure returns a fixed blocked cleanup result', async () => {
  const { service } = createHarness({
    candidates: [],
    parserFactory: async () => ({
      async parseSearchResults() { return []; },
      async parsePage() { return { title: '頁面', text: '內容' }; },
      async dispose() { throw new Error('cleanup leaked https://public.site/?token=secret'); },
    }),
  });

  const result = await service.search({ petId: 'pet-1', requestId: 'cleanup-failure', query: 'topic' });

  assert.deepEqual(result, { status: 'blocked', sources: [], reason: 'browser-search-parser-cleanup-failed' });
  assert.equal(JSON.stringify(result).includes('token=secret'), false);
});

test('a never-resolving parser dispose cannot block the overall timeout', async () => {
  const service = createPinnedBrowserSearch({
    overallTimeoutMs: 5,
    transport: { fetchHop: async () => body(SEARCH_URL) },
    parserFactory: async () => ({
      async parseSearchResults() { return []; },
      async parsePage() { return { title: '頁面', text: '內容' }; },
      dispose() { return new Promise(() => {}); },
    }),
  });

  const result = await Promise.race([
    service.search({ petId: 'pet-1', requestId: 'hanging-dispose', query: 'topic' }),
    new Promise((resolve) => setTimeout(() => resolve('deadline-not-settled'), 200)),
  ]);

  assert.notEqual(result, 'deadline-not-settled');
  assert.deepEqual(result, { status: 'blocked', sources: [], reason: 'browser-search-parser-cleanup-failed' });
});

test('cancel and dispose affect only the matching pet/request and suppress late results', async () => {
  const pending = new Map();
  const release = new Map();
  const transport = {
    fetchHop(url, { requestId }) {
      if (url !== SEARCH_URL) return Promise.resolve(body(url, '<page />'));
      return new Promise((resolve) => {
        pending.set(requestId, resolve);
        release.set(requestId, () => resolve(body(url)));
      });
    },
  };
  const service = createPinnedBrowserSearch({
    transport,
    parserFactory: async () => ({ async parseSearchResults() { return []; }, async parsePage() { return { title: 'late', text: 'late' }; }, async dispose() {} }),
    overallTimeoutMs: 100,
  });
  const first = service.search({ petId: 'pet-a', requestId: 'a-1', query: 'topic' });
  const second = service.search({ petId: 'pet-b', requestId: 'b-1', query: 'topic' });
  await new Promise(setImmediate);
  service.cancel('pet-a', 'wrong-request');
  assert.equal(pending.has('a-1'), true);
  const disposed = service.dispose('pet-a');
  release.get('a-1')();
  release.get('b-1')();
  await disposed;
  assert.deepEqual(await first, { status: 'cancelled', sources: [] });
  assert.deepEqual(await second, { status: 'empty', sources: [] });
});

test('lifecycle invalidation signals suppress stale and late results', async () => {
  const lifecycleSignals = ['edit', 'clear', 'collapse', 'capability-off', 'pet-remove', 'sleep', 'quit'];
  for (const lifecycle of lifecycleSignals) {
    let release;
    let disposed = false;
    const service = createPinnedBrowserSearch({
      overallTimeoutMs: 100,
      transport: { fetchHop: async () => new Promise((resolve) => { release = () => resolve(body(SEARCH_URL)); }) },
      parserFactory: async () => ({
        async parseSearchResults() { return []; },
        async parsePage() { return { title: 'late', text: 'late' }; },
        async dispose() { disposed = true; },
      }),
    });
    const pending = service.search({ petId: lifecycle, requestId: `${lifecycle}-request`, query: 'topic' });
    await new Promise(setImmediate);
    const cleanup = lifecycle === 'pet-remove' || lifecycle === 'quit'
      ? service.dispose(lifecycle)
      : (service.cancel(lifecycle, `${lifecycle}-request`), Promise.resolve());
    release();
    await cleanup;
    assert.deepEqual(await pending, { status: 'cancelled', sources: [] }, lifecycle);
    assert.equal(disposed, true, lifecycle);
  }
});

test('overall timeout returns timeout and awaits parser disposal', async () => {
  let disposed = false;
  const { service } = createHarness({
    overallTimeoutMs: 10,
    parserFactory: async () => ({
      async parseSearchResults() { return new Promise(() => {}); },
      async parsePage() { return { title: 'late', text: 'late' }; },
      async dispose() { await new Promise(setImmediate); disposed = true; },
    }),
  });

  const result = await service.search({ petId: 'pet-1', requestId: 'timeout', query: 'topic' });

  assert.deepEqual(result, { status: 'timeout', sources: [], reason: 'search-timeout' });
  assert.equal(disposed, true);
});

test('a never-resolving parserFactory cannot block the overall timeout', async () => {
  const service = createPinnedBrowserSearch({
    overallTimeoutMs: 5,
    transport: { fetchHop: async () => body(SEARCH_URL) },
    parserFactory: () => new Promise(() => {}),
  });

  const result = await Promise.race([
    service.search({ petId: 'pet-1', requestId: 'never-parser', query: 'topic' }),
    new Promise((resolve) => setTimeout(() => resolve('deadline-not-settled'), 200)),
  ]);

  assert.notEqual(result, 'deadline-not-settled');
  assert.deepEqual(result, { status: 'timeout', sources: [], reason: 'search-timeout' });
});

test('a parser arriving after the bounded cleanup window is still disposed', async () => {
  let releaseParser;
  let disposed = false;
  const service = createPinnedBrowserSearch({
    overallTimeoutMs: 5,
    transport: { fetchHop: async () => body(SEARCH_URL) },
    parserFactory: () => new Promise((resolve) => {
      releaseParser = () => resolve({
        async parseSearchResults() { return []; },
        async parsePage() { return { title: 'late', text: 'late' }; },
        async dispose() { disposed = true; },
      });
    }),
  });
  const pending = service.search({ petId: 'pet-1', requestId: 'late-after-deadline', query: 'topic' });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const observed = await Promise.race([
    pending,
    new Promise((resolve) => setTimeout(() => resolve('deadline-not-settled'), 200)),
  ]);
  releaseParser();
  const result = observed === 'deadline-not-settled' ? await pending : observed;
  assert.notEqual(observed, 'deadline-not-settled');
  assert.deepEqual(result, { status: 'timeout', sources: [], reason: 'search-timeout' });
  await new Promise(setImmediate);
  assert.equal(disposed, true);
});

test('a newer request makes an older late result stale', async () => {
  let releaseFirst;
  let fetchCount = 0;
  const service = createPinnedBrowserSearch({
    overallTimeoutMs: 100,
    transport: {
      fetchHop(url) {
        fetchCount += 1;
        if (fetchCount === 1) return new Promise((resolve) => { releaseFirst = () => resolve(body(url)); });
        return Promise.resolve(body(url));
      },
    },
    parserFactory: async () => ({ async parseSearchResults() { return []; }, async parsePage() { return { title: '頁面', text: '內容' }; }, async dispose() {} }),
  });
  const first = service.search({ petId: 'pet-1', requestId: 'old', query: 'topic' });
  await new Promise(setImmediate);
  const second = service.search({ petId: 'pet-1', requestId: 'new', query: 'topic' });
  releaseFirst();

  assert.deepEqual(await first, { status: 'cancelled', sources: [] });
  assert.deepEqual(await second, { status: 'empty', sources: [] });
});
