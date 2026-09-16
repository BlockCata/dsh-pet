# Pinned Public Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows Electron 桌寵中，以 numeric-IP pinned HTTPS transport 與斷網 inert DOM parser，安全地為沒有原生聯網能力的模型提供公開網頁摘要。

**Architecture:** 主程序以固定搜尋 URL 啟動受控的 `PublicHttpsTransport`，每個 redirect 重新解析並把 DNS 結果綁定到實際 TCP socket，再把 HTML 交給無網路的 `InertDocumentParser`。聊天 session 只取得受限 source，搜尋回合不執行 action、diary、care、settings 或圖片流程；安全關卡未通過時 service 保持 `blocked`。

**Tech Stack:** JavaScript、Node `net`/`tls`/`dns`/`https`、Electron 43 `BrowserWindow`/`session`、Node test runner；不新增依賴、不使用 proxy/WFP/driver。

**Spec:** `docs/superpowers/specs/2026-09-15-pinned-public-reader-design.md`

## Global Constraints

- 僅支援 Windows 與現有 Electron portable EXE。
- 只允許公開 HTTPS/443 GET；DNS 全部公開且實際 socket 必須使用已驗證 numeric IP。
- TLS 使用原 hostname SNI/憑證驗證；不接受憑證錯誤、不安裝根憑證。
- 網頁不可取得本機檔案、API key、cookies、登入表單、附件、日記、設定或其他桌寵資料。
- 不執行遠端 JavaScript、CSS、圖片、iframe、worker、service worker、表單、上傳、下載、popup 或 CAPTCHA 自動操作。
- 搜尋後不執行 action、diary、care、settings mutation 或圖片外送。
- 保留 `(petId, requestId, epoch)` 生命週期隔離與 `messageId + sourceId` 來源隔離。
- 不新增依賴，不加入 proxy、WFP、driver、系統防火牆、根憑證、管理員權限或第三方搜尋 API。
- 未完成真實 DNS-to-socket、parser egress、真網站與真模型驗收前，production factory 必須回傳 `blocked`。

### Task 1: Pinned HTTPS transport

**Files:**
- Create: `desktop-app/src/browser-search/transport.js`
- Modify: `desktop-app/src/browser-search/policy.js` only when required for canonical host/address reuse
- Test: `desktop-app/test/browser-search-transport.test.js`

**Interfaces:**
- Produces `createPinnedHttpsTransport({ resolveHost, connect, tlsConnect, now })`.
- `transport.fetch(url, { signal })` returns `{ url, statusCode, headers, body }` or a fixed error code; it never accepts caller headers/body.
- `transport.resolvePublic(url)` returns `{ url, hostname, address, family, port }` only after all DNS answers pass `validatePublicUrl`.

- [ ] Write failing tests for numeric-IP dial, remote tuple check before payload, original-host TLS identity, forbidden headers/body, redirect response limits, cancellation, and mixed DNS rejection.
- [ ] Run `node --test test/browser-search-transport.test.js`; confirm each new assertion fails because transport is absent.
- [ ] Implement the smallest transport using fresh DNS answers, `net.connect` to the selected numeric IP, `tls.connect({ servername: hostname, rejectUnauthorized: true })`, no pooled agent, and an HTTPS GET with bounded response collection.
- [ ] Add tests for 301/302/303/307/308 metadata while leaving redirect traversal to Task 3; reject other 3xx, 401/407, attachment, unknown content type/encoding, oversized body, and aborted signals.
- [ ] Run the transport test file and then `npm.cmd test`; preserve all existing pass counts.

### Task 2: Inert DOM parser and hostile lifecycle

**Files:**
- Create: `desktop-app/src/browser-search/parser.js`
- Modify: `desktop-app/diagnostics/browser-search-probe.cjs` to use current Electron event detail objects and immediate download cancellation
- Test: `desktop-app/test/browser-search-parser.test.js`

**Interfaces:**
- Produces `createInertDocumentParser({ BrowserWindow, session })` with `parseSearchResults(html, baseUrl)` and `parsePage(html)`.
- The parser has no `loadURL` for remote URLs, no preload, no product IPC, and destroys its in-memory window/session on `dispose()`.

- [ ] Write failing tests with hostile HTML containing script, event handlers, image/srcset, iframe, object, media, CSS URL, meta refresh, form, worker and popup-like links; assert only normalized title/text/HTTPS candidates are returned.
- [ ] Run the parser test file and confirm failure before implementation.
- [ ] Implement an about:blank hidden parser with sandbox/context isolation/web security, non-persistent partition, deny-all request/navigation/popup/download/permission handlers, and `DOMParser.parseFromString` extraction.
- [ ] Add strict raw/body/text limits and make any observed parser egress return `blocked` rather than partial success.
- [ ] Run parser tests and the existing diagnostic syntax check; do not claim real-site validation from fixtures.

### Task 3: Search service and chat integration

**Files:**
- Modify: `desktop-app/src/browser-search/service.js`
- Modify: `desktop-app/src/chat/search.js`
- Modify: `desktop-app/src/main.js`
- Modify: `desktop-app/src/chat/session.js` only for the exact new status/limits if tests demonstrate a gap
- Test: `desktop-app/test/browser-search-service.test.js`, `desktop-app/test/main-state.test.js`, `desktop-app/test/chat-session.test.js`

**Interfaces:**
- `createBrowserSearch({ BrowserWindow, session })` wires Task 1 and Task 2 in production; missing/unverified dependencies still return `{ status:'blocked', sources:[], reason:'network-isolation-unverified' }`.
- Search service performs one fixed Google search GET, parses candidates, validates each candidate, reads at most three public pages, and returns bounded sources; it never exposes arbitrary navigation.

- [ ] Write failing integration tests for fixed search URL, query gate, per-hop DNS/socket validation, source shaping, no second automatic search, and blocked fallback when production dependencies are not verified.
- [ ] Run the targeted integration tests and confirm failure before changing production wiring.
- [ ] Implement query normalization/gate, fixed Google search URL, redirect loop/hop budget, candidate URL revalidation, page fetch, parser extraction, source IDs, timeout/cancel/dispose epoch checks, and explicit `needs-user`/`empty`/`blocked` results.
- [ ] Wire `main.js` to pass Electron dependencies without exposing them through preload; keep renderer source opening as `messageId + sourceId` only.
- [ ] Run targeted tests, then the full suite in normal and Windows complete environments.

### Task 4: Security evidence, documentation, and package gate

**Files:**
- Modify: `desktop-app/diagnostics/browser-search-probe.cjs`
- Modify: `docs/verification-readonly-browser-chat.md`
- Modify: `.superpowers/sdd/2026-09-14-readonly-browser-chat/progress.md`
- Test/verify: `desktop-app/test/*.test.js`, portable packaging output under `desktop-app/release-0.5.12-safe`

**Interfaces:**
- Probe reports selected DNS address, actual socket remote tuple, TLS authorization/hostname, request lifecycle counters, and parser egress counters without recording keys, query text, cookies or response bodies.
- Package gate never enables production search merely because fixture tests pass.

- [ ] Write failing probe assertions for current Electron `details` event shape, `event.preventDefault()` download blocking, no remote parser request, and no local fixture hit.
- [ ] Run the probe assertions and record any environment limitation without weakening the policy.
- [ ] Implement the probe/documentation changes and list all remaining evidence gaps explicitly.
- [ ] Run the complete test suite, `node --check` on changed JavaScript, and package to a new `release-0.5.12-safe` directory without overwriting existing releases.
- [ ] Verify EXE metadata, nonzero size, `resources/app.asar`, hash, and that production browser remains blocked unless every approved safety gate is proven.

Do not commit or push this work unless the user separately requests integration; preserve existing source, release, and asset files.
