const path = require('node:path');

const STARTUP_SWITCHES = [
  'disable-gpu',
  'disable-gpu-compositing',
  'disable-software-rasterizer',
  'in-process-gpu',
];

function configureElectron(app) {
  app.disableHardwareAcceleration();

  for (const switchName of STARTUP_SWITCHES) {
    app.commandLine.appendSwitch(switchName);
  }

  if (!app.isPackaged) {
    const runtimePath = path.join(__dirname, '..', '.runtime');
    app.setPath('userData', runtimePath);
    app.setPath('cache', path.join(runtimePath, 'cache'));
  }
}

module.exports = { STARTUP_SWITCHES, configureElectron };
