'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const tls = require('node:tls');

const { createPinnedHttpsTransport } = require('../src/browser-search/transport');
const { canonicalAddress } = require('../src/browser-search/policy');

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2001:4860:4860:0:0:0:0:8888';

class FakeSocket extends EventEmitter {
  constructor(tuple = {}) {
    super();
    Object.assign(this, tuple);
    this.writes = [];
    this.destroyed = false;
  }

  write(chunk) {
    this.writes.push(Buffer.from(chunk));
    return true;
  }

  destroy(error) {
    this.destroyed = true;
    this.destroyError = error;
  }
}

function answer(address, family, ttl = 60) {
  return { address, family, ttl };
}

function snapshot({ a = [answer(PUBLIC_V4, 4)], aaaa = [] } = {}) {
  const status = (answers) => ({ status: answers.length ? 'ok' : 'nodata', answers });
  const all = [...a, ...aaaa];
  return {
    hostname: 'public.site',
    a: status(a),
    aaaa: status(aaaa),
    endpoints: all.map((endpoint) => ({ ...endpoint, key: canonicalAddress(endpoint.address, endpoint.family) })),
  };
}

function response(statusCode, headers = {}, body = '<main>safe</main>') {
  const reason = { 200: 'OK', 301: 'Moved Permanently', 302: 'Found', 401: 'Unauthorized' }[statusCode] || 'Status';
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  return Buffer.from(`HTTP/1.1 ${statusCode} ${reason}\r\n${lines.join('\r\n')}\r\n\r\n${body}`);
}

function createHarness({
  dnsSnapshot = snapshot(),
  resolve = async () => dnsSnapshot,
  tuple = { remoteAddress: PUBLIC_V4, remoteFamily: 'IPv4', remotePort: 443 },
  reply = response(200, { 'content-type': 'text/html; charset=utf-8' }),
  connectEvent = true,
  tlsEvent = true,
  responseEvent = true,
  tlsProperties = {},
  tlsError,
  afterSecureConnect,
  evidenceSink,
  now = () => 1_000,
} = {}) {
  const calls = { resolve: [], connect: [], tls: [] };
  let rawSocket;
  let tlsSocket;
  const resolverFactory = {
    resolve: async (hostname, options) => {
      calls.resolve.push({ hostname, options });
      return resolve(hostname, options);
    },
  };
  const transport = createPinnedHttpsTransport({
    resolverFactory,
    connect: (options) => {
      calls.connect.push(options);
      rawSocket = new FakeSocket(tuple);
      if (connectEvent) queueMicrotask(() => rawSocket.emit('connect'));
      return rawSocket;
    },
    tlsConnect: (options) => {
      calls.tls.push(options);
      tlsSocket = new FakeSocket({
        authorized: true,
        authorizationError: '',
        alpnProtocol: 'http/1.1',
        getPeerCertificate: () => ({ fingerprint256: 'AA:'.repeat(31) + 'AA' }),
        ...tlsProperties,
      });
      queueMicrotask(() => {
        if (tlsError) {
          tlsSocket.emit('error', tlsError);
          return;
        }
        if (!tlsEvent) return;
        tlsSocket.emit('secureConnect');
        afterSecureConnect?.(tlsSocket);
        if (!responseEvent) return;
        tlsSocket.emit('data', reply);
        tlsSocket.emit('end');
      });
      return tlsSocket;
    },
    now,
    evidenceSink,
  });
  return { transport, calls, rawSocket: () => rawSocket, tlsSocket: () => tlsSocket };
}

function resultError(code, status = 'blocked') {
  return { ok: false, status, code };
}

function validOptions(extra = {}) {
  return { requestId: 'req-1', hopIndex: 0, purpose: 'search', ...extra };
}

test('transport accepts the bounded robots purpose without changing request material', async () => {
  const harness = createHarness();
  const result = await harness.transport.fetchHop('https://public.site/robots.txt', validOptions({ purpose: 'robots' }));
  assert.equal(result.ok, true);
  assert.equal(harness.calls.connect.length, 1);
  assert.equal(harness.tlsSocket().writes.length, 1);
  assert.match(harness.tlsSocket().writes[0].toString('ascii'), /^GET \/robots\.txt HTTP\/1\.1\r\n/);
});

async function settle(promise) {
  return promise;
}

test('fetchHop performs one A+AAAA snapshot and one numeric dial without exposing endpoint details', async () => {
  const trace = [];
  const harness = createHarness({ evidenceSink: (event) => trace.push(event) });

  const result = await harness.transport.fetchHop('https://public.site/guide?q=1#fragment', validOptions());

  assert.deepEqual(result, {
    ok: true,
    kind: 'body',
    requestUrl: 'https://public.site/guide?q=1',
    statusCode: 200,
    mediaType: 'text/html',
    charset: 'utf-8',
    body: '<main>safe</main>',
    bodyBytes: Buffer.byteLength('<main>safe</main>'),
  });
  assert.equal(harness.calls.resolve.length, 1);
  assert.equal(harness.calls.resolve[0].hostname, 'public.site');
  assert.equal(harness.calls.connect.length, 1);
  assert.deepEqual(harness.calls.connect[0], { host: PUBLIC_V4, family: 4, port: 443, allowHalfOpen: false });
  assert.equal(Object.hasOwn(result, 'address'), false);
  assert.equal(harness.rawSocket().listenerCount('connect'), 0);
  assert.equal(harness.tlsSocket().listenerCount('data'), 0);
  assert.equal(harness.tlsSocket().listenerCount('end'), 0);
  assert.deepEqual(trace.map((event) => event.phase), [
    'url-policy-accepted', 'dns-start', 'dns-complete', 'all-addresses-public',
    'address-selected', 'tcp-connected', 'peer-matched', 'tls-start',
    'tls-authorized', 'request-written', 'response-classified',
  ]);
});

test('fetchHop validates every A and AAAA answer before dialing a mixed snapshot', async () => {
  const mixed = {
    hostname: 'public.site',
    a: { status: 'ok', answers: [answer(PUBLIC_V4, 4)] },
    aaaa: { status: 'ok', answers: [answer('::1', 6)] },
    endpoints: [],
  };
  const harness = createHarness({ dnsSnapshot: mixed });

  assert.deepEqual(await harness.transport.fetchHop('https://public.site/', validOptions()), resultError('dns-non-public'));
  assert.equal(harness.calls.connect.length, 0);
});

test('fetchHop dials IPv6 numerically and compares the canonical remote tuple', async () => {
  const harness = createHarness({
    dnsSnapshot: snapshot({ a: [], aaaa: [answer(PUBLIC_V6, 6)] }),
    tuple: { remoteAddress: '2001:4860:4860::8888', remoteFamily: 'IPv6', remotePort: 443 },
  });

  await harness.transport.fetchHop('https://PUBLIC.SITE./', validOptions());
  assert.deepEqual(harness.calls.connect[0], { host: PUBLIC_V6, family: 6, port: 443, allowHalfOpen: false });
  assert.equal(harness.calls.tls[0].servername, 'public.site');
});

test('fetchHop rejects a peer mismatch before TLS and request bytes', async () => {
  for (const tuple of [
    { remoteAddress: '127.0.0.1', remoteFamily: 'IPv4', remotePort: 443 },
    { remoteAddress: PUBLIC_V4, remoteFamily: 'IPv6', remotePort: 443 },
    { remoteAddress: PUBLIC_V4, remoteFamily: 'IPv4', remotePort: 444 },
  ]) {
    const harness = createHarness({ tuple });
    assert.deepEqual(await harness.transport.fetchHop('https://public.site/', validOptions()), resultError('peer-mismatch'));
    assert.equal(harness.calls.tls.length, 0);
    assert.deepEqual(harness.rawSocket().writes, []);
  }
});

test('fetchHop supplies pinned TLS identity, verification, and ALPN options', async () => {
  const harness = createHarness();
  await harness.transport.fetchHop('https://public.site/path', validOptions());

  assert.equal(harness.calls.tls.length, 1);
  assert.equal(harness.calls.tls[0].socket, harness.rawSocket());
  assert.equal(harness.calls.tls[0].servername, 'public.site');
  assert.equal(harness.calls.tls[0].rejectUnauthorized, true);
  assert.equal(harness.calls.tls[0].checkServerIdentity, tls.checkServerIdentity);
  assert.deepEqual(harness.calls.tls[0].ALPNProtocols, ['http/1.1']);
});

test('fetchHop never writes after unauthorized, authorization error, unsupported ALPN, or client certificate failure', async () => {
  const cases = [
    [{ authorized: false }, 'tls-unauthorized'],
    [{ authorized: true, authorizationError: 'CERT_UNTRUSTED' }, 'tls-unauthorized'],
    [{ alpnProtocol: 'h2' }, 'tls-protocol'],
    [null, 'tls-client-certificate-required', Object.assign(new Error('certificate required'), { code: 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED' })],
  ];
  for (const [tlsProperties, code, tlsError] of cases) {
    const harness = createHarness({ tlsProperties: tlsProperties || {}, tlsError });
    assert.deepEqual(await harness.transport.fetchHop('https://public.site/', validOptions()), resultError(code, code === 'tls-client-certificate-required' ? 'needs-user' : 'blocked'));
    assert.deepEqual(harness.rawSocket().writes, []);
  }
});

test('fetchHop accepts null authorizationError as the Node TLS no-error value', async () => {
  const harness = createHarness({ tlsProperties: { authorizationError: null } });
  const result = await harness.transport.fetchHop('https://public.site/', validOptions());
  assert.equal(result.ok, true);
  assert.equal(harness.tlsSocket().writes.length, 1);
});

test('fetchHop emits only allowlisted fingerprint evidence', async () => {
  const trace = [];
  const harness = createHarness({ evidenceSink: (event) => trace.push(event) });
  await harness.transport.fetchHop('https://public.site/', validOptions());
  const tlsEvent = trace.find((event) => event.phase === 'tls-authorized');
  assert.equal(tlsEvent.boolean, true);
  assert.equal(tlsEvent.hostname, 'public.site');
  assert.equal(tlsEvent.authorizationErrorEmpty, true);
  assert.equal(tlsEvent.alpnProtocol, 'http/1.1');
  assert.equal(tlsEvent.fingerprint256, 'AA:'.repeat(31) + 'AA');
  assert.equal(Object.keys(tlsEvent).sort().join(','), 'alpnProtocol,authorizationErrorEmpty,boolean,fingerprint256,hopIndex,hostname,phase,requestId,seq');
});

test('fetchHop rejects absent or malformed TLS fingerprint evidence before request bytes', async () => {
  for (const getPeerCertificate of [() => ({}), () => ({ fingerprint256: 'not-a-sha256-fingerprint' })]) {
    const harness = createHarness({ tlsProperties: { getPeerCertificate } });
    assert.deepEqual(await harness.transport.fetchHop('https://public.site/', validOptions()), resultError('tls-unauthorized'));
    assert.deepEqual(harness.rawSocket().writes, []);
    assert.deepEqual(harness.tlsSocket().writes, []);
  }
});

test('fetchHop rejects absent or non-HTTP/1.1 negotiated ALPN before request bytes', async () => {
  for (const alpnProtocol of [undefined, null, '']) {
    const harness = createHarness({ tlsProperties: { alpnProtocol } });
    assert.deepEqual(await harness.transport.fetchHop('https://public.site/', validOptions()), resultError('tls-protocol'));
    assert.deepEqual(harness.rawSocket().writes, []);
    assert.deepEqual(harness.tlsSocket().writes, []);
  }
});

test('fetchHop writes exactly four fixed headers, GET with an empty body, and removes fragments', async () => {
  const harness = createHarness();
  await harness.transport.fetchHop('https://public.site/a?b=1#fragment', validOptions({
    headers: { Cookie: 'secret' },
    body: 'must-not-write',
    method: 'POST',
    url: 'https://evil.example/',
  }));

  const request = Buffer.concat(harness.tlsSocket().writes);
  assert.equal(request.toString('ascii'), [
    'GET /a?b=1 HTTP/1.1',
    'Host: public.site',
    'Accept: text/html, text/plain',
    'Accept-Encoding: identity',
    'Connection: close',
    '',
    '',
  ].join('\r\n'));
  assert.equal(request.length, Buffer.byteLength(request.toString('ascii')));
  assert.doesNotMatch(request.toString('ascii'), /cookie|authorization|referer|origin|proxy|secret|must-not-write|evil/i);
});

test('fetchHop enforces the request-target byte boundary before DNS', async () => {
  const accepted = createHarness();
  const acceptedTarget = `/${'a'.repeat(8191)}`;
  const acceptedResult = await accepted.transport.fetchHop(`https://public.site${acceptedTarget}`, validOptions());
  assert.equal(acceptedResult.ok, true);

  const rejected = createHarness();
  const rejectedTarget = `/${'a'.repeat(8192)}`;
  assert.deepEqual(await rejected.transport.fetchHop(`https://public.site${rejectedTarget}`, validOptions()), resultError('request-target-too-large'));
  assert.equal(rejected.calls.resolve.length, 0);
  assert.equal(rejected.calls.connect.length, 0);
});

test('fetchHop returns bounded body or redirect outcomes without response headers', async () => {
  const body = await createHarness().transport.fetchHop('https://public.site/', validOptions());
  assert.deepEqual(body, {
    ok: true,
    kind: 'body',
    requestUrl: 'https://public.site/',
    statusCode: 200,
    mediaType: 'text/html',
    charset: 'utf-8',
    body: '<main>safe</main>',
    bodyBytes: Buffer.byteLength('<main>safe</main>'),
  });
  assert.equal(Object.hasOwn(body, 'headers'), false);

  const redirect = createHarness({ reply: response(302, { location: 'https://elsewhere.example/', 'content-type': 'text/html' }, '') });
  assert.deepEqual(await redirect.transport.fetchHop('https://public.site/', validOptions()), {
    ok: true,
    kind: 'redirect',
    requestUrl: 'https://public.site/',
    statusCode: 302,
    location: 'https://elsewhere.example/',
  });
});

test('fetchHop maps response safety failures without fallback or partial body', async () => {
  const cases = [
    [response(401, { 'content-type': 'text/html' }), resultError('response-auth-required', 'needs-user')],
    [response(200, { 'content-type': 'application/octet-stream' }), resultError('response-content-type')],
    [response(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }), resultError('response-content-encoding')],
  ];
  for (const [reply, expected] of cases) {
    assert.deepEqual(await createHarness({ reply }).transport.fetchHop('https://public.site/', validOptions()), expected);
  }
});

test('fetchHop applies DNS, TCP, TLS, header, response, and per-hop deadlines', async () => {
  const expired = (values) => {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)];
  };
  const cases = [
    [createHarness({ resolve: () => new Promise(() => {}), now: expired([0, 5_001]) }), resultError('dns-timeout', 'timeout')],
    [createHarness({ connectEvent: false, now: expired([0, 0, 5_001]) }), resultError('connect-timeout', 'timeout')],
    [createHarness({ tlsEvent: false, now: expired([0, 0, 0, 5_001]) }), resultError('tls-timeout', 'timeout')],
    [createHarness({ responseEvent: false, now: expired([0, 0, 0, 0, 5_001]) }), resultError('response-timeout', 'timeout')],
  ];
  for (const [harness, expected] of cases) assert.deepEqual(await settle(harness.transport.fetchHop('https://public.site/', validOptions())), expected);
});

test('fetchHop bounds an unfinished phase with the absolute 20 second hop deadline', async () => {
  let index = 0;
  const now = () => [0, 0, 0, 20_001][Math.min(index++, 3)];
  const harness = createHarness({ connectEvent: false, now });
  assert.deepEqual(await harness.transport.fetchHop('https://public.site/', validOptions()), resultError('connect-timeout', 'timeout'));
  assert.equal(harness.rawSocket().destroyed, true);
});

test('fetchHop aborts and cleans up sockets/listeners, suppressing late events', async () => {
  const harness = createHarness({ connectEvent: false });
  const controller = new AbortController();
  const pending = harness.transport.fetchHop('https://public.site/', validOptions({ signal: controller.signal }));
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await pending, resultError('request-aborted', 'cancelled'));
  assert.equal(harness.rawSocket().destroyed, true);
  harness.rawSocket().emit('connect');
  assert.equal(harness.calls.tls.length, 0);
  assert.equal(harness.rawSocket().listenerCount('connect'), 0);
  assert.doesNotThrow(() => harness.rawSocket().emit('error', new Error('late raw error')));
  harness.rawSocket().emit('close');
  assert.equal(harness.rawSocket().listenerCount('error'), 0);
});

test('fetchHop ignores a resolver completion after abort and never opens a socket', async () => {
  let release;
  const harness = createHarness({ resolve: () => new Promise((resolve) => { release = resolve; }) });
  const controller = new AbortController();
  const pending = harness.transport.fetchHop('https://public.site/', validOptions({ signal: controller.signal }));
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await pending, resultError('request-aborted', 'cancelled'));
  release(snapshot());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.connect.length, 0);
});

test('fetchHop cleans up every failure path after TLS/socket activity', async () => {
  let clockIndex = 0;
  const expiredClock = () => [0, 0, 0, 0, 5_001][Math.min(clockIndex++, 4)];
  const responseTimeoutHarness = createHarness({ responseEvent: false, now: expiredClock });
  const cases = [
    createHarness({ tuple: { remoteAddress: '127.0.0.1', remoteFamily: 'IPv4', remotePort: 443 } }),
    createHarness({ tlsError: new Error('handshake failed') }),
    responseTimeoutHarness,
  ];
  const results = [
    resultError('peer-mismatch'),
    resultError('tls-failed'),
    resultError('response-timeout', 'timeout'),
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const harness = cases[index];
    const result = await harness.transport.fetchHop('https://public.site/', validOptions());
    assert.deepEqual(result, results[index]);
    assert.equal(harness.rawSocket().destroyed, true);
    assert.equal(harness.rawSocket().listenerCount('connect'), 0);
    if (harness.tlsSocket()) {
      assert.equal(harness.tlsSocket().listenerCount('secureConnect'), 0);
      assert.equal(harness.tlsSocket().listenerCount('data'), 0);
      assert.equal(harness.tlsSocket().listenerCount('end'), 0);
    }
  }
});

test('fetchHop completes on close-only sockets and ignores late TLS/response events', async () => {
  const connectClose = createHarness({ connectEvent: false });
  const connectPending = connectClose.transport.fetchHop('https://public.site/', validOptions());
  await new Promise((resolve) => setImmediate(resolve));
  connectClose.rawSocket().emit('close');
  assert.deepEqual(await connectPending, resultError('connect-closed'));

  const responseClose = createHarness({ responseEvent: false });
  const responsePending = responseClose.transport.fetchHop('https://public.site/', validOptions());
  await new Promise((resolve) => setImmediate(resolve));
  responseClose.tlsSocket().emit('close');
  assert.deepEqual(await responsePending, resultError('response-closed'));
  responseClose.tlsSocket().emit('data', response(200, { 'content-type': 'text/html' }));
  responseClose.tlsSocket().emit('end');
  assert.equal(responseClose.tlsSocket().listenerCount('data'), 0);
});

test('fetchHop suppresses late TLS and socket errors after the result has settled', async () => {
  const harness = createHarness();
  assert.equal((await harness.transport.fetchHop('https://public.site/', validOptions())).ok, true);
  assert.doesNotThrow(() => harness.rawSocket().emit('error', new Error('late raw error')));
  assert.doesNotThrow(() => harness.tlsSocket().emit('error', new Error('late tls error')));
  harness.rawSocket().emit('close');
  harness.tlsSocket().emit('close');
  assert.equal(harness.rawSocket().listenerCount('error'), 0);
  assert.equal(harness.tlsSocket().listenerCount('error'), 0);
});

test('fetchHop rejects malformed request options and never exposes the legacy APIs', async () => {
  const harness = createHarness();
  assert.deepEqual(await harness.transport.fetchHop('https://public.site/', {}), resultError('invalid-request'));
  assert.equal(Object.hasOwn(harness.transport, 'resolvePublic'), false);
  assert.equal(Object.hasOwn(harness.transport, 'fetch'), false);
});
