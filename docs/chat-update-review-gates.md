# 聊天更新主管驗收關卡

本文件記錄審查後待完成事項，不替代實測證據。所有執行與審查 agent 上限 Terra / high。

## 已確認基線

- 初版一般測試：141 通過、2 跳過。
- 初版獨立審查發現下列問題；因此不允許依初版測試數字直接打包。
- GUI fixture 曾存取預設 Electron 快取；隔離後仍報 GPU child 與 about:blank ERR_FAILED。需與產品 src/startup.js 啟動相容設定對照，不能直接關閉 sandbox。

## 修正後逐項驗收

主管本次獨立重跑：一般 `npm.cmd test` 為 146 pass / 2 skip；核准受限環境外 `$env:PET_DESKTOP_TESTS='1'; npm.cmd test` 為 148 pass / 0 fail / 0 skip，包含聊天與設定 DOM。這不是人工可見視窗或真模型驗收。Rawls（Terra/high）正在唯讀複核，核取項目須等程式檢查結果才能全部結案。

- [ ] 保存模式切至 off：取消舊請求、清除舊 session/UI，下一次 mock payload 不含已清除訊息。
- [ ] 清除中串流：輸入框恢復可用、下一次可送出、晚到事件不能回寫。
- [ ] 非法編輯 mode/request：儲存與 UI 歷史不被提前破壞。
- [ ] 圖片 provider 拒絕：顯示未送出或撤回暫時訊息，輸入可重試，不假稱已保存。
- [ ] 多張歷史圖：真正按可見區載入、有界並行及釋放；完成的新訊息對應正式附件 ID。
- [ ] 主動訊息、編輯保留時間、跨日/時區與清除競爭均有可執行測試。
- [ ] 主管重新執行完整一般與 Electron 測試，區分 mock、隱藏GUI與人工視覺證據。
- [ ] 獨立 reviewer 複核修正；重要問題歸零後才安排版本與 EXE 打包。

## 搜尋工作依賴

搜尋 Task1 仍受 Google 驗證頁與連線層驗證不足阻擋。執行對話僅補充 network-options.md 技術方案，不授權新代理架構或產品整合。聊天修正不依賴此研究，可繼續完成。
