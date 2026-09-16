const fs = require('node:fs');
const path = require('node:path');
const { normalizeSearchBudget } = require('./browser-search/budget.js');

const DEFAULT_NAME = '小女僕';
const DEFAULT_PROFILE = { role: '', personality: '', speakingStyle: '' };
const DEFAULT_CHAT_SIZE = { width: 380, height: 320 };
const DEFAULT_CHAT_OFFSET = { x: 0, y: -80 };

function normalizedText(value, field, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim().length > 500) throw new Error(`${field}設定不正確。`);
  return value.trim();
}

function normalizeProfile(value) {
  if (value === undefined) return { ...DEFAULT_PROFILE };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('角色設定檔格式不正確。');
  return {
    role: normalizedText(value.role, '角色'),
    personality: normalizedText(value.personality, '個性'),
    speakingStyle: normalizedText(value.speakingStyle, '說話語氣'),
  };
}

function normalizeChatSize(value) {
  if (value === undefined) return { ...DEFAULT_CHAT_SIZE };
  if (!Number.isInteger(value?.width) || !Number.isInteger(value?.height)
    || value.width < 280 || value.width > 640 || value.height < 220 || value.height > 640) {
    throw new Error('聊天框尺寸必須介於 280–640 × 220–640。');
  }
  return { width: value.width, height: value.height };
}

function normalizeChatOffset(value) {
  if (value === undefined) return { ...DEFAULT_CHAT_OFFSET };
  if (!Number.isInteger(value?.x) || !Number.isInteger(value?.y) || Math.abs(value.x) > 1000 || Math.abs(value.y) > 1000) {
    throw new Error('聊天泡泡位移必須是 -1000–1000 的整數 DIP。');
  }
  return { x: value.x, y: value.y };
}

function validateSettings(value) {
  if (value?.version !== 1 || !Array.isArray(value.pets)) throw new Error('設定檔格式不正確。');
  const ids = new Set();
  const pets = value.pets.map((pet) => {
    if (typeof pet?.id !== 'string' || !pet.id || ids.has(pet.id)) throw new Error('桌寵識別碼無效或重複。');
    ids.add(pet.id);
    if (!Number.isFinite(pet.size) || pet.size < 50 || pet.size > 200) throw new Error('大小必須介於 50% 與 200%。');
    if (![pet.x, pet.y].every((position) => Number.isFinite(position) && Math.abs(position) <= 100000)) throw new Error('請輸入有效的桌面座標。');
    if (!Number.isInteger(pet.displayId) || typeof pet.visible !== 'boolean' || typeof pet.roaming !== 'boolean') throw new Error('螢幕或顯示／漫遊設定不正確。');
    if (pet.alwaysOnTop !== undefined && typeof pet.alwaysOnTop !== 'boolean') throw new Error('置頂設定不正確。');
    if (pet.ambientReactions !== undefined && typeof pet.ambientReactions !== 'boolean') throw new Error('對話動作設定不正確。');
    if (pet.careEnabled !== undefined && typeof pet.careEnabled !== 'boolean') throw new Error('主動關心設定不正確。');
    if (pet.webQueryEnabled !== undefined && typeof pet.webQueryEnabled !== 'boolean') throw new Error('網頁查詢設定不正確。');
    if (pet.roamingRange !== undefined) {
      const range = pet.roamingRange;
      if (![range?.left, range?.right].every((value) => Number.isFinite(value) && value >= 0 && value <= 100) || range.left >= range.right) {
        throw new Error('漫遊範圍必須是 0–100% 且左界小於右界。');
      }
    }
    const name = normalizedText(pet.name, '桌寵名稱', DEFAULT_NAME);
    if (!name) throw new Error('桌寵名稱不可為空白。');
    const normalized = {
      id: pet.id, name, profile: normalizeProfile(pet.profile), chatSize: normalizeChatSize(pet.chatSize), chatOffset: normalizeChatOffset(pet.chatOffset), size: pet.size, x: Math.round(pet.x), y: Math.round(pet.y), displayId: pet.displayId, visible: pet.visible, roaming: pet.roaming, ambientReactions: pet.ambientReactions !== false, careEnabled: pet.careEnabled === true, webQueryEnabled: pet.webQueryEnabled === true,
    };
    if (pet.alwaysOnTop !== undefined) normalized.alwaysOnTop = pet.alwaysOnTop;
    if (pet.roamingRange !== undefined) normalized.roamingRange = { left: Math.round(pet.roamingRange.left), right: Math.round(pet.roamingRange.right) };
    return normalized;
  });
  return { version: 1, pets, searchBudget: normalizeSearchBudget(value.searchBudget) };
}

function loadSettings(file) {
  try { return validateSettings(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function saveSettings(file, settings) {
  const value = validateSettings(settings);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

module.exports = { validateSettings, loadSettings, saveSettings };
