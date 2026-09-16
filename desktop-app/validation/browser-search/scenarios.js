'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSystemResolverFactory } = require('../../src/browser-search/resolver');
const { createPinnedHttpsTransport } = require('../../src/browser-search/transport');
const { createPinnedBrowserSearch } = require('../../src/browser-search/service');
const { createInertDocumentParser } = require('../../src/browser-search/parser');
const { searchUrl } = require('../../src/chat/search');
const { createEvidenceSink } = require('./evidence');

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2001:4860:4860::8888';
const SEARCH_HTML = '<a href="https://public.site/page"><h3>Fixture result</h3>Fixture snippet</a>';

const DEFINITIONS = Object.freeze({
  'a-normal': { label: 'A normal public answer', outcome: 'pass', execution: 'Task 2 resolver + Task 5 transport' },
  'aaaa-normal': { label: 'AAAA normal public answer', outcome: 'pass', execution: 'Task 2 resolver + Task 5 transport' },
  'aaaa-only': { label: 'AAAA-only public answer', outcome: 'pass', execution: 'Task 2 resolver + Task 5 transport' },
  'mixed-private': { label: 'Mixed public and private answers', outcome: 'blocked', errorCode: 'dns-non-public', execution: 'Task 2 resolver + Task 5 transport' },
  'negative-controls': { label: 'Malformed DNS negative controls', outcome: 'blocked', errorCode: 'dns-invalid', execution: 'Task 2 resolver + Task 5 transport' },
  'dns-nxdomain': { label: 'NXDOMAIN', outcome: 'blocked', errorCode: 'dns-nxdomain', execution: 'Task 2 resolver + Task 5 transport' },
  'dns-nodata': { label: 'Dual NODATA', outcome: 'blocked', errorCode: 'dns-failed', execution: 'Task 2 resolver + Task 5 transport' },
  'dns-timeout': { label: 'DNS timeout', outcome: 'blocked', errorCode: 'dns-timeout', execution: 'Task 2 resolver + Task 5 transport' },
  'peer-mismatch': { label: 'TCP peer mismatch', outcome: 'blocked', errorCode: 'peer-mismatch', execution: 'Task 2 resolver + Task 5 transport' },
  'cert-mismatch': { label: 'Certificate mismatch', outcome: 'blocked', errorCode: 'tls-unauthorized', execution: 'Task 2 resolver + Task 5 transport' },
  'redirect-chain': { label: 'Bounded redirect chain', outcome: 'pass', execution: 'Task 6 service + Task 5 transport + Task 4 parser' },
  'redirect-loop': { label: 'Redirect loop', outcome: 'blocked', errorCode: 'redirect-loop', execution: 'Task 6 service + Task 5 transport' },
  'redirect-limit': { label: 'Redirect limit', outcome: 'blocked', errorCode: 'redirect-limit', execution: 'Task 6 service + Task 5 transport' },
  'redirect-unsafe-location': { label: 'Unsafe redirect Location', outcome: 'blocked', errorCode: 'redirect-invalid', execution: 'Task 6 service + Task 5 transport' },
  'content-limit': { label: 'Content size limit', outcome: 'blocked', errorCode: 'response-too-large', execution: 'Task 5 transport' },
  'framing-limit': { label: 'HTTP framing limit', outcome: 'blocked', errorCode: 'response-framing', execution: 'Task 5 transport' },
  'hostile-parser': { label: 'Hostile parser input', outcome: 'pass', execution: 'Task 4 parser' },
  'parser-negative-control': { label: 'Parser egress negative control', outcome: 'blocked', errorCode: 'browser-search-parser-egress-blocked', execution: 'Task 4 parser' },
  cancel: { label: 'Parser cancellation', outcome: 'blocked', errorCode: 'browser-search-parser-cancelled', execution: 'Task 4 parser' },
  dispose: { label: 'Parser disposal', outcome: 'blocked', errorCode: 'browser-search-parser-disposed', execution: 'Task 4 parser' },
  'parser-electron-failure': { label: 'Electron parser ERR_FAILED fixture', outcome: 'blocked', errorCode: 'parser-electron-err-failed', execution: 'Task 4 parser', failureClass: 'electron-fixture' },
});

const SCENARIO_IDS = Object.freeze(Object.keys(DEFINITIONS));
const TRANSPORT_SCENARIOS = new Set([
  'a-normal', 'aaaa-normal', 'aaaa-only', 'mixed-private', 'negative-controls', 'dns-nxdomain',
  'dns-nodata', 'dns-timeout', 'peer-mismatch', 'cert-mismatch', 'content-limit', 'framing-limit',
]);
const SERVICE_SCENARIOS = new Set(['redirect-chain', 'redirect-loop', 'redirect-limit', 'redirect-unsafe-location']);
const PARSER_SCENARIOS = new Set(['hostile-parser', 'parser-negative-control', 'cancel', 'dispose', 'parser-electron-failure']);
let runCounter = 0;

function installedVersion(packageName) {
  try { return require(`${packageName}/package.json`).version; }
  catch { return null; }
}

function fileDigest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function createArtifactManifest({ releaseRoot, sourceRoot, configPath }) {
  const artifactDirectory = path.basename(releaseRoot);
  const manifestPrefix = artifactDirectory.replace(/^release-transport-validation-/, '');
  const exeName = fs.readdirSync(releaseRoot).find((name) => name.endsWith('.exe'));
  if (!exeName) throw new Error('validation-exe-missing');
  const appAsarRelative = path.join('win-unpacked', 'resources', 'app.asar');
  const sourceFiles = ['main.js', 'scenarios.js', 'evidence.js', 'index.html'].map((name) => path.join('validation', 'browser-search', name));
  const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file.replaceAll('\\', '/'), fileDigest(path.join(sourceRoot, file))]));
  const exeRelative = exeName;
  const configRelative = path.relative(releaseRoot, configPath).replaceAll('\\', '/');
  return {
    schemaVersion: 1,
    artifactDirectory,
    manifestPrefix,
    build: {
      electronBuilderVersion: installedVersion('electron-builder'),
      electronVersion: process.versions.electron || installedVersion('electron'),
      nodeVersion: process.versions.node,
      platform: process.platform === 'win32' ? 'win32' : process.platform,
      arch: process.arch,
      productVersion: require(path.join(sourceRoot, 'package.json')).version,
      asar: true,
      metadataSources: {
        electronBuilderVersion: 'node_modules/electron-builder/package.json',
        electronVersion: process.versions.electron ? 'process.versions.electron' : 'node_modules/electron/package.json',
        nodeVersion: 'process.versions.node',
      },
    },
    files: {
      exe: { path: exeRelative, size: fs.statSync(path.join(releaseRoot, exeRelative)).size, sha256: fileDigest(path.join(releaseRoot, exeRelative)) },
      appAsar: { path: appAsarRelative.replaceAll('\\', '/'), size: fs.statSync(path.join(releaseRoot, appAsarRelative)).size, sha256: fileDigest(path.join(releaseRoot, appAsarRelative)) },
      builderConfig: { path: configRelative, size: fs.statSync(configPath).size, sha256: fileDigest(configPath) },
    },
    sourceHashes,
  };
}

function compileScenario(scenarioId) {
  const definition = DEFINITIONS[scenarioId];
  if (!definition) throw new Error('scenario-not-allowlisted');
  return Object.freeze({ scenarioId, ...definition, synthetic: true });
}

function parseScenarioArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || typeof argv[0] !== 'string') throw new Error('scenario-argument-required');
  const match = /^--scenario-id=([A-Za-z0-9_-]{1,64})$/.exec(argv[0]);
  if (!match || !Object.hasOwn(DEFINITIONS, match[1])) throw new Error('scenario-not-allowlisted');
  return compileScenario(match[1]);
}

function answer(address, family) {
  return { address, family, ttl: 60 };
}

function resolverFor(scenarioId) {
  const createResolver = () => ({
    resolve4() {
      if (scenarioId === 'dns-timeout') return new Promise(() => {});
      if (scenarioId === 'dns-nxdomain') return Promise.reject(Object.assign(new Error(), { code: 'ENOTFOUND' }));
      if (scenarioId === 'negative-controls') return [{ address: 'not-an-ip', ttl: 60 }];
      if (scenarioId === 'dns-nodata') return [];
      if (scenarioId === 'aaaa-normal' || scenarioId === 'aaaa-only') return [];
      return [answer(PUBLIC_V4, 4)];
    },
    resolve6() {
      if (scenarioId === 'dns-timeout') return new Promise(() => {});
      if (scenarioId === 'dns-nxdomain') return Promise.reject(Object.assign(new Error(), { code: 'ENOTFOUND' }));
      if (scenarioId === 'dns-nodata') return [];
      if (scenarioId === 'mixed-private') return [answer('::1', 6)];
      if (scenarioId === 'aaaa-normal' || scenarioId === 'aaaa-only') return [answer(PUBLIC_V6, 6)];
      return [];
    },
    cancel() {},
  });
  return createSystemResolverFactory({ createResolver, timeoutMs: scenarioId === 'dns-timeout' ? 5 : 100 });
}

function statusText(status) {
  return { 200: 'OK', 302: 'Found' }[status] || 'Status';
}

function httpResponse(status, headers = {}, body = '') {
  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const entries = Object.entries(headers);
  const header = Buffer.from(`HTTP/1.1 ${status} ${statusText(status)}\r\n${entries.map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, bodyBuffer]);
}

function transportRoute(scenarioId, url, options) {
  if (scenarioId === 'content-limit') return httpResponse(200, { 'content-type': 'text/html', 'content-length': '1000001' });
  if (scenarioId === 'framing-limit') return httpResponse(200, { 'content-type': 'text/html', 'content-length': '1', 'transfer-encoding': 'chunked' }, 'x');
  if (SERVICE_SCENARIOS.has(scenarioId)) {
    if (options.purpose === 'page') return httpResponse(200, { 'content-type': 'text/html' }, '<main>Fixture page text</main>');
    if (scenarioId === 'redirect-chain') {
      if (options.hopIndex === 0) return httpResponse(302, { location: 'https://public.site/search-redirect-1', 'content-type': 'text/html' });
      if (options.hopIndex === 1) return httpResponse(302, { location: 'https://public.site/search-redirect-2', 'content-type': 'text/html' });
      return httpResponse(200, { 'content-type': 'text/html' }, SEARCH_HTML);
    }
    if (scenarioId === 'redirect-loop') {
      if (options.hopIndex === 0) return httpResponse(302, { location: 'https://public.site/loop-a', 'content-type': 'text/html' });
      return httpResponse(302, { location: searchUrl('redirect-loop'), 'content-type': 'text/html' });
    }
    if (scenarioId === 'redirect-limit') return httpResponse(302, { location: `https://public.site/limit-${options.hopIndex}`, 'content-type': 'text/html' });
    return httpResponse(302, { location: 'http://unsafe.site/', 'content-type': 'text/html' });
  }
  return httpResponse(200, { 'content-type': 'text/html' }, '<main>Fixture body</main>');
}

class FixtureSocket extends EventEmitter {
  constructor(tuple, response) {
    super();
    Object.assign(this, tuple);
    this.response = response;
    this.writes = [];
    this.destroyed = false;
  }

  write(chunk) {
    this.writes.push(Buffer.from(chunk));
    if (this.response) queueMicrotask(() => { this.emit('data', this.response); this.emit('end'); });
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    queueMicrotask(() => this.emit('close'));
  }
}

function fixtureTransportForScenario(scenarioId, trace) {
  const resolverFactory = resolverFor(scenarioId);
  let routeOptions = {};
  const transport = createPinnedHttpsTransport({
    resolverFactory,
    connect: () => {
      const ipv6 = scenarioId === 'aaaa-normal' || scenarioId === 'aaaa-only';
      const tuple = scenarioId === 'peer-mismatch'
        ? { remoteAddress: '127.0.0.1', remoteFamily: 'IPv4', remotePort: 443 }
        : { remoteAddress: ipv6 ? PUBLIC_V6 : PUBLIC_V4, remoteFamily: ipv6 ? 'IPv6' : 'IPv4', remotePort: 443 };
      const socket = new FixtureSocket(tuple);
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
    tlsConnect: () => {
      const socket = new FixtureSocket({
        authorized: scenarioId !== 'cert-mismatch',
        authorizationError: scenarioId === 'cert-mismatch' ? 'CERT_UNTRUSTED' : '',
        alpnProtocol: 'http/1.1',
        getPeerCertificate: () => ({ fingerprint256: 'AA:'.repeat(31) + 'AA' }),
      });
      socket.write = (chunk) => {
        socket.writes.push(Buffer.from(chunk));
        queueMicrotask(() => { socket.emit('data', transportRoute(scenarioId, '', routeOptions)); socket.emit('end'); });
        return true;
      };
      queueMicrotask(() => socket.emit('secureConnect'));
      return socket;
    },
    evidenceSink: (event) => trace.push(event),
  });
  return {
    fetchHop(url, options) {
      routeOptions = options;
      return transport.fetchHop(url, options);
    },
  };
}

function projectTrace(sink, trace) {
  for (const source of trace) {
    const fields = { phase: source.phase, hopIndex: source.hopIndex };
    for (const field of ['hostname', 'address', 'family', 'port', 'statusCode', 'byteCount', 'mediaType', 'boolean', 'fingerprint256']) {
      if (source[field] !== undefined) fields[field] = source[field];
    }
    sink.emit(fields);
  }
}

function parserEnvironment({ loadError, pendingEvaluation = false } = {}) {
  const calls = { beforeRequest: null, releaseEvaluation: null, windows: [] };
  const sessionEvents = new EventEmitter();
  const parserSession = Object.assign(sessionEvents, {
    webRequest: {
      onBeforeRequest(...args) { calls.beforeRequest = args.at(-1); },
      onBeforeRedirect() {},
    },
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    clearStorageData: async () => {},
    serviceWorkers: { async getAllRunning() { return []; } },
  });

  class FixtureWebContents extends EventEmitter {
    constructor() { super(); this.url = ''; }
    loadURL(url) {
      if (loadError) return Promise.reject(loadError);
      this.url = url;
      queueMicrotask(() => this.emit('did-finish-load'));
      return Promise.resolve();
    }
    getURL() { return this.url; }
    setWindowOpenHandler() {}
    closeAllConnections = async () => {};
    isDestroyed() { return this.destroyed; }
    executeJavaScript(source) {
      if (pendingEvaluation) return new Promise((resolve) => { calls.releaseEvaluation = () => resolve({ title: 'late', text: 'late' }); });
      return JSON.parse(JSON.stringify(vm.runInNewContext(source, { DOMParser: FixtureDOMParser, URL })));
    }
  }

  class FixtureBrowserWindow {
    constructor() { this.webContents = new FixtureWebContents(); this.destroyed = false; calls.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.webContents.destroyed = true; }
  }

  return { BrowserWindow: FixtureBrowserWindow, session: { fromPartition: () => parserSession }, calls, parserSession };
}

class FixtureNode {
  constructor(tagName, attributes = {}) { this.tagName = tagName.toUpperCase(); this.attributes = attributes; this.children = []; this.removed = false; }
  appendChild(value) { this.children.push(value); }
  remove() { this.removed = true; }
  getAttribute(name) { return this.attributes[name.toLowerCase()] ?? null; }
  get textContent() { return this.removed ? '' : this.children.map((child) => child instanceof FixtureNode ? child.textContent : child).join(''); }
  matches(selector) {
    const match = /^([\w-]+)(?:\[([\w-]+)\])?$/.exec(selector);
    return Boolean(match && this.tagName === match[1].toUpperCase() && (!match[2] || this.getAttribute(match[2]) !== null));
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map((value) => value.trim()).filter(Boolean);
    const result = [];
    const visit = (node) => {
      if (!(node instanceof FixtureNode) || node.removed) return;
      if (selectors.some((value) => node.matches(value))) result.push(node);
      node.children.forEach(visit);
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class FixtureDocument extends FixtureNode {
  constructor(html) {
    super('#document');
    this.body = new FixtureNode('body');
    this.appendChild(this.body);
    const stack = [this.body];
    for (const token of String(html).matchAll(/<\/([\w:-]+)>|<([\w:-]+)([^>]*)>|([^<]+)/gi)) {
      if (token[1]) { const index = [...stack].reverse().findIndex((node) => node.tagName === token[1].toUpperCase()); if (index >= 0) stack.splice(stack.length - 1 - index); continue; }
      if (token[4]) { stack.at(-1).appendChild(token[4]); continue; }
      const attrs = {};
      for (const match of token[3].matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
      const node = new FixtureNode(token[2], attrs);
      stack.at(-1).appendChild(node);
      if (!['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(token[2].toLowerCase())) stack.push(node);
    }
  }
  get title() { return this.querySelector('title')?.textContent || ''; }
}

class FixtureDOMParser {
  parseFromString(html) { return new FixtureDocument(html); }
}

async function parserFactoryFor(sink) {
  const environment = parserEnvironment();
  const parser = await createInertDocumentParser(environment);
  return {
    async parseSearchResults(html, baseUrl, options) {
      sink.emit({ phase: 'parser-start', hopIndex: 0 });
      const result = await parser.parseSearchResults(html, baseUrl, options);
      sink.emit({ phase: 'parser-complete', hopIndex: 0 });
      return result;
    },
    async parsePage(html, options) {
      sink.emit({ phase: 'parser-start', hopIndex: 0 });
      const result = await parser.parsePage(html, options);
      sink.emit({ phase: 'parser-complete', hopIndex: 0 });
      return result;
    },
    dispose: () => parser.dispose(),
  };
}

async function runTransportScenario(scenario, sink, requestId) {
  const trace = [];
  const transport = fixtureTransportForScenario(scenario.scenarioId, trace);
  const result = await transport.fetchHop('https://validation.site/fixture', { requestId, hopIndex: 0, purpose: 'page' });
  projectTrace(sink, trace);
  const ok = scenario.outcome === 'pass' ? result.ok === true : result.ok === false && result.code === scenario.errorCode;
  sink.emit(result.ok ? { phase: 'scenario-complete', hopIndex: 0, boolean: true } : { phase: 'scenario-failed', hopIndex: 0, boolean: false, errorCode: result.code });
  return { ok, errorCode: result.ok ? null : result.code, result };
}

async function runServiceScenario(scenario, sink, requestId) {
  const transport = {
    async fetchHop(url, options) {
      const trace = [];
      const fixture = fixtureTransportForScenario(scenario.scenarioId, trace);
      const result = await fixture.fetchHop(url, options);
      projectTrace(sink, trace);
      if (result.ok && result.kind === 'redirect') sink.emit({ phase: 'redirect-followed', hopIndex: options.hopIndex });
      return result;
    },
  };
  const service = createPinnedBrowserSearch({ transport, parserFactory: () => parserFactoryFor(sink), now: () => 1_000, overallTimeoutMs: 2_000 });
  const result = await service.search({ petId: 'validation-pet', requestId, query: scenario.scenarioId });
  const ok = scenario.outcome === 'pass' ? result.status === 'ok' : result.status === 'blocked' && result.reason === scenario.errorCode;
  if (ok) sink.emit(result.status === 'ok' ? { phase: 'scenario-complete', hopIndex: 0, boolean: true } : { phase: 'scenario-failed', hopIndex: 0, boolean: false, errorCode: result.reason });
  else sink.emit({ phase: 'scenario-failed', hopIndex: 0, boolean: false, errorCode: result.reason || 'response-invalid' });
  return { ok, errorCode: result.status === 'ok' ? null : result.reason, result };
}

async function runParserScenario(scenario, sink) {
  if (scenario.scenarioId === 'parser-electron-failure') {
    const environment = parserEnvironment({ loadError: Object.assign(new Error('ERR_FAILED'), { code: 'ERR_FAILED' }) });
    try { await createInertDocumentParser(environment); }
    catch {
      sink.emit({ phase: 'scenario-failed', hopIndex: 0, boolean: false, errorCode: 'parser-electron-err-failed' });
      return { ok: false, errorCode: 'parser-electron-err-failed', environmentErrorCode: 'ERR_FAILED' };
    }
  }

  const environment = parserEnvironment({ pendingEvaluation: scenario.scenarioId === 'cancel' || scenario.scenarioId === 'dispose' });
  const parser = await createInertDocumentParser(environment);
  sink.emit({ phase: 'parser-start', hopIndex: 0 });
  if (scenario.scenarioId === 'hostile-parser') {
    await parser.parsePage('<main><script>window.fetch("https://evil.invalid")</script>safe text</main>');
    sink.emit({ phase: 'parser-complete', hopIndex: 0 });
    await parser.dispose();
    sink.emit({ phase: 'scenario-complete', hopIndex: 0, boolean: true });
    return { ok: true, errorCode: null };
  }
  if (scenario.scenarioId === 'parser-negative-control') {
    environment.calls.beforeRequest({ url: 'https://evil.invalid/', resourceType: 'other' }, () => {});
    try { await parser.parsePage('<main>blocked</main>'); }
    catch (error) {
      await parser.dispose();
      sink.emit({ phase: 'scenario-failed', hopIndex: 0, boolean: false, errorCode: 'parser-egress-blocked' });
      return { ok: error.message === 'browser-search-parser-egress-blocked' && scenario.outcome === 'blocked', errorCode: error.message };
    }
  }
  if (scenario.scenarioId === 'cancel') {
    const controller = new AbortController();
    const pending = parser.parsePage('<main>cancel</main>', { signal: controller.signal });
    controller.abort();
    try { await pending; } catch (error) {
      await parser.dispose();
      sink.emit({ phase: 'cancelled', hopIndex: 0 });
      sink.emit({ phase: 'scenario-failed', hopIndex: 0, boolean: false, errorCode: 'browser-search-parser-cancelled' });
      return { ok: error.message === 'browser-search-parser-cancelled', errorCode: error.message };
    }
  }
  if (scenario.scenarioId === 'dispose') {
    const pending = parser.parsePage('<main>dispose</main>');
    await parser.dispose();
    try { await pending; } catch (error) {
      sink.emit({ phase: 'dispose', hopIndex: 0 });
      sink.emit({ phase: 'scenario-failed', hopIndex: 0, boolean: false, errorCode: 'browser-search-parser-disposed' });
      return { ok: error.message === 'browser-search-parser-disposed', errorCode: error.message };
    }
  }
  await parser.dispose();
  sink.emit({ phase: 'scenario-failed', hopIndex: 0, boolean: false, errorCode: scenario.errorCode });
  return { ok: false, errorCode: scenario.errorCode };
}

async function runScenario(scenarioId) {
  if (arguments.length !== 1) throw new Error('scenario-controls-disabled');
  const scenario = compileScenario(scenarioId);
  runCounter = (runCounter + 1) % 1_000_000;
  const requestId = `req-${scenario.scenarioId}`;
  const sink = createEvidenceSink({ runId: `run-${runCounter}-${scenario.scenarioId}`, scenarioId, requestId });
  sink.emit({ phase: 'scenario-start', hopIndex: 0 });
  let execution;
  if (TRANSPORT_SCENARIOS.has(scenarioId)) execution = await runTransportScenario(scenario, sink, requestId);
  else if (SERVICE_SCENARIOS.has(scenarioId)) execution = await runServiceScenario(scenario, sink, requestId);
  else if (PARSER_SCENARIOS.has(scenarioId)) execution = await runParserScenario(scenario, sink);
  else throw new Error('scenario-not-allowlisted');
  return {
    ok: execution.ok,
    scenarioId,
    outcome: scenario.outcome,
    execution: scenario.execution,
    synthetic: true,
    failureClass: scenario.failureClass || null,
    errorCode: execution.errorCode,
    environmentErrorCode: execution.environmentErrorCode || null,
    events: sink.finish(),
  };
}

module.exports = { SCENARIO_IDS, compileScenario, createArtifactManifest, parseScenarioArgs, runScenario };
