# 大肥魚桌寵

[English README](README.en.md)

Windows 專用的獨立 Electron 桌寵，支援透明動畫、多隻桌寵管理、互動操作、AI 聊天與本機日記記憶。

本專案基於 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 衍生開發。原始 DSH 插件保留於 `dsh-pet/`；新增的獨立桌面程式位於 `desktop-app/`，不需要安裝或執行 DSH。

## 功能

- 透明、無邊框桌寵視窗與系統匣控制
- 新增、複製、移除及個別設定多隻桌寵
- 自動漫遊、拖曳、點按回應與右鍵動作選單
- 透明像素滑鼠穿透，只有可見角色接收互動
- 可設定尺寸、位置、螢幕、永遠置頂與漫遊範圍
- 支援 Gemini、OpenAI、DeepSeek 與 OpenAI-compatible 服務的聊天
- 每隻桌寵各自保存對話與日記，並可選擇記憶保留策略
- 支援 PNG、JPEG、WebP 圖片附件；僅有圖片輸入功能的服務會收到附件
- API 金鑰由 Electron `safeStorage` 加密保存
- 使用上游既有藍髮女僕 WebM 動畫，沒有生成或改製素材

## 使用

請從 GitHub Releases 下載 Windows x64 portable EXE，解壓後直接執行。

首次啟動需要完成執行環境解壓，稍候桌寵會出現在主螢幕右下方。程式不需要 Node.js，也不會開啟瀏覽器。

> 更新版本前，請先從系統匣選擇「結束程式」。

## 從原始碼執行

需求：

- Windows
- Node.js
- npm

```powershell
git clone https://github.com/BlockCata/dsh-pet.git
cd dsh-pet\desktop-app
npm.cmd install
npm.cmd test
npm.cmd start
```

## 開發與打包

```powershell
cd desktop-app

npm.cmd run prepare:assets  # 匯入上游既有素材，不生成新媒體
npm.cmd test                # 邏輯、IPC、設定與素材來源測試
npm.cmd run test:desktop    # 以 Electron 驗證設定介面
npm.cmd start               # 啟動開發版
npm.cmd run dist            # 打包 Windows x64 portable EXE
```

## 資料與隱私

AI 服務的 API 金鑰由 Electron 主程序加密保存。桌寵、聊天視窗與設定頁只透過受限 IPC 請求功能，不會取得明文金鑰。

對話、日記與圖片附件保存在本機應用程式資料目錄。刪除本機資料只會讓程式不再讀取或送出它，無法撤回先前已傳給 AI 服務商的內容。

## 專案結構

```text
desktop-app/   獨立 Windows Electron 桌寵
dsh-pet/       上游 DSH 插件來源與素材設定
docs/          設計、驗證與決策文件
```

## 上游來源與素材授權

本專案衍生自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。

- 程式碼沿用上游 MIT License；請保留版權與授權聲明。
- 動畫、提示詞與源影片素材可用於開源用途，但**禁止商用**。
- `desktop-app/` 使用 91 段上游既有 WebM 動畫，沒有生成或改製素材。
- 完整來源與限制請見 [desktop-app/ASSET-NOTICE.md](desktop-app/ASSET-NOTICE.md)。

## License

程式碼採 [MIT License](LICENSE)。素材限制以 `desktop-app/ASSET-NOTICE.md` 與上游專案說明為準。
