'use strict';

const dns = require('node:dns');
const net = require('node:net');
const { assertAllowedPublicEndpoints } = require('./policy');

const FAMILY_LIMIT = 16;
const TOTAL_LIMIT = 32;
const DEFAULT_TIMEOUT_MS = 5_000;
const DNS_SERVERS = Object.freeze(['1.1.1.1', '8.8.8.8']);

function resolverError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function classifyDnsError(error) {
  if (error?.code === 'ENOTFOUND') return resolverError('dns-nxdomain');
  if (error?.code === 'ENODATA') return null;
  if (error?.code === 'ETIMEOUT' || error?.code === 'EAI_AGAIN') return resolverError('dns-timeout');
  return resolverError('dns-failed');
}

function normalizeAnswers(raw, family) {
  if (!Array.isArray(raw) || raw.length > FAMILY_LIMIT) throw resolverError('dns-too-many-answers');
  return raw.map((item) => {
    const address = typeof item === 'string' ? item : item?.address;
    const ttl = typeof item === 'string' ? 0 : item?.ttl;
    if (typeof address !== 'string' || net.isIP(address) !== family || !Number.isFinite(ttl) || ttl < 0) throw resolverError('dns-invalid');
    return { address, family, ttl };
  });
}

function createSystemResolverFactory({ createResolver = () => new dns.promises.Resolver({ timeout: DEFAULT_TIMEOUT_MS, tries: 1 }), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  async function resolve(hostname, { signal } = {}) {
    if (typeof hostname !== 'string' || !hostname) throw resolverError('dns-invalid');
    let resolver;
    try {
      resolver = createResolver();
      if (typeof resolver?.setServers === 'function') resolver.setServers(DNS_SERVERS);
    } catch (error) {
      throw error?.code === 'dns-failed' ? error : resolverError('dns-failed');
    }
    let settled = false;
    let timer;
    let abortListener;
    const pending = new Promise((resolvePromise, rejectPromise) => {
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (abortListener) signal?.removeEventListener('abort', abortListener);
        error ? rejectPromise(error) : resolvePromise(value);
      };
      const cancel = () => resolver.cancel?.();
      abortListener = () => {
        cancel();
        finish(resolverError('request-aborted'));
      };
      if (signal?.aborted) return abortListener();
      signal?.addEventListener('abort', abortListener, { once: true });
      timer = setTimeout(() => {
        cancel();
        finish(resolverError('dns-timeout'));
      }, timeoutMs);

      const query = (method, family) => Promise.resolve().then(() => resolver[method](hostname, { ttl: true })).then(
        (raw) => {
          if (!Array.isArray(raw)) throw resolverError('dns-invalid');
          return raw.length === 0
            ? { status: 'nodata', answers: [] }
            : { status: 'ok', answers: normalizeAnswers(raw, family) };
        },
        (error) => {
          const classified = classifyDnsError(error);
          if (!classified) return { status: 'nodata', answers: [] };
          throw classified;
        },
      );

      Promise.all([query('resolve4', 4), query('resolve6', 6)]).then(([a, aaaa]) => {
        if (settled) return;
        if (a.answers.length + aaaa.answers.length > TOTAL_LIMIT) {
          cancel();
          return finish(resolverError('dns-too-many-answers'));
        }
        let endpoints;
        try {
          endpoints = assertAllowedPublicEndpoints([...a.answers, ...aaaa.answers]);
        } catch (error) {
          cancel();
          return finish(error);
        }
        if (!endpoints.length) {
          cancel();
          return finish(resolverError('dns-failed'));
        }
        finish(null, {
          hostname,
          a,
          aaaa,
          endpoints: endpoints.map((endpoint) => ({ ...endpoint, ttl: endpoint.ttl ?? 0 })),
        });
      }, (error) => {
        cancel();
        finish(error?.code ? error : resolverError('dns-failed'));
      });
    });
    return pending;
  }

  const factory = (hostname, options) => resolve(hostname, options);
  factory.resolve = resolve;
  factory.create = resolve;
  return factory;
}

module.exports = { createSystemResolverFactory, DNS_SERVERS, FAMILY_LIMIT, TOTAL_LIMIT };
