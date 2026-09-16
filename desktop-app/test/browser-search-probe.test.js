const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const probePath = path.join(__dirname, '..', 'diagnostics', 'browser-search-probe.cjs');
const verificationPath = path.join(__dirname, '..', '..', 'docs', 'verification-readonly-browser-chat.md');

function readProbe() {
  return fs.readFileSync(probePath, 'utf8');
}

test('security probe uses current Electron event details and cancels downloads before inspection', () => {
  const probe = readProbe();

  assert.match(probe, /webContents\.on\(eventName, \(event, details\) => \{/);
  assert.match(probe, /event\.preventDefault\(\);\s*recordDownload\(\);/);
});

test('security probe reports bounded metadata without raw queries, locations, or fixture paths', () => {
  const probe = readProbe();

  assert.doesNotMatch(probe, /query:\s*fixture\.query/);
  assert.doesNotMatch(probe, /fixture:\s*path\.relative/);
  assert.doesNotMatch(probe, /localHits\.push\(\{\s*url:/);
  assert.doesNotMatch(probe, /downloads\.push\(\{\s*url:/);
  assert.doesNotMatch(probe, /navigations\.push\(\{\s*eventName,\s*url:/);
});

test('verification record keeps the public-reader production gate and evidence gaps explicit', () => {
  const verification = fs.readFileSync(verificationPath, 'utf8');

  assert.match(verification, /固定公開 HTTPS\/443 GET/);
  assert.match(verification, /每一跳.*DNS.*socket/i);
  assert.match(verification, /inert DOM parser/i);
  assert.match(verification, /取消.*dispose|dispose.*取消/i);
  assert.match(verification, /production.*blocked|blocked.*production/i);
});
