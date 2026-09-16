# 聊天時間與已傳送圖片 Implementation Plan

> 執行者使用 Terra / high，不再委派、不提高模型或思考程度。使用者已授權完成計畫後直接執行。主管審查後才整合打包。

**Goal:** 聊天泡泡顯示訊息時間、模型能參考時間脈絡，並修復已傳送圖片與歷史附件顯示。

**Architecture:** 沿用訊息 createdAt 與附件儲存。主程序提供可信時間脈絡及受 sender/pet/message 範圍限制的附件讀取；renderer 呈現時間與縮圖，不取得任意本機路徑能力。

**Tech Stack:** 現有 Electron / JavaScript / HTML / CSS / node:test，不新增服務或素材。

## 範圍與規格

- 訊息顯示本機時間 `YYYY/MM/DD HH:mm`，使用語意化 time 元素及 ISO datetime；缺失或無效歷史時間顯示「時間不詳」，不回填猜測值。
- 使用者 createdAt 為主程序接收送出時間；保留編輯前原始時間。AI 訊息時間採開始產生回覆時間（不是完成時間），主動訊息沿用其真實 createdAt。串流重繪不刷新時間。
- 每次使用者聊天請求由主程序生成 currentTime ISO、IANA timezone 與 UTC offset；各 provider 將可用 createdAt 納入對應訊息的文字脈絡。時間只為參考，不能宣稱已取得即時新聞或聯網資料；不要求模型反覆報時、角色自介。不要污染儲存的使用者原文。
- 不改圖片格式/容量/數量限制，不新增圖片生成或搜尋。不擴張模型視覺支援；顯示圖片不代表模型能看圖。
- 送出後圖片置於其 user 訊息內；依比例縮放、不超出泡泡、不被串流更新清除。送出失敗不冒充已成功保存。重開聊天後可載入仍存在的附件。
- 非持久記憶模式僅在其既有保留期間顯示，不為縮圖偷偷永久儲存；不改現有保存政策。找不到附件顯示「圖片無法載入」。克隆缺失附件同樣誠實提示，本次不擴張克隆儲存行為。
- renderer 僅送 messageId/attachmentId；主程序依 sender 判定 pet，查證附件確實屬於該訊息，再沿用安全store讀取。禁止 renderer 提供 path、file、petId 或任意URL直接讀檔；MIME 僅現有PNG/JPEG/WebP。避免一次將全部歷史圖片base64灌入訊息清單，逐附件按需載入並有界快取/清理。
- 舊版資料、來源引用、編輯上一則、取消、主動訊息、日記、置頂與 -80 偏移不回歸。圖片移除/清除後晚到讀取不得重建已刪訊息。
- 另一 agent 只執行搜尋 Task1 probe，不能碰它的 diagnostics/browser-search-probe.cjs、專用fixtures、feasibility.md。不得自行開始搜尋產品整合。
- 不使用真API key、不動使用者正在執行的桌寵、不提交/推送、不改版本或打包；只交付程式與驗證紀錄供主管審查。

## Task 1：重現與固定資料契約

Files: desktop-app/src/chat/{renderer,session,preload,attachments}.js、src/main.js、src/ai/providers.js（先讀）；既有相關 test/*.test.js。

- [ ] 讀 AGENTS 與領域文件，確認工作樹及現行程式；不得回復未提交修改。
- [ ] 依 diagnosing-bugs 先建立可執行 renderer 回歸測試：帶已保存附件的 getMessages 結果必須產生 user article 內 img；目前送出後也必須存在 img，不能只檢查輸入框預覽。執行並記錄修復前失敗。
- [ ] 固定測試時間為 `2026-09-13T07:15:00.000Z`，Asia/Taipei 預期顯示 `2026/09/13 15:15`；缺失/無效時間不得顯示 Invalid Date。
- [ ] 決定沿用的現有事件與測試工具；新跨程序契約為 `chatAPI.getAttachment({messageId,attachmentId}) -> {mimeType,data}`，data為base64，不回傳磁碟路徑。讀取錯誤由UI轉成附件不可用提示。

## Task 2：時間顯示與模型脈絡

Files: desktop-app/src/chat/renderer.js、src/chat/session.js、src/ai/providers.js、chat.css；必要的主程序時間注入與既有相關測試。

- [ ] RED：新送出、歷史、主動訊息、編輯原時間、串流不刷新、跨日與時區測試。
- [ ] 在既有事件/回傳資料中傳遞主程序訊息id及createdAt，將暫時UI與正式訊息對應；避免依renderer時鐘冒充正式時間。
- [ ] 新增最小時間格式化與 time 元素。檢查原本用 article.textContent 判斷空回答的地方：時間標籤不能讓空回答誤判為有內容。
- [ ] 注入可測試的當前時間/時區來源；所有現有provider聊天payload皆包含現在時間與有效訊息時間，圖片content parts仍保留。不對聊天以外呼叫強加搜尋/工具協定。
- [ ] GREEN：檢查實際序列化的各家payload而非僅prompt helper；固定時鐘下模型得到當前與歷史時間，原始儲存text不變。不使用真服務。

## Task 3：已送出及歷史圖片

Files: desktop-app/src/main.js、src/chat/preload.js、src/chat/renderer.js、src/chat/attachments.js（僅必要安全/生命週期修改）、chat.css；對應IPC/store/UI測試。

- [ ] RED：合法附件可讀；跨pet、跨message、偽造attachmentId、路徑穿越拒絕；清除後讀取失效。
- [ ] 實作 sender 綁定讀取，從正式訊息查找attachment metadata，不接受renderer提供磁碟資訊；仍執行store本身驗證。
- [ ] 共用新訊息與歷史訊息圖片render路徑，送出時保留預覽並在正式訊息確認後對應ID。按需載入、有界記憶體，不在訊息文字存base64。
- [ ] 保留圖片原比例，設定 alt、載入失敗提示；清理暫存/objectURL及晚到callback。不要新增圖片編輯/燈箱需求。
- [ ] GREEN：送出、重新開泡泡、重新啟動且仍在保存政策內、編輯文字後保留附件、多圖片、遺失檔、記憶關閉、清除競爭均覆蓋。來源與時間不能被圖片render覆寫。

## Task 4：驗收與回報

- [ ] 在 desktop-app 執行 `npm.cmd test`；定向測試需先記錄RED再GREEN，回報具體檔名及命令。
- [ ] 以隔離測試資料及現有非私人fixture，在真Electron驗證圖片 naturalWidth > 0、時間DOM與窄泡泡布局；不使用使用者聊天/附件/金鑰，不生成新素材。不具備GUI條件則明列未驗證。
- [ ] 回歸取消/編輯/歷史/主動訊息/來源；mock模型驗證時間payload，真模型措辭不列已驗收。
- [ ] 寫入 docs/verification-chat-time-images.md：根因、修改檔案、測試結果、GUI證據與未驗證事項；不自行升版打包，交主管審查。

## 主管檢查點

先驗證圖片重現證據與資料隔離，再審時間payload一致性及全套測試。搜尋Task1與本工作可並行；後续搜尋Task3/4須待本工作收斂後才改相同檔案。使用者本次指派為實作授權，不代表功能已完成。
