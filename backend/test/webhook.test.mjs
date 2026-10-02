import test from 'node:test';
import assert from 'node:assert/strict';
import { intake, processWebhook, resourceIds } from '../src/webhook.mjs';
import { memStore } from './helpers.mjs';

const headers = { 'paypal-transmission-id': 'tx-1', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/cert', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2026-10-02T04:00:00Z' };
const itemEvent = (batch = 'BATCH1', amount = '10.00') => ({ id: 'WH-1', event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { payout_item_id: 'ITEM1', payout_batch_id: batch, transaction_status: 'SUCCESS', payout_item: { amount: { value: amount, currency: 'USD' } } } });
const batchGet = { batch_header: { payout_batch_id: 'BATCH1', batch_status: 'SUCCESS', time_created: '2026-10-02T03:31:00Z' }, items: [{ payout_item_id: 'ITEM1', payout_batch_id: 'BATCH1', transaction_status: 'SUCCESS', time_processed: '2026-10-02T03:31:30Z', payout_item: { receiver: 'a@b.example', amount: { value: '10.00', currency: 'USD' }, note: 'tw:test', sender_item_id: 's' } }] };

function fakePp({ verdict = 'SUCCESS' } = {}) {
  const seen = [];
  return { seen, verifyWebhook: async (b) => { seen.push(b); return { verification_status: typeof verdict === 'function' ? verdict(b) : verdict }; }, getBatch: async () => batchGet };
}

test('intake keeps the PayPal signature headers and the untouched body for later verification', () => {
  const body = JSON.stringify(itemEvent());
  const { id, rec } = intake({ headers, body });
  assert.equal(id, 'tx-1'); assert.equal(rec.body, body); assert.equal(rec.headers.transmission_sig, 'sig'); assert.equal(rec.status, 'received');
});

test('resourceIds collects ids from payout, invoice and capture shaped events', () => {
  assert.deepEqual(resourceIds(itemEvent()).sort(), ['BATCH1', 'ITEM1']);
  assert.ok(resourceIds({ resource: { id: 'C1', links: [{ href: 'https://x/v2/payments/captures/C1' }] } }).includes('C1'));
});

test('an event for another project on the same PayPal app is acknowledged and ignored, with no verify call', async () => {
  const store = await memStore();
  const { id, rec } = intake({ headers, body: JSON.stringify(itemEvent('OTHER-PROJECT-BATCH')) });
  await store.putWebhook(id, rec);
  const pp = fakePp();
  assert.equal(await processWebhook(id, { store, pp, webhookId: 'WH' }), 'ignored');
  assert.equal(pp.seen.length, 0);
  assert.equal((await store.getWebhook(id)).status, 'ignored');
});

test('our event is verified with PayPal, then ingested, and the stream head moves', async () => {
  const store = await memStore();
  await store.markOwned('BATCH1', { kind: 'payout_batch' });
  const { id, rec } = intake({ headers, body: JSON.stringify(itemEvent()) });
  await store.putWebhook(id, rec);
  const pp = fakePp();
  let scans = 0;
  assert.equal(await processWebhook(id, { store, pp, webhookId: 'WH-ID', requestScan: async () => { scans++; } }), 'processed');
  assert.equal(pp.seen[0].webhook_id, 'WH-ID'); assert.equal(pp.seen[0].transmission_sig, 'sig'); assert.equal(pp.seen[0].webhook_event.event_type, 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED');
  assert.equal((await store.getRow('payout_items', 'ITEM1')).status, 'SUCCESS');
  assert.equal(scans, 1);
  assert.equal(await store.getMeta('asOf'), '2026-10-02T03:31:30Z');
});

test('a tampered payload is rejected: PayPal says FAILURE, nothing is ingested', async () => {
  const store = await memStore();
  await store.markOwned('BATCH1', { kind: 'payout_batch' });
  const original = JSON.stringify(itemEvent('BATCH1', '10.00'));
  // PayPal verifies against the signature of the original body; this fake mimics that by comparing the event it is given.
  const pp = fakePp({ verdict: (b) => (JSON.stringify(b.webhook_event) === original ? 'SUCCESS' : 'FAILURE') });
  const good = intake({ headers, body: original });
  await store.putWebhook('good', good.rec);
  assert.equal(await processWebhook('good', { store, pp, webhookId: 'W' }), 'processed');
  const tampered = intake({ headers: { ...headers, 'paypal-transmission-id': 'tx-2' }, body: JSON.stringify(itemEvent('BATCH1', '9999.00')) });
  await store.putWebhook('bad', tampered.rec);
  const before = (await store.getRows('payout_items')).length;
  assert.equal(await processWebhook('bad', { store, pp, webhookId: 'W' }), 'rejected');
  assert.equal((await store.getWebhook('bad')).status, 'rejected');
  assert.equal((await store.getRows('payout_items')).length, before);
});

test('a body that is not JSON is rejected without calling PayPal', async () => {
  const store = await memStore();
  const { id, rec } = intake({ headers, body: '{not json' });
  await store.putWebhook(id, rec);
  const pp = fakePp();
  assert.equal(await processWebhook(id, { store, pp, webhookId: 'W' }), 'rejected');
  assert.equal(pp.seen.length, 0);
});
