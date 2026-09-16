const { createWebQueryDiagnostics } = require('./diagnostics');

const MAX_QUEUED_REQUESTS = 10;

function cancelledResult() {
  return { status: 'cancelled', sources: [] };
}

function blockedResult() {
  return { status: 'blocked', sources: [] };
}

function cloneBudget(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(cloneBudget));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = cloneBudget(child);
  return Object.freeze(copy);
}

function resultCode(result) {
  return result?.status === 'ok' || result?.status === 'empty' || result?.status === 'cancelled' || result?.status === 'blocked' || result?.status === 'timeout' || result?.status === 'needs-user'
    ? result.status
    : 'blocked';
}

function createWebQueryCoordinator({ reader, getBudget = () => ({}), diagnostics = createWebQueryDiagnostics(), now = Date.now } = {}) {
  if (typeof reader?.search !== 'function') throw new TypeError('reader.search is required');

  let active;
  let pendingDisposals = 0;
  const queue = [];

  function record(entry, outcome) {
    if (entry.recorded) return;
    entry.recorded = true;
    diagnostics.record({
      requestId: entry.requestId,
      phase: 'completed',
      resultCode: resultCode(outcome),
      durationMs: Math.max(0, now() - entry.startedAt),
      sourceCount: Array.isArray(outcome?.sources) ? outcome.sources.length : 0,
    });
  }

  function settle(entry, outcome) {
    if (entry.settled) return;
    entry.settled = true;
    entry.signal?.removeEventListener('abort', entry.abort);
    record(entry, outcome);
    entry.resolve(outcome);
  }

  function invalidate(entry) {
    if (!entry || entry.cancelled) return;
    entry.cancelled = true;
    settle(entry, cancelledResult());
  }

  function removeQueued(entry) {
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
  }

  function pump() {
    if (active || pendingDisposals || !queue.length) return;
    active = queue.shift();
    void run(active);
  }

  function holdDisposal(cleanup) {
    pendingDisposals += 1;
    return Promise.resolve(cleanup).then(
      (value) => {
        pendingDisposals -= 1;
        pump();
        return value;
      },
      (error) => {
        pendingDisposals -= 1;
        pump();
        throw error;
      },
    );
  }

  async function run(entry) {
    let outcome;
    try {
      outcome = await reader.search({
        petId: entry.petId,
        requestId: entry.requestId,
        query: entry.query,
        sensitiveQueryApproved: entry.sensitiveQueryApproved,
        signal: entry.signal,
        budget: entry.budget,
      });
    } catch {
      outcome = blockedResult();
    } finally {
      entry.cleanupResolve();
      if (active === entry) active = undefined;
      settle(entry, entry.cancelled ? cancelledResult() : outcome);
      pump();
    }
  }

  function cancel(petId, requestId) {
    if (active && active.petId === petId && (requestId === undefined || active.requestId === requestId)) {
      invalidate(active);
      reader.cancel?.(petId, active.requestId);
    }
    for (const entry of [...queue]) {
      if (entry.petId === petId && (requestId === undefined || entry.requestId === requestId)) {
        removeQueued(entry);
        invalidate(entry);
      }
    }
  }

  function dispose(petId) {
    let cleanup = Promise.resolve();
    if (active?.petId === petId) {
      const entry = active;
      let readerCleanup;
      try { readerCleanup = reader.dispose?.(petId); }
      catch (error) { readerCleanup = Promise.reject(error); }
      const disposal = holdDisposal(readerCleanup);
      cancel(petId, entry.requestId);
      cleanup = Promise.all([entry.cleanup, disposal]);
    }
    cancel(petId);
    return cleanup;
  }

  function search({ petId, requestId, query, signal, sensitiveQueryApproved = false } = {}) {
    if (queue.length >= MAX_QUEUED_REQUESTS && active) {
      const error = new Error('web-query-queue-full');
      error.code = 'web-query-queue-full';
      diagnostics.record({ requestId, phase: 'completed', resultCode: error.code, durationMs: 0, sourceCount: 0 });
      return Promise.reject(error);
    }
    let resolve;
    const entry = {
      petId,
      requestId,
      query,
      sensitiveQueryApproved,
      signal,
      budget: cloneBudget(getBudget()),
      startedAt: now(),
      settled: false,
      cancelled: false,
      recorded: false,
      promise: new Promise((done) => { resolve = done; }),
    };
    entry.resolve = resolve;
    entry.cleanup = new Promise((done) => { entry.cleanupResolve = done; });
    entry.abort = () => {
      if (active === entry || queue.includes(entry)) cancel(petId, requestId);
      else invalidate(entry);
    };
    if (signal?.aborted) entry.abort();
    else signal?.addEventListener('abort', entry.abort, { once: true });
    if (!entry.cancelled) queue.push(entry);
    pump();
    return entry.promise;
  }

  return { search, cancel, dispose };
}

module.exports = { createWebQueryCoordinator };
