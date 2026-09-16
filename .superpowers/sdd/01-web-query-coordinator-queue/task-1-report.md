# Task 1 report — Web Query Coordinator

## Status

Implemented Task 1 only. The new coordinator is an application-wide, injected boundary over the existing reader. It admits one active request, queues at most ten in FIFO order, captures a deep-frozen budget snapshot at admission, and keeps later work blocked until an active reader cleanup settles. `cancel` and `dispose` resolve affected callers as cancelled and suppress late reader results. Production remains fail-closed because `main` and the blocked adapter were not changed.

## Files changed

- `desktop-app/src/browser-search/coordinator.js` — public `createWebQueryCoordinator({ reader, getBudget, diagnostics, now })`; preserves `search({ petId, requestId, query, signal })`, `cancel(petId, requestId)`, and `dispose(petId)`.
- `desktop-app/src/browser-search/diagnostics.js` — public `createWebQueryDiagnostics`; stores only request ID, fixed phase, fixed result code, duration, and source count; retains at most 30 days or 1,000 events and caps source count at three.
- `desktop-app/test/browser-search-coordinator.test.js` — focused behavioral coverage through reader/diagnostic seams.

## TDD evidence

1. RED: `node --test test/browser-search-coordinator.test.js` initially failed with `Cannot find module '../src/browser-search/coordinator'` (0 pass, 1 fail).
2. GREEN: after the minimal coordinator/diagnostics implementation, the focused suite reached 6/6 passing.
3. RED: the diagnostic bound test failed with `actual sourceCount: 99`, `expected sourceCount: 3`; the implementation now caps it to three.
4. RED: an already-aborted admission signal did not settle because it was neither active nor queued; the abort handler now invalidates that entry directly.
5. Final GREEN: `node --test test/browser-search-coordinator.test.js` — 7 tests, 7 pass, 0 fail, 0 skipped, duration 49.9518 ms.

## Full verification

`npm.cmd test` in `desktop-app` completed with exit code 0: 336 tests, 333 pass, 0 fail, 3 skipped, 0 todo, duration 30226.6032 ms. The three skips are existing Electron/renderer environment-gated tests, not Task 1 failures.

## Self-review

- Queue behavior is asserted through observable reader start order and results, never private queue/map fields.
- Full queue rejects with the fixed `web-query-queue-full` error code.
- Cancellation/disposal cannot deliver a late usable reader result; disposal waits for the active reader operation and `reader.dispose` before the queue pumps.
- The reader receives only the cloned, recursively frozen budget snapshot; later live-budget mutation cannot alter active or queued work.
- Diagnostics ignore every non-allowlisted input field and sanitize phase/result/count values; query, URL, body, excerpt, headers, keys, pet ID, and error messages are not retained.
- No session/main wiring, network access, IPC, settings UI, or unrelated refactor was added.

## Concerns / follow-up

Task 2 still needs to construct and inject the coordinator into the existing main/session boundary. This Task 1 verification does not enable public reader transport, packaging, release, or claim network-isolation validation.
