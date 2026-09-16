'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSystemResolverFactory } = require('../src/browser-search/resolver');

function answer(address, ttl = 60) {
  return [{ address, ttl }];
}

function resolverFor({ resolve4 = async () => answer('93.184.216.34'), resolve6 = async () => [], cancel, timeoutMs } = {}) {
  const calls = { resolve4: 0, resolve6: 0, cancel: 0 };
  const resolverFactory = createSystemResolverFactory({
    createResolver: () => ({
      resolve4: async (...args) => { calls.resolve4 += 1; return resolve4(...args); },
      resolve6: async (...args) => { calls.resolve6 += 1; return resolve6(...args); },
      setServers: () => {},
      cancel: () => { calls.cancel += 1; cancel?.(); },
    }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { resolverFactory, calls };
}

test('resolver snapshot resolves A and AAAA independently and canonicalizes endpoints', async () => {
  const { resolverFactory, calls } = resolverFor({ resolve6: async () => answer('2001:4860:4860:0:0:0:0:8888', 120) });
  const snapshot = await resolverFactory.resolve('public.example');
  assert.deepEqual(snapshot, {
    hostname: 'public.example',
    a: { status: 'ok', answers: [{ address: '93.184.216.34', family: 4, ttl: 60 }] },
    aaaa: { status: 'ok', answers: [{ address: '2001:4860:4860:0:0:0:0:8888', family: 6, ttl: 120 }] },
    endpoints: [
      { address: '93.184.216.34', family: 4, ttl: 60, key: 'v4:5db8d822' },
      { address: '2001:4860:4860:0:0:0:0:8888', family: 6, ttl: 120, key: 'v6:20014860486000000000000000008888' },
    ],
  });
  assert.deepEqual(calls, { resolve4: 1, resolve6: 1, cancel: 0 });
});

test('resolver uses fixed public DNS servers in primary and backup order', async () => {
  let configuredServers;
  const resolverFactory = createSystemResolverFactory({
    createResolver: () => ({
      setServers: (servers) => { configuredServers = [...servers]; },
      resolve4: async () => answer('93.184.216.34'),
      resolve6: async () => [],
    }),
  });

  await resolverFactory.resolve('public.example');

  assert.deepEqual(configuredServers, ['1.1.1.1', '8.8.8.8']);
});

test('resolver represents one-family NODATA and fails closed for dual NODATA or DNS errors', async () => {
  const one = resolverFor({ resolve6: async () => { const error = new Error('NODATA'); error.code = 'ENODATA'; throw error; } });
  const oneSnapshot = await one.resolverFactory.resolve('public.example');
  assert.equal(oneSnapshot.a.status, 'ok');
  assert.equal(oneSnapshot.aaaa.status, 'nodata');
  assert.equal(oneSnapshot.endpoints.length, 1);

  const dual = resolverFor({
    resolve4: async () => { const error = new Error('NODATA'); error.code = 'ENODATA'; throw error; },
    resolve6: async () => { const error = new Error('NODATA'); error.code = 'ENODATA'; throw error; },
  });
  await assert.rejects(() => dual.resolverFactory.resolve('public.example'), (error) => error.code === 'dns-failed');

  for (const code of ['ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT']) {
    const { resolverFactory } = resolverFor({ resolve4: async () => { const error = new Error(code); error.code = code; throw error; } });
    const expected = code === 'ENOTFOUND' ? 'dns-nxdomain' : code === 'ETIMEOUT' ? 'dns-timeout' : 'dns-failed';
    await assert.rejects(() => resolverFactory.resolve('public.example'), (error) => error.code === expected);
  }
});

test('resolver rejects malformed, family-mismatched, duplicate, and oversized answers', async () => {
  const cases = [
    { resolve4: async () => answer('not-an-ip'), code: 'dns-invalid' },
    { resolve4: async () => null, code: 'dns-invalid' },
    { resolve4: async () => answer('2001:db8::1'), code: 'dns-invalid' },
    { resolve4: async () => Array.from({ length: 17 }, (_, index) => answer(`93.184.216.${index + 1}`)[0]), code: 'dns-too-many-answers' },
    { resolve4: async () => Array.from({ length: 16 }, (_, index) => answer(`93.184.216.${index + 1}`)[0]), resolve6: async () => Array.from({ length: 17 }, () => answer('2001:4860:4860::8888')[0]), code: 'dns-too-many-answers' },
  ];
  for (const item of cases) {
    const { resolverFactory } = resolverFor(item);
    await assert.rejects(() => resolverFactory.resolve('public.example'), (error) => error.code === item.code);
  }

  const duplicate = resolverFor({ resolve4: async () => [...answer('93.184.216.34'), ...answer('93.184.216.34')] });
  const snapshot = await duplicate.resolverFactory.resolve('public.example');
  assert.equal(snapshot.endpoints.length, 1);
});

test('resolver abort cancels the system resolver and never returns a late snapshot', async () => {
  let release;
  const { resolverFactory, calls } = resolverFor({
    resolve4: () => new Promise((resolve) => { release = resolve; }),
  });
  const controller = new AbortController();
  const pending = resolverFactory.resolve('public.example', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'request-aborted');
  release(answer('93.184.216.34'));
  assert.equal(calls.cancel, 1);
});

test('resolver timeout cancels a pending per-hop resolver', async () => {
  const { resolverFactory, calls } = resolverFor({ timeoutMs: 1, resolve4: () => new Promise(() => {}) });
  await assert.rejects(() => resolverFactory.resolve('public.example'), (error) => error.code === 'dns-timeout');
  assert.equal(calls.cancel, 1);
});

test('fatal A query cancels a still-pending AAAA query immediately', async () => {
  let releaseAAAA;
  const { resolverFactory, calls } = resolverFor({
    resolve4: async () => { const error = new Error('SERVFAIL'); error.code = 'ESERVFAIL'; throw error; },
    resolve6: () => new Promise((resolve) => { releaseAAAA = resolve; }),
    timeoutMs: 100,
  });
  const pending = resolverFactory.resolve('public.example');
  const observed = pending.then(() => null, (error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.cancel, 1);
  releaseAAAA([]);
  assert.equal((await observed).code, 'dns-failed');
});
