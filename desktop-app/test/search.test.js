const test = require('node:test');
const assert = require('node:assert/strict');

test('搜尋 URL 會以 HTTPS Google URL 保留完整查詢文字', () => {
  const { searchUrl } = require('../src/chat/search.js');
  const query = '桌寵 & api #問題';
  const url = new URL(searchUrl(query));

  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'www.google.com');
  assert.equal(url.pathname, '/search');
  assert.equal(url.searchParams.get('q'), query);
});

test('搜尋 URL 拒絕空白與超過輸入上限的查詢', () => {
  const { searchUrl } = require('../src/chat/search.js');

  assert.throws(() => searchUrl('  '));
  assert.doesNotThrow(() => searchUrl('x'.repeat(8000)));
  assert.throws(() => searchUrl('x'.repeat(8001)));
});

test('來源 URL 只接受無帳密的 HTTPS URL', () => {
  const { validateSourceUrl } = require('../src/chat/search.js');

  assert.equal(validateSourceUrl('HTTPS://Example.COM/guide?q=1'), 'https://example.com/guide?q=1');
  assert.throws(() => validateSourceUrl('http://example.com/guide'));
  assert.throws(() => validateSourceUrl('https://reader@example.com/guide'));
  assert.throws(() => validateSourceUrl('https://reader:secret@example.com/guide'));
  assert.throws(() => validateSourceUrl('javascript:alert(1)'));
  assert.throws(() => validateSourceUrl('file:///C:/secret'));
  assert.throws(() => validateSourceUrl('not a URL'));
});

test('瀏覽器搜尋只將固定產生的 URL 交給外部瀏覽器', async () => {
  const { openBrowserSearch, searchUrl } = require('../src/chat/search.js');
  const opened = [];

  await openBrowserSearch('桌寵 & api #問題', async (url) => { opened.push(url); });

  assert.deepEqual(opened, [searchUrl('桌寵 & api #問題')]);
});
