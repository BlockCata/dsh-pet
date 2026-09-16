# 藍髮小女僕桌寵 0.5.0 驗證紀錄

日期：2026-09-09

## 交付檔案

- Portable EXE：`desktop-app/release-0.5.0/blue-maid-desktop-pet-0.5.0.exe`
- SHA-256：`D4AD6D3C5CC2C009F4967FBC171265076F901AD71FAE2C95CBA1DB6AF4E9E7F5`
- Unpacked EXE：`desktop-app/release-0.5.0/win-unpacked/藍髮小女僕桌寵.exe`

## 已驗證

- `npm.cmd test`：81 passed、2 skipped（Electron 視窗測試依預設略過）。
- `$env:PET_DESKTOP_TESTS='1'; npm.cmd test`：83 passed、0 failed、0 skipped。
- `npm.cmd run dist -- --config.electronDist=node_modules/electron/dist`：成功產出 Windows x64 portable 0.5.0。
- 本次 portable EXE 在獨立暫存 userData 下啟動成功；主程序與桌寵渲染器均可連線，動畫從 `app.asar/assets` 載入，Canvas 為 640×360。
- `app.asar` 靜態檢查已確認包含 `chat.html`、`settings.html`、`src/chat/window.js`、`src/memory/store.js`，以及 Gemini HTTP 400 的安全設定錯誤映射。
- 記憶策略、獨立資料、日記編輯／刪除、複製選項、透明命中、跨螢幕拖曳、聊天泡泡、金鑰遮蔽均有自動化測試覆蓋。

## 未以人工實機宣稱通過

- 未以真實 API Key 測試 Gemini、OpenAI 或 DeepSeek；使用者未提供金鑰，且聯網回答依要求維持暫停。
- 未進行人工雙螢幕混合 DPI、輸入法與通知區圖示位置檢查；現有自動化測試只驗證程式邏輯與隱藏 Electron 視窗，不等同實體操作。
- 封裝診斷腳本以模擬第二次啟動開啟設定頁時未設逾時，這次重建後停在該腳本步驟；桌寵頁已確認載入，但未將此輪設定頁自動檢查宣稱為通過。
- EXE 未簽署發行憑證；Windows 可能顯示未知發行者或 SmartScreen 提示。
