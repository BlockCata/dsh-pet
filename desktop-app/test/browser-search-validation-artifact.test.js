'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.join(__dirname, '..');
const packagePath = path.join(appRoot, 'package.json');
const builderPath = path.join(appRoot, 'electron-builder.transport-validation.yml');
const validationRoot = path.join(appRoot, 'validation', 'browser-search');

const {
  SCENARIO_IDS,
  compileScenario,
  createArtifactManifest,
  parseScenarioArgs,
  runScenario,
} = require('../validation/browser-search/scenarios');
const {
  ALLOWED_EVENT_FIELDS,
  createEvidenceSink,
  serializeEvidenceEvent,
} = require('../validation/browser-search/evidence');

test('production build files exclude the validation entrypoint and validation config fixes main', () => {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const productionFiles = packageJson.build.files.flatMap((entry) => String(entry));
  assert.equal(productionFiles.some((entry) => entry.includes('validation')), false);

  const builder = fs.readFileSync(builderPath, 'utf8');
  assert.match(builder, /main:\s*validation\/browser-search\/main\.js/);
  assert.match(builder, /validation\/browser-search\/\*\*\/\*/);
  assert.match(builder, /src\/browser-search\/\*\*\/\*/);
  assert.match(builder, /src\/chat\/search\.js/);
  assert.match(builder, /TEST-ONLY/);
});

test('validation artifact contains only the fixed entrypoint and static UI files', () => {
  for (const file of ['main.js', 'scenarios.js', 'evidence.js', 'index.html']) {
    assert.equal(fs.existsSync(path.join(validationRoot, file)), true, file);
  }

  const html = fs.readFileSync(path.join(validationRoot, 'index.html'), 'utf8');
  assert.match(html, /TEST-ONLY/);
  assert.doesNotMatch(html, /<(?:input|textarea|form)\b/i);
  assert.doesNotMatch(html, /normal chat|任意輸入/i);
});

test('runner accepts exactly one compiled scenario id and rejects arbitrary controls', async () => {
  assert.ok(SCENARIO_IDS.length >= 20);
  assert.deepEqual(parseScenarioArgs([`--scenario-id=${SCENARIO_IDS[0]}`]), compileScenario(SCENARIO_IDS[0]));

  for (const argument of [
    '--scenario-id=unknown',
    '--url=https://example.com/',
    '--header=Cookie: secret',
    '--query=arbitrary',
    '--key=secret',
  ]) {
    assert.throws(() => parseScenarioArgs([argument]), /scenario|argument|control/i, argument);
  }
  assert.throws(() => parseScenarioArgs([]), /scenario/i);
  await assert.rejects(() => runScenario(SCENARIO_IDS[0], { url: 'https://example.com/' }), /control|argument|scenario/i);
});

test('fixed scenarios cover the required transport, redirect, parser, and lifecycle matrix', () => {
  const requiredGroups = [
    ['a-normal', 'aaaa-normal', 'aaaa-only', 'mixed-private'],
    ['dns-nxdomain', 'dns-nodata', 'dns-timeout'],
    ['peer-mismatch', 'cert-mismatch'],
    ['redirect-chain', 'redirect-loop', 'redirect-limit', 'redirect-unsafe-location'],
    ['content-limit', 'framing-limit'],
    ['hostile-parser', 'parser-negative-control', 'cancel', 'dispose'],
  ];

  for (const group of requiredGroups) {
    for (const scenarioId of group) assert.ok(SCENARIO_IDS.includes(scenarioId), scenarioId);
  }
});

test('evidence serializer allowlists fields and rejects sensitive or raw values', () => {
  assert.deepEqual([...ALLOWED_EVENT_FIELDS].sort(), [
    'address', 'boolean', 'byteCount', 'errorCode', 'family', 'fingerprint256',
    'hopIndex', 'hostname', 'mediaType', 'phase', 'port', 'requestId', 'runId',
    'scenarioId', 'seq', 'statusCode',
  ].sort());

  const base = {
    runId: 'run-1',
    scenarioId: 'a-normal',
    requestId: 'req-1',
    hopIndex: 0,
    seq: 0,
    phase: 'scenario-start',
  };
  assert.doesNotThrow(() => serializeEvidenceEvent(base));

  for (const forbidden of [
    { ...base, url: 'https://public.example/path?q=1' },
    { ...base, Location: 'https://public.example/next' },
    { ...base, phase: 'raw-url https://public.example/' },
    { ...base, mediaType: '<html>secret</html>' },
    { ...base, errorCode: 'api_key=secret-value' },
    { ...base, runId: 'sk-live-12345678901234567890' },
  ]) {
    assert.throws(() => serializeEvidenceEvent(forbidden), /evidence|forbidden|sensitive|value/i);
  }
});

test('evidence serializer rejects overlong identifiers and malformed bounded values', () => {
  const base = {
    runId: 'run-1',
    scenarioId: 'a-normal',
    requestId: 'req-1',
    hopIndex: 0,
    seq: 0,
    phase: 'scenario-start',
  };
  assert.throws(() => serializeEvidenceEvent({ ...base, requestId: 'x'.repeat(65) }), /length|bounded|evidence/i);
  assert.throws(() => serializeEvidenceEvent({ ...base, scenarioId: 'x'.repeat(65) }), /length|bounded|evidence/i);
  assert.throws(() => serializeEvidenceEvent({ ...base, byteCount: -1 }), /byte|bounded|evidence/i);
  assert.throws(() => serializeEvidenceEvent({ ...base, boolean: 'true' }), /boolean|evidence/i);
});

test('evidence phase order is machine-checkable and runner emits only bounded records', async () => {
  const sink = createEvidenceSink({ runId: 'run-1', scenarioId: 'a-normal' });
  sink.emit({ requestId: 'req-1', hopIndex: 0, phase: 'scenario-start' });
  assert.throws(() => sink.emit({ requestId: 'req-1', hopIndex: 0, phase: 'response-classified' }), /phase|order/i);

  const result = await runScenario('a-normal');
  assert.equal(result.ok, true);
  assert.ok(result.events.length >= 3);
  for (const event of result.events) {
    assert.doesNotThrow(() => serializeEvidenceEvent(JSON.parse(event)));
  }
});

test('evidence sink owns provenance and sequence fields', () => {
  const sink = createEvidenceSink({ runId: 'run-fixed', scenarioId: 'a-normal', requestId: 'req-fixed' });
  const first = sink.emit({
    runId: 'attacker-run',
    scenarioId: 'attacker-scenario',
    requestId: 'attacker-request',
    seq: 999,
    phase: 'scenario-start',
    hopIndex: 0,
  });
  assert.deepEqual(first, {
    runId: 'run-fixed',
    scenarioId: 'a-normal',
    requestId: 'req-fixed',
    seq: 0,
    phase: 'scenario-start',
    hopIndex: 0,
  });
});

test('runner output comes from actual bounded module traces and redirects preserve hop semantics', async () => {
  const result = await runScenario('redirect-chain');
  assert.equal(result.ok, true);
  assert.equal(result.synthetic, true);
  assert.match(result.execution, /service|transport/i);
  const events = result.events.map((event) => JSON.parse(event));
  const responses = events.filter((event) => event.phase === 'response-classified');
  assert.deepEqual(responses.slice(0, 3).map((event) => [event.hopIndex, event.statusCode]), [
    [0, 302], [1, 302], [2, 200],
  ]);
  assert.deepEqual(events.filter((event) => event.phase === 'redirect-followed').map((event) => event.hopIndex), [0, 1]);
  assert.equal(responses.at(-1).statusCode, 200);
});

test('parser ERR_FAILED fixture remains an explicit blocked result', async () => {
  const result = await runScenario('parser-electron-failure');
  assert.equal(result.ok, false);
  assert.equal(result.synthetic, true);
  assert.equal(result.failureClass, 'electron-fixture');
  assert.equal(result.errorCode, 'parser-electron-err-failed');
  assert.equal(result.environmentErrorCode, 'ERR_FAILED');
  assert.ok(result.events.some((event) => JSON.parse(event).errorCode === 'parser-electron-err-failed'));
});

test('every allowlisted scenario executes its fixed bounded trace', () => {
  return Promise.all(SCENARIO_IDS.map(async (scenarioId) => {
    await assert.doesNotReject(async () => {
      const result = await runScenario(scenarioId);
      assert.equal(result.scenarioId, scenarioId);
      assert.equal(result.ok, scenarioId !== 'parser-electron-failure');
      assert.ok(result.events.length > 0);
    }, scenarioId);
  }));
});

test('final validation release has a reproducible artifact manifest', () => {
  const builder = fs.readFileSync(builderPath, 'utf8');
  const output = builder.match(/output:\s*(release-transport-validation-[A-Za-z0-9]+)/)?.[1];
  assert.ok(output);
  const releaseRoot = path.join(appRoot, output);
  const manifestPath = path.join(releaseRoot, 'artifact-manifest.json');
  assert.equal(fs.existsSync(manifestPath), true);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rebuilt = createArtifactManifest({ releaseRoot, sourceRoot: appRoot, configPath: builderPath });
  assert.deepEqual(manifest.build, rebuilt.build);
  assert.deepEqual(manifest.sourceHashes, rebuilt.sourceHashes);
  assert.equal(manifest.build.nodeVersion, process.versions.node);
  assert.equal(manifest.manifestPrefix, output.slice('release-transport-validation-'.length));
  assert.equal(manifest.artifactDirectory, output);
  assert.equal(manifest.build.electronVersion, '43.3.0');
  assert.equal(manifest.files.exe.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseRoot, manifest.files.exe.path))).digest('hex').toUpperCase());
  assert.equal(manifest.files.appAsar.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseRoot, manifest.files.appAsar.path))).digest('hex').toUpperCase());
  assert.equal(manifest.files.builderConfig.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseRoot, manifest.files.builderConfig.path))).digest('hex').toUpperCase());
  for (const file of ['main.js', 'scenarios.js', 'evidence.js', 'index.html']) {
    const relative = path.join('validation', 'browser-search', file);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot, relative))).digest('hex').toUpperCase();
    assert.equal(manifest.sourceHashes[relative.replaceAll('\\', '/')], digest, relative);
  }
});
