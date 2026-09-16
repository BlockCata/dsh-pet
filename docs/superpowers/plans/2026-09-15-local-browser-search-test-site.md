# Local Browser Search Test Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立只供本機安全驗收使用的固定 HTTP 測試站，重現 chunked、redirect、hostile HTML 與受限回應情境。

**Architecture:** Node.js 內建 HTTP server 綁定 `127.0.0.1`，只依固定 scenario ID 選擇回應；伺服器不讀檔、不代理、不接受上傳。測試與 server 全部位於 `.scratch/pet-browser-search/local-site/`，不被 production build 收錄。

**Tech Stack:** Node.js built-in `http`, `node:test`, `node:assert/strict`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-15-local-browser-search-test-site-design.md`

## Global Constraints

- Windows only for the acceptance run; server binds only to `127.0.0.1`.
- No production source, `package.json`, build files, release files or assets are modified.
- No API key, arbitrary URL, arbitrary header, upload, cookie or external network request is accepted.
- Reports contain only bounded scenario counters and byte counts; no response body persistence.
- Local fixture evidence never counts as public DNS/TCP/TLS/parser or production enablement evidence.

---

### Task 1: Test the fixed local server contract

**Files:**
- Create: `.scratch/pet-browser-search/local-site/test-site.test.cjs`
- Create: `.scratch/pet-browser-search/local-site/server.cjs`

**Interfaces:**
- `createTestSite(options)` returns `start`, `url`, `snapshot`, `close` as defined by the spec.

- [ ] **Step 1: Write failing tests** for startup binding, fixed `plain` and `chunked` routes, redirect chain/loop, bounded error routes, unknown-route rejection, counters and clean shutdown.
- [ ] **Step 2: Run `node --test .scratch/pet-browser-search/local-site/test-site.test.cjs` and confirm failure because `server.cjs` is absent.
- [ ] **Step 3: Implement the smallest `createTestSite` using `http.createServer`; map only fixed scenario names and write fixed bodies.
- [ ] **Step 4: Run the focused test and confirm all route and lifecycle assertions pass.
- [ ] **Step 5: Run `node --check .scratch/pet-browser-search/local-site/server.cjs`.

### Task 2: Add the operator runner and bounded report

**Files:**
- Create: `.scratch/pet-browser-search/local-site/run-local-site.cjs`
- Create: `.scratch/pet-browser-search/local-site/README.md`
- Modify: `.scratch/pet-browser-search/local-site/test-site.test.cjs`

**Interfaces:**
- `run-local-site.cjs` starts the site, fetches every fixed route through Node HTTP, writes `local-site-result.json`, and always closes the server.
- Report fields are `schema`, `status`, `host`, `port`, `routeCount`, `scenarioStatuses`, `requestCount`, `externalTargets`, and `responseBodiesSaved`.

- [ ] **Step 1: Add failing runner/report assertions** for fixed route coverage, `externalTargets: 0`, `responseBodiesSaved: false`, and no arbitrary route fetch.
- [ ] **Step 2: Run the focused test and confirm the runner/report contract fails before implementation.
- [ ] **Step 3: Implement the runner with Node HTTP requests to only `site.url(scenario)` values and bounded JSON output.
- [ ] **Step 4: Add README commands and explicitly state that this is not public-web security evidence.
- [ ] **Step 5: Run focused tests, the runner, and syntax checks; record exact counts without storing response bodies.

### Task 3: Regression verification and handoff

**Files:**
- Modify: `.superpowers/sdd/2026-09-14-readonly-browser-chat/progress.md`

- [ ] **Step 1: Run `npm.cmd test` from `desktop-app` and confirm the existing production suite remains unchanged.
- [ ] **Step 2: Run the local-site focused tests and runner again from the repository root.
- [ ] **Step 3: Confirm `git status --short` shows only the intended scratch/spec/plan/ledger files; do not package or commit.
- [ ] **Step 4: Add a progress entry with route count, test count, and the explicit limitation that local site evidence cannot unlock production.
