const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const displays = [
  { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 },
  { id: 2, workArea: { x: -1280, y: -100, width: 1280, height: 984 }, scaleFactor: 1.5 },
];
function modules() {
  assert.ok(fs.existsSync(path.join(__dirname, '../src/layout.js')), '需新增可驗證的螢幕座標邏輯');
  return { ...require('../src/layout.js'), ...require('../src/settings-store.js') };
}

test('依比例縮放視窗，負座標螢幕角落定位不重複乘上 DPI', () => {
  const { petDimensions, anchoredPosition } = modules();
  assert.deepEqual(petDimensions(150), { width: 630, height: 450 });
  assert.deepEqual(anchoredPosition(displays[1].workArea, 100, 'bottom-right'), { x: -452, y: 552 });
});

test('拖曳可跨接縫與負座標，不被原螢幕邊界攔截', () => {
  const { dragPosition } = modules();
  assert.deepEqual(dragPosition({ x: -30, y: 200 }, { x: 210, y: 150 }), { x: -240, y: 50 });
  assert.deepEqual(dragPosition({ x: 1960, y: -80 }, { x: 210, y: 150 }), { x: 1750, y: -230 });
});

test('已移除螢幕的桌寵回到現有螢幕，接縫上的有效位置保留', () => {
  const { recoverPet } = modules();
  const pet = { id: 'a', size: 100, x: -600, y: 200, displayId: 2, visible: true, roaming: true };
  const recovered = recoverPet(pet, [displays[0]]);
  assert.equal(recovered.displayId, 1);
  assert.ok(recovered.x >= 0 && recovered.x < 1500);
  assert.equal(recoverPet({ ...pet, x: -210 }, displays).x, -210);
});

test('多隻與零隻設定可儲存還原；不接受重複 ID、非法數值及錯誤布林', (t) => {
  const { loadSettings, saveSettings, validateSettings } = modules();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-settings-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  assert.equal(loadSettings(file), null);
  const pet = { id: 'a', size: 100, x: -500, y: 200, displayId: 2, visible: true, roaming: false };
  const state = { version: 1, pets: [pet, { ...pet, id: 'b', size: 150 }] };
  saveSettings(file, state);
  assert.deepEqual(loadSettings(file), { version: 1, searchBudget: { maxSearches: 2, maxCandidatePages: 3, maxExcerptChars: 18000, timeoutMs: 45000 }, pets: state.pets.map((item) => ({
    ...item, name: '小女僕', profile: { role: '', personality: '', speakingStyle: '' }, chatSize: { width: 380, height: 320 }, chatOffset: { x: 0, y: -80 }, ambientReactions: true, careEnabled: false, webQueryEnabled: false,
  })) });
  for (const invalid of [{ size: 0 }, { x: NaN }, { visible: 'false' }]) {
    assert.throws(() => validateSettings({ version: 1, pets: [{ ...pet, ...invalid }] }));
  }
  assert.throws(() => validateSettings({ version: 1, pets: [pet, pet] }));
  saveSettings(file, { version: 1, pets: [] });
  assert.deepEqual(loadSettings(file), { version: 1, searchBudget: { maxSearches: 2, maxCandidatePages: 3, maxExcerptChars: 18000, timeoutMs: 45000 }, pets: [] });
});

test('可保存永遠置頂與左右漫遊範圍，且拒絕無效範圍', () => {
  const { validateSettings } = modules();
  const pet = { id: 'a', size: 100, x: 0, y: 0, displayId: 1, visible: true, roaming: true,
    alwaysOnTop: false, roamingRange: { left: 15, right: 85 } };
  assert.deepEqual(validateSettings({ version: 1, pets: [pet] }).pets[0], {
    ...pet, name: '小女僕', profile: { role: '', personality: '', speakingStyle: '' }, chatSize: { width: 380, height: 320 }, chatOffset: { x: 0, y: -80 }, ambientReactions: true, careEnabled: false, webQueryEnabled: false,
  });
  for (const roamingRange of [{ left: -1, right: 80 }, { left: 80, right: 80 }, { left: 20, right: 101 }]) {
    assert.throws(() => validateSettings({ version: 1, pets: [{ ...pet, roamingRange }] }));
  }
  assert.throws(() => validateSettings({ version: 1, pets: [{ ...pet, alwaysOnTop: 'false' }] }));
});

test('桌寵名稱與角色設定檔會保存，舊設定補上預設值', () => {
  const { validateSettings } = modules();
  const pet = { id: 'a', size: 100, x: 0, y: 0, displayId: 1, visible: true, roaming: true };
  const defaulted = validateSettings({ version: 1, pets: [pet] }).pets[0];
  assert.deepEqual(defaulted.profile, { role: '', personality: '', speakingStyle: '' });
  assert.equal(defaulted.name, '小女僕');
  const custom = validateSettings({ version: 1, pets: [{ ...pet, name: '夏奈', profile: {
    role: '藍髮女僕', personality: '細心、活潑', speakingStyle: '使用繁體中文簡短回應',
  } }] }).pets[0];
  assert.deepEqual(custom, { ...pet, name: '夏奈', profile: {
    role: '藍髮女僕', personality: '細心、活潑', speakingStyle: '使用繁體中文簡短回應',
  }, chatSize: { width: 380, height: 320 }, chatOffset: { x: 0, y: -80 }, ambientReactions: true, careEnabled: false, webQueryEnabled: false });
  assert.throws(() => validateSettings({ version: 1, pets: [{ ...pet, name: '   ' }] }), /名稱/);
});

test('聊天泡泡尺寸會保存並限制在可用範圍', () => {
  const { validateSettings } = modules();
  const pet = { id: 'a', size: 100, x: 0, y: 0, displayId: 1, visible: true, roaming: true };
  assert.deepEqual(validateSettings({ version: 1, pets: [{ ...pet, chatSize: { width: 500, height: 440 } }] }).pets[0].chatSize, { width: 500, height: 440 });
  assert.deepEqual(validateSettings({ version: 1, pets: [pet] }).pets[0].chatSize, { width: 380, height: 320 });
  assert.throws(() => validateSettings({ version: 1, pets: [{ ...pet, chatSize: { width: 279, height: 220 } }] }), /聊天框/);
});

test('每隻桌寵預設允許依對話氣氛反應，且只接受布林設定', () => {
  const { validateSettings } = modules();
  const pet = { id: 'a', size: 100, x: 0, y: 0, displayId: 1, visible: true, roaming: true };
  assert.equal(validateSettings({ version: 1, pets: [pet] }).pets[0].ambientReactions, true);
  assert.equal(validateSettings({ version: 1, pets: [{ ...pet, ambientReactions: false }] }).pets[0].ambientReactions, false);
  assert.throws(() => validateSettings({ version: 1, pets: [{ ...pet, ambientReactions: 'false' }] }), /對話動作/);
});

test('每隻桌寵的主動關心預設關閉，且只接受布林設定', () => {
  const { validateSettings } = modules();
  const pet = { id: 'a', size: 100, x: 0, y: 0, displayId: 1, visible: true, roaming: true };
  assert.equal(validateSettings({ version: 1, pets: [pet] }).pets[0].careEnabled, false);
  assert.equal(validateSettings({ version: 1, pets: [{ ...pet, careEnabled: true }] }).pets[0].careEnabled, true);
  assert.throws(() => validateSettings({ version: 1, pets: [{ ...pet, careEnabled: 1 }] }), /主動關心/);
});

test('每隻桌寵的網頁查詢預設關閉，且只接受明確布林設定', () => {
  const { validateSettings } = modules();
  const pet = { id: 'a', size: 100, x: 0, y: 0, displayId: 1, visible: true, roaming: true };
  assert.equal(validateSettings({ version: 1, pets: [pet] }).pets[0].webQueryEnabled, false);
  assert.equal(validateSettings({ version: 1, pets: [{ ...pet, webQueryEnabled: true }] }).pets[0].webQueryEnabled, true);
  assert.throws(() => validateSettings({ version: 1, pets: [{ ...pet, webQueryEnabled: 'true' }] }), /網頁查詢/);
});

test('聊天泡泡位移可保存為每隻桌寵的整數 DIP 座標', () => {
  const { validateSettings } = modules();
  const pet = { id: 'a', size: 100, x: 0, y: 0, displayId: 1, visible: true, roaming: true };
  assert.deepEqual(validateSettings({ version: 1, pets: [pet] }).pets[0].chatOffset, { x: 0, y: -80 });
  assert.deepEqual(validateSettings({ version: 1, pets: [{ ...pet, chatOffset: { x: 80, y: -160 } }] }).pets[0].chatOffset, { x: 80, y: -160 });
  assert.throws(() => validateSettings({ version: 1, pets: [{ ...pet, chatOffset: { x: 1001, y: 0 } }] }), /聊天泡泡位移/);
});
