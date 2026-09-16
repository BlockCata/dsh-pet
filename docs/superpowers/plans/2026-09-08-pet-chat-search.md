# 桌寵搜尋模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加入可選擇的聯網回答與預設瀏覽器搜尋。

**Architecture:** 沿用階段一 streamReply 與 chat 視窗。原生搜尋走供應商 adapter；browser 模式在主程序直接開編碼後的搜尋 URL，不讀取記憶、不呼叫 AI。

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

## 依賴與檔案

先完成 `2026-09-08-pet-chat-api.md`，讀取 `.scratch/pet-ai-chat/api-capabilities.md`。
新增 `desktop-app/src/chat/search.js`；
修改 `src/ai/providers.js`、`src/chat/session.js`、`src/chat/preload.js`、`src/chat/renderer.js`、`src/main.js`、`chat.html`、`chat.css`。
新增 `test/search.test.js`，擴充 `test/ai-providers.test.js`、`test/chat-ui.test.js`。

介面：
```js
searchUrl(query) // -> canonical HTTPS Google search URL; max 8,000 chars, nonempty
validateSourceUrl(url) // -> normalized http(s) URL; otherwise throws
openBrowserSearch(query,openExternal) // -> Promise<void>
// providers: reuse streamReply({connection,messages,mode,signal})
// reuse {type:'sources',sources:[{title,url}]} event
// chatAPI.openSource(url) // MAIN validates URL, then shell.openExternal
```

### Task 1：瀏覽器搜尋，不產生模型請求

- [ ] 寫 URL 與惡意協定測試：
```js
const query = '桌寵 & api #問題';
const url = new URL(searchUrl(query));
assert.equal(url.protocol,'https:');
assert.equal(url.hostname,'www.google.com');
assert.equal(url.searchParams.get('q'),query);
assert.throws(() => validateSourceUrl('javascript:alert(1)'));
assert.throws(() => validateSourceUrl('file:///C:/secret'));
```
- [ ] `node --test test/search.test.js` 必須先 RED。
- [ ] 實作 searchUrl 使用 URL、searchParams.set；openBrowserSearch 只用固定網址。chat session 在 mode=browser 時先分流，不能呼叫 getConnection、streamReply、getMessages 或未來記憶 API。
- [ ] chat-ui 顯示三個模式及「將搜尋文字傳給搜尋引擎」提示；browser 成功僅顯示已開啟瀏覽器，不產生假 assistant 回答。
- [ ] 增加 spies 證明 browser 模式 AI 呼叫數=0、持久化數=0。GREEN 後檢查新模式不改正在執行的 chat 請求。

### Task 2：有來源的聯網回答

- [ ] 根據階段一查核的官方搜尋工具格式建立 Gemini/OpenAI 真實形狀 fixture；不支援的模型先測 unsupported，零 fetch、零自動 fallback。
```js
const events = [];
for await (const event of streamReply(webRequest)) events.push(event);
assert.ok(events.some(e => e.type === 'sources' && e.sources.length > 0));
assert.ok(events.filter(e => e.type === 'sources')
  .every(e => e.sources.every(s => /^https?:/.test(s.url))));
```
- [ ] `node --test test/ai-providers.test.js test/chat-ui.test.js` 先 RED，加入來源缺失、工具 quota、引用重複與惡意 title 的 fixture。
- [ ] Gemini/OpenAI adapter 在 web 才附搜尋工具；chat 不附。從工具 metadata 正規化來源、去重，不靠模型文本猜 URL。保留供應商規定的歸因；若要求無法安全呈現，阻擋該整合並記錄原因。
- [ ] DeepSeek 未查核到原生能力時回 unsupported；畫面提供使用者主動按「改用瀏覽器搜尋」。不新增其他搜尋服務、金鑰或抓取瀏覽器 cookie。
- [ ] 回覆下方分開列來源，標題純文字，點擊走 chatAPI.openSource 驗證；沒有來源時標示「未取得可引用來源」，不得標示已查證。外部資料只作資料，不接受工具授權或記憶寫入指令。
- [ ] GREEN 後執行 `npm.cmd test`；分別手動試一般聊天、web、browser。真搜尋需同意用量；無金鑰記錄未驗收。
- [ ] 階段交付：模式切換可用、browser 無 AI 流量、web 有來源／失敗提示、沒有暗中服務切換。
- [ ] 對話動作回歸：browser 不觸發 director；web 的 action 僅接受第一階段已驗證的結構化事件，不從來源內容解析。測試搜尋工具要求跳舞、偽造 actionId 不獲得執行權；模型不支援搜尋＋動作時顯示限制，維持來源回覆，不多送一次模型請求。
