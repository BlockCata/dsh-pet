const test = require('node:test');
const assert = require('node:assert/strict');

test('主動關心在隨機約十五分鐘後送一次，等待回覆才排下一次', () => {
  const { createCareController } = require('../src/chat/care.js');
  const timers = [];
  const deliveries = [];
  const care = createCareController({
    random: () => 0.5,
    setTimeout: (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { timer.cleared = true; },
    deliver: (petId) => deliveries.push(petId),
  });

  care.sync('pet-a', { enabled: true, visible: true });
  assert.equal(timers[0].delay, 15 * 60 * 1000);
  timers[0].callback();
  assert.deepEqual(deliveries, ['pet-a']);
  assert.equal(timers.length, 1);

  care.acknowledge('pet-a');
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 15 * 60 * 1000);
});

test('關閉、隱藏或移除桌寵會取消尚未送出的主動關心', () => {
  const { createCareController } = require('../src/chat/care.js');
  const timers = [];
  const care = createCareController({
    setTimeout: (callback) => { const timer = { callback, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { timer.cleared = true; },
    deliver: () => assert.fail('不應送出'),
  });

  care.sync('pet-a', { enabled: true, visible: true });
  care.sync('pet-a', { enabled: false, visible: true });
  assert.equal(timers[0].cleared, true);
  care.sync('pet-b', { enabled: true, visible: true });
  care.dispose('pet-b');
  assert.equal(timers[1].cleared, true);
});

test('收合選擇暫時不回覆會停止主動關心，直到使用者下次聊天才重新計時', () => {
  const { createCareController } = require('../src/chat/care.js');
  const timers = [];
  const care = createCareController({
    setTimeout: (callback) => { const timer = { callback, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { timer.cleared = true; },
  });

  care.sync('pet-a', { enabled: true, visible: true });
  care.pause('pet-a');
  assert.equal(timers[0].cleared, true);
  care.acknowledge('pet-a');
  assert.equal(timers.length, 2);
});
