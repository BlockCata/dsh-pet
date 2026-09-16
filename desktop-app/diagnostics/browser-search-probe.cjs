const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const dnsModule = require('node:dns');
const http = require('node:http');
const fs = require('node:fs');

const probeId = `${process.pid}-${Date.now()}`;
const partition = `browser-search-probe-${probeId}`;
const reportPath = process.env.BROWSER_SEARCH_PROBE_REPORT;
let localFixtureDocument = null;

const report = {
  stage: 'module-loaded',
  probe: {
    mode: 'fixture-only',
    realPublicSiteEvidence: 'unavailable',
    realDnsToSocketEvidence: 'unavailable',
    realTlsEvidence: 'unavailable',
  },
  window: null,
  security: {
    status: 'not-run',
    dns: { status: 'fixture-only', queryCount: 0, answers: [], selectedAddress: null, selectedFamily: null },
    socket: { status: 'unavailable', remoteAddress: null, remoteFamily: null, remotePort: null },
    tls: { status: 'unavailable', authorized: null, hostname: null },
    requests: { observed: 0, blocked: 0, allowedFixture: 0 },
    parser: {
      egress: { observed: 0, blocked: 0 },
      navigation: { observed: 0, blocked: 0 },
      downloads: { observed: 0, prevented: 0, cancelled: 0 },
      popups: { observed: 0, denied: 0 },
      permissions: { checks: 0, requests: 0, denied: 0 },
    },
    localFixtureHitCount: 0,
    limitations: [],
  },
};

function writeReport() {
  const serialized = JSON.stringify(report, null, 2);
  if (reportPath) fs.writeFileSync(reportPath, serialized);
  console.log(serialized);
}

function checkpoint(stage) {
  report.stage = stage;
  writeReport();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 1120,
    height: 820,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      partition,
    },
  });
  const preferences = win.webContents.getLastWebPreferences();
  report.window = {
    nodeIntegration: preferences.nodeIntegration,
    contextIsolation: preferences.contextIsolation,
    sandbox: preferences.sandbox,
    webSecurity: preferences.webSecurity,
    preload: Boolean(preferences.preload),
  };
  return win;
}

function recordDownload() {
  report.security.parser.downloads.observed += 1;
  report.security.parser.downloads.prevented += 1;
}

function configureSession(ses) {
  ses.setPermissionCheckHandler(() => {
    report.security.parser.permissions.checks += 1;
    report.security.parser.permissions.denied += 1;
    return false;
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => {
    report.security.parser.permissions.requests += 1;
    report.security.parser.permissions.denied += 1;
    callback(false);
  });
  ses.webRequest.onBeforeRequest((details, callback) => {
    report.security.requests.observed += 1;
    report.security.parser.egress.observed += 1;
    if (details.url === localFixtureDocument) {
      report.security.requests.allowedFixture += 1;
      callback({ cancel: false });
      return;
    }
    report.security.requests.blocked += 1;
    report.security.parser.egress.blocked += 1;
    callback({ cancel: true });
  });
  ses.on('will-download', (event, item) => {
    event.preventDefault();
    recordDownload();
    item.cancel();
    report.security.parser.downloads.cancelled += 1;
  });
}

async function loadFixture(win, url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const cleanup = () => {
      if (win.webContents.isDestroyed()) return;
      win.webContents.removeListener('did-finish-load', complete);
      win.webContents.removeListener('did-fail-load', failed);
    };
    const complete = () => finish(resolve);
    const failed = (_event, code) => finish(reject, new Error(`fixture-load-${code}`));
    win.webContents.once('did-finish-load', complete);
    win.webContents.once('did-fail-load', failed);
    win.loadURL(url).catch(() => finish(reject, new Error('fixture-load-failed')));
  });
}

function startProbeServer() {
  const server = http.createServer((_request, response) => {
    report.security.localFixtureHitCount += 1;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('local probe only');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function dnsAnswer(message, address) {
  const questionEnd = (() => {
    let offset = 12;
    while (message[offset] !== 0 && offset < message.length) offset += message[offset] + 1;
    return offset + 5;
  })();
  const header = Buffer.alloc(12);
  message.copy(header, 0, 0, 2);
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(1, 6);
  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xc00c, 0);
  answer.writeUInt16BE(1, 2);
  answer.writeUInt16BE(1, 4);
  answer.writeUInt32BE(0, 6);
  answer.writeUInt16BE(4, 10);
  address.split('.').forEach((part, index) => answer.writeUInt8(Number(part), 12 + index));
  return Buffer.concat([header, message.subarray(12, questionEnd), answer]);
}

function startDnsFixture() {
  let queries = 0;
  const server = dgram.createSocket('udp4');
  server.on('message', (message, remote) => {
    queries += 1;
    const address = queries === 1 ? '93.184.216.34' : '127.0.0.1';
    report.security.dns.queryCount += 1;
    report.security.dns.answers.push({ address, family: 'IPv4' });
    server.send(dnsAnswer(message, address), remote.port, remote.address);
  });
  return new Promise((resolve) => server.bind(0, '127.0.0.1', () => resolve(server)));
}

async function inspectSecurity(win, ses) {
  const local = await startProbeServer();
  const port = local.address().port;
  const dnsServer = await startDnsFixture();
  try {
    const resolver = new dnsModule.promises.Resolver();
    resolver.setServers([`127.0.0.1:${dnsServer.address().port}`]);
    await resolver.resolve4('rebind.browser-search-probe.test');
    await resolver.resolve4('rebind.browser-search-probe.test');
    checkpoint('security-dns-fixture-ready');
    report.security.limitations.push('The DNS fixture only demonstrates changing answers. It does not bind a Chromium navigation socket to an approved address.');
    report.security.limitations.push('This probe does not perform a public-site request, TCP remote-tuple observation, TLS identity observation, redirect traversal, or model request. Those evidence fields remain unavailable.');

    localFixtureDocument = `data:text/html,${encodeURIComponent(`<img src="https://127.0.0.1:${port}/subresource"><img src="https://[::1]:${port}/subresource"><iframe src="https://127.0.0.1:${port}/frame"></iframe><a id="popup" target="_blank" href="https://127.0.0.1:${port}/popup">popup</a>`)}`;
    await loadFixture(win, localFixtureDocument);
    await win.webContents.executeJavaScript("document.getElementById('popup').click()");
    win.webContents.downloadURL(`https://127.0.0.1:${port}/download`);
    await wait(500);
    checkpoint('security-fixture-egress-checked');
    assert.equal(report.security.localFixtureHitCount, 0, 'private fixture server must not receive a request');
    report.security.status = 'fixture-only';
  } finally {
    localFixtureDocument = null;
    await Promise.all([
      new Promise((resolve) => local.close(resolve)),
      new Promise((resolve) => dnsServer.close(resolve)),
    ]);
  }
}

async function main() {
  await app.whenReady();
  checkpoint('electron-ready');
  const ses = session.fromPartition(partition);
  configureSession(ses);
  const win = createWindow();
  for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    win.webContents.on(eventName, (event, details) => {
      if (details?.url === localFixtureDocument) return;
      event.preventDefault();
      report.security.parser.navigation.observed += 1;
      report.security.parser.navigation.blocked += 1;
    });
  }
  win.webContents.setWindowOpenHandler(() => {
    report.security.parser.popups.observed += 1;
    report.security.parser.popups.denied += 1;
    return { action: 'deny' };
  });
  checkpoint('window-ready');
  try {
    await inspectSecurity(win, ses);
  } catch (_error) {
    report.security.status = 'fixture-failed';
  }
  checkpoint('security-finished');
  if (!win.isDestroyed()) win.destroy();
  await ses.clearStorageData();
  checkpoint('completed');
  app.exit(report.security.status === 'fixture-only' ? 0 : 1);
}

writeReport();
main().catch(() => {
  report.fatal = { status: 'fatal' };
  writeReport();
  app.exit(1);
});
