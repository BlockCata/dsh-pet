const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const version = require('../package.json').version;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForTargets(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.length) return targets;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`DevTools port ${port} did not expose a target.`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  return {
    socket,
    evaluate(expression) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const receive = (event) => {
          const message = JSON.parse(event.data);
          if (message.id !== id) return;
          socket.removeEventListener('message', receive);
          if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
          else resolve(message.result.result.value);
        };
        socket.addEventListener('message', receive);
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      });
    },
  };
}

async function waitForPage(port, needle) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const target = (await waitForTargets(port)).find((entry) => entry.type === 'page' && entry.url.includes(needle));
    if (target) return connect(target.webSocketDebuggerUrl);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Renderer page ${needle} was not created.`);
}

(async () => {
  const executable = path.resolve(process.argv[2]);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blue-maid-exe-'));
  const browserPort = await freePort();
  const nodePort = await freePort();
  const child = spawn(executable, [
    `--remote-debugging-port=${browserPort}`,
    `--inspect=127.0.0.1:${nodePort}`,
    `--user-data-dir=${profile}`,
  ], { windowsHide: true, stdio: 'ignore' });
  let main;
  let pet;
  let settings;
  try {
    console.log('DIAGNOSTIC start', JSON.stringify({ executable, browserPort, nodePort, wrapperPid: child.pid }));
    main = await connect((await waitForTargets(nodePort))[0].webSocketDebuggerUrl);
    console.log('DIAGNOSTIC main connected');
    pet = await waitForPage(browserPort, 'index.html');
    console.log('DIAGNOSTIC pet renderer connected');
    await pet.evaluate(`new Promise((resolve) => {
      const video = document.querySelector('video');
      const timer = setInterval(() => { if (video?.videoWidth > 0 && video.currentTime > 0 && !video.paused) { clearInterval(timer); resolve(true); } }, 50);
    })`);
    const state = await main.evaluate(`(() => { const e = process.mainModule.require('electron'); return {
      packaged: e.app.isPackaged, version: e.app.getVersion(), visible: e.BrowserWindow.getAllWindows()[0].isVisible()
    }; })()`);
    assert.deepEqual(state, { packaged: true, version, visible: true });
    const video = await pet.evaluate(`(() => { const v = document.querySelector('video'); return {
      src: v.currentSrc, paused: v.paused, width: v.videoWidth, canvas: { width: document.querySelector('canvas').width, height: document.querySelector('canvas').height }
    }; })()`);
    assert.ok(video.src.includes('app.asar/assets/') && video.width === 640 && !video.paused);
    await main.evaluate(`(() => { const e = process.mainModule.require('electron'); e.BrowserWindow.getAllWindows()[0].hide(); return true; })()`);
    await pet.evaluate(`new Promise((resolve) => { const timer = setInterval(() => { if (document.querySelector('video').paused) { clearInterval(timer); resolve(true); } }, 50); })`);
    await main.evaluate(`process.mainModule.require('electron').app.emit('second-instance'); true`);
    settings = await waitForPage(browserPort, 'settings.html');
    console.log('DIAGNOSTIC settings renderer connected');
    const settingsState = await settings.evaluate(`new Promise((resolve) => {
      const timer = setInterval(() => { if (window.settingsAPI && !document.querySelector('#pet-form').hidden) { clearInterval(timer); resolve({ mode: document.querySelector('#memory-mode').value, hasDiaryList: !!document.querySelector('#diary-list') }); } }, 50);
    })`);
    assert.deepEqual(settingsState, { mode: 'diary-30d', hasDiaryList: true });
    console.log('PASS EXE:', JSON.stringify({ ...state, video, settingsState }));
  } finally {
    try { await main?.evaluate(`setTimeout(() => process.mainModule.require('electron').app.quit(), 100); true`); } catch {}
    for (const connection of [settings, pet, main]) connection?.socket.close();
    if (child.exitCode === null) await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (child.exitCode === null) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
