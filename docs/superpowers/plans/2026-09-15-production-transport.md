# Production Pinned HTTPS Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本計畫只授權規劃；實作時仍須由主控逐任務明確派工。未另行授權前，不得 commit、push、package、release 或修改 assets。

**Goal:** 在 Windows 本機 Electron 中實作只讀公開 HTTPS reader，使模型只能提出有界搜尋文字、由主程序以 DNS-to-socket pinning 讀取固定搜尋入口與最多三個公開候選頁，再由同一模型整理；production 在完整證據與另行核准前持續 fail-closed。

**Architecture:** 網路讀取只存在於主程序的深模組 `PinnedHttpsTransport`。它以一次 `fetchHop()` 封裝 URL policy、同回合 A/AAAA、全答案公開位址檢查、numeric-IP TCP、實際 remote tuple 核對、原 hostname TLS SNI/憑證驗證與固定 GET；service 不得拆開或重做其中任一步。HTML 只以字串交給 `about:blank`、無 preload、非持久 partition 的 inert parser；parser 永不導覽遠端 URL，任何 egress／導航／popup／download／permission／worker 訊號都使該 request 永久 blocked。

**Tech Stack:** Electron 43、Node.js CommonJS、`node:dns`、`node:net`、`node:tls`、`node:test`、Electron BrowserWindow/session；不新增第三方 runtime dependency。

**Spec:** `.scratch/pet-browser-search/sol-security-gate-plan.md` 與 `docs/verification-readonly-browser-chat.md`。

## Global Constraints

- 平台固定為標準使用者權限的 Windows 本機 Electron；不得引入 proxy、WFP、driver、系統防火牆規則、額外 root certificate、administrator helper 或登入瀏覽器 session。
- reader 只允許公開 DNS hostname 的 HTTPS/443、GET、空 request body、固定 request headers；不接受 renderer/model 傳入任意 URL、header、Cookie、Authorization、Proxy-Authorization、Origin、Referer、upload 或 download。
- 模型權限僅為輸出 `answer` 或有界 `search(query)`，以及讀取有界不可信摘錄後回答；不得取得檔案、金鑰、shell、設定、記憶寫入、日記、動作、IPC 或 browser control 權限。
- `webQueryEnabled` 仍預設 false，且只代表可提出搜尋，不代表 transport 安全閘已解除。
- production 預設與每個未完成階段均為 `blocked/network-isolation-unverified`；fixture、單元測試、Electron `ERR_FAILED`、validation EXE 或 package 成功均不能自動解除。
- 不得存在 runtime `verified`/`enabled` 參數、環境變數、命令列、DevTools、設定值、IPC 或 renderer 訊息可把 blocked adapter 換成 active reader。
- 現有 assets、原始 DSH 內容、`release-0.5.10`、`release-0.5.11-safe`、`release-0.5.12-safe` 與其他既有 release 目錄都不得覆寫或刪除。
- 驗收資料不得記錄 query、URL path/search、raw Location、HTML、source text、model prompt/answer、header value、Cookie、API key、檔案路徑或個資。
- 本計畫中的「全 A/AAAA」只指同一 fetch/hop 的 resolver 回合實際可見之終端 A 與 AAAA 集合，不代表全球 GeoDNS 所有可能答案。
- 每一項安全拒絕都 fail-closed；不能以 fallback 到 Chromium navigation、普通 `fetch()`、外部瀏覽器、第二個 HTTP client 或 provider 原生 web tool 維持可用性。
- 執行者只修改其 ownership 所列檔案；跨 ownership 需求先停止並交回主控重排，禁止順手重構相鄰程式。

---

## 1. 現況基線與舊 Sol 計畫差距

本輪於 2026-09-15 重新執行六個 browser-search focused test files，結果為 **45 tests、45 pass、0 fail、0 skip**。這證明目前 fake resolver/socket/DOM 與靜態 probe 契約仍一致；沒有重跑完整 suite，也沒有新增真 Windows、公網、TLS 或模型證據。

本計畫在 production transport 範圍內取代較早的 `docs/superpowers/plans/2026-09-15-pinned-public-reader.md`；`.scratch` 的本機 HTTP test site 仍只能作 framing/fixture 測試，不能替代公開 DNS、TCP/443、TLS 或外部 observer 證據。

| 面向 | 目前程式 | 舊 Sol gate 要求 | production 實作差距 |
|---|---|---|---|
| 正式入口 | `main.js:606` 呼叫 `createBrowserSearch({ BrowserWindow, session })`；`verified` 預設 false | 正式 artifact 必須持續 blocked，直到另行核准 | `service.js` 仍暴露 runtime `verified:true` 與可注入 active adapters；雖然 main 未傳入，但這不是最終可接受的 gate 形狀 |
| Transport seam | `service.fetchFollowingRedirects()` 先呼叫 `resolvePublic()`，再呼叫會自行再次解析的 `fetch(url)` | 每 hop 的 policy → DNS → numeric dial → peer → TLS → GET 必須是一條可關聯 trace | 首次 resolution 沒有綁定實際 socket；service 學到 DNS/address 細節；一次 hop 有兩次 resolution，證據語義不清 |
| DNS | resolver 只在測試注入，`addresses[0]` 被選用 | 同回合 A 與 AAAA 狀態、全部終端答案、全部公開才可選址 | 沒有 production resolver adapter；沒有 A/AAAA 各自狀態、NODATA/錯誤規則、答案數上限、真 Windows trace |
| IP policy | `policy.js` 有手寫 IPv4/IPv6拒絕邏輯與多個反例 | 公開位址 fail-closed，涵蓋 special-use、mapped/compatible/translated | 清單不是有版本的 IANA snapshot；IPv4 有過度寬鬆／過度保守混雜風險；remote IPv6 仍以字串直接比較 |
| TCP peer | numeric host、family、443；connect 後比對 remote tuple | payload 前證明 selected numeric IP 等於實際 peer | fake socket 已覆蓋，真 socket 未覆蓋；IPv6 等價文字格式需 canonical byte-key 比較 |
| TLS | `servername` 原 hostname、`rejectUnauthorized:true` | authorized、authorizationError、SNI、peer cert fingerprint；錯誤 cert 零 GET | 未顯式驗證 `secureSocket.authorized`／`authorizationError`，未鎖 ALPN 為 HTTP/1.1，沒有真 cert 證據 |
| Request | raw TLS 上固定 GET 與四個 header | GET-only、body=0、無憑證/cookie/auth/login fallback | fake 測試已覆蓋；尚缺 request-target bytes 上限與真 observer header-name 證據 |
| Response | 完整 response buffer 後解析；raw 2 MB、body 1 MB；只收 identity 與 HTML/plain | content type/charset/content encoding/framing/size/timeout 全部有界 | header 無獨立上限；非關鍵 headers 會離開 transport；UTF-8 非 fatal；chunked 一律拒絕，真網站相容性低；沒有嚴格 framing parser |
| Redirect | service 允許 301/302/303/307/308、最多 5 次、loop guard | 每跳重新跑完整 transport chain | 行為測試用 fake；service/transport 的雙解析造成 trace 不等於單一 hop；回傳全部 headers 擴大介面 |
| Parser | hidden BrowserWindow、非 persist partition、無 preload；DOMParser 解析字串；多層 deny hook | 可證明 `about:blank`、自然 hostile HTML 零 egress、負控制一有事件整回合 blocked | 現在只因「沒有 load」推定 about:blank，沒有 readiness/getURL gate；array output 未逐欄主程序驗證；沒有 service worker runtime counter；`Session.destroy?.()` 不是 Electron Session 可依賴介面；dispose 清理未 await |
| Lifecycle | per-pet request/epoch/AbortController；parser 為 service-level singleton | cancel/dispose 中止 DNS/socket/parser，late result 不寫回 | dispose 任一 pet 會釋放共用 parser；應改 request-scoped parser，並等待 close/storage cleanup |
| Provider bypass | 現行 `providers.js` 只允許 `chat/greeting/proactive/search-protocol`，provider tests 斷言 body 無 `google_search`/`web_search` | 不得使用 provider 原生搜尋能力 | 舊 memory 中「仍有 native tools」已過時；最終仍需 source/ASAR/runtime request-body 三層回歸，防止日後復發 |
| Packaging | `package.json` 仍是 0.5.10；另有 0.5.11-safe 與 0.5.12-safe 目錄 | validation 與 production bits/hash/入口分離 | 現有版本與 release 目錄語義不一致；必須先 inventory，不能直接假設下一版本或覆寫目錄 |

### 已考慮的三種做法

1. **推薦：主程序 direct TCP/TLS transport + inert parser。** DNS、socket、TLS 與 HTTP payload 在單一深模組中完成；Chromium 不負責網路，只提供 `about:blank` DOMParser。優點是 DNS 判定可和實際 peer、TLS identity、request bytes 建立同一 trace；限制是需要嚴格實作 HTTP/1.1 framing，且 proxy-only 網路會不可用。
2. **Chromium navigation + DNS preflight。** 不採用。即使先查 DNS，也無法用現有 Electron 介面證明 Chromium 最後 dial 的 IP 就是已核准答案；redirect、frame、subresource 與 worker 又擴大 egress 面。
3. **普通 Node `fetch`/`https.request`。** 不採用。若不掌握 socket 建立與 payload 時序，就不能把 resolver snapshot、numeric dial、remote tuple 與 TLS identity綁成證據；自動 pooling、代理或隱含 headers 也會模糊不變量。

## 2. 目標模組與檔案責任

| 檔案 | 責任 | 不得承擔的責任 |
|---|---|---|
| `src/browser-search/blocked.js`（新增） | 唯一 blocked adapter，固定回覆 `network-isolation-unverified`，cancel/dispose 為 no-op | 不 import resolver、transport、parser、service；不讀 env/argv/settings |
| `src/browser-search/policy.js`（修改） | 純函式 canonicalize HTTPS URL、special-use hostname/IP policy、IP canonical key | 不做 DNS、socket、redirect、logging |
| `src/browser-search/resolver.js`（新增） | 每次 hop 建立獨立 `dns.promises.Resolver`，固定使用 `1.1.1.1`／`8.8.8.8`、並行查 A/AAAA，回傳有界完整 snapshot | 不選 URL、不 dial、不 cache、不接受 caller 自訂 DNS server |
| `src/browser-search/http-response.js`（新增） | 增量解析嚴格 HTTP/1.1 response、header/framing/body/charset 上限 | 不做 socket、redirect follow、DOM parse |
| `src/browser-search/transport.js`（修改） | `fetchHop()` 深模組：policy → resolver →全答案檢查 → numeric dial → peer → TLS → GET → response classify | 不 follow redirect、不 parse HTML、不接收 caller headers/body |
| `src/browser-search/parser.js`（修改） | request-scoped inert `about:blank` parser、deny hooks、輸出 schema、async dispose | 不 load remote/file/data/blob URL、不持有產品 preload/IPC、不做 URL DNS policy |
| `src/browser-search/service.js`（修改） | 固定搜尋 URL、redirect orchestration、候選/頁數/文字總量、request epoch、結果映射 | 不解析 DNS、不看 address/cert/headers、不接受 runtime verified bool |
| `src/browser-search/production.js`（最後 enablement 才新增） | 明確組裝 production resolver/transport/parser/service | 不讀 env/argv/renderer input 決定是否啟用 |
| `validation/browser-search/*`（新增） | 固定 scenario catalog、TEST-ONLY UI/runner、bounded evidence sink | 不接受 arbitrary URL/header/query/key；不進 production ASAR |
| `electron-builder.transport-validation.yml`（新增） | 只建 validation artifact，main 指向固定 runner | 不改 production `package.json` version/output |

`extract.js` 的舊 DOM helper 不再位於 production data path；可保留供既有測試或後續移除審查，但本計畫不要求為清理而刪除它。

## 3. 明確介面與資料結構

以下是要鎖定的 interface；欄名與錯誤碼在相鄰任務間不得自行改名。

```js
// resolver.js
// status 只允許 ok 或 nodata；NXDOMAIN/SERVFAIL/timeout/malformed 直接回傳失敗結果。
{
  hostname: 'public.example',
  a:    { status: 'ok', answers: [{ address: '93.184.216.34', family: 4, ttl: 60 }] },
  aaaa: { status: 'nodata', answers: [] },
  endpoints: [{ address: '93.184.216.34', family: 4, ttl: 60, key: 'v4:c0000201' }]
}
```

```js
// transport.js external interface; service 只能學到 HTTP outcome。
const transport = createPinnedHttpsTransport({ resolverFactory, connect, tlsConnect, clock, evidenceSink });
await transport.fetchHop(url, {
  requestId,             // /^[A-Za-z0-9_-]{1,64}$/，由 main 產生
  hopIndex,              // integer 0..5
  purpose,               // 'search' | 'page'
  signal,                // AbortSignal
});

// 成功 body
{ ok: true, kind: 'body', requestUrl, statusCode, mediaType, charset: 'utf-8', body, bodyBytes }

// redirect；只讓 Location 離開 transport，不回傳 headers map 或 body
{ ok: true, kind: 'redirect', requestUrl, statusCode, location }

// 固定失敗；details、Error、socket、DNS snapshot 不離開 transport
{ ok: false, status: 'blocked' | 'timeout' | 'cancelled' | 'needs-user', code }
```

```js
// parser.js；每個 search request 建立自己的 instance
const parser = await createInertDocumentParser({ BrowserWindow, session, clock, evidenceSink });
await parser.parseSearchResults(html, baseUrl, { signal });
// => Array<{ title: string, url: string, snippet: string }>，最多 50 筆

await parser.parsePage(html, { signal });
// => { title: string, text: string }

await parser.dispose();
```

```js
// service.js；無 verified 參數
const service = createPinnedBrowserSearch({ transport, parserFactory, now, overallTimeoutMs: 45_000 });
await service.search({ petId, requestId, query, signal });
service.cancel(petId, requestId);
await service.dispose(petId);
```

### Transport 不變量

- 一次 `fetchHop()` 只解析一次 hostname；同一 snapshot 內查 A 與 AAAA，兩者都 settle 後才評估。
- A 或 AAAA 的 `NODATA` 可被明記；`NXDOMAIN`、`SERVFAIL`、timeout、cancel、格式錯誤、family 不符、答案過多皆 fail-closed。兩族皆 NODATA 亦 fail-closed。
- 每族最多 16 答案、合計最多 32；超過上限不得截斷後繼續，固定回覆 `dns-too-many-answers`。
- `endpoints` 每一筆都先經同一 policy；只要一筆不允許，dial count 必須是 0。
- 選址規則固定且可測：保留 resolver 回傳次序，A 在前、AAAA 在後，去重後選第一筆；不在同一 hop 自動 fallback 到第二個 IP，避免重複 GET 與證據歧義。
- `net.connect()` 的 `host` 必須是 selected numeric IP，且明確給 `family` 與 `port:443`；不用 pool、不用 proxy、不用 hostname dial。
- raw socket `connect` 後，以 canonical byte-key 比對 `remoteAddress`，並比對 family/443；不一致立即 destroy，GET bytes 必須為 0。
- TLS 使用既有 raw socket、原 canonical hostname 作 `servername`，`rejectUnauthorized:true`、`checkServerIdentity:tls.checkServerIdentity`、`ALPNProtocols:['http/1.1']`；`secureConnect` 後另查 `authorized===true` 且 `authorizationError` 為空，才可寫 request。
- 每 hop 只有一個 GET；request body 永遠 0 bytes；caller 傳入任何多餘 options 都不會成為 request material。
- redirect 不在 transport 內跟隨；service 每跳重新呼叫 `fetchHop()`，所以每跳必有新 resolver、socket 與 TLS。
- 所有 failure path 與 abort path 都 destroy raw/secure socket、解除 listener、停止 timer；late DNS/socket/data/end 不能改寫已 settle outcome。

### 固定錯誤碼

```text
request-aborted
invalid-request
url-invalid
url-blocked
request-target-too-large
dns-timeout
dns-nxdomain
dns-failed
dns-invalid
dns-too-many-answers
dns-non-public
connect-timeout
connect-failed
connect-closed
peer-mismatch
tls-timeout
tls-failed
tls-unauthorized
tls-client-certificate-required
tls-protocol
response-timeout
response-closed
response-invalid
response-header-too-large
response-framing
response-too-large
response-auth-required
response-status
response-redirect-invalid
response-attachment
response-content-type
response-charset
response-content-encoding
redirect-invalid
redirect-loop
redirect-limit
parser-not-about-blank
parser-egress-blocked
parser-input-too-large
parser-output-invalid
parser-timeout
search-timeout
browser-search-parser-cancelled
browser-search-parser-disposed
```

service 只將 `request-aborted` 映射 `cancelled`，所有 `*-timeout` 映射 `timeout`，401/407 與 client-certificate-required 映射 `needs-user`，其餘一律 `blocked`。`needs-user` 只表示不能匿名讀取；不得啟動登入、Cookie、client certificate 或人工 browser automation。

## 4. URL、DNS、TCP 與 TLS 細節

### URL 與 hostname

- 使用 `new URL()` 後只接受 `https:`、無 username/password、port 空或 `443`、hostname 非 IP literal。
- hostname 由 URL canonical form 轉小寫、移除末尾 dot；必須是 ASCII/Punycode 合法 DNS 名稱，總長不超過 253、每 label 1..63、至少兩個 labels。
- 拒絕 IANA special-use domain snapshot 所列 suffix，以及至少 `localhost`、`.localhost`、`.local`、`.test`、`.invalid`、`.example`、`.onion`、`home.arpa`；snapshot 日期與來源 hash 放入測試 fixture，不在 runtime 下載。
- 清除 fragment；`pathname + search` 的 UTF-8/ASCII wire bytes 不超過 8192。超過即在 DNS 前回覆 `request-target-too-large`。

### 公開 IP policy

- 實作者依 IANA [IPv4 Address Space](https://www.iana.org/assignments/ipv4-address-space/)、[IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry/) 與 [IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry/) 產生人工審核的固定測試表；runtime 不下載、不信任遠端 registry。
- IPv4准入限於已分配的一般unicast且不落入不具全球可達性的special-use；IPv6准入限於當前一般global-unicast配置並套用special-use排除。即使registry標示globally reachable，IPv4-mapped/compatible、NAT64/translation、6to4、Teredo、benchmark/documentation、multicast、unspecified、loopback、link/site/local、ULA與future/reserved ranges仍拒絕，以避免嵌入或轉譯到非公開IPv4的歧義。
- IPv4/IPv6 都轉為 canonical byte-key；policy、selected endpoint 與 raw socket peer 使用同一 key，比較不依賴 IPv6 壓縮字串表示。
- registry 更新只可透過新 source review + test fixture 變更；不能讓 production 啟動時自動擴大准入。

### Resolver

- 每 hop 建立新的 `dns.promises.Resolver({ timeout: 5_000, tries: 1 })`，固定呼叫 `setServers(['1.1.1.1', '8.8.8.8'])`；第一順位為 Cloudflare 1.1.1.1，逾時或其他 resolver error 才由 Node 使用 8.8.8.8。這些 resolver 只是 DNS 來源，不取代所有答案檢查、numeric dial、實際 peer 比對與 TLS 驗證。
- 同時呼叫 `resolve4(hostname,{ttl:true})` 與 `resolve6(hostname,{ttl:true})`。[Node DNS文件](https://nodejs.org/api/dns.html)說明這些方法直接做DNS query，與`dns.lookup()`的OS name-resolution surface不同；本設計因此不把hosts file或Chromium resolver當成證據。
- resolver instance 僅屬於該 hop；abort 時呼叫 `resolver.cancel()`，並以 settled guard 防止 late answer dial。
- snapshot 先驗證 schema、family、TTL 為有限非負數、數量與 canonical uniqueness，再一次性做全答案 public check。

### TCP/TLS

- 每 hop 新建 socket，`allowHalfOpen:false`，不重用 agent/pool。
- TCP、TLS 與 response phase 各有 timer，另有 hop 與整回合 absolute deadline；任何 timeout 都經同一 abort path。
- TLS 只允許 HTTP/1.1；若 ALPN 明確協商到其他 protocol，回覆 `tls-protocol`。未協商 ALPN 可視為 HTTP/1.1，但必須在測試與 trace 中明記。
- 證據模式可記錄 public leaf certificate `fingerprint256`；production normal mode 不記 cert、hostname 或 address 到一般 app log。

## 5. HTTP request/response、大小、編碼與時間上限

### Request allowlist

```http
GET /path?query HTTP/1.1
Host: canonical.example
Accept: text/html, text/plain
Accept-Encoding: identity
Connection: close

```

不得加入 User-Agent、Cookie、Authorization、Proxy-Authorization、Origin、Referer、Accept-Language、client hint、caller/model header 或 request body。`Host` 不含 port，因只允許 443。

### Response limits

| 項目 | 上限／規則 |
|---|---|
| Status/header deadline | GET 後 5,000 ms 內收到完整 header |
| Response absolute deadline | GET 後 10,000 ms；chunk 到來不可續期 |
| Per-hop absolute deadline | 20,000 ms，涵蓋 DNS/TCP/TLS/response |
| Whole search deadline | 45,000 ms；含 search page、最多三候選頁、redirect 與 parser |
| Header bytes | 32,768 bytes，含 status line 與終止 CRLF |
| Header fields | 最多 100；obs-fold、NUL、非法 token、控制字元拒絕 |
| Redirect Location | 最多 8,192 bytes；只回傳該欄位，不回傳其他 headers |
| Decoded body | 最多 1,000,000 bytes |
| Wire body | 最多 1,100,000 bytes，防止 pathological chunk overhead |
| Parser input | 最多 1,000,000 characters；transport byte limit 先行 |
| Search results | 最多 50 candidates；service 最多嘗試前 3 筆 |
| Page output | title 240 chars、text 6,000 chars |
| Search aggregate | 每次 service 最多 3 sources、18,000 source chars；chat loop 仍最多 2 searches/6 sources |

### Response classification

- 只接受 HTTP/1.0 或 HTTP/1.1 的單一 final response；1xx、多個 response、畸形 status line 都 `response-invalid`。
- 401、407 固定 `response-auth-required`；其他非 2xx 與非允許 redirect 為 blocked。允許 redirect status 僅 301/302/303/307/308。
- 2xx body 的 media type只允許 `text/html`、`text/plain`；`Content-Disposition: attachment` 拒絕。
- `Content-Encoding` 只允許缺省或 `identity`；不解 gzip/br/deflate。
- charset 只允許缺省、`utf-8`、`utf8`、`us-ascii`；一律用 fatal UTF-8 decoder，非法 bytes 或宣告其他 charset 回覆 `response-charset`。
- framing 三選一：合法單一 `Content-Length`、單一 `Transfer-Encoding: chunked`、或 connection-close。`Content-Length + Transfer-Encoding`、重複/衝突 framing header、非 chunked transfer coding、無效 chunk size、chunk extension、非空 trailer 都 `response-framing`。
- security-relevant headers（Content-Length、Transfer-Encoding、Content-Type、Content-Encoding、Content-Disposition、Location）重複即拒絕；其他 headers 只計數後丟棄，尤其不保存或套用 Set-Cookie。
- redirect 收到完整 header 後即可分類並 destroy socket，不讀、不解析、不保存 redirect body。

## 6. Redirect 與 service orchestration

- `searchUrl(query)` 仍是唯一搜尋入口；renderer/model 只提供已由 `normalizeSearchQuery()` 驗證的 query，不能提供搜尋 URL。
- `fetchFollowingRedirects()` 只呼叫 `transport.fetchHop(current,{requestId,hopIndex,purpose,signal})`。不得先呼叫 resolver 或 policy 的 DNS 函式。
- service 可用純 `canonicalizePublicHttpsUrl()` 在下一次 fetch 前正規化 Location、解析 relative URL 並做 syntax/special-use hostname precheck；transport 仍在實際 hop 內重做完整 policy 與 DNS。
- `seen` 保存 canonical URL（含 path/search、不含 fragment），因此 A → B → A 在第三次 network call 前回覆 `redirect-loop`。
- hopIndex 0 是初始 URL；最多跟隨 5 個 redirects。若 hopIndex 5 的 response 仍是 redirect，回覆 `redirect-limit`，不得建立第 7 個 request。
- 每個 candidate 最多嘗試一次；前三個 candidate 包含被 policy/transport 拒絕者，避免 hostile search page 用大量壞候選造成無界掃描。
- search result parse 失敗或 parser egress 使整次 search blocked；個別 candidate page 的一般 HTTP/content failure可跳過，但 parser egress、cancel、timeout 與 lifecycle stale 必須終止整次 search。
- 每個 request 擁有自己的 parser instance；在 `search()` finally 中 await dispose。`dispose(petId)` 只取消該 pet 的 active state，不銷毀其他 pet parser。

## 7. Inert parser 隔離 seam

### 建立與 readiness

- 使用唯一且不以 `persist:` 開頭的 partition；BrowserWindow `show:false`、`nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`、`webviewTag:false`、`devTools:false`，且 `preload` key 不存在。
- 所有 deny hooks 先安裝，再僅允許一次 programmatic `loadURL('about:blank')` 完成初始化。初始化完成後與每次 evaluate 前，`webContents.getURL()` 必須精確等於 `about:blank`；空字串、file/data/blob/remote URL 一律 `parser-not-about-blank`。
- BrowserWindow、webContents、session 不離開 parser module；service 只持有 parse/dispose interface。

### HTML data flow

- transport body 只是主程序字串；唯一解析方式是 `DOMParser.parseFromString(input,'text/html')`。
- 禁止把 untrusted HTML 傳給 `loadURL`、`loadFile`、data URL、blob URL、`document.write`、`innerHTML` of live document、`srcdoc` 或 remote navigation。
- extractor 先移除 `script/style/link/img/iframe/frame/object/embed/video/audio/source/track/form/meta/base/template/svg` 等 active/resource surfaces，再讀 title/text/link attribute。
- renderer execution result 回主程序後再做 schema validation：array 最多 50；每筆只有 bounded string `title/url/snippet`；page 只有 bounded `title/text`。多餘 key、非字串、過長、getter-like/非 plain data 或 invalid URL 皆 `parser-output-invalid`。

### 防禦與 poison-on-observation

- `webRequest.onBeforeRequest` 對任何非 `about:blank` request 先 poison 再 cancel；`onBeforeRedirect` 同樣 poison。
- `will-navigate`、`will-frame-navigate`、`will-redirect`、`did-start-navigation`、`did-navigate`、`did-frame-navigate` 對初始化完成後的任何非 about:blank event poison；可取消的 event 先 `preventDefault()`。
- `setWindowOpenHandler` 永遠 deny 並 poison；`will-attach-webview` preventDefault 並 poison；`will-download` 先 preventDefault、再 cancel item、再 poison。
- permission check/request 永遠 false 並 poison；不註冊 protocol handler、不允許 openExternal。
- `session.serviceWorkers` 監聽 `registration-completed` 與 `running-status-changed`；任一事件 poison。evaluate 前後及 dispose 後以 `getAllRunning()` 驗證為空。
- 在 about:blank main world 安裝只作 defense-in-depth 的 sentinels，讓 `fetch`、XHR、WebSocket、EventSource、Worker、SharedWorker、serviceWorker.register、window.open 嘗試增加 bounded counter 並 throw。sentinel 不取代 Electron hooks或外部 DNS/HTTPS observer。
- 一旦 poison，所有 pending parse reject、之後所有 parse 都 reject，且不得回傳 partial result。

### Cancel/dispose

- abort 立即使 caller 收到固定 cancelled error；late `executeJavaScript` result 被 settled guard 丟棄。
- `dispose()` 的安全效果必須同步發生：先標記disposed/poison、reject pending、移除handlers並destroy BrowserWindow；它再回傳Promise，供caller await `closeAllConnections()`、`clearStorageData({dataTypes:[...]})`與service worker running count 0。service的request `finally`必須await；reset/remove/quit等繼續存活的lifecycle也要await或由可測的drain機制收斂，不能fire-and-forget。
- Electron Session 沒有可依賴的 public `destroy()`；計畫不得聲稱已銷毀 session object。可宣稱的只有 window destroyed、connections closed、storage clear completed、service worker count 0、partition 非持久且不再重用。

## 8. Production gate 狀態機與 hidden bypass 禁令

```text
BLOCKED_BASELINE
  └─ A-D 同一 validation hash 全綠
     → EVIDENCE_COMPLETE_FOR_ENABLEMENT_REVIEW（production 仍 blocked）
        └─ 使用者另行明確核准 source wiring + version
           → ENABLEMENT_CANDIDATE（不可公開發佈）
              └─ 同一 candidate hash 通過 E/F + independent review
                 → RELEASE_ELIGIBLE
```

- Task 1 先讓 `main.js` import `blocked.js`。active `service.js` 是否存在、測試是否通過，都不會改變正式入口。
- 移除 `service.js` 的 `verified` boolean 與「缺 adapter 就自建」分支。active factory 命名 `createPinnedBrowserSearch`，只有 code import 能使用；名稱本身不宣稱已通過 release gate。
- 最終 enablement 是可見的 source diff：`main.js` 從 blocked adapter 改為 import/construct `production.js`。不允許同時保留 runtime conditional。
- source test 與 unpacked ASAR audit 必須搜尋 runtime `verified:`/`verified=` property、`network-isolation-unverified`、`process.env`、`process.argv`、browser-search IPC、arbitrary URL/header/body 接口與 provider tool fields。
- validation runner 放在 `validation/`，default production build.files 不包含它；validation builder config 不得改 production package config。若 validation entrypoint 出現在 production ASAR，Gate A 直接失敗。
- `preload.js`/renderer 仍只能提交 chat input、`messageId + sourceId`；不得新增 fetch URL、open URL、headers、scenario 或 gate IPC。
- release eligibility 是 artifact/hash 的外部決策，不是 app 內布林。緊急回滾靠重新分發保留的 blocked EXE，不靠可被切換的隱藏 kill switch。

## 9. TDD 任務拆分、ownership、驗證與停止條件

### Task 1: Freeze production on a dedicated blocked adapter

**Owner:** Luna/high-1。完成並經主控審查後，才允許其他 task 修改 active modules。

**Files:**
- Create: `desktop-app/src/browser-search/blocked.js`
- Modify: `desktop-app/src/main.js`
- Modify: `desktop-app/test/browser-search-service.test.js`（只移動 blocked factory assertions）
- Modify: `desktop-app/test/main-state.test.js`（只驗證 main import/wiring）

**Interfaces:**
- Produces: `createBlockedBrowserSearch(): {search,cancel,dispose}`；`search()` 固定 `{status:'blocked',sources:[],reason:'network-isolation-unverified'}`。
- Consumes: 無 active transport/parser interface。

- [ ] 寫 RED test：即使呼叫時夾帶 `verified:true`、transport、parser、env/argv fixture，blocked adapter 仍零 DNS/zero adapter calls。
- [ ] 寫 RED main-state test：production main factory 只建立 blocked adapter，不把 BrowserWindow/session/setting 傳給 active service。
- [ ] 執行 `node --test test/browser-search-service.test.js test/main-state.test.js`，確認新增測試因 module/wiring 尚不存在而 fail。
- [ ] 最小實作 blocked module 與 main import；不改 active service 行為。
- [ ] 重跑同一命令，記錄 pass/fail/skip；再跑 `node --check src/browser-search/blocked.js` 與 `node --check src/main.js`。
- [ ] 檢查 scoped diff；若 renderer/IPC/package/assets/release 有變更，停止並還原本 task 自己的越界變更。

**停止條件:** main 仍能由 runtime value 建 active service，或改動影響普通 chat/action/diary；不得進 Task 2。

### Task 2: Canonical public endpoint policy and resolver snapshot

**Owner:** Luna/high-2。

**Files:**
- Modify: `desktop-app/src/browser-search/policy.js`
- Create: `desktop-app/src/browser-search/resolver.js`
- Modify: `desktop-app/test/browser-search-policy.test.js`
- Create: `desktop-app/test/browser-search-resolver.test.js`
- Create: `desktop-app/test/fixtures/iana-public-endpoints.js`

**Interfaces:**
- Produces: `canonicalizePublicHttpsUrl(value)`, `canonicalAddress(value,family)`, `assertAllowedPublicEndpoints(endpoints)`, `createSystemResolverFactory()`。
- Produces resolver snapshot exactly matching section 3。

- [ ] 以 IANA registry 當日快照建立 table-driven RED tests；含所有非 globally reachable ranges與本產品額外拒絕的 translation/tunnel/mapped/compatible ranges。
- [ ] 補 hostname RED tests：special-use suffix、IDN canonicalization、trailing dot、label/host length、port、credentials、IP literal、fragment、8192-byte target。
- [ ] 補 resolver RED tests：A+AAAA success、單族 NODATA、雙 NODATA、NXDOMAIN、SERVFAIL、timeout、abort、malformed/family mismatch、duplicate、>16 each、>32 total。
- [ ] 補 canonical peer-key RED tests：各種等價 IPv6 表示得到同一 key，IPv4-mapped IPv6 永不等於可允許 IPv4 endpoint。
- [ ] 執行 `node --test test/browser-search-policy.test.js test/browser-search-resolver.test.js`，確認 RED 原因對應缺少新 interface，而不是 fixture 錯誤。
- [ ] 最小實作純 policy 與 per-hop Resolver adapter；不建立 socket、不新增 cache，正式 resolver 固定設定 `setServers(['1.1.1.1', '8.8.8.8'])`。
- [ ] 重跑 focused tests 與兩檔 `node --check`。
- [ ] reviewer 對照 registry fixture 的來源日期/hash與手工例外，確認沒有「未知 prefix 預設公開」的分支。
- [x] production resolver 固定以 `1.1.1.1` 為 primary、`8.8.8.8` 為 backup，並以測試鎖定順序；仍需保留所有答案與實際 peer 的後續驗證。

**停止條件:** 任一 malformed/special endpoint 被視為 allowed、任何答案被截斷後繼續、或 resolver late result 可在 abort 後被使用。

### Task 3: Strict incremental HTTP/1.1 response decoder

**Owner:** Luna/high-3；可與 Task 2/4 平行，因 ownership 不重疊。

**Files:**
- Create: `desktop-app/src/browser-search/http-response.js`
- Create: `desktop-app/test/browser-search-http-response.test.js`

**Interfaces:**
- Produces: `createHttpResponseDecoder({requestUrl,clock})`；`push(Buffer)`回傳`null`或完成的body/redirect outcome，`finish()`在connection-close時回傳完成outcome或固定code。沒有第三個隱含result channel。

- [ ] 寫 RED tests：header split across chunks、Content-Length、connection-close、合法 chunked、redirect early completion。
- [ ] 寫 adversarial RED matrix：CL+TE、duplicate security headers、obs-fold、invalid token/NUL、oversized header/count/location/body/wire、invalid chunk size/extension/trailer、1xx/304/401/407、attachment、bad media type/charset/content-encoding、invalid UTF-8。
- [ ] 為每個 size boundary 加 `limit-1/limit/limit+1` cases，並斷言 decoder 不回傳 headers map、Set-Cookie 或 partial body。
- [ ] 執行 `node --test test/browser-search-http-response.test.js`，確認 RED。
- [ ] 最小實作 state machine；不引入第三方 parser、不做 redirect follow。
- [ ] 重跑 focused tests、`node --check src/browser-search/http-response.js`，並做 reviewer mutation check：放寬任一 framing rule 時對應 test 必須變紅。

**停止條件:** ambiguous framing 可被接受、上限只在完整 buffer 後檢查、或 invalid UTF-8 被 replacement character 靜默接受。

### Task 4: Request-scoped inert parser with observable zero egress

**Owner:** Luna/high-4；可與 Task 2/3 平行。

**Files:**
- Modify: `desktop-app/src/browser-search/parser.js`
- Modify: `desktop-app/test/browser-search-parser.test.js`
- Create: `desktop-app/test/browser-search-parser-electron.test.js`

**Interfaces:**
- Produces: async `createInertDocumentParser(...)` 與 section 3 parse/dispose interface。

- [ ] 先更新 fake Electron surface，讓測試可觀測 initial `loadURL('about:blank')`、getURL、did-start/did-navigate、serviceWorkers、closeAllConnections、awaited storage clear。
- [ ] 寫 RED readiness tests：空 URL、file/data/blob/remote、初始化未完成、evaluate 前 URL 被改動都固定拒絕。
- [ ] 寫 RED output-schema tests：array element 非 object/多餘 key/非字串/超限、page shape 錯誤、late result。
- [ ] 寫 RED poison tests：request、redirect、frame、programmatic navigation、popup、webview、download、permission、worker/shared worker/service worker 任一事件後，pending 與後續 parse 都 reject、無 partial data。
- [ ] 寫 Electron integration fixture：自然 hostile HTML 與分離負控制 instance；驗證 about:blank、preferences、sentinel counters、service worker count、dispose cleanup。
- [ ] 執行 `node --test test/browser-search-parser.test.js`，確認 unit RED；Electron file 在沒有 `PET_DESKTOP_TESTS=1` 時明確 skip，不得假裝 pass。
- [ ] 最小實作 readiness、schema、poison、async cleanup。
- [ ] 執行 unit；再於保留 Electron sandbox 的 Windows 環境執行 `$env:PET_DESKTOP_TESTS='1'; node --test test/browser-search-parser-electron.test.js`。
- [ ] 記錄 unit 與真 Electron fixture 分欄結果；fixture 仍不等於公網 observer evidence。

**停止條件:** URL 不是精確 about:blank、任何 event observed 後仍成功、service worker running count 非零、clear/close 未 await、或 late result 可逃出。

### Task 5: Atomic pinned TCP/TLS `fetchHop()`

**Owner:** Luna/high-5；必須等待 Task 2/3 interface 通過 review。

**Files:**
- Modify: `desktop-app/src/browser-search/transport.js`
- Modify: `desktop-app/test/browser-search-transport.test.js`

**Interfaces:**
- Consumes: Task 2 resolver/policy與 Task 3 decoder。
- Produces: section 3 的唯一 `fetchHop()`；不再公開 `resolvePublic()`。

- [ ] 重寫 harness 的 RED assertions，使一次 hop 恰好一次 A+AAAA snapshot、一次 selected numeric dial，service/caller看不到 endpoint details。
- [ ] 補 RED tests：全答案先驗證；mixed answer dial=0；IPv4與IPv6 numeric dial；canonical remote tuple；peer mismatch/TLS failure均 request bytes=0。
- [ ] 補 TLS RED tests：SNI/`checkServerIdentity`/rejectUnauthorized/ALPN、authorized false、authorizationError、client certificate、fingerprint evidence allowlist。
- [ ] 補 request RED tests：精確四 headers、GET/body=0、fragment移除、target bytes boundary、caller多餘 material完全忽略。
- [ ] 補 phase/hop/abort RED tests：DNS/TCP/TLS/header/response/20s hop deadlines、close-only socket、late events、所有 timer/listener/socket cleanup。
- [ ] 執行 `node --test test/browser-search-transport.test.js test/browser-search-http-response.test.js test/browser-search-policy.test.js test/browser-search-resolver.test.js`，確認 RED。
- [ ] 最小實作 atomic fetchHop；刪除因本 task 造成的舊 `resolvePublic` unused code，不改 service。
- [ ] 重跑 focused tests、`node --check src/browser-search/transport.js`，並以 fake trace 逐筆驗證事件序列。

**停止條件:** hostname dial、第二次 DNS、peer check在 TLS/GET 後、TLS unauthorized仍write、或 failure後出現 `request-written`。

### Task 6: Service redirects, per-request parser and fixed result contract

**Owner:** Luna/high-6；等待 Task 4/5。

**Files:**
- Modify: `desktop-app/src/browser-search/service.js`
- Modify: `desktop-app/test/browser-search-service.test.js`
- Modify: `desktop-app/test/browser-search-extract.test.js`（只更新 production data path assertion）

**Interfaces:**
- Consumes: `transport.fetchHop()` 與 `parserFactory()`。
- Produces: `createPinnedBrowserSearch()`，沒有 `verified` option。

- [ ] 寫 RED test 並刪除舊 fake `resolvePublic` assumption：每 hop 只呼叫一次 fetchHop；service 永不看到 DNS/address/cert/headers。
- [ ] 補 redirect RED matrix：relative、五跳成功、第六跳禁止、A→B→A第三 fetch 前停止、invalid/missing Location、所有不允許 scheme/host/port。
- [ ] 補 candidate RED tests：最多前三筆（包括拒絕者）、每頁/總字數、search parser egress整回合 blocked、page parser egress整回合 blocked、普通頁失敗可跳過。
- [ ] 補 parser ownership RED tests：每 request新 instance；cancel/dispose只影響所屬 pet/request；finally await dispose；其他 pet不受影響。
- [ ] 補 overall 45s、edit/clear/collapse/capability-off/pet-remove/sleep/quit 的 stale/late result assertions（跨 main lifecycle留 Task 7）。
- [ ] 執行 `node --test test/browser-search-service.test.js test/browser-search-extract.test.js`，確認 RED。
- [ ] 最小實作 service；移除 `verified` boolean、auto-create adapters與 `resolvePublic` calls。
- [ ] 重跑 focused tests與 `node --check src/browser-search/service.js`。

**停止條件:** 任何 redirect hop未經 fetchHop、loop要到第三次 network才發現、parser poison被當成可跳過頁面、或一隻 pet dispose 破壞其他 request。

### Task 6A: Robots Exclusion Protocol policy

**Owner:** Luna/high-6A；等待 Task 5/6 的 transport 與 redirect contract。

**Goal:** 在讀取搜尋頁與候選頁前，透過同一個 pinned HTTPS transport 讀取該 authority 的 `/robots.txt`，並遵守可解析的 `User-agent`、`Allow`、`Disallow` 規則；robots policy 只限制 crawler 行為，不取代 DNS、TCP、TLS、parser egress 等安全閘。為維持本產品 fail-closed，robots 無法成功取得或驗證時拒絕目標頁，即使標準對部分 unavailable 狀態允許 crawler 存取。

**Files:**
- Create: `desktop-app/src/browser-search/robots.js`
- Create: `desktop-app/test/browser-search-robots.test.js`
- Modify: `desktop-app/src/browser-search/service.js`
- Modify: `desktop-app/test/browser-search-service.test.js`

**Interfaces:**
- `createRobotsPolicy({ transport, userAgent, now })`；只接受既有 `transport.fetchHop()`，不接受任意 caller URL、headers、body 或 Cookie。
- `policy.check(url, { requestId, hopIndex, signal })` 回傳固定 `{ allowed: boolean, code }`；不得把 robots 原文、raw Location 或 response headers 傳出 service。
- 每個 request 對 authority 使用 bounded in-memory cache；不把 robots 原文寫入設定、日記、聊天記憶或一般 log。

- [x] 寫 RED tests：`User-agent: *`、特定 agent、Allow/Disallow 最長匹配、相同長度 Allow 優先、空 group、UTF-8、百分比編碼與 query/path 比對。
- [x] 寫 RED tests：robots redirect 最多五跳、4xx unavailable、5xx/network unreachable、malformed line、大小上限、timeout、cancel、不同 authority 不共用規則。
- [x] 寫 service RED tests：robots deny 時不得取得目標頁；search/page redirect 的每個新 authority 都重新檢查；robots 失敗採明確 fail-closed，不得繞過到普通 fetch。
- [x] 以公開測試端點做功能驗證：你提供的 allow/readonly robots、httpbin response；BadSSL 不作 robots 規則來源。
- [x] 最小實作 parser、bounded cache 與 service seam；不修改 transport 的 DNS/TCP/TLS policy。
- [x] 重跑 focused/full tests，並確認 robots 原文與 sensitive URL 不出現在結果、log、evidence 或 persistence。

**停止條件:** robots 讀取可接受任意 caller material、規則失敗時意外放行、cache 跨 authority 污染、parser/transport 錯誤被吞掉，或把 robots 當成 SSRF／egress 安全證明。

### Task 7: Production bypass and lifecycle integration guards

**Owner:** Luna/high-7；等待 Task 6。

**Files:**
- Modify: `desktop-app/test/main-state.test.js`
- Modify: `desktop-app/test/chat-session.test.js`
- Modify: `desktop-app/test/ai-providers.test.js`
- Modify: `desktop-app/test/browser-search-probe.test.js`
- Modify production source only if a RED test proves a scoped defect in `main.js`、`chat/session.js` 或 `ai/providers.js`

**Interfaces:**
- Verifies blocked adapter、strict search protocol、source IDs、lifecycle and provider request bodies；不建立 production active wiring。

- [ ] 寫 static/runtime RED guards：production main不 import `production.js`/active service；沒有 env/argv/settings/IPC gate；renderer不能提交 URL/header/body。
- [ ] 對每個 provider與 `search-protocol` request body 斷言不存在 `tools`、`google_search`、`web_search`、browser URL與source raw HTML。
- [ ] 驗證 source opening仍只傳 `messageId+sourceId`，main再取回並做 HTTPS syntax policy；historical source無ID不可開。
- [ ] 對 send/edit/clear/collapse/capability off/pet remove/sleep/quit 加 cancel與 late source/delta/persistence零寫回測試。
- [ ] 執行 `node --test test/main-state.test.js test/chat-session.test.js test/ai-providers.test.js test/browser-search-probe.test.js`；新增測試先 RED，再做最小修正至 GREEN。
- [ ] 執行所有 browser focused tests；再執行 `$env:PET_DESKTOP_TESTS='1'; npm.cmd test`，記錄精確 total/pass/fail/skip。

**停止條件:** 需要恢復 provider native web tool、renderer URL或 runtime gate才能通過；production 保持 blocked並回報設計衝突。

### Task 8: Fixed-scenario validation EXE and bounded evidence

**Owner:** Luna/high-8；等待 Tasks 2–7 全綠。

**Files:**
- Create: `desktop-app/validation/browser-search/main.js`
- Create: `desktop-app/validation/browser-search/scenarios.js`
- Create: `desktop-app/validation/browser-search/evidence.js`
- Create: `desktop-app/validation/browser-search/index.html`
- Create: `desktop-app/electron-builder.transport-validation.yml`
- Create/Modify: `desktop-app/test/browser-search-validation-artifact.test.js`
- Do not modify: `desktop-app/package.json` version/output、production assets、existing releases

**Interfaces:**
- Runner accepts only compiled `scenarioId` allowlist；沒有 URL/header/query/key CLI或IPC。
- Evidence event fields只允許 `runId,scenarioId,requestId,hopIndex,seq,phase,hostname,address,family,port,statusCode,byteCount,mediaType,errorCode,boolean,fingerprint256`。

- [ ] 寫 RED artifact tests：default production build.files不包含 validation entrypoint；validation config main固定；runner拒絕未知scenario與所有URL/header/query參數。
- [ ] 寫 RED evidence tests：forbidden fields/value、過長ID、raw URL/path/query/Location/HTML/key-like value 不能serialize；事件phase順序可機器檢查。
- [ ] 寫固定 scenarios：A/AAAA normal、AAAA-only、mixed/private、NXDOMAIN/NODATA/timeout、peer mismatch、cert mismatch、redirect chain/loop/limit/unsafe Location、content/framing limits、hostile parser/negative controls/cancel/dispose。
- [ ] 最小實作 TEST-ONLY UI、runner與evidence sink；視窗永久顯示 TEST-ONLY，不包含正常聊天與任意輸入。
- [ ] 執行 artifact/evidence unit tests與 full suite。
- [ ] 建立新的 `release-transport-validation-<manifest-prefix>`，不得覆寫現有目錄；記錄 EXE/app.asar/config/scenario hashes。
- [ ] 解列 production safe ASAR與 validation ASAR，證明前者無 validation entrypoint，後者無 arbitrary controls。

**停止條件:** validation runner能接受任意 URL/header/query、出現在 production ASAR、輸出敏感資料或需要 admin/proxy/root CA。

### Task 9: Real Windows Gates A-D

**Owner:** Luna/high-9 負責執行與去敏證據；受控公開測試網域與 observer 由使用者/驗收者提供。

**Files:**
- Evidence only under a new non-release validation evidence directory；不修改 production source。

- [ ] Gate A：hash兩種artifact，啟動 blocked safe EXE證明搜尋結果仍 `network-isolation-unverified` 且observer DNS/HTTPS為0。
- [ ] Gate B：同一 hop關聯 A/AAAA snapshot、selected numeric IP、raw remote tuple、TLS authorized/SNI/fingerprint、GET observer；跑 mixed/private/NXDOMAIN/timeout/cert mismatch負例並證明GET hit=0。
- [ ] Gate C：五redirect成功、第六跳禁止、A→B→A、每種unsafe Location、每hop不同IP與每hop新完整trace。
- [ ] Gate D：自然 hostile HTML與分離負控制；about:blank/preferences、parser counters、DNS/HTTPS beacon 0、service worker 0、download/storage 0、cancel/dispose無late result。
- [ ] 由第二位reviewer只靠六份bounded evidence與hash重建結論。

**停止條件:** 缺受控public domain/authoritative DNS/HTTPS observer、Windows非標準使用者、無dual-stack卻想宣稱IPv6 pass、任何reject case出現payload/beacon，或hash不一致。結果只能是 `BLOCKED` 或 `EVIDENCE-COMPLETE-FOR-SEPARATE-ENABLEMENT-REVIEW`。

### Task 10: Explicit production enablement candidate, true model Gate E and release Gate F

**Owner:** 只有在使用者明確核准後才派 Luna/high-10；沒有核准即停止於 Task 9。

**Files:**
- Create: `desktop-app/src/browser-search/production.js`
- Modify: `desktop-app/src/main.js`（唯一 enablement wiring）
- Modify: `desktop-app/test/main-state.test.js`
- Modify: `desktop-app/package.json`（只有使用者核准的唯一新 version/output）
- Create: new release candidate directory；不得覆寫既有 release

**Interfaces:**
- `createProductionBrowserSearch({BrowserWindow,session})` 在 main process 內組裝 system resolver、pinned transport、request-scoped parser、verified service。
- 沒有 runtime enable/disable branch；`webQueryEnabled` 仍只控制是否提出搜索，不改 transport identity。

- [ ] enablement 前先 inventory package ProductVersion、所有 release dirs/EXE versions/hashes；把不一致交給使用者選定下一個未使用產品版本，不能自行推定 0.5.11/0.5.12/0.5.13。
- [ ] 寫 RED main-state test：預期 main明確import production factory且不存在 blocked/active runtime conditional；測試仍可注入 fake factory，不接觸公網。
- [ ] 只做 production.js與main import/construct的最小source diff；不改 renderer/UI/設定/資產。
- [ ] 重跑 focused/full Electron suite與 independent security review。
- [ ] 建立全新不可公開candidate，記錄EXE/app.asar/source manifest hash；檢查ASAR無validation entrypoint、無runtime gate、無provider native tools。
- [ ] Gate E：由設定UI寫入使用者核准的一次性低額可撤銷key；固定非敏感prompt必須走同一model `search → public pages → summarize`，且browser request、renderer、DOM、log/report/user-data leak detector count全0。
- [ ] 驗證搜尋續答不帶圖片、不執行action/diary/care/settings/IPC mutation；renderer只收到/persist `{id,title,url,retrievedAt,coverage}`，source text在persist前移除。
- [ ] 在DNS、socket、parser、第二次model call各取消一次；驗證late source/delta/persist為0。
- [ ] 遇CAPTCHA/login/consent/401/407/client cert即blocked並停止；不得帶Cookie或自動繞過。
- [ ] 移除UI key並在provider端撤銷；只保存removed/revoked booleans。
- [ ] Gate F：同一candidate hash重跑適用A-E、full suite、ASAR audit、第二人review；全部無partial/waiver才標 `RELEASE_ELIGIBLE`。

**停止條件:** API key可能外洩、model未實際search、provider/model snapshot改變、任何native search tool出現、source不是實際取得、mutation/late write、或candidate bits在驗收後改變。立即撤銷key、隔離candidate、回到blocked artifact。

## 10. 真 Windows／公開網域／真模型所需證據

### 可取得且必須取得

- EXE、app.asar、source manifest、scenario catalog 的 SHA-256與Windows/Electron/Node版本。
- 同一 `requestId/hopIndex` 的 A/AAAA回覆狀態與完整可見endpoint集合、selected numeric IP、`net.connect`參數、實際remoteAddress/family/port。
- TLS requested SNI、authorized boolean、authorizationError empty boolean、ALPN、公開leaf cert fingerprint；錯誤cert scenario的request bytes=0。
- HTTPS observer只記scenario hit count、method、header names、body bytes與secretMatch boolean；reject cases hit=0。
- parser session/webContents counters、about:blank、webPreferences、service worker running count、download/storage/connection cleanup與DNS/HTTPS beacon 0。
- 真model的provider/model ID與call/search/page/source counts；同一model snapshot、無native tool fields、mutation與late event counts為0。
- production blocked before/after，以及validation/candidate/blocked artifacts的hash分離。
- robots policy 的規則判定、每個 authority 的 bounded cache 命中，以及 deny/失敗時目標頁 GET 為 0；不得保存 robots 原文。

### 不可宣稱

- 不可宣稱看見全球GeoDNS所有答案；只能宣稱該resolver回合返回的A/AAAA全集合。
- 不可宣稱OS層或整台機器零egress；沒有WFP/driver/firewall時，只能對本模組call path、socket tuple與受控observer做證據。
- 不可宣稱抵抗遭入侵的Windows/Node/Electron、受信CA、DNS recursive resolver、BGP/route或公開server本身。
- 不可宣稱observer 0 hit是任意covert channel的數學證明；它只覆蓋固定beacon，加上source review/hooks/counters/hash形成組合證據。
- 不可宣稱validation EXE通過等於production bits通過；正式candidate hash必須另跑適用gate。
- 不可宣稱Session object被destroy；Electron public interface只能證明window destroyed、connections closed、storage cleared、service workers 0與partition未持久化。
- 不可宣稱proxy-only、TLS inspection、client-certificate或需登入的網路可用；在這些環境預期fail-closed。
- 不可因公開 `nip.io`/`sslip.io`、httpbin、BadSSL 或 Webhook.site 測試通過，就宣稱具有 DNS 控制、TCP peer observer、完整 TLS/GET 證據或 production ready。

## 11. Evidence bundle 與關卡判定

每次run只保存六類去敏檔案，每份另附SHA-256：

1. `artifact-manifest.json`
2. `transport-events.jsonl`
3. `redirect-verdicts.json`
4. `parser-verdict.json`
5. `model-e2e-summary.json`
6. `final-verdict.json`

Transport event order必須可機器驗證：

```text
url-policy-accepted
dns-start
dns-complete
all-addresses-public
address-selected
tcp-connected
peer-matched
tls-start
tls-authorized
request-written
response-classified
```

拒絕事件只可停止在失敗phase；其後不得有 `tcp-connected`、`tls-start` 或 `request-written`。任何缺欄、sequence跳號、hash不一致、observer不可用、人工猜測、waiver或partial都使final verdict為BLOCKED。

## 12. 版本、回滾與 blocked artifact 保留策略

- 現況 package宣告0.5.10，但存在0.5.11-safe與0.5.12-safe目錄，且後者文件稱內部ProductVersion仍0.5.10。這是版本inventory問題，不應由本計畫猜下一版。
- Tasks 1–9 不改 `package.json` version與default output，不覆寫任何release。validation artifact用非產品語義目錄 `release-transport-validation-<manifest-prefix>`。
- Task 10前由使用者依EXE ProductVersion、package version、release manifest選一個未使用產品版本；一次只改一處版本與一個新output directory。
- 保留至少一個已核對hash的blocked portable EXE及其app.asar/manifest，標記為rollback source；不要只保留資料夾名稱。
- candidate失敗時不使用`git reset --hard`、不刪使用者檔案、不覆寫failed evidence；把candidate標記`UNSHIPPABLE`並停止分發，實際回滾是重新提供保留的blocked EXE。
- 任何修正都產生新source/artifact hash，從Gate A重新開始；不得把舊綠色證據拼接到新bits。
- public release只有在同一candidate hash達到`RELEASE_ELIGIBLE`且使用者另行批准發佈後才能進行；本計畫不授權公開部署或發佈。

## 13. 建議 Luna/high 執行順序

```text
Task 1 blocked adapter
  ├─ Task 2 policy/resolver ─┐
  ├─ Task 3 HTTP decoder ───┼─ Task 5 atomic transport ─┐
  └─ Task 4 inert parser ───┘                           ├─ Task 6 service
                                                        └─ Task 7 integration guards
                                                             ↓
                                                        Task 8 validation EXE
                                                             ↓
                                                        Task 9 Windows Gates A-D
                                                             ↓ explicit user approval
                                                        Task 10 candidate + Gates E-F
```

- 主控若要平行，可同時派 Tasks 2、3、4，因檔案 ownership 分離；Task 5必須等2/3，Task 6必須等4/5。
- 每個task由新的Luna/high實作者執行，主控在下一task前做scoped diff、test evidence與interface name review。
- 安全關鍵Tasks 2、4、5、8、9、10應另做獨立review；reviewer不修改檔案，只回報finding，由原owner修正。
- 在目前整個`desktop-app/`為Git未追蹤的工作樹狀態下，未獲主控明確授權不得自行git add/commit/push；以檔案ownership、diff與evidence ledger作checkpoint。

## 14. 尚未解決的風險

- 固定Google HTML搜尋入口可能遇CAPTCHA、consent或markup變動；本設計選擇blocked，而不是Cookie、登入、automation或第三方搜尋API fallback，因此產品可用性可能不足。
- `dns.resolve4/resolve6` 的A與AAAA是同一hop關聯的兩個query，不是DNS協定中的原子snapshot；numeric pinning消除「驗證A卻dial B」的本地TOCTOU，但不能保證兩族回答同時刻一致。
- IANA registry會更新；固定snapshot有drift風險。更新必須人工審查，不能runtime拉取；在更新前policy可能過度拒絕新分配，這是偏安全的availability成本。
- 手寫HTTP/1.1 decoder是安全敏感實作；即使unit/adversarial tests通過，仍需獨立review與真server scenario。若decoder複雜度超出可審查範圍，應維持blocked，不改回普通fetch。
- Electron對dedicated/shared worker沒有等同WFP的OS層阻斷證明；about:blank、DOMParser inertness、sentinel、webRequest、serviceWorkers counters與外部beacon只能形成強組合證據，不能成為數學證明。
- 真model/API key gate需要使用者提供一次性key、核准provider/model與固定非敏感prompt；在此之前只能完成A-D，不能宣稱production ready。
- validation entrypoint與final candidate bits不同；因此A-D通過只允許進入enablement review，最終candidate仍須重新跑所有可重現gate。

## 15. Plan self-review 結論

- Spec coverage：舊Sol Gate A-F、DNS-to-socket、parser零egress、model/key、artifact分離、禁止方案與rollback均有對應task。
- Interface consistency：service只依賴`fetchHop()`，沒有`resolvePublic()`；parser是request-scoped async factory；blocked與active factory完全分離。
- Scope：只涵蓋production transport、parser isolation、service wiring、validation/release gate；不新增搜尋供應商、UI功能、assets或其他app能力。
- Ambiguity resolution：production「verified」明確定義為同一artifact hash通過gate後的外部release狀態，不是runtime boolean。
