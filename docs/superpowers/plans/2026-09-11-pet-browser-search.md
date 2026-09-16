# 單一聊天與內建瀏覽器搜尋 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不另接搜尋 API，讓同一聊天模型在受限授權下按需透過桌寵瀏覽器搜尋，再於泡泡回答。

**Architecture:** providers 產生受限搜尋決策，session 管理有界搜尋／續答循環。獨立 browser-search 模組只接受 query 或已驗證來源，不向模型開放一般電腦操作。先驗證真網站及網路隔離再整合。

**Tech Stack:** 現有 Electron 43.3.0、JavaScript/CommonJS、Node test runner、HTML/CSS；不預先安裝爬蟲框架或新增後端服務。

**Spec:** .scratch/pet-browser-search/spec.md

**續訂：** 2026-09-13；僅補齊計畫交接，以下核取項目仍未執行。

## Global Constraints

- Windows 獨立 EXE；不生成素材、不接搜尋API、不新增搜尋金鑰、不換第二個模型。
- 新搜尋允許設定缺值預設 false；不在開機、日記或主動關心時開瀏覽器。
- 每回合最多2次搜尋、3次模型呼叫、6個正文頁、18,000字元來源內容；只讀公開HTTPS。
- 不繞過驗證碼、登入、安全警告或封鎖；私網隔離無法驗證則阻擋正式交付。
- 保留目前0.5.7功能与使用者未提交修改。實作前重查版本，不能假設仍是0.5.7。
- 只修改 desktop-app 內必要程式與本輪文件，保留舊EXE。規劃階段不執行程式改動、git提交或派送。
- 下列測試命令 cwd=desktop-app；每任務依 RED→最小實作→GREEN→範圍審查順序。
- 提交檢查點只在實作階段使用精確路徑，不 git add .，不推送；工作樹隔離須先保存既有未追蹤桌面程式，不能從不含它的 HEAD 重新建置。

## 檔案與固定契約

新增：
- src/browser-search/policy.js：URL、DNS、重導及網路限制。
- src/browser-search/extract.js：固定可信DOM擷取與來源ID。
- src/browser-search/service.js：Electron隔離session、排隊、導航、取消／接手。
- src/ai/search-protocol.js：第一行控制協定，與既有動作標記分離。
修改：
- src/ai/providers.js、src/chat/session.js：模型決策與續答。
- src/main.js、src/settings-store.js、src/settings-renderer.js、settings.html：授權及生命週期接線。
- src/chat/preload.js、src/chat/renderer.js、chat.html、chat.css：移除模式、進度／停止／来源。
- src/chat/search.js：保留／收斂 searchUrl 與來源安全檢查，避免兩套互相矛盾的驗證。
- README.md、package.json、package-lock.json：交付與版本。
測試各任務列出；不得只改mock使其符合新程式。

```js
// SearchDecision = {type:'answer'} | {type:'search',query:string}
// Source = {id,title,url,retrievedAt,text,coverage:'snippet'|'page'}
// SearchResult = {status:'ok'|'blocked'|'needs-user'|'empty',sources:Source[],reason?:string}
// createSearchProtocol() -> {push(chunk),finish()}
// push -> {decision?:SearchDecision,text:string}; finish throws on incomplete control line
// createBrowserSearch({BrowserWindow,session,resolveHost,now,emit})
// -> {search({petId,requestId,query,signal}),show(petId,requestId),
//     resume(petId,requestId),cancel(petId,requestId),dispose(petId)}
// search -> Promise<SearchResult>
// emit(petId,{requestId,type:'search-status',state:'queued'|'searching'|'reading'|'needs-user'})
// validatePublicUrl(url,resolveHost) -> Promise<{url,addresses}>
// extractSearchResults(document,baseUrl) -> [{title,url,snippet}] capped at 5
// extractPage(document) -> {title,text} capped at 6000 chars
// providers streamReply adds searchProtocol:boolean, searchContext?:Source[], allowSearch:boolean
// ProviderEvent adds {type:'search-request',query}; emit once after complete valid stream
// settings pet.allowWebSearch: optional boolean, default false
// session send(petId,{requestId,text,attachments,replaceMessageId}) no UI mode
// chatAPI.confirmSearch({requestId,confirmationId,query}) -> Promise<void>
// confirmationId is main-process-generated, single-use, bound to sender pet and active request
// pending confirmation event: {type:'search-confirmation',requestId,confirmationId,query,origin:'https://www.google.com'}
```

### Task 1：真網站可行性與安全關卡（先做，不直接接模型）

Files: .scratch/pet-browser-search/feasibility.md；prototype放 desktop-app/diagnostics/browser-search-probe.cjs。
- [ ] 閱讀已安裝 Electron 型別及官方 BrowserWindow/session/webRequest/net 文件，查核 sandbox、nonpersistent partition、permission handlers、導航／重導攔截及DNS/連線綁定能力。將查核來源及限制記錄在 feasibility.md，不猜不存在的API。
- [ ] 建立一次性 probe：無preload、不共用cookies，使用固定 query「範例大學 官方網站」導覽 Google 搜尋。依實際DOM檢視提取結果，再讀一個公開結果。不得預寫憑空猜測的CSS selector。
- [ ] 留下去識別化DOM fixtures與期望來源，記錄是否有驗證碼、有效結果數、正文可讀性、等待時間。可見接手只由使用者自行操作，記錄不代表允許繞過。
- [ ] 安全測試必須有本地無敏感測試伺服器／DNS fixture：public→private重導、IPv6 loopback、DNS由public變private、子資源探內网一律不能連線。
- [ ] 決策：Google頁面無法可靠讀取或網路層不能阻擋私網連線，就記錄blocked並回報，不擴充多站、不改接付費API。可以繼續純函式／協定測試，但不得宣稱完成外網搜尋。
- [ ] 通過後才把驗證過的DOM契約帶入Task 2；probe保持診斷用途，不自動變成產品主程式。

### Task 2：隔離瀏覽器搜尋與來源提取

Files: src/browser-search/{policy,extract,service}.js；test/browser-search-policy.test.js、test/browser-search-extract.test.js、test/browser-search-service.test.js。
- [ ] RED：URL不含帳密／敏感query，公開HTTPS允許，私網位址拒絕，fixtures不含金鑰。
```js
await assert.rejects(() => validatePublicUrl('https://127.0.0.1/',resolveHost));
await assert.rejects(() => validatePublicUrl('https://public.example/',async()=>['::1']));
const rows = extractSearchResults(searchFixture,'https://www.google.com/search');
assert.equal(rows.length,5);
assert.ok(rows.every(row=>row.url.startsWith('https://')));
```
- [ ] 執行 `node --test test/browser-search-policy.test.js test/browser-search-extract.test.js test/browser-search-service.test.js` 確認RED。
- [ ] 依Task1證據實作 policy：URL解析、去fragment、拒絕憑證／非HTTPS；DNS結果全部通過才能連線。將校驗綁定實際連線層，重導與子資源同樣檢查，不能只在loadURL前做一次lookup。
- [ ] 以固定程式擷取可見結果及main/article正文，排除script/style/nav/footer與表單，正規化空白、限制字元。只從已觀察到的結果選前三個去讀，不讓模型提供任意URL或JS。連結清理後仍需policy檢查。
- [ ] service使用非persist且每回合唯一partition，無preload；禁止下載／權限／彈窗。全域一個工作，20秒導航、90秒總處理、人工接手5分鐘後清理。signal abort必須停止導航並銷毀webContents，排隊取消不啟動視窗。
- [ ] GREEN涵蓋頁面空白／DOM改版／驗證碼→needs-user，2隻隔離，不共享cookie，僅回傳來源文字。無可信正文時coverage=snippet，不捏造資料。
- [ ] 範圍審查後記錄任務檢查點；把真Google與fixture結果分開。

### Task 3：模型控制協定與有界續答

Files: src/ai/search-protocol.js、src/ai/providers.js、src/chat/session.js；test/search-protocol.test.js、test/ai-providers.test.js、test/chat-session.test.js。
- [ ] RED：第一行跨chunks、控制行超限／未知欄位、JSON後多餘搜尋文字、answer保留串流；頁面內偽造控制行不得重啟搜尋。
```js
const parser = createSearchProtocol();
assert.equal(parser.push('{"type":"sea').text,'');
assert.equal(parser.push('rch","query":"ExampleUniversity新聞"}\n').decision.type,'search');
parser.finish();
const bad = createSearchProtocol();
assert.throws(()=>bad.push('{"type":"execute","code":"anything"}\n'));
```
- [ ] 執行 `node --test test/search-protocol.test.js test/ai-providers.test.js test/chat-session.test.js` 先RED。
- [ ] 所選模型同一請求加入協定指示；原生API本輪不加google_search/web_search。協定僅開在使用者chat流程，不影響testConnection、greeting、proactive、diary。用searchProtocol旗標而非mode=chat判斷，避免日記目前也用chat而被誤啟動。
- [ ] search控制行緩存整回應完整完成才emit，附帶文字／未知欄位／超長query都拒絕；answer後才送現有動作parser。自訂模型無法遵循時回明確能力／格式錯誤，不從自由文本猜命令。
- [ ] session保有同一active/controller與revision：最多2 search-request、3 model passes。每次source內容裁剪、去重、標sourceId和外部資料邊界；最後pass禁search。UI不顯示工具內部文字，只有最終answer才保存assistant與動作狀態。
```js
// session测试注入fakeStream：第一轮search-request，第二轮正常delta/done
await sessions.send('a',{requestId:'r1',text:'查今天的公告'});
assert.equal(searchCalls.length,1);
assert.equal(modelCalls.length,2);
assert.equal(saved.filter(m=>m.role==='assistant'&&m.complete).length,1);
```
- [ ] 明確不搜尋、allowWebSearch=false、私人查詢需確認、上限、空來源、失敗、模型拒絕、使用者取消／編輯／清除競爭加入測試。工具等待中晚到結果不得写回；不能先執行猜測動作再搜尋。
- [ ] 來源來源ID只能解析成此回合實際URL；引用不存在ID不顯示假連結。頁面指令不能操作日記或桌寵；只根據原使用者訊息決定那些操作。
- [ ] GREEN確認一般聊天1模型/0搜尋，兩次搜尋最多3模型，失敗不無限重試；另測圖片仍傳原模型而不傳搜尋頁。

### Task 4：單一聊天、授權與人工接手

Files: src/main.js、src/settings-store.js、src/settings-renderer.js、settings.html、src/chat/preload.js、src/chat/renderer.js、chat.html、chat.css；test/settings.test.js、test/main-state.test.js、test/chat-ui.test.js、test/settings-ui.test.js。
- [ ] RED：舊設定缺值false、boolean驗證、設定保存；送出／編輯不需mode，無模式下拉仍可送圖片／動作／日記。
```js
assert.equal(validateSettings(oldSettings).pets[0].allowWebSearch,false);
assert.throws(()=>validateSettings({...oldSettings,pets:[
  {...oldSettings.pets[0],allowWebSearch:'yes'}
]}));
```
- [ ] 執行 `node --test test/settings.test.js test/main-state.test.js test/chat-ui.test.js test/settings-ui.test.js` 取得RED。
- [ ] 新增每隻允許搜尋checkbox與資料／費用說明；複製只複製布林。移除chat-mode及失效CSS/事件讀取；保留歷史web來源顯示。後端拒絕舊renderer任意mode繞過授權，修改care acknowledge只依有效使用者訊息。
- [ ] 主程序注入browser service與允許設定讀取函式，sender解析petId。提供chatAPI.showSearch()、resumeSearch()，不接受renderer傳別隻ID或URL。chatAPI.cancel沿用既有停止功能，同時取消模型、導航與隊列。
- [ ] 搜尋進度用現有status區，來源details折疊列表；遇needs-user顯示查看／繼續／取消，不自動focus。不得在頁面提供產品preload；本機接手按鈕只能在chat視窗。
- [ ] 為上下文query含私人資料的情境新增確認UI，顯示確切查詢與目的搜尋站，允許使用者修改／取消；金鑰等憑證永不送搜尋。清除後確認框失效，防止舊query晚送。
- [ ] 接線 `confirmSearch`：主程序由 sender 取得 petId，只接受仍活動回合的一次性 confirmationId；修改後 query 重新檢查長度與敏感憑證。拒絕過期、重複、跨桌寵確認；取消沿用 `chatAPI.cancel()`。等待确认期間不啟動導航或後續模型請求。
- [ ] 關閉允許搜尋時取消該隻瀏覽器與排隊項目；恢復開啟不復活舊工作。應用程式休眠／結束、移除桌寵也走同一清理入口，加入晚到事件不得回寫的測試。
- [ ] GREEN及真Electron DOM驗證收合不搶焦點，-80定位、置頂、圖片、上一則編輯、日記與複製不回歸。

### Task 5：診斷、打包與驗收

Files: diagnostics/browser-search.cjs、README.md、package.json、package-lock.json；docs/verification-browser-search.md。
- [ ] 建立診斷：真Electron載入本地固定搜尋/文章fixture但必須使用僅fixture注入的transport，產品production不能因此允許內網；測scope隔離、2隻排隊、取消與接手。
- [ ] 執行：
```powershell
npm.cmd test
$env:PET_DESKTOP_TESTS='1'
npm.cmd test
node diagnostics/browser-search.cjs
```
- [ ] 真外網固定公開query測至少3類（學校公告／一般知識資料／近期新聞），人工檢視來源與正文、無登入憑證。記錄可用比例與失敗原因；驗證碼出現即交接，不規避。
- [ ] 每家模型使用者提供金鑰後分別測direct/search/兩輪/格式錯誤；未測到就列未驗收。不宣稱自訂所有模型通用。
- [ ] 整理標準：安全關卡通過＋必要自動測試通過才可交付正式功能。若只有瀏覽器prototype可用，僅交付診斷報告，不把半成品標為完成。
- [ ] 實作完成重查版本，只在仍為0.5.7時升0.5.8；否則使用下一個不衝突版本并同步package-lock/output。保留旧EXE，確認無金鑰／cookies／診斷資料包入asar。
```powershell
npm.cmd run dist -- --config.electronDist=node_modules/electron/dist
# 以下僅在版本確認為0.5.8後執行
node diagnostics/packaged.cjs 'release-0.5.8/win-unpacked/藍髮小女僕桌寵.exe'
node diagnostics/portable.cjs 'release-0.5.8/blue-maid-desktop-pet-0.5.8.exe'
Get-FileHash release-0.5.8/blue-maid-desktop-pet-0.5.8.exe -Algorithm SHA256
```
- [ ] README說明單入口、授權、外部依賴、費用、接手及限制；verification列測試命令結果、真網站／各模型驗證及EXE hash。僅在使用者明確指派後將計畫送到其他對話執行。

## 自我檢查與依賴

規格對應：能力/網路關卡→Task1；導航/提取/隱私→Task2；同模型決策/限制/引用→Task3；授權/UI/取消/歷史相容→Task4；實機/模型/EXE→Task5。
優先順序：1→2→3→4→5。Task3純解析測試可在Task2期間獨立進行，但不得跳过Task1外網與安全關卡。

## 分階段交付與停止條件

| 階段 | 交付證據 | 不通過時 |
| --- | --- | --- |
| 1 可行性 | 真搜尋結果、正文、攔截測試與限制報告 | 停止產品整合，回報阻礙，不擅自換搜尋服務 |
| 2 瀏覽器 | 提取、隔離、取消及網路限制測試 | 修正失敗案例，不接入真模型 |
| 3 模型循環 | 一般聊天 1 次模型／0 搜尋；搜尋上限與來源測試 | 不宣稱未實測模型相容 |
| 4 介面整合 | 單入口、授權、私人查詢確認、接手與舊功能回歸 | 不以靜態畫面代替互動驗證 |
| 5 EXE | 自動測試、真網站、已授權模型實測與打包紀錄 | 明列未驗收項目，不把 fixture 當外網成功 |

交接時先讀本規格及計畫，再重查現有版本與修改，不能依歷史 0.5.7 快照覆蓋後續工作。首次執行以 Task 1 報告為檢查點；此文件的建立不代表已完成搜尋功能，也不授權自動派送其他對話。
