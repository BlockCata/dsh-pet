'use strict';

const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { parseScenarioArgs, runScenario } = require('./scenarios');

function createWindow() {
  const window = new BrowserWindow({
    width: 720,
    height: 560,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });
  return window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    const scenario = parseScenarioArgs(process.argv.slice(2));
    const result = await runScenario(scenario.scenarioId);
    for (const event of result.events) console.log(event);
    exitCode = result.ok ? 0 : 1;
  } catch {
    console.error('TEST-ONLY validation-runner-error');
    exitCode = 1;
  }
  process.exitCode = exitCode;
  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
