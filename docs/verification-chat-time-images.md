# 聊天時間與圖片驗證紀錄

日期：2026-09-13

## 根因與修正

- 歷史訊息 renderer 只建立文字節點，沒有讀取訊息附件；新送出訊息也只保留輸入區預覽。
- `chatSessions.getMessages()` 在首次開啟時沒有建立 session，因此已保存歷史資料不會進入 renderer。
- renderer 沒有安全的附件讀取契約；現在僅能以 `messageId` 與 `attachmentId` 請求，主程序從該 sender 所屬 pet 的正式訊息查找附件，再透過 attachment store 讀取。IPC 不接受或回傳檔案路徑、pet ID 或 URL。
- 訊息缺少呈現用時間及供應商時間脈絡。現在由主程序建立 ISO 現在時間、IANA 時區與 UTC offset；provider payload 對每一則有效 `createdAt` 加入文字脈絡，但不改寫已保存的原訊息內容。

## 後續生命週期修正

- 記憶策略明確轉為 `off` 後，主程序會失效該桌寵的 active chat session、取消日記工作並向聊天泡泡發送 `reset`；不會再從舊 session 快取取回歷史或讓晚到串流寫回。
- 清除與 `off` 都會使 renderer 清空訊息、附件快取及進行中的 UI 狀態，重新啟用輸入；失敗或取消的未保存請求也會從 session 移除。
- `editLatest` 在呼叫持久化編輯前驗證 mode，非法 `browser` 不會改動原訊息或移除原回答。
- provider 拒絕圖片時，renderer 移除暫時 user 訊息但保留輸入附件以便重試；成功 `done` 事件才提供正式 attachment ID，將本地預覽換成受 sender/pet/message/attachment 範圍限制的讀取。
- 歷史附件改為 IntersectionObserver 進入聊天訊息 viewport 時才經 IPC 讀取，最多兩個並行請求；離開 viewport 移除 `src`，base64 LRU 快取最多 12 筆。

## 修改檔案

- `desktop-app/src/main.js`
- `desktop-app/src/chat/preload.js`
- `desktop-app/src/chat/renderer.js`
- `desktop-app/src/chat/session.js`
- `desktop-app/src/ai/providers.js`
- `desktop-app/chat.css`
- `desktop-app/test/chat-ui.test.js`
- `desktop-app/test/chat-session.test.js`
- `desktop-app/test/ai-providers.test.js`
- `desktop-app/test/main-state.test.js`
- `desktop-app/test/memory-store.test.js`

## RED / GREEN 證據

- RED：`PET_DESKTOP_TESTS=1; node --test test/chat-ui.test.js` 失敗於「已保存附件必須在其使用者訊息內顯示圖片」。
- RED：`node --test test/main-state.test.js` 在新增契約前找不到 `chat:get-attachment` handler。
- RED：`node --test test/chat-session.test.js test/ai-providers.test.js` 顯示 session 未傳遞 `timeContext`，且 provider 指令未帶可信時間。
- RED：`node --test test/chat-session.test.js` 顯示首次取得歷史訊息為空陣列。
- RED（harness）：原本啟用 Electron fixture 時會嘗試存取預設 `AppData/Roaming/Electron/Cache`，並以 `ERR_FAILED` 結束。
- RED（生命週期）：`dispose` 未送出 cancelled/reset，`off` 後可由舊 session 讀回歷史，非法 edit mode 先改 store，provider error 留下未完成附件訊息。
- GREEN：上述定向 Node 測試與完整非 GUI 測試均已在修正後通過。

## 最終驗證

- `node --test test/chat-session.test.js test/main-state.test.js test/memory-store.test.js test/ai-providers.test.js`：83 passed、0 failed；覆蓋 policy off、清除競爭、非法 edit mode、provider 圖片拒絕、正式 attachment ID、主動訊息、編輯原時間、跨日和 `Asia/Taipei` 時區脈絡。
- `npm.cmd test`：146 passed、0 failed、2 skipped（既有需要顯式啟用的 GUI 測試）。
- 受限 sandbox 內的 `PET_DESKTOP_TESTS=1; node --test test/chat-ui.test.js`：1 passed、1 failed。fixture 已在 child 啟動前以 `mkdtemp` 隔離 `APPDATA`、`LOCALAPPDATA`、`TEMP`、`TMP`，並在 `app.whenReady()` 前設定獨立 `userData`、`sessionData`、`cache`；預設 AppData Cache/Network 存取拒絕已消失，但仍在載入 `about:blank` 前得到 `ERR_FAILED (-2)` 與 GPU shared context failure。
- 經核准、同一個隔離 fixture 在 sandbox 外執行 `PET_DESKTOP_TESTS=1; node --test test/chat-ui.test.js`：2 passed、0 failed。GPU context 警告仍出現，但 renderer 已實際執行，先 RED 於「圖片被拒絕後必須保留輸入附件以便重試」，修正後 GREEN。
- fixture 已套用產品 `configureElectron(app)` 的 Windows 相容性設定、固定 `TZ=Asia/Taipei`，且未使用 `--no-sandbox`。以非私人 1×1 PNG 實際驗證 `naturalWidth > 0`、時間 DOM、窄泡泡圖片 CSS、viewport 延遲載入與離開釋放、正式 attachment ID 對應、圖片拒絕可重試及 reset。
- provider 測試以 mock fetch 檢查 Gemini、OpenAI、DeepSeek、custom 的實際序列化 payload；未使用 API key 或真實服務。
- 附件 IPC 測試覆蓋合法讀取、跨 pet、偽造 attachment ID，以及夾帶 path/petId 欄位；主程序僅使用 sender、messageId、attachmentId。

## 未驗證／限制

- 沒有以可見的真實桌寵視窗進行人工視覺驗收；隱藏 Electron fixture 已在核准隔離環境完成 DOM 驗證，但受限 sandbox 內仍無法建立 renderer，且未進行人工視覺檢查。
- 沒有使用使用者聊天、使用者圖片或 API key；未驗證真實模型對時間措辭的品質。
- 未調整版本、未打包、未提交或推送，也沒有啟動或終止任何既有桌寵程序。
- 沒有進行人工跨日長時間操作；時間格式、時區脈絡、串流開始時間與保存歷史均由固定測試資料覆蓋。

## 2026-09-14 主管複核與 v0.5.8 封裝

### 第二輪審查發現與修正

- `memory/context.js` 的有效 `createdAt` 已保留至主程序實際 provider payload；`main-state.test.js` 以 Gemini 序列化驗證此完整路徑。
- clone 已保留安全的 `{ id, name, mimeType, unavailable: true }` 缺失圖片中繼資料，不複製來源檔案或跨桌寵讀取能力。
- `chat:send` 不再以全域 `prune` 清理舊請求；改為只 `discard` 該請求未被記憶引用的附件，避免 reset 後的舊 `finally` 刪除新請求尚未保存的持久或 transient 圖片。
- renderer 在 reset 時使初始歷史與附件讀取 generation 失效；晚到回呼不會重建歷史或污染快取。離開 viewport 的 queued 圖片會回到可重新排程狀態。

### RED / GREEN 與獨立複核

- RED：`node --test test/main-state.test.js` 曾於「清除記憶」競態重現新附件讀取的「找不到附件」。
- RED：隔離 Electron fixture 於 sandbox 外執行 `$env:PET_DESKTOP_TESTS='1'; node --test test/chat-ui.test.js` 曾重現 queued 圖片重入後不再發出讀取。
- GREEN：`node --test test/attachments.test.js test/main-state.test.js` 為 29 passed、0 failed；涵蓋清除與 off 兩種附件競態。
- GREEN：一般 `npm.cmd test` 為 151 passed、0 failed、2 skipped；啟用隔離 Electron fixture 的 `PET_DESKTOP_TESTS=1; npm.cmd test` 為 153 passed、0 failed、0 skipped。
- 獨立唯讀複核沒有 P0/P1/P2 finding；確認修正只涉及附件生命週期與 renderer 非同步回呼。

### EXE 交付驗證

- package 與 lockfile 由 0.5.7 升至 0.5.8；舊 release 未覆寫。
- `npm.cmd run dist -- --config.electronDist=node_modules/electron/dist` 已產出 `desktop-app/release-0.5.8/blue-maid-desktop-pet-0.5.8.exe`。
- packaged 診斷以隔離暫存 profile 確認 `isPackaged=true`、版本 0.5.8、桌寵 renderer 與 640×360 動畫播放、設定視窗與預設 `diary-30d` 均可用。
- ASAR 清單共 135 項，包含 `src/main.js`、`src/chat/renderer.js`、`assets/animations.json`，未含 `.runtime`、`node_modules`、`release-*`、`.npm-cache` 或 `test-profile`。
- EXE SHA-256：`0EA1DF92440047BD5C9A18F6059C764AC9A9F609D787A68B142E332FBF76E2CB`。

### 仍未驗證

- 沒有真實 API 金鑰或真模型品質驗收。
- 沒有以可見視窗進行人工視覺 QA；本次只有隔離 Electron DOM 與 packaged 診斷。
- 內建瀏覽器搜尋仍維持 BLOCKED；沒有實作 proxy、WFP、管理員權限或任何搜尋產品整合。
