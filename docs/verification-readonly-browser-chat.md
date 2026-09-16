# 僅網頁查詢與彙整：驗證紀錄

日期：2026-09-15  
來源版本：0.5.10；另產出安全驗收包 0.5.11（搜尋功能仍封鎖）

## 已實作與驗證

- 單一聊天入口；renderer 不再選擇一般／聯網模式。
- 每隻桌寵的 `webQueryEnabled` capability 預設關閉，只由主程序讀取保存設定。
- 嚴格模型協定只接受 `answer` 或 `search(query)`；錯誤後 fail-closed，拒絕重複 JSON 鍵與尾隨搜尋內容。
- 同一回合固定 provider/model snapshot；最多 3 次模型呼叫、2 次搜尋、6 個來源、18,000 字來源內容，每頁最多 6,000 字。
- 尚未搜尋的直答保留既有白名單動作與正常日記排程；一旦提出搜尋，後續彙整不執行動作、不排程日記、不傳圖片。
- 來源只作不可信資料；顯示 title、HTTPS URL 與擷取時間。
- 開啟來源時 renderer 只提交 message/source ID，主程序由 sender 綁定的桌寵 session 取回實際 URL；不接受 renderer 提交任意 URL、path 或 petId。
- provider 不使用原生 `google_search`／`web_search` 工具；聯網決策只走受限的 `answer`／`search` 協定。
- 保存來源的 URL 在聊天層再次驗證，只接受 HTTPS 且拒絕帳號／密碼欄位。
- 敏感 query 預設停在確認狀態；只有同一聊天視窗、同一桌寵與同一 requestId 明確同意後才 resume 搜尋，確認事件不攜帶 query。
- URL policy 拒絕非 HTTPS、帳密、localhost 等價形式、IP literal、私網／loopback／link-local／mapped IPv6 與混合 DNS 回答。
- URL policy 另拒絕 IPv6 site-local `fec0::/10` 與 6to4 `2002::/16`。
- production `createBrowserSearch()` 仍無條件回傳 `blocked`，沒有 transport 或測試後門。

## 測試證據

在 `desktop-app` 執行：

```powershell
npm.cmd test
```

結果：183 tests；181 pass、0 fail、2 skip。兩個 skip 是需要 Electron UI 的 fixture。

在 sandbox 外執行，但保留 Electron sandbox：

```powershell
$env:PET_DESKTOP_TESTS='1'; npm.cmd test
```

結果：183 pass、0 fail、0 skip。

Task 級證據：

- 搜尋協定：11/11。
- browser policy/extract/blocked service：13/13，另由安全審查者驗證 18 個 IPv6／localhost 反例。
- provider/session/main 有界迴圈與生命週期：82/82。
- chat/settings/main UI 與 IPC：41/41（sandbox 外 Electron fixture）。
- 敏感 query confirmation/resume：57 pass、0 fail、1 skip；確認後外送與 sender/request 綁定均由 fixture 驗證。
- IPv6 policy 修正：8/8，涵蓋 site-local 與 6to4 重現案例，scoped re-review 為 ADDRESSED。

## 尚未通過的安全與產品關卡

- DNS preflight 尚無法證明已檢查的位址被綁定到 Chromium 實際 socket；不能宣稱完整 egress isolation 或 DNS rebinding 防護。
- 尚未取得真公開搜尋結果、正文、redirect/frame/subresource/download/popup 的完整真機證據。
- 尚未用使用者授權的 API key 驗證無原生搜尋能力的真模型端到端流程。
- 敏感 query 目前預設停在確認；尚未以真網站／真模型完成確認後 resume 的端到端驗收。
- Google 驗證／CAPTCHA 僅允許人工接手；未實作且不得自動繞過。

## 交付判定

目前可交付的是 fail-closed 的協定、設定、UI、fixture 與安全政策框架，以及保留搜尋封鎖的安全驗收包：

- `desktop-app/release-0.5.11-safe/blue-maid-desktop-pet-0.5.11.exe`
- EXE：137,583,893 bytes；SHA-256：`D53BAC5BEB140A4CF19096D4096A01A1FD93407E928729591A39CB41EE50568A`
- `win-unpacked/resources/app.asar` 存在，48,490,925 bytes；檔案版本 0.5.11。

這不是正式瀏覽器搜尋版本。若要解除 production `blocked`，需另行核准並驗證能把 DNS 判定綁定到實際連線的隔離架構；本輪沒有新增 proxy、WFP、driver、系統防火牆、根憑證或管理員權限。

## Pinned Public Reader 的 production 閘門

- production 仍為 `blocked`。fixture、診斷探針、portable EXE 或封裝成功本身均不構成解除條件。
- 若日後另行核准啟用，請求範圍只能是固定公開 HTTPS/443 GET：固定搜尋入口與其最多三個經 parser 擷取、再次驗證的公開候選頁；沒有 request body、Cookie、Authorization、Proxy-Authorization、Origin、Referer 或模型自訂 header，renderer 也不能傳入任意 URL。
- 每一跳 redirect 都必須重新做 DNS 全答案公開位址驗證，選定 numeric IP 後直接 dial，並在送出 TLS/HTTP payload 前比對實際 TCP socket remote address、family 與 port 443；TLS 必須用原 hostname 的 SNI 與憑證驗證。僅允許 301/302/303/307/308，最多五跳。
- HTML 只可送進 hidden、`about:blank`、無 preload、非持久 partition 的 inert DOM parser。它不做遠端導覽，也拒絕 HTTP(S)/WS(S)/file/data/blob/custom request、navigation/frame、popup、download、permission、worker 與 service worker；任何 parser egress 觀測都應讓本回合 `blocked`，不能回傳部分資料。
- `(petId, requestId, epoch)` 的取消與 dispose 必須中止 DNS/socket/parser 工作並抑制晚到結果；edit、clear、collapse、capability off、移除桌寵、sleep 與 quit 同樣不可留下可寫回的回合。

## Task 4 診斷探針邊界

- `desktop-app/diagnostics/browser-search-probe.cjs` 僅輸出有界安全 metadata：DNS fixture 的 address/family 與計數、socket/TLS 的 `unavailable` 狀態、request 與 parser egress/navigation/download/popup/permission 計數。它不輸出 API key、query、Cookie、response body、URL、檔案路徑或個人資料。
- 探針使用 Electron 目前的 `(event, details)` 導覽事件型態；download handler 一開始即呼叫 `event.preventDefault()`，再計數與取消 item。
- probe 的 DNS fixture 只證明答案可改變，並非 Chromium 連線 resolver；fixture 中的 egress 拒絕也不是實網站或真模型證據。真 Windows DNS-to-socket、TCP remote tuple、TLS hostname/authorization、redirect 每跳、parser egress、真公開網站與真模型端到端證據目前都 unavailable。

## Task 4 safe package（2026-09-15）

- 新增而未覆寫的目錄：`desktop-app/release-0.5.12-safe`。
- portable EXE：`blue-maid-desktop-pet-0.5.10.exe`，137,507,988 bytes，SHA-256 `A480F5147C17374A0AB15526748E6E4BF62F693119946B5FAF5FAECFCF78117E`。
- 解包 EXE 存在，225,441,792 bytes；FileVersion `0.5.10`、ProductVersion `0.5.10.0`。名稱仍為 0.5.10 是刻意保留來源 package version，並未為 safe package 虛增產品版本。
- `win-unpacked/resources/app.asar` 存在，48,518,967 bytes；已列出其中的 `src/main.js`、`src/browser-search/parser.js` 與 `src/browser-search/service.js`。
- 此封裝仍保留 production `blocked`；它不是正式瀏覽器搜尋版本。
