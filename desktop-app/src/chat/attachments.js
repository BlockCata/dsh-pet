const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIME_EXTENSIONS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const MAX_COUNT = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

function attachmentError(message) { throw new Error(message); }
function petDirectory(root, petId) {
  if (typeof petId !== 'string' || !petId || petId.length > 200) attachmentError('桌寵識別碼無效。');
  return path.join(root, crypto.createHash('sha256').update(petId).digest('hex'));
}

function createAttachmentStore({ directory }) {
  const root = path.join(directory, 'attachments');
  const transient = new Map();
  function transientFor(petId) {
    let entries = transient.get(petId);
    if (!entries) { entries = new Map(); transient.set(petId, entries); }
    return entries;
  }
  function stage(petId, items, { persist = true } = {}) {
    if (!Array.isArray(items) || !items.length) return [];
    if (items.length > MAX_COUNT) attachmentError('最多附加 3 張圖片。');
    let total = 0;
    const prepared = items.map((item) => {
      if (!Object.hasOwn(MIME_EXTENSIONS, item?.mimeType)) attachmentError('附件只支援 PNG、JPEG 或 WebP 圖片。');
      if (!Buffer.isBuffer(item.bytes)) attachmentError('圖片資料無效。');
      if (item.bytes.length > MAX_FILE_BYTES) attachmentError('單張圖片不得超過 5 MiB。');
      total += item.bytes.length;
      const name = typeof item.name === 'string' && item.name.trim() ? path.basename(item.name.trim()).slice(0, 160) : `image${MIME_EXTENSIONS[item.mimeType]}`;
      return { name, mimeType: item.mimeType, bytes: item.bytes };
    });
    if (total > MAX_TOTAL_BYTES) attachmentError('圖片合計不得超過 10 MiB。');
    return prepared.map(({ name, mimeType, bytes }) => {
      const id = crypto.randomUUID();
      if (!persist) {
        transientFor(petId).set(id, bytes);
        return { id, name, mimeType, byteLength: bytes.length };
      }
      const target = petDirectory(root, petId);
      fs.mkdirSync(target, { recursive: true });
      const file = `${crypto.randomUUID()}${MIME_EXTENSIONS[mimeType]}`;
      fs.writeFileSync(path.join(target, file), bytes, { flag: 'wx' });
      return { id, name, mimeType, byteLength: bytes.length, file };
    });
  }
  function read(petId, attachment) {
    if (!attachment) attachmentError('找不到附件。');
    const temporary = transient.get(petId)?.get(attachment.id);
    if (temporary) return Buffer.from(temporary);
    if (typeof attachment.file !== 'string' || path.basename(attachment.file) !== attachment.file) attachmentError('找不到附件。');
    const target = path.join(petDirectory(root, petId), attachment.file);
    if (!fs.existsSync(target)) attachmentError('找不到附件。');
    return fs.readFileSync(target);
  }
  function removePet(petId) {
    transient.delete(petId);
    const target = petDirectory(root, petId);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
  function discard(petId, attachments) {
    const ids = new Set((attachments || []).map((attachment) => attachment?.id).filter((id) => typeof id === 'string'));
    const files = new Set((attachments || []).map((attachment) => attachment?.file).filter((file) => typeof file === 'string' && path.basename(file) === file));
    const temporary = transient.get(petId);
    if (temporary) {
      for (const id of ids) temporary.delete(id);
      if (!temporary.size) transient.delete(petId);
    }
    const target = petDirectory(root, petId);
    for (const file of files) {
      const entry = path.join(target, file);
      if (fs.existsSync(entry)) fs.rmSync(entry, { force: true });
    }
  }
  function prune(petId, attachments) {
    const kept = new Set((attachments || []).map((attachment) => attachment?.file).filter((file) => typeof file === 'string' && path.basename(file) === file));
    const keptIds = new Set((attachments || []).map((attachment) => attachment?.id).filter((id) => typeof id === 'string'));
    const temporary = transient.get(petId);
    if (temporary) {
      for (const id of temporary.keys()) if (!keptIds.has(id)) temporary.delete(id);
      if (!temporary.size) transient.delete(petId);
    }
    const target = petDirectory(root, petId);
    if (!fs.existsSync(target)) return;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.isFile() && !kept.has(entry.name)) fs.rmSync(path.join(target, entry.name), { force: true });
    }
  }
  return { stage, read, removePet, discard, prune };
}

module.exports = { createAttachmentStore, MAX_COUNT, MAX_FILE_BYTES, MAX_TOTAL_BYTES };
