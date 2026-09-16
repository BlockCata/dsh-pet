const fs = require('node:fs');
const path = require('node:path');

const PROVIDERS = ['gemini', 'openai', 'deepseek', 'custom'];
const VERSION = 2;

function invalid(message) { throw new Error(message); }

function emptyConfig() {
  return {
    version: VERSION,
    provider: 'gemini',
    providers: Object.fromEntries(PROVIDERS.map((provider) => [provider, { model: '', keyCiphertext: null, ...(provider === 'custom' ? { baseUrl: '' } : {}) }])),
  };
}

function normalizeBaseUrl(value, { required = false } = {}) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || !value.trim()) {
    if (required) invalid('請輸入自訂 API Base URL。');
    return '';
  }
  let url;
  try { url = new URL(value.trim()); }
  catch { invalid('自訂 API Base URL 無效。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) invalid('自訂 API Base URL 無效。');
  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/v1')) pathname += '/v1';
  return `${url.origin}${pathname}`;
}

function migrateConfig(value) {
  if (value?.version !== 1) return value;
  return {
    version: VERSION,
    provider: value.provider,
    providers: {
      ...value.providers,
      custom: { model: '', keyCiphertext: null, baseUrl: '' },
    },
  };
}

function validateConfig(value) {
  if (value?.version !== VERSION || !PROVIDERS.includes(value.provider) || typeof value.providers !== 'object') invalid('AI 設定檔格式不正確。');
  const providers = {};
  for (const provider of PROVIDERS) {
    const entry = value.providers[provider];
    if (!entry || typeof entry.model !== 'string' || typeof entry.keyCiphertext !== 'string' && entry.keyCiphertext !== null) invalid('AI 服務設定格式不正確。');
    providers[provider] = { model: entry.model, keyCiphertext: entry.keyCiphertext };
    if (provider === 'custom') providers[provider].baseUrl = normalizeBaseUrl(entry.baseUrl);
  }
  return { version: VERSION, provider: value.provider, providers };
}

function readConfig(file) {
  try { return validateConfig(migrateConfig(JSON.parse(fs.readFileSync(file, 'utf8')))); }
  catch (error) { if (error.code === 'ENOENT') return emptyConfig(); throw error; }
}

function writeConfig(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

function createConfigStore({ directory, safeStorage }) {
  if (typeof directory !== 'string' || !directory || !safeStorage) invalid('AI 設定儲存空間無效。');
  const file = path.join(directory, 'ai-settings.json');
  let config = readConfig(file);

  function publicConfig() {
    return {
      provider: config.provider,
      model: config.providers[config.provider].model,
      providers: Object.fromEntries(PROVIDERS.map((provider) => [provider, {
        hasKey: config.providers[provider].keyCiphertext !== null,
        model: config.providers[provider].model,
        ...(provider === 'custom' ? { baseUrl: config.providers[provider].baseUrl } : {}),
      }])),
    };
  }

  function save({ provider, model, key, baseUrl } = {}) {
    if (!PROVIDERS.includes(provider)) invalid('AI 服務無效。');
    if (typeof model !== 'string' || !model.trim()) invalid('請輸入模型名稱。');
    if (key !== undefined && (typeof key !== 'string' || !key.trim())) invalid('API 金鑰無效。');
    const next = validateConfig(structuredClone(config));
    next.provider = provider;
    next.providers[provider].model = model.trim();
    if (provider === 'custom') {
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl, { required: true });
      if (next.providers.custom.baseUrl && next.providers.custom.baseUrl !== normalizedBaseUrl && key === undefined) next.providers.custom.keyCiphertext = null;
      next.providers.custom.baseUrl = normalizedBaseUrl;
    }
    if (key !== undefined) {
      if (!safeStorage.isEncryptionAvailable()) invalid('系統加密無法使用，未保存 API 金鑰。');
      next.providers[provider].keyCiphertext = safeStorage.encryptString(key).toString('base64');
    }
    writeConfig(file, next);
    config = next;
    return publicConfig();
  }

  function removeKey(provider) {
    if (!PROVIDERS.includes(provider)) invalid('AI 服務無效。');
    const next = validateConfig(structuredClone(config));
    next.providers[provider].keyCiphertext = null;
    writeConfig(file, next);
    config = next;
    return publicConfig();
  }

  function getConnection() {
    const entry = config.providers[config.provider];
    if (!entry.keyCiphertext) invalid('尚未設定 API 金鑰。');
    if (!safeStorage.isEncryptionAvailable()) invalid('系統加密無法使用，無法讀取 API 金鑰。');
    return {
      provider: config.provider,
      model: entry.model,
      key: safeStorage.decryptString(Buffer.from(entry.keyCiphertext, 'base64')),
      ...(config.provider === 'custom' ? { baseUrl: entry.baseUrl } : {}),
    };
  }

  return { getPublic: publicConfig, save, removeKey, getConnection };
}

module.exports = { createConfigStore, normalizeBaseUrl };
