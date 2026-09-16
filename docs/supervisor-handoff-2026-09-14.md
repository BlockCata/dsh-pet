# 更新計畫主管交接

使用者於 2026-09-14 指定「桌寵計畫執行人-Terra」（local / 01a085f8-9700-7891-b4f6-f8a9aed5f9c0）接任主管並繼續執行。所有受派 agent 模型上限 gpt-5.6-terra、思考程度 high；不得自行提高。原主管停止平行派修，避免共同工作目錄衝突。

## 現況

- 工作目錄 C:/Users/USER/Desktop/big_fat_fish，desktop-app/package.json 仍 0.5.7。新更新未升版、未打包。
- desktop-app、docs、.scratch 等為使用者既有未追蹤資料，不能以空 git diff 或不含桌面程式的 HEAD 當基線；不得清除、重設或覆蓋。
- 聊天時間/圖片已實作初版與第一輪修正。舊主管曾獨立跑一般測試146 pass/2 skip，核准sandbox外 PET_DESKTOP_TESTS=1 npm.cmd test 為148 pass/0 fail/0 skip。這是歷史驗證結果，非完整需求達成證明，後續修改必須重跑。
- Carver（01a09979-04e5-7ac3-8d03-c32b12570ea3）已完成；Rawls（01a09a91-95a2-7ff2-b46e-3a8f196e393f）已完成第二次唯讀審查。沒有尚在寫入的這兩位agent。Lagrange是更早審查者。

## 必讀文件

- docs/superpowers/plans/2026-09-13-chat-time-images.md
- docs/verification-chat-time-images.md
- docs/chat-update-review-gates.md
- docs/superpowers/plans/2026-09-11-pet-browser-search.md
- .scratch/pet-browser-search/spec.md、feasibility.md、network-options.md

## 第二輪審查：尚未派修、不得放行

1. P1 memory/context.js 的 recent map 只留id/role/text，丟createdAt，main.js實際context選取路徑使模型收不到訊息時間。本日交接再次讀碼確認。補主程序→context→provider整合測試，不能只直接餵provider含時間資料。
2. P1 main.js chat:send finally依持久記憶做全域attachment prune；clear/off後新圖片請求已開始，舊finally可能刪新尚未保存附件。以延遲舊stream+新圖片重現，涵蓋持久與off暫存。
3. P1 renderer初始getMessages非同步回應無世代檢查，reset後晚到舊歷史會重新append；需history讀取token/epoch驗證及回歸。
4. P2 queued圖片離開viewport被跳過時未還原queued state，重入後永久不載入。三圖/兩並行/第三離開再進入測試。
5. P2 reset後已開始的附件讀取完成仍先寫cache才檢查DOM，已清除base64回到快取；需在寫入前驗證世代/生命週期。
6. P2 memory/store.js clone會直接剝除attachments，UI不能依規格顯示缺失圖片。保留安全的缺失提示/metadata，不擴張成未授權的完整附件複製，不跨pet讀原檔。

前次off/session/reset/非法mode/圖片拒絕重試主要修正通過複核；不要推翻它們。上述finding需先重現再精準修正，分工寫入範圍不重疊，重要問題閉合後再打包。

## GUI驗證注意

受限sandbox內about:blank ERR_FAILED，不能當產品測試結果。核准sandbox外相同隔離fixture可到真正DOM斷言並已通過。使用既有mkdtemp隔離資料與產品startup相容旗標，不使用--no-sandbox，不讀私人聊天/圖片/key，不操作正在執行的正式桌寵。

## 搜尋範圍待決策

Task1 BLOCKED：Google驗證頁與無法證明DNS/連線綁定。network-options為待批准研究，不是已實作。先前已問使用者是否允許僅驗證用本機代理原型，尚未收到決定；本次改主管不是代理/WFP/管理員權限批准。不可擅自新增系統層規則或改接付費服務。聊天工作可繼續，不必等搜尋。

## 下一步

新主管先派修第二輪6項，重跑整合/桌面測試及獨立複核，通過後安排版本、保留舊EXE的打包與啟動驗證，再向使用者報告。模型真API品質與人工可見視窗未驗證必須明列。不要把工作移交當全專案目標完成。
