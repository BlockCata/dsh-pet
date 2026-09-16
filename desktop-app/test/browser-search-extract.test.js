const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { extractSearchResults, extractPage, validateSearchResultUrl } = require('../src/browser-search/extract');

function textNode(text) {
  return { innerText: text, textContent: text };
}

test('extractSearchResults keeps unique HTTPS result links with normalized title and snippet', () => {
  const nodes = [
    {
      href: 'https://public.site/news#top',
      innerText: '範例大學  最新公告',
      querySelector: (selector) => selector === 'h3' ? textNode(' 範例大學 ') : null,
    },
    {
      href: 'https://public.site/news',
      innerText: '重複結果',
      querySelector: () => textNode('重複結果'),
    },
    {
      href: 'javascript:alert(1)',
      innerText: '不安全連結',
      querySelector: () => textNode('不安全連結'),
    },
  ];
  const document = { querySelectorAll: (selector) => selector === 'a:has(h3)' ? nodes : [] };

  assert.deepEqual(extractSearchResults(document, 'https://www.google.com/search?q=example'), [
    {
      title: '範例大學',
      url: 'https://public.site/news',
      snippet: '範例大學 最新公告',
    },
  ]);
});

test('extractPage selects readable main text, normalizes whitespace, and limits the returned text', () => {
  const document = {
    title: '  校園公告  ',
    querySelector: (selector) => {
      assert.equal(selector, 'main, article, body');
      return textNode(' 第一段\n\n第二段   第三段 ');
    },
  };

  assert.deepEqual(extractPage(document, 10), { title: '校園公告', text: '第一段 第二段 第三' });
});

test('extractors return no untrusted data when the expected document surface is absent', () => {
  assert.deepEqual(extractSearchResults(null, 'https://www.google.com/search'), []);
  assert.deepEqual(extractPage({ title: '空白', querySelector: () => null }), { title: '空白', text: '' });
});

test('the legacy extractor is not part of the production browser-search data path', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, '../src/browser-search/service.js'), 'utf8');
  assert.equal(serviceSource.includes("require('./extract.js')"), false);
  assert.equal(serviceSource.includes('validateSearchResultUrl'), false);
});

test('an extracted candidate remains validated by the legacy helper when used directly', async () => {
  const document = {
    querySelectorAll: () => [{
      href: 'https://public.site/news',
      innerText: '範例大學 公告',
      querySelector: () => textNode('範例大學'),
    }],
  };
  const [candidate] = extractSearchResults(document, 'https://www.google.com/search?q=example');

  await assert.rejects(
    () => validateSearchResultUrl(candidate, async () => ['::1']),
    /不允許的位址/,
  );
  assert.deepEqual(
    await validateSearchResultUrl(candidate, async (host) => {
      assert.equal(host, 'public.site');
      return ['93.184.216.34'];
    }),
    { url: 'https://public.site/news', addresses: ['93.184.216.34'] },
  );
});
