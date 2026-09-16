const test = require('node:test');
const assert = require('node:assert/strict');

const { createHttpResponseDecoder } = require('../src/browser-search/http-response');

const HEADER_LIMIT = 32_768;
const FIELD_LIMIT = 100;
const LOCATION_LIMIT = 8_192;
const BODY_LIMIT = 1_000_000;
const WIRE_LIMIT = 1_100_000;

function response(status = 200, headers = [], body = '') {
  const reason = {
    200: 'OK',
    301: 'Moved Permanently',
    302: 'Found',
    401: 'Unauthorized',
    407: 'Proxy Authentication Required',
    304: 'Not Modified',
  }[status] || 'Status';
  return Buffer.from([
    `HTTP/1.1 ${status} ${reason}`,
    ...headers.map(([name, value]) => `${name}: ${value}`),
    '',
    body,
  ].join('\r\n'));
}

function decode(chunks, { finish = true, requestUrl = 'https://public.example/page' } = {}) {
  const decoder = createHttpResponseDecoder({ requestUrl });
  let result = null;
  for (const chunk of chunks) {
    result = decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (typeof result === 'string' || result?.kind) break;
  }
  if (result === null && finish) result = decoder.finish();
  return result;
}

function bodyResponse(size, headers = [['Content-Type', 'text/plain'], ['Content-Length', String(size)]]) {
  return response(200, headers, Buffer.alloc(size, 0x61));
}

test('增量 decoder 處理 header split、Content-Length 與合法 connection-close body', () => {
  const contentLength = response(200, [
    ['Content-Type', 'text/plain; charset=utf-8'],
    ['Content-Length', '5'],
  ], 'hello');
  const decoder = createHttpResponseDecoder({ requestUrl: 'https://public.example/cl' });

  assert.equal(decoder.push(contentLength.subarray(0, 17)), null);
  assert.deepEqual(decoder.push(contentLength.subarray(17)), {
    kind: 'body',
    status: 200,
    mediaType: 'text/plain',
    charset: 'utf-8',
    bodyBytes: Buffer.from('hello'),
  });

  assert.deepEqual(decode([
    response(200, [['Content-Type', 'text/plain']], 'close body'),
  ]), {
    kind: 'body',
    status: 200,
    mediaType: 'text/plain',
    charset: null,
    bodyBytes: Buffer.from('close body'),
  });
});

test('decoder 在完整 header 後立即分類 redirect 並只交出 bounded Location', () => {
  const decoder = createHttpResponseDecoder({ requestUrl: 'https://public.example/start' });
  const header = response(302, [
    ['Location', 'https://elsewhere.example/next'],
    ['Set-Cookie', 'secret=must-not-escape'],
  ]);

  assert.deepEqual(decoder.push(header), {
    kind: 'redirect',
    status: 302,
    location: 'https://elsewhere.example/next',
  });
});

test('decoder 接受無 extension、空 trailer 的 chunked framing', () => {
  const wire = response(200, [
    ['Content-Type', 'text/html; charset=utf8'],
    ['Transfer-Encoding', 'chunked'],
  ], '4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n');

  assert.deepEqual(decode([wire.subarray(0, 80), wire.subarray(80)]), {
    kind: 'body',
    status: 200,
    mediaType: 'text/html',
    charset: 'utf-8',
    bodyBytes: Buffer.from('Wikipedia'),
  });
});

test('decoder 拒絕不明確 framing 與 security-sensitive duplicate headers', () => {
  const cases = [
    [response(200, [['Content-Type', 'text/plain'], ['Content-Length', '1'], ['Transfer-Encoding', 'chunked']], 'a'), 'response-framing'],
    [response(200, [['Content-Type', 'text/plain'], ['Content-Type', 'text/html']], 'a'), 'response-invalid'],
    [response(200, [['Content-Type', 'text/plain'], ['Content-Length', '1'], ['Content-Length', '1']], 'a'), 'response-invalid'],
    [response(200, [['Content-Type', 'text/plain'], ['Transfer-Encoding', 'chunked'], ['Transfer-Encoding', 'chunked']], '0\r\n\r\n'), 'response-invalid'],
  ];
  for (const [wire, expected] of cases) assert.equal(decode([wire]), expected);
});

test('decoder 不以 trim 吞掉垂直 tab 或未允許的 parameter whitespace', () => {
  const cases = [
    [Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain; foo=token\x0b\r\nContent-Length: 1\r\n\r\nx'), 'response-invalid'],
    [Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\x0b\r\n\r\nx'), 'response-invalid'],
    [Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\x0b\r\n\r\n0\r\n\r\n'), 'response-invalid'],
    [response(200, [['Content-Type', 'text/plain; foo= token'], ['Content-Length', '1']], 'x'), 'response-content-type'],
  ];
  for (const [wire, expected] of cases) assert.equal(decode([wire]), expected);
});

test('redirect 先完成 framing validation 才分類 bounded Location', () => {
  const wire = response(302, [
    ['Location', 'https://elsewhere.example/next'],
    ['Content-Length', '0'],
    ['Transfer-Encoding', 'chunked'],
  ]);

  assert.equal(decode([wire]), 'response-framing');
});

test('decoder 拒絕 invalid token、NUL、obs-fold 與過多 header fields', () => {
  const cases = [
    [response(200, [['Bad Header', 'x'], ['Content-Type', 'text/plain']], 'x'), 'response-invalid'],
    [Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nX-Test: a\0b\r\n\r\n'), 'response-invalid'],
    [Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n bad-fold\r\n\r\nx'), 'response-invalid'],
    [response(200, [
      ...Array.from({ length: FIELD_LIMIT + 1 }, (_, index) => [`X-${index}`, 'x']),
      ['Content-Type', 'text/plain'],
    ], 'x'), 'response-header-too-large'],
  ];
  for (const [wire, expected] of cases) assert.equal(decode([wire]), expected);
});

test('header bytes 採用 limit-1/limit/limit+1 並在超限時增量拒絕', () => {
  function withHeaderBytes(target) {
    const prefix = Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nX-Pad: ');
    const suffix = Buffer.from('\r\n\r\n');
    return Buffer.concat([prefix, Buffer.alloc(Math.max(0, target - prefix.length - suffix.length), 0x61), suffix]);
  }

  assert.equal(decode([withHeaderBytes(HEADER_LIMIT - 1)]).kind, 'body');
  assert.equal(decode([withHeaderBytes(HEADER_LIMIT)]).kind, 'body');
  assert.equal(decode([withHeaderBytes(HEADER_LIMIT + 1)]), 'response-header-too-large');
});

test('header field count 採用 limit-1/limit/limit+1', () => {
  function withFieldCount(count) {
    const headers = [
      ...Array.from({ length: count - 1 }, (_, index) => [`X-${index}`, 'x']),
      ['Content-Type', 'text/plain'],
    ];
    return response(200, headers, '');
  }

  assert.notEqual(decode([withFieldCount(FIELD_LIMIT - 1)]), 'response-header-too-large');
  assert.notEqual(decode([withFieldCount(FIELD_LIMIT)]), 'response-header-too-large');
  assert.equal(decode([withFieldCount(FIELD_LIMIT + 1)]), 'response-header-too-large');
});

test('redirect Location 採用 limit-1/limit/limit+1 bytes', () => {
  function redirectWithLocationLength(length) {
    return response(302, [['Location', 'a'.repeat(length)]], 'ignored');
  }

  assert.equal(decode([redirectWithLocationLength(LOCATION_LIMIT - 1)]).kind, 'redirect');
  assert.equal(decode([redirectWithLocationLength(LOCATION_LIMIT)]).kind, 'redirect');
  assert.equal(decode([redirectWithLocationLength(LOCATION_LIMIT + 1)]), 'response-header-too-large');
});

test('decoded body 採用 limit-1/limit/limit+1，且只回傳完整 bytes', () => {
  const below = decode([bodyResponse(BODY_LIMIT - 1)]);
  const at = decode([bodyResponse(BODY_LIMIT)]);
  const above = decode([bodyResponse(BODY_LIMIT + 1)]);

  assert.equal(below.kind, 'body');
  assert.equal(below.bodyBytes.length, BODY_LIMIT - 1);
  assert.equal(at.kind, 'body');
  assert.equal(at.bodyBytes.length, BODY_LIMIT);
  assert.equal(above, 'response-too-large');
});

test('wire body 採用 limit-1/limit/limit+1，即使 decoded body 尚未超限也有界', () => {
  function chunkedWire(target) {
    const oneByteChunks = Buffer.from('1\r\nx\r\n');
    const count = 183_000;
    const largeChunkSize = target - (count * oneByteChunks.length) - 12;
    return Buffer.concat([
      ...Array.from({ length: count }, () => oneByteChunks),
      Buffer.from(`${largeChunkSize.toString(16)}\r\n`),
      Buffer.alloc(largeChunkSize, 0x78),
      Buffer.from('\r\n0\r\n\r\n'),
    ]);
  }

  for (const target of [WIRE_LIMIT - 1, WIRE_LIMIT]) {
    const result = decode([response(200, [
      ['Content-Type', 'text/plain'],
      ['Transfer-Encoding', 'chunked'],
    ], chunkedWire(target).toString())]);
    assert.equal(result.kind, 'body');
    assert.equal(result.bodyBytes.length < BODY_LIMIT, true);
  }
  assert.equal(decode([response(200, [
    ['Content-Type', 'text/plain'],
    ['Transfer-Encoding', 'chunked'],
  ], chunkedWire(WIRE_LIMIT + 1).toString())]), 'response-too-large');
});

test('decoder 拒絕 invalid chunk size、extension、non-empty trailer 與 partial body', () => {
  const cases = [
    [response(200, [['Content-Type', 'text/plain'], ['Transfer-Encoding', 'chunked']], 'Z\r\nx\r\n0\r\n\r\n'), 'response-framing'],
    [response(200, [['Content-Type', 'text/plain'], ['Transfer-Encoding', 'chunked']], '1;secret=x\r\nx\r\n0\r\n\r\n'), 'response-framing'],
    [response(200, [['Content-Type', 'text/plain'], ['Transfer-Encoding', 'chunked']], '0\r\nX-Trailer: secret\r\n\r\n'), 'response-framing'],
    [response(200, [['Content-Type', 'text/plain'], ['Content-Length', '5']], 'abc'), 'response-closed'],
  ];
  for (const [wire, expected] of cases) assert.equal(decode([wire]), expected);
});

test('decoder 拒絕 1xx/304/401/407 與 unsupported response semantics', () => {
  const cases = [
    [response(100, []), 'response-invalid'],
    [response(304, [['Content-Type', 'text/plain']]), 'response-status'],
    [response(401, [['Content-Type', 'text/plain']]), 'response-auth-required'],
    [response(407, [['Content-Type', 'text/plain']]), 'response-auth-required'],
    [response(200, [['Content-Type', 'text/plain'], ['Content-Disposition', 'attachment; filename=x']], 'x'), 'response-attachment'],
    [response(200, [['Content-Type', 'application/json']], 'x'), 'response-content-type'],
    [response(200, [['Content-Type', 'text/plain'], ['Content-Encoding', 'gzip']], 'x'), 'response-content-encoding'],
    [response(200, [['Content-Type', 'text/plain; charset=latin1']], 'x'), 'response-charset'],
  ];
  for (const [wire, expected] of cases) assert.equal(decode([wire]), expected);
});

test('decoder 以 fatal decoding 拒絕 invalid UTF-8、us-ascii 非 ASCII 與 partial body', () => {
  const utf8 = Buffer.concat([
    Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 2\r\n\r\n'),
    Buffer.from([0xc3, 0x28]),
  ]);
  const ascii = Buffer.concat([
    Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=us-ascii\r\nContent-Length: 1\r\n\r\n'),
    Buffer.from([0xff]),
  ]);

  assert.equal(decode([utf8]), 'response-charset');
  assert.equal(decode([ascii]), 'response-charset');
});

test('Content-Type 參數值只接受 token 或合法 quoted-string', () => {
  for (const parameter of [
    'foo=token',
    'foo="quoted value; still one value"',
    'foo="escaped \\"quote\\""',
  ]) {
    const result = decode([response(200, [
      ['Content-Type', `text/plain; ${parameter}`],
      ['Content-Length', '1'],
    ], 'x')]);
    assert.equal(result.kind, 'body', parameter);
  }

  for (const parameter of [
    'foo=unquoted value',
    'foo=unquoted\tvalue',
    'foo="unterminated',
    'foo="bad\\',
  ]) {
    const result = decode([response(200, [
      ['Content-Type', `text/plain; ${parameter}`],
      ['Content-Length', '1'],
    ], 'x')]);
    assert.equal(result, 'response-content-type', parameter);
  }
});

test('chunked decoder 在逐 byte header、size、data、CRLF 與終止 framing 下每次均等待或前進', () => {
  const wire = response(200, [
    ['Content-Type', 'text/plain'],
    ['Transfer-Encoding', 'chunked'],
  ], '3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n');
  const decoder = createHttpResponseDecoder({ requestUrl: 'https://public.example/bytewise' });
  let result = null;
  let waitingPushes = 0;

  for (const byte of wire) {
    result = decoder.push(Buffer.from([byte]));
    if (result === null) waitingPushes += 1;
    else break;
  }

  assert.equal(waitingPushes > 0, true);
  assert.deepEqual(result, {
    kind: 'body',
    status: 200,
    mediaType: 'text/plain',
    charset: null,
    bodyBytes: Buffer.from('abcde'),
  });
});

test('Content-Length 的 header/body boundary 逐 byte 分割時不回傳 partial body', () => {
  const wire = response(200, [
    ['Content-Type', 'text/plain'],
    ['Content-Length', '5'],
  ], 'hello');
  const decoder = createHttpResponseDecoder({ requestUrl: 'https://public.example/bytewise-cl' });
  let result = null;

  for (const byte of wire) {
    result = decoder.push(Buffer.from([byte]));
    if (result !== null) break;
    assert.equal(result, null);
  }

  assert.deepEqual(result, {
    kind: 'body',
    status: 200,
    mediaType: 'text/plain',
    charset: null,
    bodyBytes: Buffer.from('hello'),
  });
});

test('decoder 不輸出 headers、Set-Cookie、partial body 或 trailing second response', () => {
  const first = response(200, [
    ['Content-Type', 'text/plain'],
    ['Set-Cookie', 'session=secret'],
    ['X-Ignored', 'private'],
    ['Content-Length', '1'],
  ], 'a');
  const second = response(200, [['Content-Type', 'text/plain'], ['Content-Length', '1']], 'b');
  const result = decode([Buffer.concat([first, second])]);

  assert.equal(result, 'response-invalid');
  assert.equal(Object.prototype.hasOwnProperty.call(result || {}, 'headers'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result || {}, 'body'), false);
});

test('完成 body 後收到 trailing response 時轉為 terminal failure', () => {
  const first = response(200, [['Content-Type', 'text/plain'], ['Content-Length', '1']], 'a');
  const second = response(200, [['Content-Type', 'text/plain'], ['Content-Length', '1']], 'b');
  const decoder = createHttpResponseDecoder({ requestUrl: 'https://public.example/trailing-body' });

  assert.deepEqual(decoder.push(first), {
    kind: 'body',
    status: 200,
    mediaType: 'text/plain',
    charset: null,
    bodyBytes: Buffer.from('a'),
  });
  assert.equal(decoder.push(second), 'response-framing');
  assert.equal(decoder.finish(), 'response-framing');
});

test('完成 redirect 後收到 trailing response 時轉為 terminal failure', () => {
  const first = response(302, [['Location', 'https://elsewhere.example/next']]);
  const second = response(200, [['Content-Type', 'text/plain'], ['Content-Length', '1']], 'b');
  const decoder = createHttpResponseDecoder({ requestUrl: 'https://public.example/trailing-redirect' });

  assert.deepEqual(decoder.push(first), {
    kind: 'redirect',
    status: 302,
    location: 'https://elsewhere.example/next',
  });
  assert.equal(decoder.push(second), 'response-framing');
  assert.equal(decoder.finish(), 'response-framing');
});

test('body 完成後即使 response deadline 已過，late bytes 仍固定為 response-framing', () => {
  let now = 0;
  const first = response(200, [['Content-Type', 'text/plain'], ['Content-Length', '1']], 'a');
  const second = response(200, [['Content-Type', 'text/plain'], ['Content-Length', '1']], 'b');
  const decoder = createHttpResponseDecoder({ requestUrl: 'https://public.example/late-body', clock: () => now });

  assert.equal(decoder.push(first).kind, 'body');
  now = 10_001;
  assert.equal(decoder.push(second), 'response-framing');
  assert.equal(decoder.finish(), 'response-framing');
});

test('redirect 完成後即使 response deadline 已過，late bytes 仍固定為 response-framing', () => {
  let now = 0;
  const first = response(302, [['Location', 'https://elsewhere.example/next']]);
  const second = response(200, [['Content-Type', 'text/plain'], ['Content-Length', '1']], 'b');
  const decoder = createHttpResponseDecoder({ requestUrl: 'https://public.example/late-redirect', clock: () => now });

  assert.equal(decoder.push(first).kind, 'redirect');
  now = 10_001;
  assert.equal(decoder.push(second), 'response-framing');
  assert.equal(decoder.finish(), 'response-framing');
});
