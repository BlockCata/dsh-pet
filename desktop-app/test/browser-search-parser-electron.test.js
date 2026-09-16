const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

if (process.versions.electron && process.argv.includes('--browser-search-parser-fixture')) {
  const { app, BrowserWindow, session } = require('electron');
  const path = require('node:path');
  const os = require('node:os');

  app.setPath('userData', path.join(os.tmpdir(), 'big-fat-fish-browser-search-parser-fixture'));
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('in-process-gpu');
  let createdWindow;
  app.whenReady().then(async () => {
    const partitions = [];
    function TrackedBrowserWindow(options) {
      createdWindow = new BrowserWindow(options);
      return createdWindow;
    }
    const trackedSession = {
      fromPartition(partition) {
        partitions.push(partition);
        return session.fromPartition(partition);
      },
    };
    const { createInertDocumentParser } = require('../src/browser-search/parser');
    const parser = await createInertDocumentParser({ BrowserWindow: TrackedBrowserWindow, session: trackedSession });
    const hostileHtml = '<title>Fixture</title><script>fetch("https://fixture.invalid/")</script><main>只解析本地字串</main>';
    const page = await parser.parsePage(hostileHtml);
    assert.deepEqual(page, { title: 'Fixture', text: '只解析本地字串' });
    assert.equal(createdWindow.isVisible(), false);
    assert.equal(createdWindow.webContents.getURL(), 'about:blank', `actual URL: ${createdWindow.webContents.getURL()}`);
    assert.equal(partitions.length, 1);
    assert.equal(partitions[0].startsWith('persist:'), false);
    const preferences = createdWindow.webContents.getLastWebPreferences?.();
    if (preferences) {
      assert.equal(preferences.nodeIntegration, false);
      assert.equal(preferences.contextIsolation, true);
      assert.equal(preferences.sandbox, true);
      assert.equal(preferences.webSecurity, true);
      assert.equal(preferences.preload, undefined);
    }
    const runningWorkers = await session.fromPartition(partitions[0]).serviceWorkers.getAllRunning();
    const runningWorkerCount = runningWorkers instanceof Map
      ? runningWorkers.size
      : Array.isArray(runningWorkers)
        ? runningWorkers.length
        : Object.keys(runningWorkers || {}).length;
    assert.equal(runningWorkerCount, 0);
    await parser.dispose();
    assert.equal(createdWindow.isDestroyed(), true);
    console.log('Real Electron parser fixture passed; fixture-only, not public-web or egress-isolation evidence');
    app.exit(0);
  }).catch((error) => {
    console.error(error);
    app.exit(1);
  });
} else {
  test('real Electron inert parser fixture', { skip: process.env.PET_DESKTOP_TESTS === '1' ? false : 'PET_DESKTOP_TESTS=1 is required' }, () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename, '--browser-search-parser-fixture'], {
      env,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /fixture-only, not public-web or egress-isolation evidence/);
  });
}
