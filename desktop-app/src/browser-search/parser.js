const MAX_INPUT_CHARS = 1_000_000;
const MAX_RESULTS = 50;
const MAX_TITLE_CHARS = 240;
const MAX_SNIPPET_CHARS = 500;
const MAX_PAGE_TEXT_CHARS = 6_000;

const PARSER_CANCELLED = 'browser-search-parser-cancelled';
const PARSER_DISPOSED = 'browser-search-parser-disposed';
const PARSER_EGRESS_BLOCKED = 'browser-search-parser-egress-blocked';
const PARSER_INPUT_TOO_LARGE = 'browser-search-parser-input-too-large';
const PARSER_OUTPUT_INVALID = 'browser-search-parser-output-invalid';
const PARSER_NOT_ABOUT_BLANK = 'browser-search-parser-not-about-blank';

let partitionSequence = 0;

function fixedError(code) {
  return new Error(code);
}

function parserScript(kind, html, baseUrl) {
  return `(() => {
    const input = ${JSON.stringify(html)};
    const baseUrl = ${JSON.stringify(baseUrl || '')};
    const maxResults = ${MAX_RESULTS};
    const maxTitleChars = ${MAX_TITLE_CHARS};
    const maxSnippetChars = ${MAX_SNIPPET_CHARS};
    const maxPageTextChars = ${MAX_PAGE_TEXT_CHARS};
    const blockedElements = 'script,style,link,img,iframe,frame,object,embed,video,audio,source,track,form,meta,base';
    const normalize = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const document = new DOMParser().parseFromString(input, 'text/html');
    for (const element of document.querySelectorAll(blockedElements)) element.remove();

    if ('${kind}' === 'page') {
      const content = document.querySelector('main, article, body');
      return {
        title: normalize(document.title, maxTitleChars),
        text: normalize(content && content.textContent, maxPageTextChars),
      };
    }

    const results = [];
    const seen = new Set();
    for (const link of document.querySelectorAll('a[href]')) {
      const heading = link.querySelector('h3');
      if (!heading) continue;
      const title = normalize(heading.textContent, maxTitleChars);
      if (!title) continue;
      let url;
      try {
        url = new URL(link.getAttribute('href'), baseUrl);
      } catch {
        continue;
      }
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      url.hash = '';
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      results.push({ title, url: url.href, snippet: normalize(link.textContent, maxSnippetChars) });
      if (results.length >= maxResults) break;
    }
    return results;
  })()`;
}

function eventUrl(args) {
  for (const value of args) {
    if (typeof value === 'string') return value;
    if (value && typeof value.url === 'string') return value.url;
  }
  return '';
}

function isExactAboutBlank(value) {
  return value === 'about:blank';
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hash === '';
  } catch {
    return false;
  }
}

function validateOutput(kind, value) {
  if (kind === 'page') {
    if (!hasExactKeys(value, ['title', 'text']) || typeof value.title !== 'string' || typeof value.text !== 'string') return false;
    return value.title.length <= MAX_TITLE_CHARS && value.text.length <= MAX_PAGE_TEXT_CHARS;
  }
  if (!Array.isArray(value) || value.length > MAX_RESULTS) return false;
  return value.every((entry) => hasExactKeys(entry, ['title', 'url', 'snippet'])
    && typeof entry.title === 'string'
    && typeof entry.snippet === 'string'
    && entry.title.length <= MAX_TITLE_CHARS
    && entry.snippet.length <= MAX_SNIPPET_CHARS
    && validHttpsUrl(entry.url));
}

async function createInertDocumentParser({ BrowserWindow, session }) {
  if (typeof BrowserWindow !== 'function' || !session?.fromPartition) throw new TypeError('parser dependencies are required');

  const partition = `browser-search-in-memory-${process.pid}-${partitionSequence += 1}`;
  const parserSession = session.fromPartition(partition);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
      partition,
    },
  });
  const webContents = window.webContents;
  const pending = new Set();
  const navigationEvents = [
    'will-navigate', 'will-frame-navigate', 'will-redirect', 'did-start-navigation',
    'did-navigate', 'did-frame-navigate', 'did-navigate-in-page', 'will-attach-webview',
    'did-attach-webview', 'new-window', 'did-create-window',
  ];
  const sessionEvents = [
    'permission-request', 'service-worker-created', 'service-worker-started',
    'shared-worker-created', 'worker-created',
  ];
  let disposed = false;
  let initialized = false;
  let egressError = null;
  let disposePromise;

  function rejectPending(error) {
    for (const reject of pending) reject(error);
    pending.clear();
  }

  function poison() {
    if (!egressError) egressError = fixedError(PARSER_EGRESS_BLOCKED);
    rejectPending(egressError);
  }

  function currentUrl() {
    try {
      return webContents.getURL?.() || '';
    } catch {
      return '';
    }
  }

  function onBeforeRequest(details, callback) {
    if (!initialized && isExactAboutBlank(details?.url)) {
      callback?.({});
      return;
    }
    poison();
    callback?.({ cancel: true });
  }

  function onBeforeRedirect(...args) {
    if (!initialized && isExactAboutBlank(eventUrl(args))) return;
    poison();
  }

  function onNavigation(event, ...args) {
    const url = eventUrl(args) || eventUrl([event]);
    if (!initialized && isExactAboutBlank(url)) return;
    event?.preventDefault?.();
    poison();
  }

  function onDownload(event, item) {
    event?.preventDefault?.();
    item?.cancel?.();
    poison();
  }

  function onSessionEvent() {
    poison();
  }

  const requestFilter = { urls: ['*://*/*', 'file://*/*', 'data:*', 'blob:*'] };
  parserSession.webRequest.onBeforeRequest(requestFilter, onBeforeRequest);
  parserSession.webRequest.onBeforeRedirect?.(requestFilter, onBeforeRedirect);
  navigationEvents.forEach((eventName) => webContents.on(eventName, onNavigation));
  sessionEvents.forEach((eventName) => parserSession.on?.(eventName, onSessionEvent));
  parserSession.on?.('will-download', onDownload);
  webContents.setWindowOpenHandler(() => {
    poison();
    return { action: 'deny' };
  });
  parserSession.setPermissionCheckHandler((_contents, _permission, requestingOrigin) => {
    if (!initialized) return false;
    poison();
    return false;
  });
  parserSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    poison();
    callback(false);
  });

  async function clearWorkers() {
    const workersApi = parserSession.serviceWorkers;
    const running = await workersApi?.getAllRunning?.();
    const entries = running instanceof Map
      ? [...running.values()]
      : Array.isArray(running)
        ? running
        : running && typeof running === 'object'
          ? Object.values(running)
          : [];
    for (const worker of entries) await workersApi.terminate?.(worker.id ?? worker);
    await workersApi?.getAllRunning?.();
  }

  async function dispose() {
    if (disposePromise) return disposePromise;
    disposed = true;
    rejectPending(fixedError(PARSER_DISPOSED));
    disposePromise = (async () => {
      navigationEvents.forEach((eventName) => webContents.removeListener?.(eventName, onNavigation));
      sessionEvents.forEach((eventName) => parserSession.removeListener?.(eventName, onSessionEvent));
      parserSession.removeListener?.('will-download', onDownload);
      parserSession.webRequest.onBeforeRequest?.(requestFilter, null);
      parserSession.webRequest.onBeforeRedirect?.(requestFilter, null);
      parserSession.setPermissionCheckHandler?.(null);
      parserSession.setPermissionRequestHandler?.(null);
      await webContents.closeAllConnections?.();
      await clearWorkers();
      await parserSession.clearStorageData?.();
      if (!window.isDestroyed?.()) window.destroy();
      await parserSession.destroy?.();
    })();
    return disposePromise;
  }

  try {
    const loadFinished = webContents.once
      ? new Promise((resolve) => webContents.once('did-finish-load', resolve))
      : Promise.resolve();
    await webContents.loadURL('about:blank');
    if (!isExactAboutBlank(currentUrl())) await loadFinished;
    if (!isExactAboutBlank(currentUrl())) throw fixedError(PARSER_NOT_ABOUT_BLANK);
    initialized = true;
  } catch (error) {
    await dispose();
    if (error?.message === PARSER_NOT_ABOUT_BLANK) throw error;
    throw fixedError(PARSER_NOT_ABOUT_BLANK);
  }

  function ensureActive() {
    if (disposed) throw fixedError(PARSER_DISPOSED);
    if (egressError) throw egressError;
    if (!initialized || !isExactAboutBlank(currentUrl())) throw fixedError(PARSER_NOT_ABOUT_BLANK);
  }

  function ensureInput(html) {
    if (typeof html !== 'string') throw new TypeError('parser input must be a string');
    if (html.length > MAX_INPUT_CHARS) throw fixedError(PARSER_INPUT_TOO_LARGE);
  }

  async function evaluate(kind, html, baseUrl, signal) {
    ensureActive();
    ensureInput(html);
    if (signal?.aborted) throw fixedError(PARSER_CANCELLED);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        pending.delete(rejectPendingForThisCall);
        signal?.removeEventListener('abort', abort);
        callback(value);
      };
      const abort = () => finish(reject, fixedError(PARSER_CANCELLED));
      const rejectPendingForThisCall = (error) => finish(reject, error);
      pending.add(rejectPendingForThisCall);
      signal?.addEventListener('abort', abort, { once: true });

      Promise.resolve()
        .then(() => webContents.executeJavaScript(parserScript(kind, html, baseUrl), false))
        .then((result) => {
          if (disposed) return finish(reject, fixedError(PARSER_DISPOSED));
          if (egressError) return finish(reject, egressError);
          if (!isExactAboutBlank(currentUrl())) return finish(reject, fixedError(PARSER_NOT_ABOUT_BLANK));
          if (!validateOutput(kind, result)) return finish(reject, fixedError(PARSER_OUTPUT_INVALID));
          finish(resolve, result);
        }, (error) => finish(reject, error));
    });
  }

  return {
    parseSearchResults(html, baseUrl, options = {}) {
      return evaluate('search', html, baseUrl, options?.signal);
    },
    parsePage(html, options = {}) {
      return evaluate('page', html, '', options?.signal);
    },
    dispose,
  };
}

module.exports = { createInertDocumentParser };
