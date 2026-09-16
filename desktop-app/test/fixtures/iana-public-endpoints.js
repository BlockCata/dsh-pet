'use strict';

const REVIEWED_POLICY_TABLE = Object.freeze({
  specialUseSuffixes: Object.freeze([
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
  ]),
  blockedIpv4: Object.freeze([
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.0.8', 32],
    ['192.0.0.170', 31], ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
  ]),
  blockedIpv6: Object.freeze([
    ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96],
    ['64:ff9b:1::', 48], ['100::', 64], ['100:0:0:1::', 64], ['2001::', 23],
    ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28], ['2001:db8::', 32],
    ['2002::', 16], ['3fff::', 20], ['5f00::', 16], ['fc00::', 7], ['fe80::', 10],
    ['ff00::', 8],
  ]),
});

// Human-reviewed fixed snapshot. Source pages were reviewed on 2026-09-15;
// source hashes are recorded here so updates require an explicit fixture review.
const IANA_SNAPSHOT = Object.freeze({
  reviewedAt: '2026-09-15',
  sourceHashBasis: 'UTF-8 bytes of the reviewed IANA CSV payloads',
  policyTableHash: 'sha256:3fc13dbb90c7ea58e327621740c2d88ca2bcdc0a8abbc516ab1d43b54333919d',
  policyTable: REVIEWED_POLICY_TABLE,
  sources: Object.freeze([
    Object.freeze({
      url: 'https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv',
      lastUpdated: '2025-10-09',
      sha256: 'e3e39e76d00b1677335db8e9a805c7b9480ea2f4dc9e33f0b93cd3a905128d73',
    }),
    Object.freeze({
      url: 'https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv',
      lastUpdated: '2025-10-09',
      sha256: '775feea0621dec8735a44fbf30f762e721e8f0a1b3ab7eb341961a88cfce2139',
    }),
    Object.freeze({
      url: 'https://www.iana.org/assignments/special-use-domain-names/special-use-domain.csv',
      lastUpdated: '2026-05-22',
      sha256: '74cee5aa529088b7540252e30ba4775f83202ccb3323a590789ce9dc9a53a3cd',
    }),
  ]),
});

const PUBLIC_ENDPOINT_CASES = Object.freeze([
  { name: 'ordinary IPv4', address: '93.184.216.34', family: 4, allowed: true },
  { name: 'this network', address: '0.0.0.1', family: 4, allowed: false },
  { name: 'private use', address: '10.0.0.1', family: 4, allowed: false },
  { name: 'shared address', address: '100.64.0.1', family: 4, allowed: false },
  { name: 'loopback', address: '127.0.0.1', family: 4, allowed: false },
  { name: 'link local', address: '169.254.1.1', family: 4, allowed: false },
  { name: 'private use 172', address: '172.16.0.1', family: 4, allowed: false },
  { name: 'private use 192', address: '192.168.0.1', family: 4, allowed: false },
  { name: 'documentation', address: '192.0.2.1', family: 4, allowed: false },
  { name: 'IETF aggregate unknown hole', address: '192.0.0.11', family: 4, allowed: false },
  { name: 'AS112-v4', address: '192.31.196.1', family: 4, allowed: false },
  { name: 'AMT special-use', address: '192.52.193.1', family: 4, allowed: false },
  { name: 'benchmark', address: '198.18.0.1', family: 4, allowed: false },
  { name: 'documentation 2', address: '198.51.100.1', family: 4, allowed: false },
  { name: 'documentation 3', address: '203.0.113.1', family: 4, allowed: false },
  { name: 'reserved', address: '240.0.0.1', family: 4, allowed: false },
  { name: 'ordinary IPv6', address: '2001:4860:4860::8888', family: 6, allowed: true },
  { name: 'unspecified', address: '::', family: 6, allowed: false },
  { name: 'loopback v6', address: '::1', family: 6, allowed: false },
  { name: 'mapped', address: '::ffff:7f00:1', family: 6, allowed: false },
  { name: 'NAT64', address: '64:ff9b::c000:201', family: 6, allowed: false },
  { name: 'NAT64 reserved', address: '64:ff9b:1::1', family: 6, allowed: false },
  { name: 'discard-only', address: '100::1', family: 6, allowed: false },
  { name: 'Teredo', address: '2001:0::1', family: 6, allowed: false },
  { name: 'IETF IPv6 aggregate unknown hole', address: '2001:5::1', family: 6, allowed: false },
  { name: '6to4', address: '2002:7f00:1::', family: 6, allowed: false },
  { name: 'documentation v6', address: '2001:db8::1', family: 6, allowed: false },
  { name: 'future documentation', address: '3fff::1', family: 6, allowed: false },
  { name: 'unique local', address: 'fd00::1', family: 6, allowed: false },
  { name: 'link local v6', address: 'fe80::1', family: 6, allowed: false },
  { name: 'multicast', address: 'ff02::1', family: 6, allowed: false },
]);

module.exports = { IANA_SNAPSHOT, PUBLIC_ENDPOINT_CASES };
