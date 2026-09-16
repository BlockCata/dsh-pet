# 桌寵設定、透明命中與跨螢幕 Implementation Plan

**Goal:** 完成使用者排定的三項 Windows 桌寵功能，產出獨立 0.3.0 EXE。

**Architecture:** 每個桌寵一個透明視窗，由同一個系統匣管理；設定視窗讀寫本機 JSON。影片透明度遮罩決定原生視窗是否穿透滑鼠，拖曳使用主程序提供的 DIP 桌面游標座標，拖曳期間不套用單螢幕邊界限制。

**Tech Stack:** 現有 Electron 43、JavaScript、Node test runner、HTML/CSS；不增加套件或生成素材。

**Spec:** 本對話排程的三項需求。大小使用百分比（50–200%），位置為桌面邏輯座標；每隻可選螢幕／角落、顯示與漫遊。可移除到零隻，系統匣仍可開設定新增。

## Global Constraints

- 僅 Windows、離線獨立 EXE；沿用藍髮女僕既有素材。
- 保留原 DSH 程式與舊版 EXE，不使用 AI 或網路服務。
- 工作目錄含前階段未追蹤的新程式；原地精準修改，不建立遺漏這些檔案的乾淨 worktree。
- 排程已授權直接實作；若有重大新權限或超出範圍的選擇才停止詢問。

## Tasks

- [ ] `src/layout.js`、`src/settings-store.js`、`test/settings.test.js`：先測大小、角落定位、負座標、離線螢幕復原、設定驗證及磁碟儲存，再實作。
- [ ] `src/hit-test.js`、`test/hit-test.test.js`：先測透明像素、實體像素、邊界、鏡像、縮放；用影片 frame callback 產生 alpha 資料，不產生新素材。
- [ ] `src/main.js`、`src/preload.js`、`src/renderer.js`：改用每個 renderer sender 對應的桌寵，主程序游標追蹤控制拖曳，設定與動作 IPC 保持限定來源；保留點擊／轉向／漫遊。
- [ ] `settings.html`、`settings.css`、`src/settings-renderer.js`：原生設定視窗，新增／移除、逐隻編輯、顯示螢幕及角落定位，明確顯示存檔失敗。
- [ ] `diagnostics/settings.cjs`：真實 Electron 檢查多實例、設定 UI、重啟還原、透明像素穿透切換與跨螢幕座標；注入測試與實體人工測試分開標示。
- [ ] 執行全部測試，檢視設定視窗截圖，打包並啟動 portable EXE；記錄無法完成的實體多螢幕／不同 DPI 驗收。
