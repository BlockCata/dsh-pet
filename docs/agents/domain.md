# 領域文件

採 single-context：根目錄 CONTEXT.md 與 docs/adr/。

探索程式碼前：

- 讀取根目錄 CONTEXT.md。
- 若存在 CONTEXT-MAP.md，改依索引讀取相關 CONTEXT.md。
- 讀取 docs/adr/ 中與目前工作相關的決策紀錄。

文件不存在時直接繼續，不預先建立空白領域文件。
領域術語或決策確立後，再由 domain-modeling 建立。

輸出使用 CONTEXT.md 定義的術語。
若建議與既有 ADR 衝突，明確指出對應決策及原因。
