# 0.5.2 驗證記錄

日期：2026-09-09

## 自動化驗證

- `$env:PET_DESKTOP_TESTS='1'; npm.cmd test`：105 項通過、0 項失敗、0 項跳過。
- `node diagnostics/portable.cjs release-0.5.2/blue-maid-desktop-pet-0.5.2.exe`：通過。已確認封裝狀態、0.5.2 版本、可見桌寵視窗、asar 內待機動畫播放、設定視窗與日記頁。

## 產物

- EXE：`desktop-app/release-0.5.2/blue-maid-desktop-pet-0.5.2.exe`
- SHA-256：`8B70D1966396BFBFCBC6CC4ADBCC586A231A7D679AF45906D4CD2F09FCE13641`

## 尚未由人工驗收

- 真實 Gemini、OpenAI、DeepSeek API（未提供金鑰，未產生費用）。
- 實體雙螢幕／混合 DPI、輸入法、透明命中與拖曳。
- 10–20 分鐘主動關心的實際桌面觀察；排程器以假時間測試驗證。
