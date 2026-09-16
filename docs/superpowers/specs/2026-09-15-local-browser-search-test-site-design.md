# Local Browser Search Test Site Design

## Goal

建立只供本機安全驗收使用的固定 HTTP 測試站，讓 pinned transport、inert parser 與 Electron 負控制可以在不連到公開網路的情況下重現必要情境。

## Scope

- 所有檔案只存在 `.scratch/pet-browser-search/local-site/`，不可進入 `app.asar`、release 或 production package。
- 使用 Node.js 內建 `http` 模組，不新增 npm dependency。
- 只綁定 `127.0.0.1`，由測試程式取得隨機可用 port；不接受外部連線。
- 不接受上傳、表單提交、任意 URL、任意 header 或 API key。
- 伺服器只提供固定 route 與固定 response；觀測只保留 scenario ID、method、status、計數與 bounded byte count。

## Fixed scenarios

- `plain`: server-rendered text/html page with bounded content.
- `chunked`: equivalent page using chunked transfer encoding.
- `redirect-chain`: fixed finite redirect chain ending in a safe page.
- `redirect-loop`: two fixed locations that redirect to each other.
- `hostile`: inert-parser input containing script, style, image, iframe, popup, download, form, worker and permission surfaces.
- `unauthorized`: HTTP 401 response.
- `attachment`: attachment content-disposition response.
- `wrong-content-type`: unsupported content type response.
- `oversized`: body above the configured test limit.

## Interface

`createTestSite(options)` returns:

- `start(): Promise<{ host: '127.0.0.1', port: number }>`
- `url(scenario): string` for a fixed scenario name only
- `snapshot(): { requests: number, byScenario: Record<string, number>, externalTargets: number }`
- `close(): Promise<void>`

Unknown scenarios return a bounded 404 and never become a file-system path or remote target.

## Verification

- Node tests exercise startup, all fixed route statuses/headers/bodies, chunked framing, redirect behavior, unknown-route rejection, counter snapshots and clean shutdown.
- A separate Electron fixture can use the hostile route; any request outside the fixed local fixture is denied by the existing probe.
- Tests must not claim public DNS, TCP peer, TLS, redirect-on-public-host, or production-readiness evidence.
