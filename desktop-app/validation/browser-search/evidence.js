'use strict';

const net = require('node:net');

const ALLOWED_EVENT_FIELDS = new Set([
  'runId', 'scenarioId', 'requestId', 'hopIndex', 'seq', 'phase', 'hostname', 'address', 'family',
  'port', 'statusCode', 'byteCount', 'mediaType', 'errorCode', 'boolean', 'fingerprint256',
]);

const SAFE_PHASES = new Set([
  'scenario-start', 'url-policy-accepted', 'dns-start', 'dns-complete', 'all-addresses-public',
  'address-selected', 'tcp-connected', 'peer-matched', 'peer-mismatch', 'tls-start', 'tls-authorized',
  'request-written', 'response-classified', 'redirect-followed', 'parser-start', 'parser-complete',
  'cancelled', 'dispose', 'scenario-complete', 'scenario-failed',
]);

const SAFE_MEDIA_TYPES = new Set(['text/html', 'text/plain', 'application/octet-stream']);
const SAFE_ERROR_CODES = new Set([
  'dns-nxdomain', 'dns-failed', 'dns-invalid', 'dns-timeout', 'dns-non-public', 'dns-too-many-answers',
  'peer-mismatch', 'connect-failed', 'connect-closed', 'tls-failed', 'tls-unauthorized', 'tls-protocol',
  'response-too-large', 'response-framing', 'response-invalid', 'response-timeout', 'response-closed',
  'response-content-type', 'response-content-encoding', 'response-charset', 'redirect-invalid',
  'redirect-loop', 'redirect-limit', 'parser-egress-blocked', 'browser-search-parser-egress-blocked',
  'browser-search-parser-cancelled', 'browser-search-parser-disposed', 'browser-search-parser-not-about-blank',
  'parser-electron-err-failed', 'request-aborted',
]);

const TRANSITIONS = Object.freeze({
  'scenario-start': new Set(['url-policy-accepted', 'parser-start', 'scenario-failed']),
  'url-policy-accepted': new Set(['dns-start']),
  'dns-start': new Set(['dns-complete', 'scenario-failed']),
  'dns-complete': new Set(['all-addresses-public']),
  'all-addresses-public': new Set(['address-selected']),
  'address-selected': new Set(['tcp-connected']),
  'tcp-connected': new Set(['peer-matched', 'peer-mismatch', 'scenario-failed']),
  'peer-mismatch': new Set(['scenario-failed']),
  'peer-matched': new Set(['tls-start']),
  'tls-start': new Set(['tls-authorized', 'scenario-failed']),
  'tls-authorized': new Set(['request-written', 'scenario-failed']),
  'request-written': new Set(['response-classified', 'scenario-failed']),
  'response-classified': new Set(['redirect-followed', 'parser-start', 'scenario-complete', 'scenario-failed']),
  'redirect-followed': new Set(['url-policy-accepted', 'scenario-failed']),
  'parser-start': new Set(['parser-complete', 'cancelled', 'dispose', 'scenario-failed']),
  'parser-complete': new Set(['url-policy-accepted', 'parser-start', 'scenario-complete', 'scenario-failed']),
  cancelled: new Set(['scenario-failed']),
  dispose: new Set(['scenario-failed']),
});

function evidenceError(code) {
  return new Error(code);
}

function assertBoundedString(value, maximum = 64) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) throw evidenceError('evidence-value-bounded');
  if (/https?:\/\/|file:|data:|blob:|<[^>]*>|(?:^|[\s"'`])(?:url|path|query|location|html|header|cookie|authorization|api[-_]?key|secret|token|password)\s*[:=]|\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/i.test(value)) {
    throw evidenceError('evidence-sensitive-value');
  }
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw evidenceError('evidence-object-required');
  for (const field of Object.keys(event)) if (!ALLOWED_EVENT_FIELDS.has(field)) throw evidenceError('evidence-field-not-allowlisted');
  for (const field of ['runId', 'scenarioId', 'requestId']) {
    assertBoundedString(event[field]);
    if (!/^[A-Za-z0-9_-]+$/.test(event[field])) throw evidenceError('evidence-id-invalid');
  }
  assertBoundedString(event.phase);
  if (!SAFE_PHASES.has(event.phase)) throw evidenceError('evidence-phase-invalid');
  if (!Number.isInteger(event.hopIndex) || event.hopIndex < 0 || event.hopIndex > 5) throw evidenceError('evidence-hop-invalid');
  if (!Number.isInteger(event.seq) || event.seq < 0 || event.seq > 10_000) throw evidenceError('evidence-seq-invalid');
  if (event.hostname !== undefined) {
    assertBoundedString(event.hostname, 253);
    if (!/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(event.hostname)) throw evidenceError('evidence-hostname-invalid');
  }
  if (event.address !== undefined && net.isIP(event.address) === 0) throw evidenceError('evidence-address-invalid');
  if (event.family !== undefined && event.family !== 4 && event.family !== 6) throw evidenceError('evidence-family-invalid');
  if (event.port !== undefined && (!Number.isInteger(event.port) || event.port < 1 || event.port > 65_535)) throw evidenceError('evidence-port-invalid');
  if (event.statusCode !== undefined && (!Number.isInteger(event.statusCode) || event.statusCode < 100 || event.statusCode > 599)) throw evidenceError('evidence-status-invalid');
  if (event.byteCount !== undefined && (!Number.isInteger(event.byteCount) || event.byteCount < 0 || event.byteCount > 2_000_000)) throw evidenceError('evidence-byte-count-invalid');
  if (event.mediaType !== undefined && !SAFE_MEDIA_TYPES.has(event.mediaType)) throw evidenceError('evidence-media-type-invalid');
  if (event.errorCode !== undefined && !SAFE_ERROR_CODES.has(event.errorCode)) throw evidenceError('evidence-error-invalid');
  if (event.boolean !== undefined && typeof event.boolean !== 'boolean') throw evidenceError('evidence-boolean-invalid');
  if (event.fingerprint256 !== undefined && !/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(event.fingerprint256)) throw evidenceError('evidence-fingerprint-invalid');
  return event;
}

function serializeEvidenceEvent(event) {
  return JSON.stringify(validateEvent(event));
}

function projectFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw evidenceError('evidence-fields-required');
  for (const field of Object.keys(fields)) if (!ALLOWED_EVENT_FIELDS.has(field)) throw evidenceError('evidence-field-not-allowlisted');
  const projected = {};
  for (const field of ['hopIndex', 'hostname', 'address', 'family', 'port', 'statusCode', 'byteCount', 'mediaType', 'errorCode', 'boolean', 'fingerprint256']) {
    if (fields[field] !== undefined) projected[field] = fields[field];
  }
  return projected;
}

function createEvidenceSink({ runId, scenarioId, requestId = `req-${scenarioId}` }) {
  assertBoundedString(runId);
  assertBoundedString(scenarioId);
  assertBoundedString(requestId);
  const events = [];
  let previousPhase = null;
  let terminal = false;

  return {
    emit(fields) {
      const phase = fields?.phase;
      if (terminal) throw evidenceError('evidence-after-terminal');
      if (!SAFE_PHASES.has(phase)) throw evidenceError('evidence-phase-invalid');
      const allowed = previousPhase === null ? phase === 'scenario-start' : TRANSITIONS[previousPhase]?.has(phase);
      if (!allowed) throw evidenceError('evidence-phase-order');
      const event = validateEvent({
        ...projectFields(fields),
        runId,
        scenarioId,
        requestId,
        seq: events.length,
        phase,
      });
      events.push(JSON.stringify(event));
      previousPhase = phase;
      terminal = phase === 'scenario-complete' || phase === 'scenario-failed';
      return event;
    },
    finish() {
      if (!terminal) throw evidenceError('evidence-phase-incomplete');
      return events.slice();
    },
  };
}

module.exports = { ALLOWED_EVENT_FIELDS, createEvidenceSink, serializeEvidenceEvent, TRANSITIONS };
