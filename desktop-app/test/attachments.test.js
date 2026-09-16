const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-attachments-'));
  return { directory, png: { name: 'photo.png', mimeType: 'image/png', bytes: Buffer.from([137, 80, 78, 71]) } };
}

test('只暫存使用者明確提供的 PNG、JPEG、WebP 圖片，並回傳不含內容的持久化中繼資料', () => {
  const { createAttachmentStore } = require('../src/chat/attachments.js');
  const { directory, png } = fixture();
  const store = createAttachmentStore({ directory });
  const attachments = store.stage('pet-a', [png]);
  assert.deepEqual(attachments.map(({ name, mimeType, byteLength, file }) => ({ name, mimeType, byteLength, file })), [{ name: 'photo.png', mimeType: 'image/png', byteLength: 4, file: attachments[0].file }]);
  assert.equal(Object.hasOwn(attachments[0], 'bytes'), false);
  assert.deepEqual(store.read('pet-a', attachments[0]), png.bytes);
});

test('圖片附件拒絕非圖片、超過三張、單張五 MiB 或合計十 MiB', () => {
  const { createAttachmentStore } = require('../src/chat/attachments.js');
  const { directory, png } = fixture();
  const store = createAttachmentStore({ directory });
  assert.throws(() => store.stage('pet-a', [{ ...png, mimeType: 'text/plain' }]), /PNG、JPEG 或 WebP/);
  assert.throws(() => store.stage('pet-a', Array.from({ length: 4 }, () => png)), /最多附加 3 張/);
  assert.throws(() => store.stage('pet-a', [{ ...png, bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }]), /不得超過 5 MiB/);
  assert.throws(() => store.stage('pet-a', Array.from({ length: 3 }, () => ({ ...png, bytes: Buffer.alloc(4 * 1024 * 1024) }))), /合計不得超過 10 MiB/);
});

test('清除或移除桌寵只刪除該桌寵管理的附件', () => {
  const { createAttachmentStore } = require('../src/chat/attachments.js');
  const { directory, png } = fixture();
  const store = createAttachmentStore({ directory });
  const a = store.stage('pet-a', [png])[0];
  const b = store.stage('pet-b', [png])[0];
  store.removePet('pet-a');
  assert.throws(() => store.read('pet-a', a), /找不到附件/);
  assert.deepEqual(store.read('pet-b', b), png.bytes);
});

test('關閉保存時附件只保留在記憶體，且可移除不再被訊息參照的檔案', () => {
  const { createAttachmentStore } = require('../src/chat/attachments.js');
  const { directory, png } = fixture();
  const store = createAttachmentStore({ directory });
  const transient = store.stage('pet-a', [png], { persist: false })[0];
  assert.equal(fs.existsSync(path.join(directory, 'attachments')), false);
  const saved = store.stage('pet-a', [png])[0];
  assert.equal(Object.hasOwn(transient, 'file'), false);
  assert.deepEqual(store.read('pet-a', transient), png.bytes);
  store.prune('pet-a', [transient]);
  assert.throws(() => store.read('pet-a', saved), /找不到附件/);
  assert.deepEqual(store.read('pet-a', transient), png.bytes);
});

test('只丟棄指定的未保存附件，不會裁剪同一隻桌寵其他請求的附件', () => {
  const { createAttachmentStore } = require('../src/chat/attachments.js');
  const { directory, png } = fixture();
  const store = createAttachmentStore({ directory });
  const oldAttachment = store.stage('pet-a', [{ ...png, name: 'old.png' }], { persist: false })[0];
  const newAttachment = store.stage('pet-a', [{ ...png, name: 'new.png' }], { persist: false })[0];
  store.discard('pet-a', [oldAttachment]);
  assert.throws(() => store.read('pet-a', oldAttachment), /找不到附件/);
  assert.deepEqual(store.read('pet-a', newAttachment), png.bytes);
});
