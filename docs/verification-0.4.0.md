# Windows 桌寵 0.4.0 驗證紀錄

日期：2026-09-06

## 本次變更

- HTML5 影片改為 1×1 隱藏靜音來源，逐幀繪製至可見透明 Canvas；可見 Canvas 依桌寵倍率從 640×360 等比例調整，透明 alpha 命中使用獨立的 320×180 遮罩畫布。
- 每隻桌寵新增可保存的「永遠置頂」設定，既有設定未提供此欄位時預設維持置頂。
- 每隻桌寵新增 0–100% 的左右漫遊範圍；自動漫遊只使用 `animations.moves.actions` 中現有的「螃蟹走路」、「原地漂浮踏步」、「原地左转奔跑」素材。
- 沒有生成或修改任何動畫、圖片素材。

## 交付

- `desktop-app/release-0.4.0/blue-maid-desktop-pet-0.4.0.exe`
- 137,553,100 bytes
- SHA256：`3671AB6A4041099528ABB0F8E940CE63A5EE4A9594FF6F917C5F327FB7A1F6F1`
- Windows x64 portable；0.3.0 舊版檔案保留。

## 已通過

- `$env:PET_DESKTOP_TESTS='1'; npm.cmd test`：29/29，無跳過。
- `diagnostics/controls.cjs`：exit 0；確認置頂切換、影片 alpha 遮罩、透明區域穿透、角色像素互動、設定保存、多桌寵與零桌寵。
- `diagnostics/packaged.cjs`：exit 0；確認打包版動畫、隱藏／顯示、Canvas 畫面與設定頁。
- `diagnostics/portable.cjs`：exit 0；確認單檔 EXE 解壓啟動、版本 0.4.0、影片來源位於 app.asar、可見 Canvas 依目前桌寵倍率設定解析度、影片來源為 1px。
- app.asar 已包含 `index.html`、`style.css`、`settings.html`、`settings.css`、`src/main.js`、`src/renderer.js`、`src/animation.js`、`src/settings-store.js`。
- 已檢視 `desktop-app/diagnostics/output/v0.4.0-packaged.png` 與 `v0.4.0-packaged-settings.png`。

## 限制

- 本機 `powercfg /requests` 查詢需要系統管理員權限，因此沒有在本次自動化環境取得 Windows 電源要求清單。
- 已用隱藏靜音影片來源降低 Chromium VideoWakeLock 風險，但螢幕休眠仍應由使用者依 Windows 電源計畫實機確認。
- 實體滑鼠人工點擊穿透、跨螢幕拖曳與混合 DPI 尚未完成；目前通過的是原生視窗 API 加上注入游標座標的整合測試。
