function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractSearchResults(document, baseUrl) {
  if (!document?.querySelectorAll) return [];

  const results = [];
  const seen = new Set();
  for (const link of document.querySelectorAll('a:has(h3)')) {
    const heading = link.querySelector?.('h3');
    const title = normalizeText(heading?.innerText || heading?.textContent);
    const snippet = normalizeText(link.innerText || link.textContent);
    let url;
    try {
      url = new URL(link.href, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.username || url.password || !title) continue;
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    results.push({ title, url: url.href, snippet });
  }
  return results;
}

function extractPage(document, maxChars = 6_000) {
  const title = normalizeText(document?.title);
  const content = document?.querySelector?.('main, article, body');
  return { title, text: normalizeText(content?.innerText || content?.textContent).slice(0, maxChars) };
}

// Extracted URLs are untrusted candidates. This is the only Task 2 bridge from
// a parsed result to a navigation-ready, DNS-validated public URL.
function validateSearchResultUrl(candidate, resolveHost) {
  if (!candidate || typeof candidate.url !== 'string') throw new Error('搜尋結果網址無效。');
  return validatePublicUrl(candidate.url, resolveHost);
}

module.exports = { extractSearchResults, extractPage, validateSearchResultUrl };
const { validatePublicUrl } = require('./policy');
