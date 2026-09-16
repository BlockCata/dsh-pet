# 本機議題追蹤

議題與規格僅存於本機 `.scratch/`，不發佈至遠端服務。

## 檔案慣例

- 每個功能使用 `.scratch/<feature-slug>/`。
- 規格存於 `spec.md`。
- 每張實作議題分別存於 `issues/<NN>-<slug>.md`，從 01 編號。
- 議題頂部以 `Status:` 記錄分類，值見 `triage-labels.md`。
- 討論依時間附加於 `## Comments`。
- 「發佈議題」指建立上述本機檔案；「取得議題」指讀取指定檔案。

## Wayfinder 工作流程

- 工作地圖：`.scratch/<effort>/map.md`。
- 子議題：`issues/<NN>-<slug>.md`。
- `Type:` 使用 research、prototype、grilling 或 task。
- 此流程的 `Status:` 使用 claimed／resolved 表示認領／完成。
- `Blocked by: NN, NN` 記錄依賴；依賴全部 resolved 才可執行。
- 按編號選取未完成、未認領且無阻塞的議題。
- 開工前保存 claimed；完成後附加 `## Answer`，改為 resolved，
  並將結果摘要與檔案連結更新至 map.md。
