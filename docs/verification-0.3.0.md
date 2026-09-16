# Windows 桌寵 0.3.0 驗證紀錄

日期：2026-09-05

## 交付

- `desktop-app/release-0.3.0/blue-maid-desktop-pet-0.3.0.exe`
- 137,550,017 bytes
- SHA256：`E25C1055A2909796BA62D3BA47953B4350666FCC83A301AAA3AC7C39028A89D8`
- 獨立 Windows portable 程式；保留舊版檔案，沿用原專案 91 個動畫與圖示，沒有生成素材。
- 設定支援每隻大小 50–200%、螢幕、角落／中央定位、X/Y、顯示、漫遊，以及新增／移除至零隻。設定自動保存，X/Y 需按套用。
- 影片 alpha 遮罩控制透明區域滑鼠穿透；拖曳採桌面 DIP 座標，取消原螢幕限制。

## 已通過

- `PET_DESKTOP_TESTS=1 npm.cmd test`：25/25，無跳過。
- `diagnostics/controls.cjs`：exit 0。真實影片 alpha、原生忽略滑鼠切換、150% 角色大小、注入游標跨至第二螢幕、設定重啟保存、多隻／零隻、新增後立即退出。
- `npm.cmd run dist -- --config.electronDist=node_modules/electron/dist`：exit 0。
- `diagnostics/packaged.cjs`：exit 0，打包版可見、動畫播放、隱藏／恢復、設定頁 DOM 與畫面正常。
- `diagnostics/portable.cjs`：exit 0，單檔 EXE 解壓啟動後版本 0.3.0、桌寵可見、內含影片播放正常。
- 已檢視 `desktop-app/diagnostics/output/v0.3.0-packaged-settings.png`。
- 原有追蹤檔案未修改；工作內容在未追蹤的 desktop-app 與 docs 內。

## 驗證限制與使用方式

- 真實雙螢幕 GP27-FQS 與 ROG XG279Q 都是 100% Windows 縮放。負座標／不同 DPI 邏輯有純函式測試，但沒有混合 DPI 實機驗收。
- 原生桌面擷取失敗，未完成實體滑鼠點擊穿透與拖曳人工驗收；注入測試不等同人工驗收。
- 測試時確認並停止正在執行的 0.2.0 程序，避免單一執行個體鎖攔截新版；未移除舊版檔案。
- 雙擊新版 EXE，按系統匣小女僕圖示開啟設定。程式退出後再啟動可還原設定。
