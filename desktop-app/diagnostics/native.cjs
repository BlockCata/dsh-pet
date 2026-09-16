const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-native-'));
process.env.PET_CONTROLS_PROFILE = profile;
require('./controls-boot.cjs');
app.whenReady().then(async () => {
  const pet = BrowserWindow.getAllWindows()[0];
  pet.webContents.on('page-title-updated', (event) => event.preventDefault());
  pet.setTitle('桌寵互動驗證');
  await new Promise((resolve) => pet.webContents.once('did-finish-load', resolve));
  pet.setBounds({ x: 900, y: 400, width: 420, height: 300 });
  // Freeze automatic choices, not pointer input, while checking the native mouse path.
  pet.webContents.send('pet:command', { type: 'preferences', pet: { roaming: false, visible: true } });
  const board = new BrowserWindow({ x: 900, y: 400, width: 420, height: 300, frame: false,
    title: '桌寵穿透驗證底板', backgroundColor: '#eef4ff', alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await board.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><title>桌寵穿透驗證底板</title>
    <body style="margin:0;font:16px Microsoft JhengHei;color:#234;background:#eef4ff;height:100vh">
    <div style="padding:14px">透明區域點擊底板：<span id="count">0</span></div>
    <div style="position:absolute;bottom:12px;left:14px">僅測試用，會自動關閉</div>
    <script>document.addEventListener('click',()=>{const c=document.getElementById('count');c.textContent=Number(c.textContent)+1;});</script></body>`));
  board.setAlwaysOnTop(true, 'floating');
  pet.moveTop();
  const timer = setInterval(async () => {
    if (pet.isDestroyed() || board.isDestroyed()) return;
    console.log('NATIVE', JSON.stringify({ bounds: pet.getBounds(), ignored: global.petProbe.ignored[pet.id], cursor: screen.getCursorScreenPoint(),
      clicks: await board.webContents.executeJavaScript('document.getElementById("count").textContent'),
      video: await pet.webContents.executeJavaScript('decodeURIComponent(document.querySelector("video").currentSrc).split("/").pop()') }));
  }, 2000);
  setTimeout(() => { clearInterval(timer); app.quit(); }, 120000);
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
