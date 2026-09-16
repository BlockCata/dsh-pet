const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebQueryCoordinator } = require('../src/browser-search/coordinator');
const { createWebQueryDiagnostics } = require('../src/browser-search/diagnostics');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function cancelled() {
  return { status: 'cancelled', sources: [] };
}

function createReader() {
  const starts = [];
  const pending = new Map();
  const cancelledRequests = [];
  const disposedPets = [];
  return {
    starts,
    cancelledRequests,
    disposedPets,
    reader: {
      search(request) {
        starts.push(request);
        const work = deferred();
        pending.set(request.requestId, work);
        return work.promise;
      },
      cancel(petId, requestId) { cancelledRequests.push({ petId, requestId }); },
      dispose(petId) { disposedPets.push(petId); return Promise.resolve(); },
    },
    finish(requestId, outcome = { status: 'empty', sources: [] }) { pending.get(requestId).resolve(outcome); },
  };
}

async function nextTurn() {
  await new Promise(setImmediate);
}

test('coordinator admits only one active request across pets and starts later requests in FIFO order', async () => {
  const fake = createReader();
  const coordinator = createWebQueryCoordinator({ reader: fake.reader });
  const first = coordinator.search({ petId: 'pet-a', requestId: 'a-1', query: 'first' });
  const second = coordinator.search({ petId: 'pet-b', requestId: 'b-1', query: 'second' });
  const third = coordinator.search({ petId: 'pet-c', requestId: 'c-1', query: 'third' });

  assert.deepEqual(fake.starts.map((request) => request.requestId), ['a-1']);
  fake.finish('a-1');
  await first;
  await nextTurn();
  assert.deepEqual(fake.starts.map((request) => request.requestId), ['a-1', 'b-1']);
  fake.finish('b-1');
  await second;
  await nextTurn();
  assert.deepEqual(fake.starts.map((request) => request.requestId), ['a-1', 'b-1', 'c-1']);
  fake.finish('c-1');
  await third;
});

test('coordinator permits ten queued requests then rejects the next request with a fixed code', async () => {
  const fake = createReader();
  const coordinator = createWebQueryCoordinator({ reader: fake.reader });
  const active = coordinator.search({ petId: 'active', requestId: 'active-1', query: 'active' });
  const queued = Array.from({ length: 10 }, (_, index) => coordinator.search({ petId: `pet-${index}`, requestId: `queued-${index}`, query: 'queued' }));

  await assert.rejects(
    coordinator.search({ petId: 'overflow', requestId: 'overflow-1', query: 'overflow' }),
    (error) => error?.code === 'web-query-queue-full',
  );
  assert.deepEqual(fake.starts.map((request) => request.requestId), ['active-1']);
  fake.finish('active-1');
  await active;
  for (let index = 0; index < queued.length; index += 1) {
    await nextTurn();
    fake.finish(`queued-${index}`);
    await queued[index];
  }
});

test('coordinator cancellation resolves active and queued requests as cancelled without late usable results', async () => {
  const fake = createReader();
  const coordinator = createWebQueryCoordinator({ reader: fake.reader });
  const active = coordinator.search({ petId: 'pet-a', requestId: 'a-1', query: 'active' });
  const queued = coordinator.search({ petId: 'pet-b', requestId: 'b-1', query: 'queued' });

  coordinator.cancel('pet-a', 'a-1');
  coordinator.cancel('pet-b', 'b-1');
  assert.deepEqual(await active, cancelled());
  assert.deepEqual(await queued, cancelled());
  assert.deepEqual(fake.cancelledRequests, [{ petId: 'pet-a', requestId: 'a-1' }]);
  fake.finish('a-1', { status: 'ok', sources: [{ text: 'late result' }] });
  await nextTurn();
  assert.deepEqual(fake.starts.map((request) => request.requestId), ['a-1']);
});

test('coordinator treats an already-aborted request signal as cancelled before admission', async () => {
  const fake = createReader();
  const coordinator = createWebQueryCoordinator({ reader: fake.reader });
  const controller = new AbortController();
  controller.abort();

  assert.deepEqual(await coordinator.search({ petId: 'pet-a', requestId: 'a-1', query: 'cancelled', signal: controller.signal }), cancelled());
  assert.deepEqual(fake.starts, []);
});

test('coordinator dispose cancels every request for one pet and waits for active reader cleanup before later admission', async () => {
  const fake = createReader();
  const coordinator = createWebQueryCoordinator({ reader: fake.reader });
  const active = coordinator.search({ petId: 'pet-a', requestId: 'a-1', query: 'active' });
  const queuedSamePet = coordinator.search({ petId: 'pet-a', requestId: 'a-2', query: 'queued' });
  const queuedOtherPet = coordinator.search({ petId: 'pet-b', requestId: 'b-1', query: 'other' });

  const disposal = coordinator.dispose('pet-a');
  assert.deepEqual(await active, cancelled());
  assert.deepEqual(await queuedSamePet, cancelled());
  assert.deepEqual(fake.disposedPets, ['pet-a']);
  assert.deepEqual(fake.starts.map((request) => request.requestId), ['a-1']);
  fake.finish('a-1');
  await disposal;
  await nextTurn();
  assert.deepEqual(fake.starts.map((request) => request.requestId), ['a-1', 'b-1']);
  fake.finish('b-1');
  await queuedOtherPet;
});

test('coordinator captures an immutable budget snapshot at admission and gives it to the reader', async () => {
  const fake = createReader();
  const liveBudget = { maxPages: 3, nested: { timeoutMs: 45_000 } };
  const coordinator = createWebQueryCoordinator({ reader: fake.reader, getBudget: () => liveBudget });
  const active = coordinator.search({ petId: 'pet-a', requestId: 'a-1', query: 'active' });
  const queued = coordinator.search({ petId: 'pet-b', requestId: 'b-1', query: 'queued' });
  liveBudget.maxPages = 99;
  liveBudget.nested.timeoutMs = 1;

  assert.deepEqual(fake.starts[0].budget, { maxPages: 3, nested: { timeoutMs: 45_000 } });
  assert.equal(Object.isFrozen(fake.starts[0].budget), true);
  assert.equal(Object.isFrozen(fake.starts[0].budget.nested), true);
  fake.finish('a-1');
  await active;
  await nextTurn();
  assert.deepEqual(fake.starts[1].budget, { maxPages: 3, nested: { timeoutMs: 45_000 } });
  fake.finish('b-1');
  await queued;
});

test('diagnostics retain only allowlisted terminal fields and evict by age and capacity', () => {
  let time = 0;
  const diagnostics = createWebQueryDiagnostics({ now: () => time, maxEvents: 2, retentionMs: 30 });
  diagnostics.record({ requestId: 'one', phase: 'completed', resultCode: 'ok', durationMs: 4, sourceCount: 1, query: 'private phrase', url: 'https://private.example/?key=secret', body: 'body', excerpt: 'excerpt', headers: { authorization: 'secret' }, petId: 'pet-a', error: new Error('secret message') });
  time = 20;
  diagnostics.record({ requestId: 'two', phase: 'completed', resultCode: 'cancelled', durationMs: 5, sourceCount: 0 });
  time = 40;
  diagnostics.record({ requestId: 'three', phase: 'unapproved-phase', resultCode: 'unapproved-code', durationMs: -1, sourceCount: -1 });
  diagnostics.record({ requestId: 'four', phase: 'completed', resultCode: 'ok', durationMs: 6, sourceCount: 99 });

  assert.deepEqual(diagnostics.read(), [
    { requestId: 'three', phase: 'completed', resultCode: 'blocked', durationMs: 0, sourceCount: 0 },
    { requestId: 'four', phase: 'completed', resultCode: 'ok', durationMs: 6, sourceCount: 3 },
  ]);
  assert.equal(JSON.stringify(diagnostics.read()).includes('secret'), false);
});
