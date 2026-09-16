# 桌寵第二輪聊天功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Windows 桌寵的聯網、日記、圖片附件與最後訊息修正都維持真實能力、每隻隔離與可驗證的本機資料一致性。

**Architecture:** 供應商能力由 adapters 的明確 capability 決定，聊天 session 不再有 browser 分支。訊息、附件與日記關係由 memory store 原子處理；聊天/日記視窗只是經 preload 呼叫受限 IPC 的閱讀與編輯介面。

**Tech Stack:** Electron CommonJS、Node 內建 fs/crypto、現有 node:test、既有原專案素材。

**Spec:** `.scratch/pet-ai-chat/spec.md`

## Global Constraints

- 僅 Windows portable EXE；不生成或改寫原專案素材，不覆蓋舊 release。
- API 金鑰僅主程序 safeStorage；不記錄金鑰、附件位元組或聊天正文。
- 自訂服務的搜尋/視覺能力預設不支援，不能由模型名稱或回覆推測。
- 圖片上限：PNG/JPEG/WebP，最多 3 張、單張 5 MiB、總計 10 MiB；僅使用者明確附加。
- 既有每隻隔離、日記 policy、動作仲裁、泡泡 -80、置頂與關心行為不可回歸。

---

### Task 1: 對話模式、能力與角色文案

**Files:** `desktop-app/src/ai/providers.js`, `desktop-app/src/chat/session.js`, `desktop-app/chat.html`, `desktop-app/src/chat/renderer.js`, `desktop-app/src/chat/preload.js`, `desktop-app/test/ai-providers.test.js`, `desktop-app/test/chat-session.test.js`, `desktop-app/test/chat-ui.test.js`

**Interfaces:** providers exposes `capabilities(connection)` and only accepts `chat|web|greeting|proactive`; session exposes `send()` without browser dispatch.

- [x] 寫失敗測試：custom/web 回傳 unsupported、browser mode 被拒絕、短回答 prompt 不含重複角色介紹要求。
- [x] 執行指定 node:test，確認缺少 capability/拒絕行為而失敗。
- [x] 最小修改 providers/session/UI：移除 browser 控制項與後備按鈕，以 capability 決定 web，設定自訂文案改為通用文字。
- [x] 執行 provider、session、renderer 測試確認通過。

### Task 2: 日記閱讀、自然整理與最後訊息修正

**Files:** `desktop-app/src/memory/store.js`, `desktop-app/src/memory/diary.js`, `desktop-app/src/chat/session.js`, `desktop-app/src/main.js`, `desktop-app/settings.html`, `desktop-app/src/settings-renderer.js`, `desktop-app/test/memory-store.test.js`, `desktop-app/test/diary.test.js`, `desktop-app/test/chat-session.test.js`, `desktop-app/test/main-state.test.js`

**Interfaces:** store exposes `editLatestUserMessage(petId, messageId, text)` and returns invalidated diary ids; diary `runNow()` returns a true state; session may call injected `runDiary(petId)` only for recognized natural requests.

- [x] 寫失敗測試：編輯最後 user 訊息刪除對應 assistant、只失效引用該訊息的日記；舊晚到回覆不追加；自然整理在無新內容/成功/失敗時把真實狀態交給當次回覆。
- [x] 執行 store、diary、session 測試確認失敗原因是 API 未實作。
- [x] 實作 sourceMessageIds 關係、日記 worker 狀態、session cancellation/retry，以及日記獨立視窗的受限 IPC。
- [x] 執行相關測試確認通過，並檢查不同 petId 互不讀寫。

### Task 3: 使用者明確圖片附件

**Files:** `desktop-app/src/chat/attachments.js`, `desktop-app/src/memory/store.js`, `desktop-app/src/ai/providers.js`, `desktop-app/src/main.js`, `desktop-app/src/chat/preload.js`, `desktop-app/chat.html`, `desktop-app/chat.css`, `desktop-app/src/chat/renderer.js`, `desktop-app/test/attachments.test.js`, `desktop-app/test/ai-providers.test.js`, `desktop-app/test/chat-session.test.js`

**Interfaces:** `stageAttachments()` validates and stores selected/clipboard images; persisted message uses metadata plus managed local path; providers consume image content only when `capabilities(connection).vision` is true.

- [x] 寫失敗測試：拒絕超量/格式/大小、off policy 不寫檔、刪除或 clone 不保留來源附件、未支援供應商零網路請求。
- [x] 執行附件/provider/session 測試確認失敗。
- [x] 實作主程序選檔與剪貼簿讀圖、預覽/移除、受限保存/刪除，並只為已確認的供應商格式加入圖像內容。
- [x] 執行相關測試確認通過；確認附件不是自動截圖、不是任意檔案讀取。

### Task 4: 整合、UI 與封裝

**Files:** `desktop-app/settings.html`, `desktop-app/settings.css`, `desktop-app/src/settings-renderer.js`, `desktop-app/package.json`, `desktop-app/package-lock.json`, `desktop-app/README.md`

- [x] 寫失敗 UI 測試：自訂文案無品牌、日記視窗按鈕、最後訊息編輯與附件預覽存在，browser 控制項不存在。
- [x] 執行實際 Electron UI fixture，確認失敗。
- [x] 最小實作可存取日記閱讀窗、更新 UI 提示，升版 output 目錄但保留舊 release。
- [x] 執行 `npm.cmd test`、`PET_DESKTOP_TESTS=1 node --test test/settings-ui.test.js`，再封裝 portable EXE 並檢查非零檔案大小與 SHA-256。

### Addendum: Gemini Google Search Grounding

- [x] 依官方 Generate Content 格式，在 Gemini 的 `web` 模式加入 `tools: [{ google_search: {} }]`。
- [x] 僅從 `groundingMetadata.groundingChunks[].web` 擷取並正規化可引用來源；串流分段來源在完成後合併。
- [x] Gemini 未提供來源時回傳空來源；iAI 自訂服務維持不支援，因其文件未提供搜尋或 citation 格式。
- [x] 執行 providers 與完整測試，封裝新的 Windows portable EXE。
