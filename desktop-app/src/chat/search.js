const MAX_MODEL_QUERY_LENGTH = 300;

const SENSITIVE_QUERY_PATTERNS = [
  /(?:api[ _-]?key|password|token|secret|金鑰|密碼|權杖)\s*(?:[:=：]|\b)/i,
  /(?:^|[\s"'=:(])(?:file:|[a-z]:[\\/]|\\\\|~[\\/]|%userprofile%|%appdata%|\$env:[a-z_]+)(?:[^\s]*)/i,
  /(?:^|[\s"'=:(])\/(?!\/)(?:[^\/\s]+\/)+[^\/\s]*/,
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/i,
  /(?:phone|mobile|tel|電話|手機|聯絡電話)\s*[:：-]?\s*\+?[\d][\d\s().-]{6,}[\d]/i,
  /(?:^|[^\d])(?:\+?886[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{3}|09\d{2}[\s-]?\d{3}[\s-]?\d{3})(?:$|[^\d])/,
  /(?:信用卡|卡號|credit\s*card|card\s*(?:number|no\.?))\s*[:：-]?\s*(?:\d[ -]?){13,19}\d/i,
  /(?:身分證|身份證|national\s*id|ssn|social\s*security|護照|passport)\s*[:：-]?\s*[a-z0-9-]{4,}/i,
  /(?:帳號|賬號|銀行帳號|bank\s*account|account\s*(?:number|no\.?))\s*[:：=#-]?\s*[a-z0-9][a-z0-9._-]{3,}/i,
  /(?:^|[^\w])(?:[a-z]\d{9}|\d{3}-\d{2}-\d{4})(?:$|[^\w])/i,
  /(?:authorization\s*:\s*bearer|bearer\s+[a-z0-9._~+/=-]{12,})/i,
  /(?:sk-[a-z0-9]{16,}|gh[pousr]_[a-z0-9_]{20,}|AIza[a-z0-9_-]{20,}|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/i,
];

function queryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalizeSearchQuery(value) {
  if (typeof value !== 'string' || !value.trim()) throw queryError('empty', '請輸入搜尋文字。');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw queryError('needs-user', '搜尋文字格式不安全。');
  const query = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (query.length > MAX_MODEL_QUERY_LENGTH) throw queryError('needs-user', '搜尋文字超過安全上限。');
  if (/(?:%[0-9a-f]{2}){8,}/i.test(query)) throw queryError('needs-user', '搜尋文字格式不安全。');
  return query;
}

function isSensitiveSearchQuery(value) {
  let query;
  try { query = canonicalizeSearchQuery(value); }
  catch { return false; }
  return SENSITIVE_QUERY_PATTERNS.some((pattern) => pattern.test(query));
}

function normalizeSearchQuery(value) {
  const query = canonicalizeSearchQuery(value);
  if (isSensitiveSearchQuery(query)) throw queryError('needs-user', '搜尋文字可能包含敏感資料。');
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

module.exports = { MAX_MODEL_QUERY_LENGTH, canonicalizeSearchQuery, isSensitiveSearchQuery, normalizeSearchQuery, searchUrl, validateSourceUrl, openBrowserSearch };
