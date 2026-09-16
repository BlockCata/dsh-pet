const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.join(__dirname, 'output');
fs.mkdirSync(output, { recursive: true });
require('../src/main.js');
app.whenReady().then(() => {
  setTimeout(async () => {
    try {
      const win = BrowserWindow.getAllWindows()[0];
      const status = {
        visible: win?.isVisible(),
        bounds: win?.getBounds(),
        loading: win?.webContents.isLoading(),
        url: win?.webContents.getURL(),
      };
      console.log('WINDOW', JSON.stringify(status));
      const state = await Promise.race([
        win.webContents.executeJavaScript(`({ title: document.title, video: (() => {
          const v = document.querySelector('video');
          return v && { src: v.currentSrc, time: v.currentTime, paused: v.paused, ready: v.readyState, width: v.videoWidth, error: v.error?.message };
        })(), background: getComputedStyle(document.body).backgroundColor })`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('renderer timeout')), 8000)),
      ]);
      console.log('RENDERER', JSON.stringify(state));
      assert.equal(status.visible, true);
      assert.equal(state.video.paused, false);
      assert.ok(state.video.time > 0);
      assert.ok(state.video.width > 0);
      const firstFrame = (await win.webContents.capturePage()).toPNG();
      fs.writeFileSync(path.join(output, 'frame.png'), firstFrame);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const nextTime = await win.webContents.executeJavaScript('document.querySelector("video").currentTime');
      assert.ok(nextTime > state.video.time, '影片時間應持續前進');
      const secondFrame = (await win.webContents.capturePage()).toPNG();
      assert.equal(firstFrame.equals(secondFrame), false, '動畫畫面應隨時間改變');
      fs.writeFileSync(path.join(output, 'frame-next.png'), secondFrame);
      console.log('PASS: visible window, playing local video, advancing time and changing frames');
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  }, 5000);
});
setTimeout(() => app.exit(2), 20000);
