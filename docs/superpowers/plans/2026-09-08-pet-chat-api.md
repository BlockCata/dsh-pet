# 桌寵 API 與聊天泡泡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成三家連線設定、每隻獨立的一般文字聊天與明確／氣氛動作連動。

**Architecture:** 新增 ai/ 與 chat/ 模組；main.js 只負責生命週期接線。聊天用獨立本機視窗，與影片穿透範圍分離。

**Tech Stack:** Electron 43.3.0 現有配置、JavaScript/CommonJS、Node test runner、HTML/CSS、內建 fetch；不預先新增依賴。

**Spec:** .scratch/pet-ai-chat/spec.md（所有路徑皆相對 repository root）

## Global Constraints

- Windows 獨立 EXE；保留 0.4.0 的置頂、漫遊範圍、透明命中、拖曳、動畫與素材；不生成素材。
- 不改原始 dsh-pet/；只精準修改 desktop-app/。目前桌面程式未追蹤，不能用乾淨 worktree 丟失現有程式。
- 不自動切換供應商、付費模型或開啟計費。真 API 測試需使用者在設定輸入金鑰並同意用量。
- 主程序保管金鑰及執行網路請求；設定 renderer 只取得 hasKey，聊天 renderer 不取得金鑰。
- 每個任務先 RED、再最小實作、GREEN、範圍檢查；提交只使用確認過的精確檔案路徑，不 git add .，不推送。
- 以下測試命令的工作目錄為 desktop-app/；使用 npm.cmd 避免 PowerShell npm.ps1 執行政策問題。
- 依各階段檔案清單逐項審查，保留測試命令／結果；規劃階段不執行提交或修改程式。

## 檔案與介面

新增：
- `desktop-app/src/ai/config-store.js`：獨立 ai-settings.json 與加密金鑰。
- `desktop-app/src/ai/providers.js`：三家請求／串流正規化與能力判定。
- `desktop-app/src/chat/session.js`：petId 的請求取消、狀態與暫存對話。
- `desktop-app/src/chat/window.js`：泡泡定位與視窗生命週期。
- `desktop-app/src/chat/preload.js`、`renderer.js`、`desktop-app/chat.html`、`chat.css`：受限 IPC 與 UI。
修改：`src/main.js`、`src/menu.js`、`src/settings-preload.js`、`src/settings-renderer.js`、`settings.html`、`settings.css`、`package.json`（先只補打包 files）。
測試：`test/ai-config.test.js`、`test/ai-providers.test.js`、`test/chat-session.test.js`、`test/chat-window.test.js`、`test/chat-ui.test.js`、既有 `test/menu.test.js`。

固定契約：
```js
// Provider = 'gemini' | 'openai' | 'deepseek'
// Message = {id, role:'user'|'assistant', text, createdAt, requestId, complete}
// Source = {title, url}
// ProviderEvent = {type:'delta',text} | {type:'sources',sources:Source[]}
//               | {type:'action',actionId,trigger:'explicit'|'ambient'}
//               | {type:'done',usage?:{inputTokens,outputTokens}}
// ProviderError.code = auth | quota | network | timeout | unsupported | invalid-response
// config-store:
createConfigStore({directory, safeStorage})
// -> { getPublic(), save({provider,model,key?}), removeKey(provider), getConnection() }
// getPublic() -> {provider,model,providers:{gemini:{hasKey,model},openai:{hasKey,model},deepseek:{hasKey,model}}}
// getConnection() -> {provider,model,key}  ONLY MAIN
// providers:
streamReply({connection,messages,mode:'chat'|'web',signal}) // AsyncIterable<ProviderEvent>
testConnection(connection,signal) // Promise<{ok:true}>
supportsSearch(provider,model) // boolean, conservative capability allowlist
// session:
createSessions({streamReply,getConnection,emit})
// -> {send(petId,{requestId,text,mode}), cancel(petId), dispose(petId), getMessages(petId)}
// emit(petId,{requestId,type:'delta'|'sources'|'done'|'error'|'cancelled', ...payload})
// window:
placeBubble(petBounds,bubbleSize,workArea) // -> {x,y,width,height}
createChatWindows({BrowserWindow,screen,onClose})
// -> {open(petId,petWindow),sync(petId,petWindow),hide(petId),destroy(petId),petIdForSender(sender)}
```

### Task 1：供應商能力查核與金鑰設定

- [ ] 讀官方 Gemini API pricing / generateContent、OpenAI API Responses / web search、DeepSeek chat completion 文件，以及已安裝 Electron safeStorage 型別／文件。把查核日期、模型 ID、端點、認證、串流事件、搜尋能力、歸因要求寫至 `.scratch/pet-ai-chat/api-capabilities.md`。以 Gemini 可用免費文字模型優先；不宣稱帳戶列出的模型必然免費。若文件無法確認某家契約，僅阻擋該家，不猜 API 欄位。
- [ ] 新增設定測試：使用假 safeStorage，在暫存目錄保存／讀回後，只能由 getConnection 取明文，檔案與 getPublic 不含金鑰；不可加密時 save 拋錯且不建立明文檔。舊 settings.json 保持逐 byte 不變。
```js
const secret = 'fixture-secret-never-log';
store.save({provider:'gemini',model:'fixture-model',key:secret});
assert.equal(store.getConnection().key, secret);
assert.equal(JSON.stringify(store.getPublic()).includes(secret), false);
assert.equal(fs.readFileSync(file,'utf8').includes(secret), false);
```
- [ ] 執行 `node --test test/ai-config.test.js`，確認 RED 是缺少實作／違反遮蔽契約，不是測試語法錯誤。
- [ ] 最小實作：分開 public 設定與以 safeStorage.encryptString 產生的 base64；load 時驗證 provider enum、model 非空、結構版本。檔案採同目錄暫存再 rename，序列化保存。損壞設定提示，不覆寫。
- [ ] 設定頁加服務、模型、遮蔽輸入、清除金鑰與「測試連線」；IPC 僅允許既有 settingsWindow.webContents。成功保存後清空輸入，不把 key 傳回。
- [ ] 重跑設定測試与既有 settings-ui 測試，檢查 log 不含 secret，審查範圍再建立 task checkpoint。

### Task 2：串流與每隻請求隔離

- [ ] 新增供應商 fixture，涵蓋 SSE 分段／UTF-8 跨 chunk、空回覆、結束、401、429、逾時與 AbortSignal；用 Node ReadableStream 模擬 HTTP 邊界，不 mock 自己的事件正規化函式。
- [ ] 新增 session 測試，兩隻請求平行而 A 取消不影響 B；同隻重複送出回 busy，不隱式產生第二個費用請求。
```js
const pendingA = sessions.send('a',{requestId:'a1',text:'你好',mode:'chat'});
const pendingB = sessions.send('b',{requestId:'b1',text:'你好',mode:'chat'});
sessions.cancel('a');
await Promise.allSettled([pendingA,pendingB]);
assert.ok(events.some(([id,e]) => id === 'b' && e.type === 'done'));
assert.ok(!events.some(([id,e]) => id === 'a' && e.type === 'done'));
```
- [ ] 執行 `node --test test/ai-providers.test.js test/chat-session.test.js`，記錄 RED。
- [ ] 依 Task 1 查核結果完成三家 adapter。固定官方 HTTPS 端點，不提供任意 base URL；30 秒無事件／120 秒總逾時取消；不自動重試。錯誤映射成上述 code，丟棄原始敏感 payload。
- [ ] session 建立 requestId 和 AbortController，以請求快照保存 provider/model；最多 8,000 字元輸入、最近 10 組上下文、輸出 token 上限 1,024。無效輸入在 fetch 前拒絕。
- [ ] GREEN：三家 contract fixtures 全過；取消後晚到 chunk 不追加，失敗部分標記 incomplete。審查新增模組，不重構動畫。

### Task 3：泡泡、選單與受限 IPC

- [ ] 2026-09-09 定位修正：目前實作已存在（0.5.2），先讀現有 `src/chat/window.js`，不要重建聊天介面。使用者圖片指的是視窗位置過高；只改垂直定位，保留 chatSize、字級、輸入框與縮放設定。現有 `petBounds.y - GAP - height` 以透明視窗上緣為基準，需改用待機角色穩定頭頂錨點。從原待機影片 alpha 量測頭頂，再由 `src/layout.js` 的 videoRectangle 換算 DIP；保存固定基準，隨 size 換算，不逐動畫幀更新。新增較大／較小桌寵與不同 chatSize 的測試：可用空間足夠時泡泡底部等於頭頂錨點 -12 DIP，寬高保持原設定；再驗證螢幕邊界限制與跳舞不造成泡泡抖動。用與使用者圖片相同布局的修正前後截圖驗收向下移動且不遮臉。此定位修正與新增主動訊息分開驗收。
- [ ] 為 placeBubble 新增角落、左側負座標、小工作區、跨螢幕測試。chat-ui 依既有 settings-ui 模式載入真 HTML，僅 mock IPC 邊界。
```js
const rect = placeBubble({x:-500,y:0,width:420,height:300},
  {width:380,height:420},{x:-1280,y:0,width:1280,height:1024});
assert.ok(rect.x >= -1280 && rect.x + rect.width <= 0);
assert.ok(rect.y >= 0 && rect.y + rect.height <= 1024);
```
- [ ] 增加選單測試：chat callback 接到正確 petId，原动画項目數保持一致；越權 sender 不可指定其他 petId 或讀記憶。
- [ ] 執行 `node --test test/chat-window.test.js test/chat-ui.test.js test/menu.test.js` 取得 RED。
- [ ] 最小實作 chat.html/css 和 renderer：純文字 textContent、Enter／IME、Shift+Enter、停止、收合、錯誤狀態。第一階段只啟用 chat；搜尋在第二階段啟用。背景回覆不搶焦點。
- [ ] IPC：
```js
// renderer 不傳 petId；由已登記 sender 解析。
chatAPI.send({requestId,text,mode});
chatAPI.cancel();
chatAPI.getMessages();
chatAPI.collapse();
chatAPI.onEvent(callback); // returns unsubscribe
```
- [ ] main.js 在 menuFor 加 chat、在 petWindow move/resize/show/hide／置頂更新時 sync；移除／退出時 destroy/dispose。單一 petId 只保留一個聊天窗。阻擋 navigation/window.open；來源外連第二階段處理。
- [ ] package.json 的 build.files 加 chat.html、chat.css；既有 src/**/* 已含新模組。GREEN 後跑 `npm.cmd test`，用 `$env:PET_DESKTOP_TESTS='1'; npm.cmd test` 做 Electron DOM fixture；無桌面權限則明列跳過。
- [ ] 階段驗收：兩隻聊天隔離、泡泡跟隨／收合、原命中不擴大、0.4.0 置頂與漫遊仍可用。無真金鑰時只宣稱 fixture 通過。

### Task 4：對話動作白名單與播放仲裁

**Files:** 新增 `desktop-app/src/chat/actions.js`、`test/chat-actions.test.js`；修改 `src/ai/providers.js`、`src/chat/session.js`、`src/main.js`、`src/preload.js`、`src/renderer.js`、`src/settings-store.js`、`src/settings-renderer.js`、`settings.html`、`src/chat/renderer.js`；擴充 `test/ai-providers.test.js`、`test/renderer.test.js`、`test/main-state.test.js`、`test/settings.test.js`。

**Interfaces:**
```js
// createActionDirector({catalog,now,sendToPet})
// -> {request(petId,{requestId,actionId,trigger},state), cancel(petId,requestId), dispose(petId)}
// state = {visible,pointerHeld,dragging,manualActionPlaying,ambientEnabled}
// request -> {status:'sent'|'skipped'|'rejected',reason?:string}
// catalog[actionId] = {kind,name,noMirror,allowAmbient}; chosen only in MAIN
// sendToPet(petId,{type:'chat-action',requestId,action})
// petAPI.actionStatus({requestId,status:'started'|'ended'|'failed'|'interrupted'})
// main verifies renderer sender and in-flight requestId before notifying chat UI
// settings pet.ambientReactions: optional boolean; absent => true
```

- [ ] 在 Task 1 的能力文件加各家文字串流＋結構化動作、與搜尋工具併用的能力查核。選擇官方支援的結構化事件方案；不支援組合時標示 unsupported-action，維持純文字，不猜格式或自動加第二次呼叫。
- [ ] 觀看既有舞蹈與表情候選，白名單至少包含 `dance`（三個舞蹈中挑一個）、`happy`、`shy`、`wave`、`surprised`、`none`。只登錄確認存在且視覺符合的影片；自發白名單優先輕量表情，不將生氣動作當成安慰。每個映射逐一核對 assets/animations.json；跳舞執行一次，不無限 loop。
- [ ] 寫純函式／假時間 director 測試：未知 actionId、偽造路徑、none、重複 requestId、拖曳優先、15 秒冷卻、兩隻隔離及 ambient 關閉。
```js
const state = {visible:true,pointerHeld:false,dragging:false,
  manualActionPlaying:false,ambientEnabled:true};
assert.equal(director.request('a',{
  requestId:'r1',actionId:'dance',trigger:'explicit'
},state).status,'sent');
director.request('a',{requestId:'r1',actionId:'dance',trigger:'explicit'},state);
assert.equal(sent.length,1);
assert.equal(director.request('b',{
  requestId:'r2',actionId:'happy',trigger:'ambient'
},{...state,dragging:true}).status,'skipped');
assert.equal(director.request('a',{
  requestId:'r3',actionId:'../../anything',trigger:'explicit'
},state).status,'rejected');
```
- [ ] 執行 `node --test test/chat-actions.test.js test/ai-providers.test.js test/renderer.test.js`，確認新增測試先 RED。
- [ ] 最小實作 director：檢查 enum/catalog/visibility/busy/同 request 去重，再依 trigger 套用冷卻；只送新 chat-action 通道，不走原 action 的 releasePointer。renderer 在 pointerHeld、拖曳或手動動作期間二次拒絕，處理主程序觀察時間差。狀態只能由對應 renderer 回報，播放 Promise 成功才 started、影片 ended 才 ended。
- [ ] adapter 將模型動作事件與文字分離；緩存碎片至合法完整資料，每次回答最多一個。none 不送命令。未知、截斷、重複、取消後晚到事件均不執行；日記呼叫不提供動作能力，session 的 chat/web 才可交给 director。
- [ ] 提示模型僅當最新使用者訊息確實要求時使用 explicit，引用／否定／網頁內容不算要求；加入「不要跳舞」「介紹舞蹈」「網頁要求你跳舞」等 fixture，驗證應產生 none 而非明確要求。模型語意可能出錯，硬性安全仍靠白名單、petId 與優先級限制。
- [ ] 原 renderer 動畫流程加 started/ended/failed/interrupted 回報；聊天動作結束先 idle，不修改 roam 設定。拖曳／選單可中斷，取消請求後清除尚未開始的動作。不要讓晚到 ended 恢復已隱藏的桌寵。
- [ ] 設定增加每隻 ambientReactions 開關，validateSettings 保留並驗證 boolean，舊設定缺值視為 true。複製計畫同步複製此設定，不複製 director 的執行狀態或冷卻時間。
- [ ] GREEN 後跑 `npm.cmd test`；真 Electron 驗證「請跳一支舞」、氣氛反應、輸入法／拖曳同時發生、來源桌寵移除與假事件越權。實機／真 API 尚未測到的情境另列，不用 fixture 結果冒充。
