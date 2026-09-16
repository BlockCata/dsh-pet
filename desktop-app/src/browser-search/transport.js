'use strict';

const net = require('node:net');
const tls = require('node:tls');
const {
  assertAllowedPublicEndpoints,
  canonicalAddress,
  canonicalizePublicHttpsUrl,
} = require('./policy');
const { createSystemResolverFactory } = require('./resolver');
const { createHttpResponseDecoder } = require('./http-response');

const DNS_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;
const TLS_TIMEOUT_MS = 5_000;
const HEADER_TIMEOUT_MS = 5_000;
const RESPONSE_TIMEOUT_MS = 10_000;
const HOP_TIMEOUT_MS = 20_000;
const HEADER_LIMIT = 32_768;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FINGERPRINT256 = /^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i;
const PURPOSES = new Set(['search', 'page', 'robots']);

function normalizeFamily(value) {
  if (value === 4 || value === 'IPv4') return 4;
  if (value === 6 || value === 'IPv6') return 6;
  return 0;
}

function isClientCertificateError(error) {
  return error?.code === 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED'
    || /client certificate|certificate required/i.test(String(error?.message || ''));
}

function resultFor(code) {
  const status = code === 'request-aborted'
    ? 'cancelled'
    : code.endsWith('-timeout')
      ? 'timeout'
      : code === 'response-auth-required' || code === 'tls-client-certificate-required'
        ? 'needs-user'
        : 'blocked';
  return { ok: false, status, code };
}

function codeFor(error, fallback) {
  if (typeof error === 'string') return error;
  return error?.code || fallback;
}

function emit(sink, requestId, hopIndex, sequence, phase, fields = {}) {
  if (typeof sink !== 'function') return sequence;
  const event = { requestId, hopIndex, seq: sequence, phase };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) event[key] = value;
  }
  try {
    sink(event);
  } catch {
    // Evidence collection is best effort and cannot change the result.
  }
  return sequence + 1;
}

function invalidDns() {
  return Object.assign(new Error(), { code: 'dns-invalid' });
}

function validateSnapshot(snapshot, hostname) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.hostname !== hostname) throw invalidDns();
  const answers = [];
  for (const [name, family] of [['a', 4], ['aaaa', 6]]) {
    const familyResult = snapshot[name];
    if (!familyResult || !['ok', 'nodata'].includes(familyResult.status) || !Array.isArray(familyResult.answers)) throw invalidDns();
    if (familyResult.status === 'nodata' && familyResult.answers.length !== 0) throw invalidDns();
    for (const answer of familyResult.answers) {
      if (!answer || typeof answer !== 'object' || answer.family !== family) throw invalidDns();
      answers.push(answer);
    }
  }
  if (answers.length > 32) throw Object.assign(new Error(), { code: 'dns-too-many-answers' });
  const endpoints = assertAllowedPublicEndpoints(answers);
  if (!endpoints.length) throw Object.assign(new Error(), { code: 'dns-failed' });
  return endpoints;
}

function createPinnedHttpsTransport({
  resolverFactory = createSystemResolverFactory(),
  connect = net.connect,
  tlsConnect = tls.connect,
  clock = Date.now,
  evidenceSink,
} = {}) {
  const resolveSnapshot = typeof resolverFactory?.resolve === 'function'
    ? resolverFactory.resolve.bind(resolverFactory)
    : resolverFactory;

  async function fetchHop(value, options = {}) {
    const { requestId, hopIndex, purpose, signal } = options || {};
    if (!REQUEST_ID.test(requestId || '') || !Number.isInteger(hopIndex) || hopIndex < 0 || hopIndex > 5 || !PURPOSES.has(purpose)) return resultFor('invalid-request');
    if (signal && typeof signal.addEventListener !== 'function') return resultFor('invalid-request');

    let request;
    try {
      request = canonicalizePublicHttpsUrl(value);
    } catch (error) {
      return resultFor(codeFor(error, 'url-invalid'));
    }
    if (signal?.aborted) return resultFor('request-aborted');

    return new Promise((resolve) => {
      let settled = false;
      let phase = 'dns';
      let sequence = 1;
      let rawSocket;
      let secureSocket;
      let phaseTimer;
      let headerTimer;
      let responseTimer;
      let hopTimer;
      let headerProbe = Buffer.alloc(0);
      const waiters = new Set();
      const cleanups = [];
      const controller = new AbortController();

      const cancelTimer = (timer) => {
        if (typeof timer === 'function') timer();
        else if (timer) clearTimeout(timer);
      };
      const armTimer = (duration, callback) => {
        const deadline = clock() + duration;
        let timer;
        const check = () => {
          if (settled) return;
          const remaining = deadline - clock();
          if (remaining <= 0) {
            callback();
            return;
          }
          timer = setTimeout(check, Math.min(remaining, 250));
        };
        timer = setTimeout(check, 0);
        return () => clearTimeout(timer);
      };
      const destroySocket = (socket) => {
        if (!socket || socket.destroyed || typeof socket.destroy !== 'function') return;
        const ignoreLateError = () => {};
        const removeLateError = () => {
          socket.removeListener('error', ignoreLateError);
          socket.removeListener('close', removeLateError);
        };
        socket.on('error', ignoreLateError);
        socket.once('close', removeLateError);
        socket.destroy();
      };
      const removeAll = () => {
        cancelTimer(phaseTimer);
        cancelTimer(headerTimer);
        cancelTimer(responseTimer);
        cancelTimer(hopTimer);
        for (const remove of cleanups.splice(0)) remove();
        destroySocket(rawSocket);
        destroySocket(secureSocket);
        controller.abort();
      };
      const settle = (result) => {
        if (settled) return;
        settled = true;
        removeAll();
        for (const wake of [...waiters]) wake();
        resolve(result);
      };
      const fail = (code) => settle(resultFor(code));
      const record = (phaseName, fields) => {
        sequence = emit(evidenceSink, requestId, hopIndex, sequence, phaseName, fields);
      };
      const timeoutCode = () => phase === 'dns'
        ? 'dns-timeout'
        : phase === 'connect'
          ? 'connect-timeout'
          : phase === 'tls'
            ? 'tls-timeout'
            : 'response-timeout';
      const startPhase = (nextPhase, duration, timeout) => {
        phase = nextPhase;
        cancelTimer(phaseTimer);
        phaseTimer = armTimer(duration, () => fail(timeout));
      };
      const addListener = (socket, event, listener, once = false) => {
        socket[once ? 'once' : 'on'](event, listener);
        cleanups.push(() => socket.removeListener(event, listener));
      };
      const waitForSocket = (socket, successEvent, onSuccess, closeCode, errorCode) => new Promise((resolveStage) => {
        let done = false;
        let wake;
        const stageCleanups = [];
        const removeStageListeners = () => {
          for (const remove of stageCleanups.splice(0)) remove();
          waiters.delete(wake);
        };
        const complete = (value) => {
          if (done) return;
          done = true;
          removeStageListeners();
          resolveStage(value);
        };
        wake = () => complete(false);
        waiters.add(wake);
        const addStageListener = (event, listener) => {
          socket.once(event, listener);
          stageCleanups.push(() => socket.removeListener(event, listener));
        };
        addStageListener(successEvent, () => complete(onSuccess()));
        addStageListener('error', (error) => {
          const code = typeof errorCode === 'function' ? errorCode(error) : errorCode;
          fail(code);
          complete(false);
        });
        addStageListener('close', () => {
          fail(closeCode);
          complete(false);
        });
      });

      const onAbort = () => fail('request-aborted');
      signal?.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => signal?.removeEventListener('abort', onAbort));
      hopTimer = armTimer(HOP_TIMEOUT_MS, () => fail(timeoutCode()));

      (async () => {
        try {
          record('url-policy-accepted');
          record('dns-start');
          startPhase('dns', DNS_TIMEOUT_MS, 'dns-timeout');
          const snapshotResult = await resolveSnapshot(request.hostname, { signal: controller.signal });
          if (settled) return;
          cancelTimer(phaseTimer);
          const endpoints = validateSnapshot(snapshotResult, request.hostname);
          record('dns-complete');
          record('all-addresses-public');
          const selected = endpoints[0];
          record('address-selected', { address: selected.address, family: selected.family, port: 443 });

          startPhase('connect', CONNECT_TIMEOUT_MS, 'connect-timeout');
          try {
            rawSocket = connect({ host: selected.address, family: selected.family, port: 443, allowHalfOpen: false });
          } catch {
            fail('connect-failed');
            return;
          }
          if (!rawSocket || typeof rawSocket.once !== 'function') {
            fail('connect-failed');
            return;
          }
          const connected = await waitForSocket(rawSocket, 'connect', () => {
            if (settled) return false;
            record('tcp-connected', { address: rawSocket.remoteAddress, family: normalizeFamily(rawSocket.remoteFamily), port: rawSocket.remotePort });
            let peerKey;
            try {
              peerKey = canonicalAddress(rawSocket.remoteAddress, normalizeFamily(rawSocket.remoteFamily));
            } catch {
              peerKey = null;
            }
            if (peerKey !== selected.key || normalizeFamily(rawSocket.remoteFamily) !== selected.family || rawSocket.remotePort !== 443) {
              record('peer-mismatch');
              fail('peer-mismatch');
              return false;
            }
            record('peer-matched', { address: rawSocket.remoteAddress, family: selected.family, port: 443 });
            return true;
          }, 'connect-closed', 'connect-failed');
          if (!connected || settled) return;
          cancelTimer(phaseTimer);

          phase = 'tls';
          record('tls-start');
          startPhase('tls', TLS_TIMEOUT_MS, 'tls-timeout');
          try {
            secureSocket = tlsConnect({
              socket: rawSocket,
              servername: request.hostname,
              rejectUnauthorized: true,
              checkServerIdentity: tls.checkServerIdentity,
              ALPNProtocols: ['http/1.1'],
            });
          } catch (error) {
            fail(isClientCertificateError(error) ? 'tls-client-certificate-required' : 'tls-failed');
            return;
          }
          if (!secureSocket || typeof secureSocket.once !== 'function') {
            fail('tls-failed');
            return;
          }

          const requestUrl = request.url;
          const parsedUrl = new URL(requestUrl);
          const requestTarget = `${parsedUrl.pathname || '/'}${parsedUrl.search}`;
          const requestBytes = Buffer.from([
            `GET ${requestTarget} HTTP/1.1`,
            `Host: ${request.hostname}`,
            'Accept: text/html, text/plain',
            'Accept-Encoding: identity',
            'Connection: close',
            '',
            '',
          ].join('\r\n'), 'ascii');
          const decoder = createHttpResponseDecoder({ requestUrl, clock });
          let requestWritten = false;
          const completeResponse = (outcome) => {
            if (outcome === null) return;
            if (typeof outcome === 'string') {
              fail(outcome);
              return;
            }
            record('response-classified', {
              statusCode: outcome.status,
              byteCount: outcome.bodyBytes?.length || 0,
              ...(outcome.mediaType ? { mediaType: outcome.mediaType } : {}),
            });
            if (outcome.kind === 'redirect') {
              settle({ ok: true, kind: 'redirect', requestUrl, statusCode: outcome.status, location: outcome.location });
              return;
            }
            try {
              const body = new TextDecoder('utf-8', { fatal: true }).decode(outcome.bodyBytes);
              settle({ ok: true, kind: 'body', requestUrl, statusCode: outcome.status, mediaType: outcome.mediaType, charset: 'utf-8', body, bodyBytes: outcome.bodyBytes.length });
            } catch {
              fail('response-charset');
            }
          };
          addListener(secureSocket, 'data', (chunk) => {
            if (settled) return;
            if (!requestWritten) {
              fail('response-invalid');
              return;
            }
            const bytes = Buffer.from(chunk);
            if (!headerProbe.includes(Buffer.from('\r\n\r\n'))) {
              headerProbe = Buffer.concat([headerProbe, bytes]).subarray(0, HEADER_LIMIT + 4);
              if (headerProbe.includes(Buffer.from('\r\n\r\n'))) {
                cancelTimer(headerTimer);
                headerTimer = null;
              }
            }
            try {
              completeResponse(decoder.push(bytes));
            } catch {
              fail('response-invalid');
            }
          });
          addListener(secureSocket, 'end', () => {
            if (settled) return;
            if (!requestWritten) {
              fail('response-invalid');
              return;
            }
            try {
              completeResponse(decoder.finish());
            } catch {
              fail('response-invalid');
            }
          }, true);

          const writeRequest = () => {
            if (settled) return false;
            phase = 'response';
            headerTimer = armTimer(HEADER_TIMEOUT_MS, () => fail('response-timeout'));
            responseTimer = armTimer(RESPONSE_TIMEOUT_MS, () => fail('response-timeout'));
            addListener(secureSocket, 'error', () => fail('response-invalid'), true);
            addListener(secureSocket, 'close', () => fail('response-closed'), true);
            try {
              secureSocket.write(requestBytes);
            } catch {
              fail('response-invalid');
              return false;
            }
            requestWritten = true;
            record('request-written', { byteCount: requestBytes.length });
            return true;
          };

          const tlsReady = await waitForSocket(secureSocket, 'secureConnect', () => {
            if (settled) return false;
            const authorized = secureSocket.authorized === true;
            const authorizationErrorEmpty = secureSocket.authorizationError === '' || secureSocket.authorizationError === null;
            let certificate;
            try {
              certificate = typeof secureSocket.getPeerCertificate === 'function' ? secureSocket.getPeerCertificate(true) : null;
            } catch {
              certificate = null;
            }
            const fingerprint256 = certificate?.fingerprint256;
            record('tls-authorized', {
              hostname: request.hostname,
              boolean: authorized,
              authorizationErrorEmpty,
              alpnProtocol: secureSocket.alpnProtocol ?? null,
              ...(typeof fingerprint256 === 'string' && FINGERPRINT256.test(fingerprint256) ? { fingerprint256 } : {}),
            });
            if (!authorized || !authorizationErrorEmpty) {
              fail('tls-unauthorized');
              return false;
            }
            if (secureSocket.alpnProtocol !== 'http/1.1') {
              fail('tls-protocol');
              return false;
            }
            if (typeof fingerprint256 !== 'string' || !FINGERPRINT256.test(fingerprint256)) {
              fail('tls-unauthorized');
              return false;
            }
            cancelTimer(phaseTimer);
            return writeRequest();
          }, 'tls-failed', (error) => isClientCertificateError(error) ? 'tls-client-certificate-required' : 'tls-failed');
          if (!tlsReady || settled) return;
        } catch (error) {
          if (!settled) fail(codeFor(error, timeoutCode()));
        }
      })();
    });
  }

  return { fetchHop };
}

module.exports = { createPinnedHttpsTransport };
