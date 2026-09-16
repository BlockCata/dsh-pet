const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  isBlockedUrl,
  validatePublicUrl,
  canonicalizePublicHttpsUrl,
  canonicalAddress,
  assertAllowedPublicEndpoints,
  PUBLIC_POLICY_SNAPSHOT,
  PUBLIC_POLICY_TABLE_DIGEST,
} = require('../src/browser-search/policy');

const { IANA_SNAPSHOT, PUBLIC_ENDPOINT_CASES } = require('./fixtures/iana-public-endpoints');

const REVIEWED_POLICY_TABLE_HASH = 'sha256:3fc13dbb90c7ea58e327621740c2d88ca2bcdc0a8abbc516ab1d43b54333919d';

test('fixed IANA fixture provenance is mechanically tied to the runtime policy table', () => {
  const policyTableHash = crypto.createHash('sha256').update(JSON.stringify(PUBLIC_POLICY_SNAPSHOT)).digest('hex');
  assert.equal(IANA_SNAPSHOT.policyTableHash, REVIEWED_POLICY_TABLE_HASH);
  assert.equal(PUBLIC_POLICY_TABLE_DIGEST, REVIEWED_POLICY_TABLE_HASH);
  assert.equal(`sha256:${policyTableHash}`, REVIEWED_POLICY_TABLE_HASH);
  assert.deepEqual(IANA_SNAPSHOT.policyTable, PUBLIC_POLICY_SNAPSHOT);
  const mutated = JSON.parse(JSON.stringify(PUBLIC_POLICY_SNAPSHOT));
  mutated.blockedIpv4.pop();
  const mutatedHash = crypto.createHash('sha256').update(JSON.stringify(mutated)).digest('hex');
  assert.notEqual(mutatedHash, REVIEWED_POLICY_TABLE_HASH.slice('sha256:'.length));
  assert.notEqual(policyTableHash, mutatedHash);
});

test('canonicalizePublicHttpsUrl enforces the fixed HTTPS target policy', () => {
  assert.deepEqual(canonicalizePublicHttpsUrl('https://PUBLIC.Site./path?q=1#fragment'), {
    url: 'https://public.site/path?q=1',
    hostname: 'public.site',
    targetBytes: Buffer.byteLength('/path?q=1'),
  });

  for (const value of [
    'http://public.site/',
    'https://user:pass@public.site/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://public.site:444/',
    'https://subdomain.localhost/',
    'https://service.local/',
    'https://service.test/',
    'https://resolver.arpa/',
    `https://${'a'.repeat(64)}.example/`,
    `https://${'a'.repeat(250)}.example/`,
  ]) {
    assert.throws(() => canonicalizePublicHttpsUrl(value), /url-invalid|url-blocked|request-target-too-large/);
  }
  assert.equal(canonicalizePublicHttpsUrl('https://public.site/#fragment').url, 'https://public.site/');
  assert.equal(canonicalizePublicHttpsUrl('https://bücher.site/').hostname, 'xn--bcher-kva.site');
  assert.equal(canonicalizePublicHttpsUrl('https://public.site:443/').url, 'https://public.site/');
  assert.doesNotThrow(() => canonicalizePublicHttpsUrl(`https://public.site/${'a'.repeat(8191)}`));
  assert.throws(() => canonicalizePublicHttpsUrl(`https://public.site/${'a'.repeat(8192)}`), (error) => error.code === 'request-target-too-large');
});

test('canonicalAddress gives equivalent IPv6 spellings one peer key and isolates families', () => {
  assert.equal(canonicalAddress('2001:4860:4860:0:0:0:0:8888', 6), 'v6:20014860486000000000000000008888');
  assert.equal(canonicalAddress('2001:4860:4860::8888', 6), 'v6:20014860486000000000000000008888');
  assert.throws(() => canonicalAddress('::ffff:93.184.216.34', 6), /dns-non-public/);
  assert.equal(canonicalAddress('93.184.216.34', 4), 'v4:5db8d822');
});

test('assertAllowedPublicEndpoints rejects every fixed special-purpose and translated fixture endpoint', () => {
  for (const entry of PUBLIC_ENDPOINT_CASES.filter((item) => !item.allowed)) {
    assert.throws(
      () => assertAllowedPublicEndpoints([{ address: entry.address, family: entry.family }]),
      /dns-non-public|dns-invalid/,
      entry.name,
    );
  }
  assert.deepEqual(
    assertAllowedPublicEndpoints([{ address: '93.184.216.34', family: 4 }]),
    [{ address: '93.184.216.34', family: 4, key: 'v4:5db8d822' }],
  );
});

test('aggregate reserved ranges fail closed even in unknown holes', () => {
  for (const [address, family] of [['192.0.0.11', 4], ['2001:5::1', 6]]) {
    assert.throws(() => canonicalAddress(address, family), (error) => error.code === 'dns-non-public', address);
  }
});

test('isBlockedUrl fail-closes non-HTTPS and locally addressable navigation targets', () => {
  for (const value of [
    'file:///C:/Windows/',
    'data:text/html,test',
    'http://public.site/',
    'https://user:pass@public.site/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://localhost./',
    'https://LOCALHOST./',
    'https://subdomain.localhost./',
  ]) {
    assert.equal(isBlockedUrl(value), true, value);
  }
  assert.equal(isBlockedUrl('https://public.site/path'), false);
});

test('validatePublicUrl accepts an HTTPS hostname only when every DNS answer is public', async () => {
  const result = await validatePublicUrl('https://public.site/path?q=1', async () => ['93.184.216.34', '2001:4860:4860::8888']);

  assert.deepEqual(result, {
    url: 'https://public.site/path?q=1',
    addresses: ['93.184.216.34', '2001:4860:4860::8888'],
  });
});

test('validatePublicUrl canonicalizes a trailing-dot hostname before DNS and transport reuse', async () => {
  let resolvedHost;
  const result = await validatePublicUrl('https://PUBLIC.SITE./path', async (host) => {
    resolvedHost = host;
    return ['93.184.216.34'];
  });

  assert.equal(resolvedHost, 'public.site');
  assert.deepEqual(result, { url: 'https://public.site/path', addresses: ['93.184.216.34'] });
});

test('validatePublicUrl rejects non-HTTPS, credentialed, local, and IP-literal URLs before resolution', async () => {
  const resolveHost = async () => {
    throw new Error('URL should have been rejected before DNS resolution');
  };

  for (const value of [
    'http://public.site/',
    'file:///C:/Windows/',
    'https://user:pass@public.site/',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://[::1]/',
  ]) {
    await assert.rejects(() => validatePublicUrl(value, resolveHost), /不允許/);
  }
});

test('validatePublicUrl rejects a DNS response when any answer is private or loopback', async () => {
  await assert.rejects(
    () => validatePublicUrl('https://public.site/', async () => ['93.184.216.34', '127.0.0.1']),
    /不允許的位址/,
  );
  await assert.rejects(
    () => validatePublicUrl('https://public.site/', async () => ['::1']),
    /不允許的位址/,
  );
});

test('validatePublicUrl rejects IPv6 special addresses by their 16-bit structure', async () => {
  for (const address of [
    '::1',
    '0:0:0:0:0:0:0:1',
    'fd00::1',
    'fe80::1',
    '0000:0000:0000:0000:0000:ffff:7f00:0001',
    '::ffff:7f00:1',
    '0000:0000:0000:0000:0000:0000:7f00:0001',
    '::7f00:1',
  ]) {
    await assert.rejects(
      () => validatePublicUrl('https://public.site/', async () => [address]),
      /不允許的位址/,
      address,
    );
  }
});

test('validatePublicUrl rejects IPv6 site-local and 6to4 address prefixes', async () => {
  for (const [url, address] of [
    ['https://site-local.site/', 'fec0::1'],
    ['https://six-to-four.site/', '2002:7f00:1::'],
  ]) {
    await assert.rejects(
      () => validatePublicUrl(url, async () => [address]),
      /不允許的位址/,
      address,
    );
  }
});

test('validatePublicUrl rejects IPv6 special-use, transition, and tunnel ranges', async () => {
  for (const [prefix, address] of [
    ['64:ff9b::/96', '64:ff9b::c000:201'],
    ['64:ff9b:1::/48', '64:ff9b:1::1'],
    ['100::/64', '100::1'],
    ['2001::/23', '2001:0::1'],
    ['2002::/16', '2002:7f00:1::'],
    ['3fff::/20', '3fff::1'],
  ]) {
    await assert.rejects(
      () => validatePublicUrl('https://public.site/', async () => [address]),
      /不允許的位址/,
      `${prefix}: ${address}`,
    );
  }
});

test('validatePublicUrl rejects localhost hostname equivalents before a public DNS answer can be used', async () => {
  let resolutions = 0;
  const resolveHost = async () => {
    resolutions += 1;
    return ['93.184.216.34'];
  };

  for (const value of ['https://localhost./', 'https://LOCALHOST./', 'https://subdomain.LOCALHOST./']) {
    await assert.rejects(() => validatePublicUrl(value, resolveHost), /不允許的網址主機/);
  }
  assert.equal(resolutions, 0);
});

test('validatePublicUrl rejects an absent or malformed DNS answer instead of assuming it is public', async () => {
  await assert.rejects(() => validatePublicUrl('https://public.site/', async () => []), /無法驗證/);
  await assert.rejects(() => validatePublicUrl('https://public.site/', async () => ['not-an-ip']), /無法驗證/);
});
