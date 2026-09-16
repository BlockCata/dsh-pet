# 僅網頁查詢與彙整 Implementation Plan

> For agentic workers: Use superpowers:executing-plans or superpowers:subagent-driven-development. 所有受派agent最高Terra/high。本輪已依此計畫執行；最終程式碼審查 clean，但正式瀏覽器搜尋交付仍受安全驗收關卡阻擋。

**Goal:** 讓沒有原生聯網能力的模型經桌寵隔離瀏覽器取得公開資料並彙整，不新增任何其他模型操作權限。

**Architecture:** provider只產生受限answer/search決策，session維護回合/預算，browser-search固定執行查詢與擷取。主程序檢查授權及生命週期，來源不可信且不能通往動作/日記/設定工具。

**Tech Stack:** Windows Electron、現有JS/CommonJS、node:test、HTML/CSS，不預設新套件或系統服務。

**Spec:** .scratch/pet-browser-search/readonly-scope-2026-09-14.md；沿用舊spec的未衝突限制。

## Global Constraints

- 基準0.5.10；重查正式目錄與主管worktree最新修改。保留未追蹤工作、既有EXE與原素材。
- 模型僅answer/search；不提供通用電腦/瀏覽器操作工具。搜尋续答不執行動作/寫日記。
- 同API/model，不接額外搜尋服務；不再研究iAI是否原生支援搜尋作為前置條件。
- 每回合2搜尋/3模型/6正文/18000來源字元；每頁6000/query300。一般對話不額外加分類模型請求。
- 無管理員/WFP/driver/防火牆/系統proxy/根憑證/自動登入；本機代理如有必要須另批准具體方案。
- 完整安全關卡仍需證據；不因模型權限縮小就聲稱瀏覽器安全。獨立純函式工作可並行，完整整合須通過真瀏覽器驗收。
- 不接觸私人資料/key，真模型需另有用量授權。不得同時改同檔，暫不提交或推送。

## 契約與檔案

新增 desktop-app/src/ai/search-protocol.js、src/browser-search/{policy,extract,service}.js。
修改 src/ai/providers.js、src/chat/session.js、src/main.js、src/chat/{preload,renderer}.js、src/settings-store.js、src/settings-renderer.js、chat.html/chat.css/settings.html。
沿用src/chat/search.js的固定搜尋URL；統一安全檢查不保留相互矛盾入口。

```js
// Decision = {type:'answer'} | {type:'search',query:string}
// Source = {id,title,url,retrievedAt,text,coverage:'page'|'snippet'}
// parseDecision(line) -> Decision; strict keys, query <=300, line <=2048
// createSearchProtocol() -> {push(chunk),finish()}; answer可串流，search全文驗證後才emit
// createBrowserSearch(deps) -> {search({petId,requestId,query,signal}),cancel(petId,requestId),dispose(petId)}
// search -> {status:'ok'|'empty'|'needs-user'|'blocked',sources:Source[],reason?}
// 尚未安全通過的service只回blocked，不留可繞過的production測試入口
// validatePublicUrl(url,resolveHost) -> Promise<{url,addresses}>
// extractSearchResults(document,baseUrl) -> [{title,url,snippet}]
// extractPage(document) -> {title,text}
```

## Task 1：模型權限與協定（不依賴真網站）

Files: src/ai/search-protocol.js；test/search-protocol.test.js；對照providers.js既有動作parser。

- [ ] RED：嚴格白名單，不從自由文字猜命令；未知type/欄位/超限/多餘內容拒絕。
```js
assert.deepEqual(parseDecision('{"type":"search","query":"ExampleUniversity公告"}'),{type:'search',query:'ExampleUniversity公告'});
assert.throws(()=>parseDecision('{"type":"execute","code":"anything"}'));
assert.throws(()=>parseDecision('{"type":"search","query":"公告","path":"C:/"}'));
```
- [ ] 執行 `node --test test/search-protocol.test.js` 確認RED，再實作固定schema及分段parser。
- [ ] GREEN：分段JSON/answer文字、空query、未知tool、search尾隨任意文字、頁面偽工具標記均測試。search完成驗證前不產生副作用。

## Task 2：隔離瀏覽器與實際阻礙重驗

Files: diagnostics/browser-search-probe.cjs；src/browser-search/{policy,extract,service}.js；test/browser-search-{policy,extract,service}.test.js；.scratch/pet-browser-search/readonly-validation.md。

- [ ] 先讀現有probe證據與實作；補permission check/request雙拒絕、無產品preload、不可任意導航/下載/本機資源的測試，不重寫已正常部分。
```js
await assert.rejects(()=>validatePublicUrl('https://127.0.0.1/',resolveHost));
await assert.rejects(()=>validatePublicUrl('file:///C:/Windows/',resolveHost));
await assert.rejects(()=>validatePublicUrl('https://public.example/',async()=>['::1']));
```
- [ ] 執行 `node --test test/browser-search-policy.test.js test/browser-search-extract.test.js test/browser-search-service.test.js`，逐組RED→最小實作→GREEN。
- [ ] 真瀏覽器僅固定公開查詢；驗證搜尋結果/一篇正文/來源時間與Google驗證頁接手，不繞過。DOM selector以觀察為準。
- [ ] 分開記錄：已可開頁、已可擷取、已攔截URL、已驗證實際連線。DNS重綁/redirect/IPv6/frame/worker/subresource測試不得以mock成功冒充實際socket阻擋。
- [ ] 若不能通過，輸出一個具體失敗案例與最小方案所需權限；不自行加入proxy/WFP，也不阻擋Task1/3的fixture邏輯開發。service維持blocked直到可驗證。

## Task 3：同模型查詢—回答循環

Files: src/ai/providers.js、src/chat/session.js、src/main.js；test/ai-providers.test.js、test/chat-session.test.js、test/main-state.test.js。

- [ ] RED：fake provider先search後answer，fake browser回來源；單純回答為1模型/0搜尋；第二次補查後第三次只答。
```js
// 使用既有session測試依賴注入browser service與provider
assert.equal(modelCalls.length,2); // 一次search決策，一次彙整
assert.equal(browserCalls.length,1);
assert.equal(actionCalls.length,0); // 搜尋續答沒有動作權限
assert.equal(diaryWriteCalls.length,0);
```
- [ ] 在原session加有界循環，同API/model快照，保留createdAt/currentTime；只向本回合傳來源摘錄，不寫成使用者原文或日記指令。
- [ ] 搜尋分支不加原生google_search/web_search、不解析執行动作標記；把外部資料與工具控制分開，未知來源ID不產生連結。
- [ ] 指令要求讀key/上傳/改設定/送日記到query：只能拒絕，不能有通用工具fallback。敏感query需使用者確認後才外送。
- [ ] GREEN：關閉授權/明確不搜尋、格式錯誤、無結果、timeout、cancel/clear/edit/off晚到、兩隻排隊、圖片不外送、來源ID與同模型限制。

## Task 4：單一聊天與來源呈現

Files: chat.html/chat.css、src/chat/{renderer,preload}.js、src/main.js、settings.html、src/settings-{store,renderer}.js；test/chat-ui.test.js、test/settings.test.js、test/settings-ui.test.js。

- [ ] RED：設定缺值false；移除一般/聯網模式選單後仍能正常送文字/圖片。搜尋進度只顯示狀態，不顯示控制JSON。
- [ ] 新增每隻允許網頁查詢與資料外送說明；沿用舊計畫的showSearch/resumeSearch/cancel與敏感query確認介面，sender綁pet/request，不接受任意URL/path/petId。
- [ ] 回答附title/URL/擷取時間，可顯示只讀摘要。未查到以角色語氣說明失敗，不能說已驗證最新資料。
- [ ] GREEN：歷史來源仍顯示；圖片/時間/-80/置頂不回歸；停止/清除不復活。驗證頁只人工接手，私人登入要求停止。

## Task 5：整合、審查、交付

Files: docs/verification-readonly-browser-chat.md；desktop-app/README.md、package.json、package-lock.json（僅驗收後）。

- [ ] 執行 `npm.cmd test` 及 `$env:PET_DESKTOP_TESTS='1'; npm.cmd test`，必要時按正常核准流程在sandbox外用隔離fixture，不關Electron sandbox。
- [ ] 真公開搜尋/正文/引用測試與惡意fixture分開；至少一個無原生搜尋的自訂模型在另獲key/用量授權後端到端測試。未獲授權則列未驗收，不宣稱所有模型通用。
- [ ] 獨立Terra/high審查權限與生命周期；確認模型工具列表只有answer/search且無外部內容副作用。安全關卡不通過不打包成正式搜尋版。
- [ ] 通過後重查下一版本，保留原EXE，執行 `npm.cmd run dist -- --config.electronDist=node_modules/electron/dist`，確認打包程式與source一致、無key/cookies/私人資料，再執行既有packaged/portable診斷。
- [ ] 報告分列：已實作、fixture、真網站、真模型、打包、未驗證風險；不以規劃/研究等同完成。

## 分工與順序

協定agent（Task1）及瀏覽器agent（Task2）可在分離檔案並行；Task3需協定契約，Task4與Task3的main.js改動由同一整合者依序處理；Task5最後。主管既已由使用者指定為「桌寵更新主管-Terra」，本輪不另建主管/不重複派工。

自我檢查：模型權限→Task1/3；瀏覽器安全與既有阻礙→Task2；同模型/來源/預算→Task3；單入口/授權/相容→Task4；驗證/EXE→Task5。本計畫未宣稱安全阻擋已解除，也未授權新增系統權限。
