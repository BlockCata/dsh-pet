'use strict';

const { canonicalizePublicHttpsUrl } = require('./policy');

const MAX_ROBOTS_BYTES = 128 * 1024;
const MAX_REDIRECT_HOPS = 5;
const MAX_CACHED_REQUESTS = 8;
const MAX_CACHED_AUTHORITIES = 16;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_USER_AGENT = 'big-fat-fish-reader';

function robotsError(code) {
  return { allowed: false, code };
}

function stripComment(value) {
  const index = value.indexOf('#');
  return (index < 0 ? value : value.slice(0, index)).trim();
}

function patternMatcher(pattern) {
  const end = pattern.endsWith('$');
  const source = (end ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${source}${end ? '$' : ''}`);
}

function parseRobotsTxt(value, userAgent = DEFAULT_USER_AGENT) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_ROBOTS_BYTES || /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('robots-invalid');

  const groups = [];
  let current;
  for (const rawLine of value.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const parameter = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      current = { agents: [parameter.toLowerCase()], rules: [] };
      groups.push(current);
    } else if ((key === 'allow' || key === 'disallow') && current) {
      if (!parameter && key === 'disallow') continue;
      current.rules.push({ allow: key === 'allow', pattern: parameter, match: patternMatcher(parameter) });
    }
  }

  const normalizedAgent = String(userAgent).trim().toLowerCase();
  const exact = groups.filter((group) => group.agents.includes(normalizedAgent));
  const selected = exact.length ? exact : groups.filter((group) => group.agents.includes('*'));
  const rules = selected.flatMap((group) => group.rules);
  return Object.freeze({
    allows(pathAndQuery) {
      if (typeof pathAndQuery !== 'string' || !pathAndQuery.startsWith('/')) return false;
      let best;
      for (const rule of rules) {
        if (!rule.match.test(pathAndQuery)) continue;
        if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)) best = rule;
      }
      return !best || best.allow;
    },
  });
}

function authorityKey(url) {
  return url.hostname.toLowerCase();
}

function createRobotsPolicy({ transport, userAgent = DEFAULT_USER_AGENT } = {}) {
  const requests = new Map();

  function requestCache(requestId) {
    let cache = requests.get(requestId);
    if (!cache) {
      cache = new Map();
      requests.set(requestId, cache);
      while (requests.size > MAX_CACHED_REQUESTS) requests.delete(requests.keys().next().value);
    }
    return cache;
  }

  async function loadRules(url, options) {
    let current = `https://${url.hostname}/robots.txt`;
    for (let hopIndex = 0; hopIndex <= MAX_REDIRECT_HOPS; hopIndex += 1) {
      if (options.signal?.aborted) return robotsError('request-aborted');
      let response;
      try {
        response = await transport.fetchHop(current, {
          requestId: options.requestId,
          hopIndex: Math.min(options.hopIndex ?? 0, 5),
          purpose: 'robots',
          signal: options.signal,
        });
      } catch {
        return robotsError('robots-unavailable');
      }
      if (!response || response.ok !== true) return robotsError(response?.code === 'request-aborted' ? 'request-aborted' : 'robots-unavailable');
      if (response.kind === 'redirect') {
        if (hopIndex === MAX_REDIRECT_HOPS || typeof response.location !== 'string' || !response.location.trim()) return robotsError('robots-redirect-limit');
        try { current = canonicalizePublicHttpsUrl(new URL(response.location, current).toString()).url; }
        catch { return robotsError('robots-redirect-invalid'); }
        continue;
      }
      if (response.kind !== 'body' || response.statusCode < 200 || response.statusCode >= 300) return robotsError('robots-unavailable');
      if (response.mediaType !== 'text/plain') return robotsError('robots-content-type');
      try { return { allowed: true, rules: parseRobotsTxt(response.body, userAgent) }; }
      catch { return robotsError(Buffer.byteLength(response.body || '', 'utf8') > MAX_ROBOTS_BYTES ? 'robots-too-large' : 'robots-invalid'); }
    }
    return robotsError('robots-redirect-limit');
  }

  async function check(value, options = {}) {
    if (!REQUEST_ID.test(options.requestId || '')) return robotsError('invalid-request');
    if (options.signal?.aborted) return robotsError('request-aborted');
    let url;
    try { url = new URL(canonicalizePublicHttpsUrl(value).url); }
    catch { return robotsError('robots-invalid-target'); }
    if (typeof transport?.fetchHop !== 'function') return robotsError('robots-unavailable');

    const cache = requestCache(options.requestId);
    const key = authorityKey(url);
    let loaded = cache.get(key);
    if (!loaded) {
      loaded = await loadRules(url, options);
      if (cache.size < MAX_CACHED_AUTHORITIES) cache.set(key, loaded);
    }
    if (!loaded.allowed) return robotsError(loaded.code);
    return loaded.rules.allows(`${url.pathname || '/'}${url.search}`)
      ? { allowed: true }
      : robotsError('robots-disallowed');
  }

  function dispose(requestId) {
    requests.delete(requestId);
  }

  return { check, dispose };
}

module.exports = { MAX_ROBOTS_BYTES, createRobotsPolicy, parseRobotsTxt };
