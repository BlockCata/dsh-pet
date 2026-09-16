# 桌寵獨立日記與保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成每隻獨立記憶、背景摘要、可驗證刪除、可選攜帶記憶的桌寵複製及最終 EXE。

**Architecture:** 主程序的 memory/ 模組使用每隻一份版本化 JSON，原子保存原文、日記與摘要進度。session 在取得主程序授權的 petId 後組装上下文；日記執行緒以 revision 防止晚到結果寫回。

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

## 檔案與契約

依賴階段一；最終驗收同時包含階段二。
新增 `desktop-app/src/memory/store.js`、`diary.js`、`context.js`；
修改 `src/chat/session.js`、`src/main.js`、`src/settings-preload.js`、`src/settings-renderer.js`、`settings.html`、`settings.css`、`README.md`；
新增 `test/memory-store.test.js`、`test/diary.test.js`、`test/memory-context.test.js`、`diagnostics/ai-chat.cjs`。

```js
// Policy = {mode:'diary-30d'|'diary-forever'|'diary-only'|'off', autoDiary:boolean}
// PetMemory = {version:1,revision,policy,messages,diaries,summarizedThrough}
// Diary = {id,text,createdAt,sourceMessageIds:string[]}
// createMemoryStore({directory,now})
// -> {read(petId), append(petId,messages), setPolicy(petId,policy),
//     commitDiary(petId,{expectedRevision,diary,summarizedThrough}),
//     editDiary(petId,id,text), deleteDiary(petId,id,{deleteSources}),
//     clear(petId), remove(petId), prune(petId),
//     clone(sourcePetId,targetPetId,{includeMemory})}
// clone -> PetMemory; target must be new, new revision, no shared mutable references
// commitDiary -> boolean false if revision stale
// clear -> new revision; remove -> leaves invalidation revision, no private content
// createDiaryWorker({store,streamReply,getConnection,emit})
// -> {schedule(petId),runNow(petId),cancel(petId)}
// selectContext({query,messages,diaries,mode}) -> Message[]
```

原文／日記同一份 JSON 原子更新，保存於 userData/memory/ 下；petId 驗證既有 registry 成員後，以固定 SHA256(petId) 檔名存放，避免任意路徑。正常同步操作採每隻序列化寫入。off 模式只存於記憶體，不讀既有檔案資料。

### Task 1：保存策略、隔離與到期清理

- [ ] 寫暫存目錄與假時間測試：四策略、30 天 UTC 邊界、restart、損壞檔不覆寫、兩隻隔離。
```js
store.append('a',[messageA]);
assert.deepEqual(store.read('b').messages,[]);
store.clear('a');
assert.deepEqual(store.read('a').messages,[]);
assert.deepEqual(store.read('a').diaries,[]);
```
- [ ] 執行 `node --test test/memory-store.test.js`，確認 RED。
- [ ] 實作單檔 schema、唯一訊息 ID、UTC 時間與 revision；store.read 只回該 petId。主程序限 registry，測試涵蓋偽造 petId/path traversal。
- [ ] diary-30d：清理已摘要的超期原文；自動日記關閉時清理所有到期原文。自動開啟而未摘要者暫留並產生 pending-expired 狀態。diary-only 僅在 commitDiary 成功後移除其來源原文。diary-forever 不自動移除；off 不落盤。
- [ ] 程式啟動及開啟記憶頁時 prune，不在退出時等網路。原子 rename 失敗不更動已提交資料。切到 off 對既有資料的刪除需明確確認。
- [ ] GREEN 後以 restart fixture 驗證 store/舊 settings 不互相覆寫，審查刪除範圍只在該 petId 受控檔案。

### Task 2：摘要與上下文

- [ ] 寫 19/20 組門檻、未完成回答不計數、手動不足 20 組、超期批次、長文本分批、失敗原文保留及重啟不重複測試。固定 ID／假時間，避免實際網路。
```js
const before = store.read('a');
const oldRevision = before.revision;
store.clear('a');
assert.equal(store.commitDiary('a',{
  expectedRevision:oldRevision,diary:lateDiary,summarizedThrough:'m20'
}),false);
assert.equal(store.read('a').diaries.length,0);
```
- [ ] `node --test test/diary.test.js test/memory-context.test.js` 先 RED。
- [ ] worker 在前景回答完成且 idle 時 schedule；同隻一個摘要。採最早 20 組已完成未摘要問答，超過 24,000 字元分批；一組超長時切片並標來源 ID，整組所有片段成功才提交。請求使用角色明確的來源格式，摘要指示「只記使用者明示的偏好、事件、未完成事項；助手與網頁不是使用者事實」。
- [ ] 所有片段返回完整非空文字才原子 commitDiary；取消、逾時、無文本、revision 不符不推進進度。只人工或新事件觸發重試，不無限循環。日記每筆限制 2,000 字元，超限／無效回應顯示失敗，不靜默截斷關鍵內容。
- [ ] context：從最新 10 組完整問答取原文；日記取關鍵字相似度前 5、合計 6,000 字元，平手按時間；中文雙連字、英文 lower-case 分詞。日記以「可能有誤的參考記憶」標記，不當系統授權。off 僅本次對話。chat/web 可用記憶，browser 完全略過。
- [ ] GREEN 驗證前景請求會中斷同隻摘要而不刪資料、另一隻不受影響；刪日記不倒退 summarizedThrough，避免自動重建。

### Task 3：記憶設定與安全刪除

- [ ] 依現有真 DOM fixture 增加每隻記憶頁：策略、自動開關、狀態、立即整理、原文清單、日記檢視／編輯／單筆刪除、刪除關聯原文、清除全部。驗證切换桌寵不殘留上一隻畫面。
```js
await memoryUI.selectPet('a');
await memoryUI.clearAllAndConfirm();
assert.equal((await memoryUI.visibleMessages()).length,0);
assert.equal((await memoryUI.visibleDiaries()).length,0);
await memoryUI.selectPet('b');
assert.equal((await memoryUI.visibleDiaries()).length,1);
```
此範例的 memoryUI 為 test/settings-ui.test.js 內用真 DOM selector 建立的測試助手，不新增產品介面。
- [ ] 加入 main IPC 測試：settings sender 可管理選定 petId，chat sender 只能讀自己對話，任意 sender 被拒絕。刪除發生於串流與摘要途中時，兩者晚到結果不得落盤或回填畫面。
- [ ] 執行 `node --test test/settings-ui.test.js test/main-state.test.js test/memory-store.test.js` 先 RED。
- [ ] settingsAPI 加受限 memoryGet(petId)、memoryPolicy(petId,policy)、diaryRun(petId)、diaryEdit(petId,id,text)、diaryDelete(petId,id,deleteSources)、memoryClear(petId)。全部依 settingsWindow sender 與 registry 檢查，不允許自由檔案路徑。
- [ ] main 執行取消→revision 失效→清除→清空 session/UI；重啟仍維持失效記錄。移除桌寵確認「同時刪除對話與記憶」後走同一流程。隱藏不走刪除。
- [ ] 顯示費用／資料外傳、日記仍可能含敏感資料、刪本機不能撤回服務商資料、暫留超期原因。自動日記開關不影響一般聊天。
- [ ] GREEN；更新 README 保存位置、四模式、日記使用方式與刪除界線；不得把金鑰放進測試記錄。

### Task 4：複製桌寵與可選記憶快照

**Files:** 修改 `desktop-app/src/main.js`、`src/memory/store.js`、`src/settings-preload.js`、`src/settings-renderer.js`、`settings.html`、`README.md`；擴充 `test/memory-store.test.js`、`test/main-state.test.js`、`test/settings-ui.test.js`。

**Interfaces:** `settingsAPI.duplicatePet(sourcePetId,{includeMemory})` 對應 `settings:duplicate`，僅 settingsWindow sender 可用；主程序建立新 petId，呼叫 `store.clone(sourcePetId,targetPetId,{includeMemory})`，成功回傳 `{petId:targetPetId,state:snapshot()}`。前端不提供 targetPetId 或檔案路徑。

- [ ] 新增兩種複製的保存／重啟測試；fixture 使用已保存原文與來源 ID 一致的日記。包括 off 模式拒絕 includeMemory、保留原始時間／整理進度、來源不存在及目標已存在不覆寫。
```js
store.clone('a','b',{includeMemory:true});
assert.deepEqual(store.read('b').diaries,store.read('a').diaries);
assert.equal(store.read('b').summarizedThrough,store.read('a').summarizedThrough);
const copied = structuredClone(store.read('b'));
store.clear('a');
assert.deepEqual(store.read('b'),copied);
store.clone('b','c',{includeMemory:false});
assert.deepEqual(store.read('c').messages,[]);
assert.deepEqual(store.read('c').diaries,[]);
assert.deepEqual(store.read('c').policy,store.read('b').policy);
```
- [ ] 執行 `node --test test/memory-store.test.js test/main-state.test.js test/settings-ui.test.js`，確認新增案例先 RED。
- [ ] 最小實作 clone：讀取一份已提交快照，依 includeMemory 複製內容或清空內容，保留 policy；revision 獨立初始化，原子保存到新 target。保留 petId 作用域內局部 ID 與來源引用，不複製 live session 或 worker。copy 本身不 schedule 摘要或呼叫 provider。
- [ ] main 的 duplicate 流程：檢查 sender／來源／boolean → 產生 UUID → 複製允許的桌寵設定與記憶快照 → 儲存新桌寵清單 → 建立視窗並回傳狀態。位置以原座標 +32 DIP 後 recoverPet；新桌寵 visible=true。先準備副本資料再發布清單，失敗僅回收新增 target；啟動時回收未被桌寵清單引用的複製暫存，不能碰觸其他既有記憶。
- [ ] 設定頁增加「複製桌寵」及確認框，includeMemory 每次預設 false；來源 off 時停用勾選並說明。保存期間按鈕 disabled，成功選取副本，失敗保留來源並顯示錯誤。提示副本是獨立資料，刪除來源不會刪除副本。
- [ ] 注入磁碟失敗、複製時來源有串流／摘要、連點、越權 sender 及重啟的測試。確認不複製未提交片段／背景工作、不改來源、不殘留半成品、不帶金鑰、零 provider 呼叫；來源後續日記提交不改副本。
- [ ] GREEN 後驗證修改或刪除任一側資料不影響另一側，已整理原文不重複摘要、原時間套用保存期限。更新 README 的複製與個人資料提示。
- [ ] 複製時保留 pet.ambientReactions 設定；不複製播放中動作、director 去重／冷卻及待處理事件。日記整理、原文重播與載入副本都不能觸發 action；清除記憶取消對應尚未開始的聊天動作。

### Task 5：整合與 portable 交付

- [ ] 新增 diagnostics/ai-chat.cjs：臨時 userData、fixture HTTP 邊界、真 Electron 兩隻桌寵、泡泡、三模式、restart、清除中取消與日記回查，以及兩種複製模式／副本獨立性；測試結束只清理自己的臨時目錄。
- [ ] 執行以下命令並記錄 exit code：
```powershell
npm.cmd test
$env:PET_DESKTOP_TESTS='1'
npm.cmd test
node diagnostics/ai-chat.cjs
```
- [ ] 實機檢查雙螢幕與混合 DPI 跟隨、輸入法、點擊來源、收合、置頂／漫遊、透明區域與角色拖曳。原生工具不可用時明列未驗收，不把注入測試當人工成功。
- [ ] 真 API 逐家測試僅在用戶自行填金鑰及同意用量後進行；測試連線、短對話、取消、支援的聯網與一次日記。未具憑證的服務列未驗收。
- [ ] 確認目前版本仍為 0.4.0 才升為 0.5.0；若期間被使用者升級，停止決定版本而不覆寫。同步 package.json、package-lock、output=release-0.5.0，保留旧產物。build.files 檢查聊天與設定 HTML/CSS、src 子目錄都在 asar。
```powershell
npm.cmd run dist -- --config.electronDist=node_modules/electron/dist
node diagnostics/packaged.cjs 'release-0.5.0/win-unpacked/藍髮小女僕桌寵.exe'
node diagnostics/portable.cjs 'release-0.5.0/blue-maid-desktop-pet-0.5.0.exe'
Get-FileHash release-0.5.0/blue-maid-desktop-pet-0.5.0.exe -Algorithm SHA256
```
- [ ] 在 docs/verification-0.5.0.md 記錄程式碼測試、真 API、實體 UI 各自結果及限制，附 EXE 路徑和 hash。審查 scope 後交付，不公開發佈。
