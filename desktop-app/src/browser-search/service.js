const { canonicalizeSearchQuery, normalizeSearchQuery, searchUrl } = require('../chat/search.js');
const { canonicalizePublicHttpsUrl } = require('./policy.js');

const MAX_REDIRECT_HOPS = 5;
const MAX_CANDIDATES = 3;
const MAX_TITLE_CHARS = 240;
const MAX_TEXT_CHARS = 6_000;
const MAX_TOTAL_TEXT_CHARS = 18_000;
const OVERALL_TIMEOUT_MS = 45_000;
const PARSER_CLEANUP_GRACE_MS = 100;

const CANCEL_CODES = new Set(['request-aborted', 'cancelled', 'browser-search-parser-cancelled']);
const ALLOWED_CODES = new Set([
  'request-aborted', 'invalid-request', 'url-invalid', 'url-blocked', 'request-target-too-large',
  'dns-timeout', 'dns-nxdomain', 'dns-failed', 'dns-invalid', 'dns-too-many-answers', 'dns-non-public',
  'connect-timeout', 'connect-failed', 'connect-closed', 'peer-mismatch',
  'tls-timeout', 'tls-failed', 'tls-unauthorized', 'tls-client-certificate-required', 'tls-protocol',
  'response-timeout', 'response-closed', 'response-invalid', 'response-header-too-large', 'response-framing',
  'response-too-large', 'response-auth-required', 'response-status', 'response-status-401', 'response-status-403',
  'response-status-407', 'response-redirect-invalid', 'response-attachment', 'response-content-type',
  'response-charset', 'response-content-encoding', 'redirect-invalid', 'redirect-loop', 'redirect-limit',
  'parser-not-about-blank', 'parser-output-invalid', 'parser-timeout', 'search-timeout',
  'robots-disallowed', 'robots-unavailable', 'robots-invalid', 'robots-too-large',
  'robots-content-type', 'robots-redirect-invalid', 'robots-redirect-limit',
  'robots-invalid-target',
  'browser-search-parser-cancelled', 'browser-search-parser-disposed', 'browser-search-parser-egress-blocked',
  'browser-search-parser-input-too-large', 'browser-search-parser-output-invalid', 'browser-search-parser-not-about-blank',
  'browser-search-parser-cleanup-failed', 'transport-unavailable', 'needs-user',
]);

function result(status, reason) {
  return reason ? { status, sources: [], reason } : { status, sources: [] };
}

function statusForCode(code) {
  if (CANCEL_CODES.has(code)) return 'cancelled';
  if (code === 'search-timeout' || /(?:^|-)(?:timeout)$/.test(code || '')) return 'timeout';
  if (code === 'needs-user' || code === 'response-auth-required' || code === 'tls-client-certificate-required' || /^response-status-(401|407)$/.test(code || '')) return 'needs-user';
  return 'blocked';
}

function fixedCode(value, fallback) {
  const code = typeof value === 'string' ? value : value?.code || value?.message;
  return ALLOWED_CODES.has(code) ? code : fallback;
}

function resultForCode(code, fallback = 'response-invalid') {
  const normalized = fixedCode(code, fallback);
  const status = statusForCode(normalized);
  return result(status, status === 'cancelled' ? undefined : normalized === 'url-blocked' ? 'unsafe-target' : normalized);
}

function bounded(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

async function adoptLateParser(parserPromise) {
  const deadline = {};
  let timer;
  const grace = new Promise((resolve) => {
    timer = setTimeout(() => resolve(deadline), PARSER_CLEANUP_GRACE_MS);
  });
  const parser = await Promise.race([parserPromise, grace]);
  clearTimeout(timer);
  if (parser !== deadline) return parser;
  parserPromise.then(async (lateParser) => {
    try { await lateParser?.dispose?.(); }
    catch { /* the request already returned a fixed timeout/cancel result */ }
  }, () => {});
  return undefined;
}

async function disposeWithGrace(parser) {
  if (typeof parser?.dispose !== 'function') return true;
  const completion = Promise.resolve().then(() => parser.dispose()).then(() => true);
  const deadline = new Promise((resolve) => setTimeout(() => resolve(false), PARSER_CLEANUP_GRACE_MS));
  return Promise.race([completion, deadline]);
}

function createPinnedBrowserSearch({ transport, parserFactory, robotsPolicy, now = Date.now, overallTimeoutMs = OVERALL_TIMEOUT_MS } = {}) {
  const requests = new Map();
  const epochs = new Map();
  const enabled = typeof transport?.fetchHop === 'function' && typeof parserFactory === 'function';
  const timeoutMs = Number.isFinite(overallTimeoutMs) ? overallTimeoutMs : OVERALL_TIMEOUT_MS;

  function cancelState(state, code = 'request-aborted') {
    if (!state || state.cancelled) return;
    state.cancelled = true;
    state.cancelReason = code;
    state.controller.abort();
    state.cancelResolve(code);
  }

  function currentCode(state) {
    return state.cancelReason || 'request-aborted';
  }

  function isCurrent(petId, state) {
    return requests.get(petId) === state && epochs.get(petId) === state.epoch && !state.cancelled && !state.controller.signal.aborted;
  }

  async function raceRequest(promise, state) {
    return Promise.race([Promise.resolve(promise), state.cancelPromise]);
  }

  async function fetchFollowingRedirects(startUrl, petId, state, purpose) {
    let current;
    try { current = canonicalizePublicHttpsUrl(startUrl).url; }
    catch { return 'url-invalid'; }
    const seen = new Set();

    for (let hopIndex = 0; hopIndex <= MAX_REDIRECT_HOPS; hopIndex += 1) {
      if (!isCurrent(petId, state)) return currentCode(state);
      if (seen.has(current)) return 'redirect-loop';
      seen.add(current);

      if (robotsPolicy?.check) {
        let robots;
        try {
          robots = await raceRequest(robotsPolicy.check(current, {
            requestId: state.requestId,
            hopIndex,
            signal: state.controller.signal,
          }), state);
        } catch {
          return 'robots-unavailable';
        }
        if (typeof robots === 'string') return robots;
        if (!robots?.allowed) return fixedCode(robots?.code, 'robots-unavailable');
      }

      let response;
      try {
        response = await raceRequest(transport.fetchHop(current, {
          requestId: state.requestId,
          hopIndex,
          purpose,
          signal: state.controller.signal,
        }), state);
      } catch (error) {
        return state.cancelled ? currentCode(state) : fixedCode(error, 'response-invalid');
      }
      if (typeof response === 'string') return response;
      if (!isCurrent(petId, state)) return currentCode(state);
      if (!response || response.ok !== true) return fixedCode(response?.code || response?.status, 'response-invalid');
      if (response.kind === 'body') return { response, url: response.requestUrl || current };
      if (response.kind !== 'redirect' || typeof response.location !== 'string' || !response.location.trim()) return 'redirect-invalid';
      if (hopIndex === MAX_REDIRECT_HOPS) return 'redirect-limit';

      try { current = canonicalizePublicHttpsUrl(new URL(response.location, current).toString()).url; }
      catch { return 'redirect-invalid'; }
    }
    return 'redirect-limit';
  }

  function parserResult(code) {
    const normalized = fixedCode(code, 'parser-output-invalid');
    if (normalized === 'browser-search-parser-egress-blocked') return result('blocked', 'parser-egress-blocked');
    return resultForCode(normalized, 'parser-output-invalid');
  }

  function pageFailureIsTerminal(code) {
    return statusForCode(code) === 'cancelled' || statusForCode(code) === 'timeout' || code === 'browser-search-parser-egress-blocked';
  }

  function pageTerminalResult(code) {
    return code === 'browser-search-parser-egress-blocked' ? parserResult(code) : resultForCode(code);
  }

  async function performSearch(petId, state, query, parser) {
    const search = await fetchFollowingRedirects(searchUrl(query), petId, state, 'search');
    if (typeof search === 'string') return resultForCode(search);

    let candidates;
    try {
      candidates = await raceRequest(parser.parseSearchResults(search.response.body, search.url, { signal: state.controller.signal }), state);
    } catch (error) {
      return parserResult(fixedCode(error, 'parser-output-invalid'));
    }
    if (typeof candidates === 'string') return parserResult(candidates);
    if (!isCurrent(petId, state)) return resultForCode(currentCode(state));
    if (!Array.isArray(candidates)) return result('blocked', 'parser-output-invalid');

    const sources = [];
    let totalText = 0;
    const candidateLimit = Math.min(candidates.length, MAX_CANDIDATES);
    for (let index = 0; index < candidateLimit; index += 1) {
      if (!isCurrent(petId, state)) return resultForCode(currentCode(state));
      const candidate = candidates[index];
      if (typeof candidate?.url !== 'string' || typeof candidate?.title !== 'string') continue;

      const page = await fetchFollowingRedirects(candidate.url, petId, state, 'page');
      if (typeof page === 'string') {
        if (pageFailureIsTerminal(page)) return pageTerminalResult(page);
        continue;
      }

      let extracted;
      try {
        extracted = await raceRequest(parser.parsePage(page.response.body, { signal: state.controller.signal }), state);
      } catch (error) {
        const code = fixedCode(error, 'parser-output-invalid');
        if (pageFailureIsTerminal(code)) return pageTerminalResult(code);
        continue;
      }
      if (typeof extracted === 'string') {
        if (pageFailureIsTerminal(extracted)) return pageTerminalResult(extracted);
        continue;
      }
      if (!isCurrent(petId, state)) return resultForCode(currentCode(state));

      const title = bounded(extracted?.title || candidate.title, MAX_TITLE_CHARS);
      const text = bounded(extracted?.text, Math.min(MAX_TEXT_CHARS, MAX_TOTAL_TEXT_CHARS - totalText));
      if (!title || !text) continue;
      totalText += text.length;
      sources.push({
        id: `source-${sources.length + 1}`,
        title,
        url: page.url,
        retrievedAt: new Date(now()).toISOString(),
        text,
        coverage: 'page',
      });
    }
    return sources.length ? { status: 'ok', sources } : result('empty');
  }

  async function search({ petId, requestId, query, signal, sensitiveQueryApproved = false } = {}) {
    if (!enabled) return result('blocked', 'transport-unavailable');
    let normalized;
    try {
      normalized = sensitiveQueryApproved === true ? canonicalizeSearchQuery(query) : normalizeSearchQuery(query);
    }
    catch (error) { return result(error.code === 'empty' ? 'empty' : 'needs-user', error.code); }
    if (typeof petId !== 'string' || !petId || typeof requestId !== 'string' || !requestId) return result('blocked', 'invalid-request');

    const previous = requests.get(petId);
    if (previous) cancelState(previous);

    let cancelResolve;
    const state = {
      requestId,
      epoch: (epochs.get(petId) || 0) + 1,
      controller: new AbortController(),
      cancelled: false,
      cancelPromise: new Promise((resolve) => { cancelResolve = resolve; }),
      cancelResolve,
    };
    epochs.set(petId, state.epoch);
    requests.set(petId, state);
    state.done = new Promise((resolve) => { state.doneResolve = resolve; });
    const abort = () => cancelState(state);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => cancelState(state, 'search-timeout'), timeoutMs);
    let parser;
    let parserPromise;
    let outcome;
    let cleanupFailed = false;
    try {
      if (state.cancelled) outcome = resultForCode(currentCode(state));
      else {
        parserPromise = Promise.resolve().then(() => parserFactory());
        let created;
        try { created = await raceRequest(parserPromise, state); }
        catch (error) { outcome = parserResult(fixedCode(error, 'parser-output-invalid')); }
        if (outcome === undefined) {
          if (typeof created === 'string') {
            parser = undefined;
            outcome = resultForCode(created);
          } else {
            parser = created;
            if (!parser || typeof parser.parseSearchResults !== 'function' || typeof parser.parsePage !== 'function') outcome = result('blocked', 'parser-output-invalid');
            else if (!isCurrent(petId, state)) outcome = resultForCode(currentCode(state));
            else outcome = await performSearch(petId, state, normalized, parser);
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (!parser && parserPromise && state.cancelled) {
        try { parser = await adoptLateParser(parserPromise); }
        catch { parser = undefined; }
      }
      try {
        if (!await disposeWithGrace(parser)) cleanupFailed = true;
      }
      catch { cleanupFailed = true; }
      try { robotsPolicy?.dispose?.(state.requestId); }
      catch { /* request cleanup must stay fixed and bounded */ }
      if (requests.get(petId) === state) requests.delete(petId);
      state.doneResolve();
    }
    return cleanupFailed ? result('blocked', 'browser-search-parser-cleanup-failed') : outcome;
  }

  function cancel(petId, requestId) {
    const state = requests.get(petId);
    if (state && (requestId === undefined || state.requestId === requestId)) cancelState(state);
  }

  function dispose(petId) {
    const state = requests.get(petId);
    if (!state) return Promise.resolve();
    cancelState(state);
    return state.done;
  }

  return { search, cancel, dispose };
}

module.exports = { createPinnedBrowserSearch };
