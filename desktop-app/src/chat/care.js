const MIN_DELAY_MS = 10 * 60 * 1000;
const MAX_DELAY_MS = 20 * 60 * 1000;

function createCareController({ random = Math.random, setTimeout: schedule = setTimeout, clearTimeout: cancel = clearTimeout, deliver = () => {} } = {}) {
  const records = new Map();

  function stop(record) {
    if (record.timer) cancel(record.timer);
    record.timer = null;
  }

  function scheduleNext(petId, record) {
    if (!record.enabled || !record.visible || record.awaitingReply || record.timer) return;
    const delay = Math.round(MIN_DELAY_MS + (MAX_DELAY_MS - MIN_DELAY_MS) * random());
    record.timer = schedule(() => {
      record.timer = null;
      if (!record.enabled || !record.visible || record.awaitingReply) return;
      record.awaitingReply = true;
      deliver(petId);
    }, delay);
  }

  function sync(petId, { enabled, visible }) {
    let record = records.get(petId);
    if (!record) { record = { enabled: false, visible: false, awaitingReply: false, timer: null }; records.set(petId, record); }
    record.enabled = enabled === true;
    record.visible = visible === true;
    if (!record.enabled || !record.visible) stop(record);
    scheduleNext(petId, record);
  }

  function acknowledge(petId) {
    const record = records.get(petId);
    if (!record || !record.awaitingReply) return;
    record.awaitingReply = false;
    scheduleNext(petId, record);
  }

  function pause(petId) {
    const record = records.get(petId);
    if (!record) return;
    stop(record);
    record.awaitingReply = true;
  }

  function dispose(petId) {
    const record = records.get(petId);
    if (record) stop(record);
    records.delete(petId);
  }

  return { sync, acknowledge, pause, dispose };
}

module.exports = { MIN_DELAY_MS, MAX_DELAY_MS, createCareController };
