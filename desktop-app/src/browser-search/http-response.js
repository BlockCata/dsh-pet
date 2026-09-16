const HEADER_LIMIT = 32_768;
const FIELD_LIMIT = 100;
const LOCATION_LIMIT = 8_192;
const BODY_LIMIT = 1_000_000;
const WIRE_LIMIT = 1_100_000;

const SECURITY_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'content-type',
  'content-encoding',
  'content-disposition',
  'location',
]);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const SAFE_MEDIA_TYPES = new Set(['text/html', 'text/plain']);
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function createHttpResponseDecoder({ requestUrl, clock = Date.now } = {}) {
  let input = Buffer.alloc(0);
  let headerParsed = false;
  let framing = null;
  let expectedBodyBytes = null;
  let chunkRemaining = 0;
  let chunkState = 'size';
  let bodyParts = [];
  let bodyLength = 0;
  let wireBodyLength = 0;
  let status = null;
  let mediaType = null;
  let charset = null;
  let terminal = null;
  let failed = null;
  let startedAt = null;

  function fail(code) {
    if (!failed) failed = code;
    return failed;
  }

  function appendBody(bytes) {
    if (bytes.length === 0) return null;
    bodyLength += bytes.length;
    if (bodyLength > BODY_LIMIT) return fail('response-too-large');
    bodyParts.push(bytes);
    return null;
  }

  function consume(length) {
    const bytes = input.subarray(0, length);
    input = input.subarray(length);
    wireBodyLength += length;
    if (wireBodyLength > WIRE_LIMIT) {
      fail('response-too-large');
      return null;
    }
    return bytes;
  }

  function checkDeadline() {
    if (startedAt === null) return null;
    const elapsed = clock() - startedAt;
    if (elapsed > 10_000) return fail('response-timeout');
    if (!headerParsed && elapsed > 5_000) return fail('response-timeout');
    return null;
  }

  function checkInputWireLimit() {
    if (wireBodyLength + input.length > WIRE_LIMIT) return fail('response-too-large');
    return null;
  }

  function validHeaderControls(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 0 || code === 127 || (code < 32 && code !== 9)) return false;
    }
    return true;
  }

  function stripOws(value) {
    let start = 0;
    let end = value.length;
    while (start < end && (value[start] === ' ' || value[start] === '\t')) start += 1;
    while (end > start && (value[end - 1] === ' ' || value[end - 1] === '\t')) end -= 1;
    return value.slice(start, end);
  }

  function splitContentTypeParameters(value) {
    const parts = [];
    let start = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (quoted) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          quoted = false;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ';') {
        parts.push(value.slice(start, index));
        start = index + 1;
      }
    }
    if (quoted || escaped) return null;
    parts.push(value.slice(start));
    return parts;
  }

  function parseParameterValue(value) {
    if (TOKEN.test(value)) return value;
    if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') return null;

    let result = '';
    for (let index = 1; index < value.length - 1; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 92) {
        index += 1;
        if (index >= value.length - 1) return null;
        const escapedCode = value.charCodeAt(index);
        if (escapedCode === 0 || escapedCode === 127 || (escapedCode < 32 && escapedCode !== 9)) return null;
        result += value[index];
        continue;
      }
      if (code === 0 || code === 34 || code === 127 || (code < 32 && code !== 9)) return null;
      result += value[index];
    }
    return result;
  }

  function parseCharset(value) {
    const parts = splitContentTypeParameters(value);
    if (!parts) return { error: 'response-content-type' };
    const type = stripOws(parts.shift()).toLowerCase();
    if (!SAFE_MEDIA_TYPES.has(type)) return { error: 'response-content-type' };

    let declared = null;
    for (let parameter of parts) {
      parameter = stripOws(parameter);
      if (!parameter) return { error: 'response-content-type' };
      const delimiter = parameter.indexOf('=');
      if (delimiter < 1 || parameter.indexOf('=', delimiter + 1) !== -1) return { error: 'response-content-type' };
      const name = parameter.slice(0, delimiter).toLowerCase();
      const rawParameterValue = parameter.slice(delimiter + 1);
      if (!TOKEN.test(name)) return { error: 'response-content-type' };
      const parameterValue = parseParameterValue(rawParameterValue);
      if (parameterValue === null) return { error: 'response-content-type' };
      if (name !== 'charset') continue;
      if (declared !== null) return { error: 'response-charset' };
      declared = parameterValue.toLowerCase();
    }

    if (declared === null) return { mediaType: type, charset: null };
    if (declared === 'utf-8' || declared === 'utf8') return { mediaType: type, charset: 'utf-8' };
    if (declared === 'us-ascii') return { mediaType: type, charset: 'us-ascii' };
    return { error: 'response-charset' };
  }

  function parseHeaders(headerBytes) {
    const headerText = headerBytes.toString('latin1');
    for (let index = 0; index < headerText.length; index += 1) {
      const code = headerText.charCodeAt(index);
      if (code === 13 && headerText[index + 1] !== '\n') return 'response-invalid';
      if (code === 10 && headerText[index - 1] !== '\r') return 'response-invalid';
    }

    const lines = headerText.slice(0, -4).split('\r\n');
    const statusLine = lines.shift();
    if (!/^HTTP\/1\.[01] \d{3}(?: [\x20-\x7e]*)?$/.test(statusLine || '')) return 'response-invalid';
    status = Number(statusLine.slice(9, 12));
    if (status < 200 || status >= 300) {
      if (status >= 100 && status < 200) return 'response-invalid';
      if (status === 401 || status === 407) return 'response-auth-required';
      if (status === 304) return 'response-status';
      if (!REDIRECT_STATUS_CODES.has(status)) return 'response-status';
    }

    if (lines.length > FIELD_LIMIT) return 'response-header-too-large';
    const headers = new Map();
    for (const line of lines) {
      if (!line || line[0] === ' ' || line[0] === '\t') return 'response-invalid';
      const delimiter = line.indexOf(':');
      if (delimiter < 1) return 'response-invalid';
      const name = line.slice(0, delimiter);
      const rawValue = line.slice(delimiter + 1);
      if (!TOKEN.test(name) || !validHeaderControls(rawValue)) return 'response-invalid';
      const value = stripOws(rawValue);
      const normalized = name.toLowerCase();
      if (SECURITY_HEADERS.has(normalized) && headers.has(normalized)) return 'response-invalid';
      if (!headers.has(normalized)) headers.set(normalized, value);
    }

    const contentLength = headers.get('content-length');
    const transferEncoding = headers.get('transfer-encoding');
    if (contentLength !== undefined && transferEncoding !== undefined) return 'response-framing';
    if (contentLength !== undefined && !/^\d+$/.test(contentLength)) return 'response-framing';
    const parsedContentLength = contentLength === undefined ? null : Number(contentLength);
    if (contentLength !== undefined && !Number.isSafeInteger(parsedContentLength)) return 'response-framing';
    if (contentLength !== undefined && parsedContentLength > BODY_LIMIT) return 'response-too-large';
    if (transferEncoding !== undefined && transferEncoding.toLowerCase() !== 'chunked') return 'response-framing';

    if (REDIRECT_STATUS_CODES.has(status)) {
      const location = headers.get('location');
      if (!location || Buffer.byteLength(location, 'latin1') > LOCATION_LIMIT) return 'response-header-too-large';
      terminal = { kind: 'redirect', status, location };
      return terminal;
    }

    const contentType = headers.get('content-type');
    if (contentType === undefined) return 'response-content-type';
    const parsedType = parseCharset(contentType);
    if (parsedType.error) return parsedType.error;
    mediaType = parsedType.mediaType;
    charset = parsedType.charset;
    if (/\battachment\b/i.test(headers.get('content-disposition') || '')) return 'response-attachment';
    const encoding = headers.get('content-encoding');
    if (encoding !== undefined && encoding.toLowerCase() !== 'identity') return 'response-content-encoding';

    if (contentLength !== undefined) {
      framing = 'content-length';
      expectedBodyBytes = parsedContentLength;
    } else if (transferEncoding !== undefined) {
      framing = 'chunked';
    } else {
      framing = 'connection-close';
    }
    headerParsed = true;
    return null;
  }

  function validateBody(bytes) {
    try {
      if (charset === 'us-ascii') {
        for (const byte of bytes) if (byte > 0x7f) return fail('response-charset');
      } else {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
    } catch {
      return fail('response-charset');
    }
    return null;
  }

  function bodyOutcome() {
    const bodyBytes = Buffer.concat(bodyParts, bodyLength);
    const validation = validateBody(bodyBytes);
    if (validation) return validation;
    terminal = {
      kind: 'body',
      status,
      mediaType,
      charset,
      bodyBytes,
    };
    return terminal;
  }

  function processContentLength() {
    const remaining = expectedBodyBytes - bodyLength;
    if (input.length < remaining) {
      const bytes = consume(input.length);
      if (bytes === null) return failed;
      return appendBody(bytes);
    }
    const bytes = consume(remaining);
    if (bytes === null) return failed;
    if (appendBody(bytes)) return failed;
    if (input.length !== 0) return fail('response-invalid');
    return bodyOutcome();
  }

  function processConnectionClose() {
    const bytes = consume(input.length);
    if (bytes === null) return failed;
    if (appendBody(bytes)) return failed;
    return null;
  }

  function processChunked() {
    while (true) {
      if (chunkState === 'size') {
        const lineEnd = input.indexOf('\r\n');
        if (lineEnd < 0) return checkInputWireLimit();
        const line = consume(lineEnd + 2);
        if (line === null) return failed;
        const sizeLine = line.subarray(0, line.length - 2).toString('latin1');
        if (!/^[0-9A-Fa-f]+$/.test(sizeLine)) return fail('response-framing');
        const size = Number.parseInt(sizeLine, 16);
        if (!Number.isSafeInteger(size)) return fail('response-framing');
        if (size > BODY_LIMIT - bodyLength) return fail('response-too-large');
        chunkRemaining = size;
        chunkState = size === 0 ? 'trailers' : 'data';
      }

      if (chunkState === 'data') {
        if (input.length === 0) return null;
        const take = Math.min(input.length, chunkRemaining);
        const bytes = consume(take);
        if (bytes === null) return failed;
        if (appendBody(bytes)) return failed;
        chunkRemaining -= take;
        if (chunkRemaining !== 0) return null;
        chunkState = 'data-crlf';
      }

      if (chunkState === 'data-crlf') {
        if (input.length < 2) return checkInputWireLimit();
        if (input[0] !== 13 || input[1] !== 10) return fail('response-framing');
        if (consume(2) === null) return failed;
        chunkState = 'size';
      }

      if (chunkState === 'trailers') {
        if (input.length < 2) return checkInputWireLimit();
        if (input[0] !== 13 || input[1] !== 10) return fail('response-framing');
        if (consume(2) === null) return failed;
        if (input.length !== 0) return fail('response-invalid');
        return bodyOutcome();
      }
    }
  }

  function push(chunk) {
    if (failed) return failed;
    if (!Buffer.isBuffer(chunk)) return fail('response-invalid');
    if (terminal) return chunk.length === 0 ? null : fail('response-framing');
    if (startedAt === null) startedAt = clock();
    if (checkDeadline()) return failed;
    if (chunk.length === 0) return null;
    input = Buffer.concat([input, chunk]);

    if (!headerParsed) {
      const headerEnd = input.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        if (input.length > HEADER_LIMIT) return fail('response-header-too-large');
        return null;
      }
      const headerBytesLength = headerEnd + 4;
      if (headerBytesLength > HEADER_LIMIT) return fail('response-header-too-large');
      const headerBytes = input.subarray(0, headerBytesLength);
      input = input.subarray(headerBytesLength);
      const parsed = parseHeaders(headerBytes);
      if (typeof parsed === 'string') return fail(parsed);
      if (parsed?.kind === 'redirect') return parsed;
    }

    if (checkInputWireLimit()) return failed;
    if (framing === 'content-length') return processContentLength();
    if (framing === 'chunked') return processChunked();
    return processConnectionClose();
  }

  function finish() {
    if (failed) return failed;
    if (terminal) return terminal;
    if (checkDeadline()) return failed;
    if (!headerParsed) return fail('response-closed');
    if (framing !== 'connection-close') return fail('response-closed');
    return bodyOutcome();
  }

  return { push, finish };
}

module.exports = { createHttpResponseDecoder };
