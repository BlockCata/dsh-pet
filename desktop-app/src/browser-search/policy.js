'use strict';

const net = require('node:net');
const { domainToASCII } = require('node:url');

const MAX_HOSTNAME_BYTES = 253;
const MAX_TARGET_BYTES = 8192;
const SPECIAL_USE_SUFFIX_TABLE = Object.freeze([
  'alt', '6tisch.arpa', 'eap.arpa', 'eap-noob.arpa', 'home.arpa', 'ipv4only.arpa',
  'resolver.arpa', 'service.arpa', '10.in-addr.arpa', '254.169.in-addr.arpa',
  '16.172.in-addr.arpa', '17.172.in-addr.arpa', '18.172.in-addr.arpa',
  '19.172.in-addr.arpa', '20.172.in-addr.arpa', '21.172.in-addr.arpa',
  '22.172.in-addr.arpa', '23.172.in-addr.arpa', '24.172.in-addr.arpa',
  '25.172.in-addr.arpa', '26.172.in-addr.arpa', '27.172.in-addr.arpa',
  '28.172.in-addr.arpa', '29.172.in-addr.arpa', '30.172.in-addr.arpa',
  '31.172.in-addr.arpa', '170.0.0.192.in-addr.arpa', '171.0.0.192.in-addr.arpa',
  '168.192.in-addr.arpa', '8.e.f.ip6.arpa', '9.e.f.ip6.arpa', 'a.e.f.ip6.arpa',
  'b.e.f.ip6.arpa', 'invalid', 'local', 'localhost', 'onion', 'test',
  'example', 'example.com', 'example.net', 'example.org',
]);
const SPECIAL_USE_SUFFIXES = SPECIAL_USE_SUFFIX_TABLE;

// Fixed, human-reviewed IANA snapshot. Unknown address space is rejected by
// the global-unicast family gates below; it is never treated as public.
const BLOCKED_IPV4_TABLE = Object.freeze([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.0.8', 32],
  ['192.0.0.170', 31], ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4],
  ['240.0.0.0', 4], ['255.255.255.255', 32],
]);
const BLOCKED_IPV4 = BLOCKED_IPV4_TABLE.map(([address, bits]) => ({ bytes: parseIpv4(address), bits }));

const BLOCKED_IPV6_TABLE = Object.freeze([
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96],
  ['64:ff9b:1::', 48], ['100::', 64], ['100:0:0:1::', 64], ['2001::', 23],
  ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28], ['2001:db8::', 32],
  ['2002::', 16], ['3fff::', 20], ['5f00::', 16], ['fc00::', 7], ['fe80::', 10],
  ['ff00::', 8],
]);
const BLOCKED_IPV6 = BLOCKED_IPV6_TABLE.map(([address, bits]) => ({ segments: parseIpv6(address), bits }));

const PUBLIC_POLICY_SNAPSHOT = Object.freeze({
  specialUseSuffixes: SPECIAL_USE_SUFFIX_TABLE,
  blockedIpv4: BLOCKED_IPV4_TABLE,
  blockedIpv6: BLOCKED_IPV6_TABLE,
});
const PUBLIC_POLICY_TABLE_DIGEST = 'sha256:3fc13dbb90c7ea58e327621740c2d88ca2bcdc0a8abbc516ab1d43b54333919d';

function policyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseIpv4(value) {
  if (typeof value !== 'string' || net.isIP(value) !== 4) return null;
  const pieces = value.split('.').map(Number);
  if (pieces.length !== 4 || pieces.some((piece) => !Number.isInteger(piece) || piece < 0 || piece > 255)) return null;
  return Buffer.from(pieces);
}

function parseIpv6(value) {
  if (typeof value !== 'string' || net.isIP(value) !== 6) return null;
  const pieces = value.toLowerCase().split('::');
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(':') : [];
  const tokens = [...left, ...right];
  const segments = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.includes('.')) {
      if (index !== tokens.length - 1) return null;
      const bytes = parseIpv4(token);
      if (!bytes) return null;
      segments.push((bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]);
    } else {
      if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
      segments.push(Number.parseInt(token, 16));
    }
  }
  if (pieces.length === 1) return segments.length === 8 ? segments : null;
  const omitted = 8 - segments.length;
  return omitted > 0 ? [...segments.slice(0, left.length), ...Array(omitted).fill(0), ...segments.slice(left.length)] : null;
}

function inPrefix(bytes, prefix, bits) {
  const whole = Math.floor(bits / 8);
  const remainder = bits % 8;
  for (let index = 0; index < whole; index += 1) if (bytes[index] !== prefix[index]) return false;
  return !remainder || (bytes[whole] & (0xff << (8 - remainder))) === (prefix[whole] & (0xff << (8 - remainder)));
}

function ipv6Bytes(segments) {
  const bytes = Buffer.alloc(16);
  segments.forEach((segment, index) => bytes.writeUInt16BE(segment, index * 2));
  return bytes;
}

function familyNumber(family) {
  if (family === 4 || family === 'IPv4') return 4;
  if (family === 6 || family === 'IPv6') return 6;
  return 0;
}

function canonicalAddress(value, family) {
  const expectedFamily = familyNumber(family);
  const actualFamily = net.isIP(String(value || ''));
  if (!expectedFamily || actualFamily !== expectedFamily) throw policyError('dns-invalid');
  if (actualFamily === 4) {
    const bytes = parseIpv4(value);
    if (!bytes || BLOCKED_IPV4.some((prefix) => inPrefix(bytes, prefix.bytes, prefix.bits))) throw policyError('dns-non-public');
    return `v4:${bytes.toString('hex')}`;
  }
  const segments = parseIpv6(value);
  const bytes = segments && ipv6Bytes(segments);
  if (!bytes || bytes[0] < 0x20 || bytes[0] > 0x3f || BLOCKED_IPV6.some((prefix) => inPrefix(bytes, ipv6Bytes(prefix.segments), prefix.bits))) {
    throw policyError('dns-non-public');
  }
  return `v6:${bytes.toString('hex')}`;
}

function assertAllowedPublicEndpoints(endpoints) {
  if (!Array.isArray(endpoints)) throw policyError('dns-invalid');
  const seen = new Set();
  const normalized = [];
  for (const endpoint of endpoints) {
    if (!endpoint || typeof endpoint !== 'object') throw policyError('dns-invalid');
    const family = familyNumber(endpoint.family);
    const key = canonicalAddress(endpoint.address, family);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ address: endpoint.address, family, ...(Number.isFinite(endpoint.ttl) ? { ttl: endpoint.ttl } : {}), key });
  }
  return normalized;
}

function canonicalizeHostname(hostname) {
  const withoutDot = hostname.replace(/\.$/, '').toLowerCase();
  const ascii = domainToASCII(withoutDot);
  if (!ascii || ascii.length > MAX_HOSTNAME_BYTES || ascii.split('.').length < 2) throw policyError('url-blocked');
  const labels = ascii.split('.');
  if (labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-'))) throw policyError('url-blocked');
  if (SPECIAL_USE_SUFFIXES.some((suffix) => ascii === suffix || ascii.endsWith(`.${suffix}`))) throw policyError('url-blocked');
  return ascii;
}

function canonicalizePublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw policyError('url-invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw policyError('url-invalid');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname || net.isIP(hostname)) throw policyError('url-blocked');
  const canonicalHostname = canonicalizeHostname(hostname);
  url.hostname = canonicalHostname;
  url.hash = '';
  const target = `${url.pathname || '/'}${url.search}`;
  const targetBytes = Buffer.byteLength(target, 'utf8');
  if (targetBytes > MAX_TARGET_BYTES) throw policyError('request-target-too-large');
  return { url: url.toString(), hostname: canonicalHostname, targetBytes };
}

function isPublicAddress(value) {
  try {
    canonicalAddress(value, net.isIP(String(value || '')));
    return true;
  } catch {
    return false;
  }
}

function isBlockedUrl(value) {
  try {
    canonicalizePublicHttpsUrl(value);
    return false;
  } catch {
    return true;
  }
}

function addressesFrom(result) {
  if (Array.isArray(result)) return result.map((address) => ({ address, family: net.isIP(address) }));
  if (Array.isArray(result?.endpoints)) return result.endpoints;
  return [];
}

async function validatePublicUrl(value, resolveHost) {
  let canonical;
  try {
    canonical = canonicalizePublicHttpsUrl(value);
  } catch (error) {
    if (error.code === 'url-blocked') throw new Error('不允許的網址主機。');
    if (error.code === 'url-invalid') throw new Error('不允許的網址協定。');
    throw new Error('不允許的網址。');
  }
  if (typeof resolveHost !== 'function') throw new Error('無法驗證目標 DNS 位址。');
  const endpoints = addressesFrom(await resolveHost(canonical.hostname));
  if (!endpoints.length) throw new Error('無法驗證目標 DNS 位址。');
  let normalized;
  try {
    normalized = assertAllowedPublicEndpoints(endpoints);
  } catch (error) {
    if (error.code === 'dns-non-public') throw new Error('不允許的位址。');
    throw new Error('無法驗證目標 DNS 位址。');
  }
  return { url: canonical.url, addresses: normalized.map((endpoint) => endpoint.address) };
}

module.exports = {
  MAX_TARGET_BYTES,
  isBlockedUrl,
  isPublicAddress,
  validatePublicUrl,
  canonicalAddress,
  canonicalizePublicHttpsUrl,
  assertAllowedPublicEndpoints,
  PUBLIC_POLICY_SNAPSHOT,
  PUBLIC_POLICY_TABLE_DIGEST,
};
