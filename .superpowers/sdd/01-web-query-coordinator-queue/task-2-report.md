# Task 2 Report: Chat-session and main-process integration

## Status

Ready to commit after focused and full-suite verification. The commit scope is limited to the main-process integration and this report.

## Implementation summary

- `main.js` now constructs the fail-closed Blocked state reader and immediately wraps it with `createWebQueryCoordinator({ reader })` before passing the existing `search/cancel/dispose` capability to chat sessions.
- The session capability API is unchanged. No raw reader reaches sessions, and no settings, transport, release, or asset work was added.
- The main-state harness keeps existing `browserSearch` final-capability injection unchanged. A new `browserReader` seam composes the real Coordinator for integration behaviour tests.

## Commit files

- `desktop-app/src/main.js`
- `desktop-app/test/main-state.test.js`
- `.superpowers/sdd/01-web-query-coordinator-queue/task-2-report.md`

`desktop-app/test/main-state.test.js` contains the Task 2 integration tests below, but they remain intentionally unstaged: the same file has a deliberately pre-existing sensitive-query hunk, and this recovery handoff does not risk staging that unrelated work. The commit therefore contains only `main.js` and this report.

## TDD evidence

RED command:

```text
node --test --test-name-pattern "依 FIFO" test/main-state.test.js
```

RED output: failed at `main-state.test.js:1121`; actual reader starts were `['a-first', 'b-second']`, while the required single active slot expected `['a-first']`.

GREEN commands:

```text
node --test --test-name-pattern "依 FIFO" test/main-state.test.js
node --test --test-name-pattern "lifecycle 取消 queued" test/main-state.test.js
node --test test/main-state.test.js
```

GREEN output: FIFO test `1 pass, 0 fail`; lifecycle test `1 pass, 0 fail`; focused main-state suite `42 pass, 0 fail`.

## Full verification

```text
npm test
```

Output: `tests 339`, `pass 336`, `fail 0`, `cancelled 0`, `skipped 3`, `duration_ms 30188.5796`. The three skips are the pre-existing explicitly skipped Electron/renderer cases.

`git diff --check` exited cleanly before staging.

## Self-review

- Two pets share the real application-wide Coordinator in the main-state harness; the later request starts only after the first completes.
- A queued request is cancelled via the existing collapse entry point, and an active request is disposed via existing pet removal; neither persists messages nor emits late `delta`, `sources`, or `done` events.
- The existing session search-failure catch already keeps `web-query-queue-full` in the Web query failure path, rather than emitting the generic AI failure event, so no session change was needed.
- Existing fake `browserSearch` injections remain direct capabilities, avoiding changes to unrelated cancellation-count and sensitive-query tests.

## Concerns

- The production reader remains fail-closed in Blocked state; this task does not enable transport or establish release/network-isolation evidence.
- Deliberately pre-existing, uncommitted sensitive-query changes in service/session/search and their tests were not staged or included.
- The two verified Task 2 `main-state.test.js` hunks are also not included in this recovery commit, solely to avoid including the adjacent pre-existing sensitive-query hunk.
