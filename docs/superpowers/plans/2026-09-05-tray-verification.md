# 0.2.0 驗證紀錄

- `npm.cmd test`：13/13 通過。包含來源素材 SHA-256 比對、分類權重、文字鏡像、拖曳閾值與取消、選單、移動時序及邊界。
- `diagnostics/interactions.cjs`：真實 Electron 的系統匣建立、原生選單回呼、顯示／隱藏、關閉留在系統匣、分類選片、行走位置更新與關閉漫遊通過；91 段 WebM 全數成功解碼。
- 指標注入能觸發懸空動畫；原生視窗移動可能使模擬指標失去擷取，程式正確回待機。這不是實體長按拖曳手感的人工驗收。
- `diagnostics/packaged.cjs`：對 `win-unpacked/藍髮小女僕桌寵.exe` 檢查 `app.isPackaged=true`、版本 0.2.0、單一可見視窗、動畫播放及隱藏／顯示恢復，通過。
- `diagnostics/portable.cjs`：直接啟動交付的 portable EXE，由本機暫時除錯連線確認版本 0.2.0、視窗可見、從解壓後 app.asar 播放 640px 寬動畫，通過；測試後退出程式。
- 打包命令：`npm.cmd run dist -- --config.electronDist=node_modules/electron/dist`，使用本機已安裝的 Electron；預設遠端下載受沙箱阻擋，未變更應用程式的安全設定。
- Electron 仍會記錄既有 GPU context 警告，但上述影片與視窗檢查通過；本次未更動既有啟動旗標。全數解碼不等於已逐段人工評估動作品質。

交付：`desktop-app/release-0.2.0/blue-maid-desktop-pet-0.2.0.exe`

大小：137,541,466 bytes

SHA-256：`F8DA26BAFC9E5FB87DB2696026F4E13D59CC62C7793631A92875A644F8910DBD`

舊版保留，上游 DSH 原始檔案無修改。
