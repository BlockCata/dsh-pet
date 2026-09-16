'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_ROBOTS_BYTES,
  createRobotsPolicy,
  parseRobotsTxt,
} = require('../src/browser-search/robots');

function body(url, text, mediaType = 'text/plain') {
  return {
    ok: true,
    kind: 'body',
    requestUrl: url,
    statusCode: 200,
    mediaType,
    body: text,
    bodyBytes: Buffer.byteLength(text),
  };
}

test('robots parser selects the matching user-agent group and longest rule', () => {
  const wildcardRules = parseRobotsTxt(`
User-agent: *
Disallow: /private
Allow: /private/public

User-agent: big-fat-fish-reader
Disallow: /
Allow: /public
`, 'other-reader');

  assert.equal(wildcardRules.allows('/private'), false);
  assert.equal(wildcardRules.allows('/private/public'), true);

  const exactRules = parseRobotsTxt(`User-agent: big-fat-fish-reader\nDisallow: /\nAllow: /public\n`);
  assert.equal(exactRules.allows('/public'), true);
  assert.equal(exactRules.allows('/other'), false);
});

test('robots parser treats equal-length Allow as the safe tie-breaker and ignores empty Disallow', () => {
  const rules = parseRobotsTxt(`
User-agent: *
Disallow:
Disallow: /same
Allow: /same
Disallow: /path/*
Allow: /path/open$
`);

  assert.equal(rules.allows('/anything'), true);
  assert.equal(rules.allows('/same'), true);
  assert.equal(rules.allows('/path/open'), true);
  assert.equal(rules.allows('/path/closed'), false);
});

test('robots parser matches the encoded path and query without exposing source text', () => {
  const rules = parseRobotsTxt('User-agent: *\nDisallow: /private?q=1\n');
  assert.equal(rules.allows('/private?q=1'), false);
  assert.equal(rules.allows('/private?q=2'), true);
  assert.deepEqual(Object.keys(rules), ['allows']);
});

test('robots policy fetches each authority once and denies when rules disallow the target', async () => {
  const calls = [];
  const transport = {
    async fetchHop(url, options) {
      calls.push({ url, options });
      return body(url, 'User-agent: *\nDisallow: /private\n');
    },
  };
  const policy = createRobotsPolicy({ transport, userAgent: 'big-fat-fish-reader' });

  assert.deepEqual(await policy.check('https://public.site/private', { requestId: 'req-1', hopIndex: 0 }), {
    allowed: false,
    code: 'robots-disallowed',
  });
  assert.deepEqual(await policy.check('https://public.site/public', { requestId: 'req-1', hopIndex: 0 }), {
    allowed: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/robots.txt');
  assert.equal(calls[0].options.purpose, 'robots');
});

test('robots policy follows at most five redirects and keeps rules bound to the initial authority', async () => {
  const calls = [];
  const transport = {
    async fetchHop(url) {
      calls.push(url);
      if (calls.length <= 5) return { ok: true, kind: 'redirect', requestUrl: url, statusCode: 302, location: `/r${calls.length}` };
      return body(url, 'User-agent: *\nDisallow: /\n');
    },
  };
  const policy = createRobotsPolicy({ transport });
  assert.deepEqual(await policy.check('https://public.site/private', { requestId: 'req-2', hopIndex: 0 }), { allowed: false, code: 'robots-disallowed' });
  assert.equal(calls.length, 6);

  const failing = createRobotsPolicy({
    transport: { async fetchHop() { return { ok: true, kind: 'redirect', requestUrl: 'https://public.site/robots.txt', statusCode: 302, location: '/again' }; } },
  });
  assert.deepEqual(await failing.check('https://public.site/private', { requestId: 'req-3', hopIndex: 0 }), { allowed: false, code: 'robots-redirect-limit' });
});

test('robots policy fails closed for unavailable, malformed, oversized, and non-text rules', async () => {
  const cases = [
    { response: { ok: false, status: 'blocked', code: 'response-status' }, code: 'robots-unavailable' },
    { response: body('https://public.site/robots.txt', 'User-agent: *\nDisallow: /\n', 'text/html'), code: 'robots-content-type' },
    { response: body('https://public.site/robots.txt', '\u0000'), code: 'robots-invalid' },
    { response: body('https://public.site/robots.txt', 'x'.repeat(MAX_ROBOTS_BYTES + 1)), code: 'robots-too-large' },
  ];
  for (const { response, code } of cases) {
    const policy = createRobotsPolicy({ transport: { async fetchHop() { return response; } } });
    assert.deepEqual(await policy.check('https://public.site/private', { requestId: 'req-4', hopIndex: 0 }), { allowed: false, code });
  }
});

test('robots policy rejects invalid targets and aborted requests without leaking rules', async () => {
  const policy = createRobotsPolicy({ transport: { async fetchHop() { throw new Error('should-not-fetch'); } } });
  assert.deepEqual(await policy.check('http://public.site/private', { requestId: 'req-5', hopIndex: 0 }), { allowed: false, code: 'robots-invalid-target' });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await policy.check('https://public.site/private', { requestId: 'req-5', hopIndex: 0, signal: controller.signal }), { allowed: false, code: 'request-aborted' });
});
