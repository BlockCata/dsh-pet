# Pinned Public Reader 設計規格

日期：2026-09-15  
來源：Sol 設計報告 `browser-search-readonly-security-design-2026-09-15.md`，已獲使用者確認採用。

## 目標

讓沒有原生聯網能力的模型，透過桌寵內部的受控查詢流程讀取公開網頁摘要，再由同一個模型整理回答；正式啟用前必須以 fail-closed 安全關卡驗證。

## 架構

主程序使用 Pinned Public Reader：先解析公開 HTTPS hostname 的所有 A/AAAA 位址，再以選定的 numeric IP 建立 TCP/TLS socket，TLS 仍使用原 hostname 驗證 SNI 與憑證。HTML 不交給遠端 Chromium 導覽，而送入只載入 `about:blank`、無 preload、無網路權限的 inert DOM parser；parser 只回傳受限文字與 HTTPS 候選連結。

## 固定介面

- `createBrowserSearch({ BrowserWindow, session, resolveHost, transport, parser } = {})`
- `search({ petId, requestId, query, signal })`
- `cancel(petId, requestId)`
- `dispose(petId)`
- 結果狀態只允許 `ok`、`empty`、`needs-user`、`blocked`、`timeout`、`cancelled`。
- source 只允許 `{ id, title, url, retrievedAt, text, coverage }`，持久化前由聊天層移除 `text`。

## 網路邊界

- 只允許 HTTPS、port 443、無帳密、非 IP literal、非 localhost／`.local`／單標籤主機。
- DNS 必須全部是公開單播位址；混合公開／私有、空答案、格式錯誤、timeout 全部拒絕。
- 連線必須直接 dial 已驗證的 numeric IP；TCP connected 後比對 `remoteAddress`、family、443，通過後才允許 TLS/HTTP payload。
- TLS 使用原 hostname 的 SNI/憑證驗證；不接受錯誤憑證、不安裝自訂 CA、不送 Cookie、Authorization、Proxy-Authorization、Origin、Referer 或模型自訂 header。
- 只送無 body 的 GET；redirect 僅接受 301/302/303/307/308，最多 5 hops，每 hop 重新 DNS 驗證與 socket pin；不跟隨 HTTP、私網、credentials、JS/meta refresh。
- response 只接受 2xx 的 `text/html`、`application/xhtml+xml` 或核准的 `text/plain`；拒絕登入、401/407、client certificate、attachment、未知 encoding/type。
- raw/decompressed/body/page/total source、timeout、redirect 都有上限；資料只存在本回合記憶體，不建立下載檔或 cache。

## Parser 與權限

- hidden `BrowserWindow` 只載入 `about:blank`；`nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`、無產品 preload、`devTools:false`、非持久 partition。
- parser 對所有 HTTP(S)/WS(S)/file/data/blob/custom request、navigation、frame、popup、download、permission、worker 一律拒絕；任何觀測到的事件都使回合失敗。
- HTML 以 `DOMParser.parseFromString` 作 inert 解析，不執行遠端 JavaScript、CSS、圖片、iframe、form、worker 或 service worker。
- query gate 拒絕 API key、token、password、檔案路徑、URL credentials、長編碼資料與控制字元；不得以「同意」放行秘密，只能要求使用者改寫。
- 搜尋開始後不執行 action、diary、care、settings mutation 或圖片外送；來源仍由主程序依 `messageId + sourceId` 綁定。

## 生命週期與驗收

每個 request 以 `(petId, requestId, epoch)` 綁定；cancel、edit、clear、collapse、capability off、pet remove、sleep、quit 會中止 socket/parser 並阻止晚到資料寫回。所有安全測試先以 fake resolver/dialer/TLS/parser 建立可重現證據，再以 Windows portable EXE 驗證 DNS-to-socket、redirect、parser egress、真公開網站與真模型流程。任一安全證據不足時，factory 回傳 `blocked`，不提供 hidden production escape hatch。

## 明確非目標

不支援登入、cookies、CAPTCHA 自動操作、任意 URL/selector/JavaScript、表單、上傳、下載、外部電腦控制、proxy、WFP、driver、系統防火牆、根憑證、管理員 helper 或第三方搜尋 API。
