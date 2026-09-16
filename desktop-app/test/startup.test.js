const test = require('node:test');
const assert = require('node:assert/strict');
const { STARTUP_SWITCHES, configureElectron } = require('../src/startup.js');

test('Windows 啟動設定停用不可用的 GPU 程序', () => {
  assert.ok(STARTUP_SWITCHES.includes('disable-gpu'));
  assert.ok(STARTUP_SWITCHES.includes('disable-gpu-compositing'));
  assert.ok(STARTUP_SWITCHES.includes('disable-software-rasterizer'));
  assert.ok(STARTUP_SWITCHES.includes('in-process-gpu'));
});

test('Windows 啟動時停用硬體加速', () => {
  let disabled = false;
  const fakeApp = {
    commandLine: { appendSwitch() {} },
    disableHardwareAcceleration() {
      disabled = true;
    },
    isPackaged: true,
  };

  configureElectron(fakeApp);

  assert.equal(disabled, true);
});
