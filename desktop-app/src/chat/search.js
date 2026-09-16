const MAX_MODEL_QUERY_LENGTH = 300;

function queryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeSearchQuery(value) {
  if (typeof value !== 'string' || !value.trim()) throw queryError('empty', '請輸入搜尋文字。');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw queryError('needs-user', '搜尋文字格式不安全。');
  const query = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (query.length > MAX_MODEL_QUERY_LENGTH) throw queryError('needs-user', '搜尋文字超過安全上限。');
  if (/(?:api[ _-]?key|password|token|secret|金鑰|密碼|權杖)|(?:file:|[a-z]:[\\/])/i.test(query)) {
    throw queryError('needs-user', '搜尋文字可能包含敏感資料。');
  }
  if (/(?:%[0-9a-f]{2}){8,}/i.test(query)) throw queryError('needs-user', '搜尋文字格式不安全。');
  return query;
}

function searchUrl(query) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('請輸入搜尋文字。');
  if (query.length > 8000) throw new Error('搜尋文字最多 8,000 個字元。');
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query);
  return url.toString();
}

function validateSourceUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('來源網址無效。'); }
  if (url.protocol !== 'https:') throw new Error('來源網址必須使用 HTTPS。');
  if (url.username || url.password) throw new Error('來源網址不可包含帳號或密碼。');
  return url.toString();
}

async function openBrowserSearch(query, openExternal) {
  await openExternal(searchUrl(query));
}

module.exports = { MAX_MODEL_QUERY_LENGTH, normalizeSearchQuery, searchUrl, validateSourceUrl, openBrowserSearch };
