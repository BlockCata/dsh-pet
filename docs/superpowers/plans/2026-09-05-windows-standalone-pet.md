# Windows Standalone Desktop Pet Implementation Plan

**Goal:** 建立只支援 Windows 的獨立 Electron 桌寵，先能播放專案既有藍髮女僕動畫。

**Architecture:** 新增 `desktop-app/`，不改動原本 DSH 插件。Electron Main 負責透明置頂小視窗與系統匣，Renderer 負責影片播放與基本互動，動畫選擇邏輯保持為可測試的獨立模組。既有 WebM 素材以複製方式納入，沒有新素材生成。

**Tech Stack:** Electron、JavaScript、Node.js test runner；後續抽離共用邏輯時使用 TypeScript。

**Spec:** 本對話中已確認的 Windows-only 獨立桌寵需求。

## Global Constraints

- 僅支援 Windows。
- 不依賴 DSH、`dsh web`、DSH bridge 或 DSH HTTP server。
- 主要使用 TypeScript／JavaScript；Python／ffmpeg 僅保留作既有素材處理工具。
- 不生成新素材，只使用專案已有素材。
- 第一階段只做單一藍髮女僕與最小可運行框架。

### Task 1: Animation Selection Core

**Files:**
- Create: `desktop-app/src/animation.js`
- Test: `desktop-app/test/animation.test.js`

- [ ] Write a failing test for selecting a valid animation and avoiding an immediate repeat when alternatives exist.
- [ ] Run `node --test desktop-app/test/animation.test.js` and confirm it fails because the module is missing.
- [ ] Implement the smallest pure animation selector.
- [ ] Run the focused test and confirm it passes.

### Task 2: Standalone Electron Shell

**Files:**
- Create: `desktop-app/package.json`
- Create: `desktop-app/src/main.js`
- Create: `desktop-app/src/preload.js`
- Create: `desktop-app/src/index.html`
- Create: `desktop-app/src/renderer.js`
- Create: `desktop-app/src/style.css`

- [ ] Add a Windows Electron entry point with a frameless transparent always-on-top window.
- [ ] Load local assets only; do not construct DSH URLs or bridge requests.
- [ ] Play idle animation first, then select additional existing animations on `ended`.
- [ ] Add click-to-replay and a minimal right-click exit action.
- [ ] Run the app with Electron and confirm a local transparent window displays the pet.

### Task 3: Existing Asset Integration

**Files:**
- Copy: selected existing files from `dsh-pet/assets/webm/` to `desktop-app/assets/`

- [ ] Copy only existing idle, turn, click, and one action WebM files.
- [ ] Confirm the files are readable and have the expected WebM media type.
- [ ] Do not create or modify video content.

### Task 4: Verification

- [ ] Run the focused unit test.
- [ ] Run the standalone app smoke check.
- [ ] Confirm the original DSH plugin files remain unchanged.
- [ ] Report exact files added, commands run, and any environment limitation.
