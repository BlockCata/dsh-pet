const MAX_EVENTS = 1_000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const PHASES = new Set(['completed']);
const RESULT_CODES = new Set(['ok', 'empty', 'cancelled', 'blocked', 'timeout', 'needs-user', 'web-query-queue-full']);

function fixedPhase(phase) {
  return PHASES.has(phase) ? phase : 'completed';
}

function fixedResultCode(resultCode) {
  return RESULT_CODES.has(resultCode) ? resultCode : 'blocked';
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function boundedSourceCount(value) {
  return Math.min(nonNegativeInteger(value), 3);
}

function createWebQueryDiagnostics({ now = Date.now, maxEvents = MAX_EVENTS, retentionMs = RETENTION_MS } = {}) {
  const events = [];
  const limit = Number.isSafeInteger(maxEvents) && maxEvents > 0 ? Math.min(maxEvents, MAX_EVENTS) : MAX_EVENTS;
  const retention = Number.isSafeInteger(retentionMs) && retentionMs >= 0 ? Math.min(retentionMs, RETENTION_MS) : RETENTION_MS;

  function evict(timestamp) {
    const oldest = timestamp - retention;
    while (events.length && events[0].recordedAt < oldest) events.shift();
  }

  function record({ requestId, phase, resultCode, durationMs, sourceCount } = {}) {
    const recordedAt = now();
    evict(recordedAt);
    while (events.length >= limit) events.shift();
    const event = {
      requestId: typeof requestId === 'string' ? requestId.slice(0, 128) : '',
      phase: fixedPhase(phase),
      resultCode: fixedResultCode(resultCode),
      durationMs: nonNegativeInteger(durationMs),
      sourceCount: boundedSourceCount(sourceCount),
    };
    events.push({ recordedAt, event });
    return { ...event };
  }

  function read() {
    evict(now());
    return events.map(({ event }) => ({ ...event }));
  }

  return { record, read };
}

module.exports = { createWebQueryDiagnostics };
