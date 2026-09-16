const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`cipher:${value}`, 'utf8'),
    decryptString: (value) => {
      const decoded = value.toString('utf8');
      if (!decoded.startsWith('cipher:')) throw new Error('invalid ciphertext');
      return decoded.slice('cipher:'.length);
    },
  };
}

function createStore(directory, safeStorage = fakeSafeStorage()) {
  return require('../src/ai/config-store.js').createConfigStore({ directory, safeStorage });
}

test('API 金鑰只由主程序連線設定讀取，不會寫入公開設定或既有桌寵設定', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-ai-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secret = 'fixture-secret-never-log';
  const settingsFile = path.join(directory, 'settings.json');
  fs.writeFileSync(settingsFile, '{"version":1,"pets":[]}\n');
  const originalSettings = fs.readFileSync(settingsFile);
  const store = createStore(directory);

  store.save({ provider: 'gemini', model: 'gemini-2.5-flash-lite', key: secret });

  assert.deepEqual(store.getConnection(), {
    provider: 'gemini', model: 'gemini-2.5-flash-lite', key: secret,
  });
  assert.deepEqual(store.getPublic(), {
    provider: 'gemini',
    model: 'gemini-2.5-flash-lite',
    providers: {
      gemini: { hasKey: true, model: 'gemini-2.5-flash-lite' },
      openai: { hasKey: false, model: '' },
      deepseek: { hasKey: false, model: '' },
      custom: { hasKey: false, model: '', baseUrl: '' },
    },
  });
  const configText = fs.readFileSync(path.join(directory, 'ai-settings.json'), 'utf8');
  assert.equal(configText.includes(secret), false);
  assert.equal(JSON.stringify(store.getPublic()).includes(secret), false);
  assert.deepEqual(fs.readFileSync(settingsFile), originalSettings);

  const reloaded = createStore(directory);
  assert.deepEqual(reloaded.getConnection(), {
    provider: 'gemini', model: 'gemini-2.5-flash-lite', key: secret,
  });
});

test('切換服務時保留各服務金鑰，清除只移除指定服務金鑰', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-ai-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);

  store.save({ provider: 'gemini', model: 'gemini-2.5-flash-lite', key: 'gemini-key' });
  store.save({ provider: 'deepseek', model: 'deepseek-v4-flash', key: 'deepseek-key' });
  store.save({ provider: 'gemini', model: 'gemini-2.5-flash-lite' });

  assert.equal(store.getConnection().key, 'gemini-key');
  store.removeKey('gemini');
  assert.throws(() => store.getConnection(), /尚未設定 API 金鑰/);
  store.save({ provider: 'deepseek', model: 'deepseek-v4-flash' });
  assert.deepEqual(store.getConnection(), {
    provider: 'deepseek', model: 'deepseek-v4-flash', key: 'deepseek-key',
  });
});

test('無法使用系統加密時拒絕保存金鑰，且不建立明文設定檔', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-ai-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory, fakeSafeStorage(false));

  assert.throws(() => store.save({ provider: 'openai', model: 'gpt-fixture', key: 'must-not-write' }), /系統加密/);
  assert.equal(fs.existsSync(path.join(directory, 'ai-settings.json')), false);
});

test('自訂 iAI 相容服務保存獨立金鑰，標準化 v1 基底網址且切換網址時不重用金鑰', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-ai-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);

  store.save({ provider: 'custom', model: 'Furen-large', baseUrl: 'https://custom-provider.test/aihub/v1/', key: 'iai-fixture-key' });
  assert.deepEqual(store.getConnection(), {
    provider: 'custom', model: 'Furen-large', baseUrl: 'https://custom-provider.test/aihub/v1', key: 'iai-fixture-key',
  });
  assert.deepEqual(store.getPublic().providers.custom, {
    hasKey: true, model: 'Furen-large', baseUrl: 'https://custom-provider.test/aihub/v1',
  });

  store.save({ provider: 'custom', model: 'Other-model', baseUrl: 'https://example.test/api' });
  assert.equal(store.getPublic().providers.custom.hasKey, false);
  assert.throws(() => store.getConnection(), /尚未設定 API 金鑰/);
  assert.equal(fs.readFileSync(path.join(directory, 'ai-settings.json'), 'utf8').includes('iai-fixture-key'), false);
});

test('既有三服務設定升級後保留原金鑰，新增自訂服務欄位', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-ai-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'ai-settings.json'), JSON.stringify({
    version: 1, provider: 'gemini', providers: {
      gemini: { model: 'gemini-legacy', keyCiphertext: Buffer.from('cipher:legacy-key').toString('base64') },
      openai: { model: '', keyCiphertext: null }, deepseek: { model: '', keyCiphertext: null },
    },
  }));

  const store = createStore(directory);
  assert.equal(store.getConnection().key, 'legacy-key');
  assert.deepEqual(store.getPublic().providers.custom, { hasKey: false, model: '', baseUrl: '' });
  store.save({ provider: 'gemini', model: 'gemini-legacy' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'ai-settings.json'), 'utf8')).version, 2);
});
