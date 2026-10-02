import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../src/handler.mjs';
import { BedrockUnavailable } from '../src/bedrock.mjs';
import { existingBatchId, isDuplicateRequestId } from '../src/paypal.mjs';
import { memStore, scriptedBedrock, say } from './helpers.mjs';

async function app(over = {}) {
  const store = await memStore();
  const invoked = [];
  const a = makeApp({ store, invoke: async (p) => { invoked.push(p); }, pp: () => over.pp, bedrock: over.bedrock ?? scriptedBedrock([say('hi')]), model: 'm', webhookId: 'W', ...over.deps });
  return { a, store, invoked };
}
const req = (method, path, body, headers = {}) => ({ method, path, body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body), headers, query: {} });

test('health and board answer', async () => {
  const { a } = await app();
  assert.equal((await a.route(req('GET', '/api/health'))).status, 200);
  const b = JSON.parse((await a.route(req('GET', '/api/board'))).body);
  assert.deepEqual(Object.keys(b).sort(), ['asOf', 'findings', 'model', 'runs', 'widgets']);
});

test('webhook returns 200 immediately and hands the work to an async invocation', async () => {
  const { a, store, invoked } = await app();
  const t0 = Date.now();
  const res = await a.route(req('POST', '/api/webhook', '{"event_type":"X","resource":{}}', { 'paypal-transmission-id': 'tx-9' }));
  assert.equal(res.status, 200);
  assert.ok(Date.now() - t0 < 200);
  assert.deepEqual(invoked, [{ op: 'webhook', id: 'tx-9' }]);
  assert.equal((await store.getWebhook('tx-9')).status, 'received');
});

test('scan is rate limited per hour and queues an async run', async () => {
  const { a, invoked } = await app();
  let last;
  for (let i = 0; i < 9; i++) last = await a.route(req('POST', '/api/scan', {}));
  assert.equal(last.status, 429);
  assert.equal(invoked.filter((x) => x.op === 'scan').length, 8);
  assert.match(JSON.parse(last.body).message, /Too many scan requests/);
});

test('finding status can be set, and unknown values and ids are refused', async () => {
  const { a, store } = await app();
  await store.putFinding({ id: 'fd-x', status: 'open', title: 't' });
  assert.equal((await a.route(req('POST', '/api/findings/fd-x/status', { status: 'reviewed' }))).status, 200);
  assert.equal((await store.getFinding('fd-x')).status, 'reviewed');
  assert.equal((await a.route(req('POST', '/api/findings/fd-x/status', { status: 'nope' }))).status, 400);
  assert.equal((await a.route(req('POST', '/api/findings/zzz/status', { status: 'open' }))).status, 404);
});

test('chat-built widgets pass through the same validators as the watcher', async () => {
  const { a, store } = await app();
  await store.putFinding({ id: 'fd-refund', status: 'open', title: 't' });
  const bad = await a.route(req('POST', '/api/widgets', { findingId: 'fd-refund', type: 'tw-grid', spec: { dataset: 'refunds', columns: ['id', 'nope'] } }));
  assert.equal(bad.status, 422); assert.match(JSON.parse(bad.body).message, /not a field of refunds/);
  const empty = await a.route(req('POST', '/api/widgets', { findingId: 'fd-refund', type: 'tw-breakdown', spec: { dataset: 'refunds', by: 'reason', where: { item: 'nothing' } } }));
  assert.equal(empty.status, 422); assert.match(JSON.parse(empty.body).message, /would be empty/);
  const ok = await a.route(req('POST', '/api/widgets', { findingId: 'fd-refund', type: 'tw-breakdown', spec: { dataset: 'refunds', by: 'reason', title: 'By reason' } }));
  assert.equal(ok.status, 201);
  assert.equal((await store.listWidgets())[0].author, 'chat');
  assert.equal((await a.route(req('POST', '/api/widgets', { findingId: 'missing', type: 'tw-trend', spec: {} }))).status, 404);
});

test('the Bedrock proxy relays Converse output, and says so plainly when the model is rate limited', async () => {
  const { a } = await app();
  const ok = await a.route(req('POST', '/api/llm', { messages: [{ role: 'user', content: [{ text: 'hello' }] }] }));
  assert.equal(ok.status, 200); assert.equal(JSON.parse(ok.body).message.content[0].text, 'hi');
  const { a: b } = await app({ bedrock: scriptedBedrock(() => new BedrockUnavailable('x', { attempts: 7 })) });
  const down = await b.route(req('POST', '/api/llm', { messages: [{ role: 'user', content: [{ text: 'hello' }] }] }));
  assert.equal(down.status, 503); assert.match(JSON.parse(down.body).message, /rate limited/);
  assert.equal((await b.route(req('POST', '/api/llm', { messages: [] }))).status, 400);
});

test('unknown routes 404 with a message that says what was asked for', async () => {
  const { a } = await app();
  const r = await a.route(req('GET', '/api/nope'));
  assert.equal(r.status, 404); assert.match(JSON.parse(r.body).message, /GET \/api\/nope/);
});

test('idempotency: a duplicate sender_batch_id is adopted as the same batch, and duplicate request ids count as success', async () => {
  const dup = { status: 400, name: 'USER_BUSINESS_ERROR', details: [{ issue: 'Batch with given sender_batch_id already exists', link: [{ href: 'https://api.sandbox.paypal.com/v1/payments/payouts/B-ORIG-1' }] }] };
  assert.equal(existingBatchId(dup), 'B-ORIG-1');
  assert.ok(isDuplicateRequestId({ status: 409 }));
  assert.ok(!isDuplicateRequestId({ status: 500 }));
});

test('activity: the payout is created with an idempotent batch id, polled to terminal, rows land in the stream, a scan is queued', async () => {
  const created = [];
  let polls = 0;
  const pp = {
    createPayout: async (body, rid) => { created.push({ body, rid }); return { batch_header: { payout_batch_id: 'B-ACT-1' } }; },
    getBatch: async () => { polls++; const done = polls >= 2; return { batch_header: { payout_batch_id: 'B-ACT-1', batch_status: done ? 'SUCCESS' : 'PROCESSING', time_created: '2026-10-02T03:40:00Z' }, items: [
      { payout_item_id: 'I1', payout_batch_id: 'B-ACT-1', transaction_status: done ? 'SUCCESS' : 'PENDING', time_processed: '2026-10-02T03:40:20Z', payout_item: { receiver: 'sb-patient@personal.example.com', amount: { value: '45.00', currency: 'USD' }, note: 'tw:x', sender_item_id: 'a' } },
      { payout_item_id: 'I2', payout_batch_id: 'B-ACT-1', transaction_status: done ? 'UNCLAIMED' : 'PENDING', errors: done ? { name: 'RECEIVER_UNREGISTERED' } : undefined, time_processed: '2026-10-02T03:40:20Z', payout_item: { receiver: 'new@x.example', amount: { value: '130.00', currency: 'USD' }, note: 'tw:y', sender_item_id: 'b' } }] }; },
  };
  const { a, store, invoked } = await app({ pp });
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => realSetTimeout(fn, 0);
  try { await a.runActivity({ activityId: 'a-test-1', preset: 'mixed' }); } finally { global.setTimeout = realSetTimeout; }
  assert.equal(created.length, 1);
  assert.equal(created[0].rid, created[0].body.sender_batch_header.sender_batch_id);
  assert.equal((await store.getMeta('activity#a-test-1')).status, 'done');
  assert.equal((await store.getRow('payout_items', 'I2')).status, 'UNCLAIMED');
  assert.ok(await store.isOwned('B-ACT-1')); assert.ok(await store.isOwned('I1'));
  assert.ok(invoked.some((x) => x.op === 'scan' && x.trigger === 'activity'));
});
