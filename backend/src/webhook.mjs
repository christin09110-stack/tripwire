// Webhook intake. PayPal webhooks are per app, so this endpoint also receives events that do not belong to this same
// app. Everything gets a 200 immediately; the event is persisted raw, then (asynchronously) filtered to our own resource
// ids, verified with PayPal's verify-webhook-signature endpoint, and only then ingested.
import { payoutRows, invoiceRow, captureRow, disputeRow } from './ingest.mjs';
import { DATASET_IDS } from '../../shared/datasets.mjs';

const H = (headers, k) => headers[k] ?? headers[k.toLowerCase()];

export function intake({ headers, body, now = () => new Date().toISOString() }) {
  const id = H(headers, 'paypal-transmission-id') || `local-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    rec: {
      receivedAt: now(), status: 'received', body,
      headers: {
        auth_algo: H(headers, 'paypal-auth-algo'), cert_url: H(headers, 'paypal-cert-url'), transmission_id: H(headers, 'paypal-transmission-id'),
        transmission_sig: H(headers, 'paypal-transmission-sig'), transmission_time: H(headers, 'paypal-transmission-time'),
      },
    },
  };
}

/** Every PayPal id an event mentions, so ownership can be tested without knowing the event's exact shape. */
export function resourceIds(event) {
  const r = event?.resource || {};
  const ids = [r.id, r.payout_batch_id, r.payout_item_id, r.batch_header?.payout_batch_id, r.invoice?.id, r.dispute_id, r.supplementary_data?.related_ids?.order_id, r.parent_payment]
    .filter((x) => typeof x === 'string');
  for (const l of r.links || []) { const m = /\/(?:captures|refunds|payouts|payouts-item|invoices)\/([A-Za-z0-9-]+)/.exec(l.href || ''); if (m) ids.push(m[1]); }
  return [...new Set(ids)];
}

export async function verifySignature({ pp, headers, event, webhookId }) {
  const r = await pp.verifyWebhook({ ...headers, webhook_id: webhookId, webhook_event: event });
  return r.verification_status === 'SUCCESS';
}

/**
 * Process one stored delivery. Returns the final status: ignored (not ours), rejected (signature failed), processed.
 * deps: { store, pp, webhookId, head() }
 */
export async function processWebhook(id, { store, pp, webhookId, requestScan }) {
  const rec = await store.getWebhook(id);
  if (!rec) return 'missing';
  let event;
  try { event = JSON.parse(rec.body); } catch { await store.patchWebhook(id, { status: 'rejected', note: 'Body is not JSON.' }); return 'rejected'; }
  const eventType = event.event_type || 'unknown';
  const ids = resourceIds(event);
  let ours = eventType.startsWith('CUSTOMER.DISPUTE');
  for (const x of ids) if (!ours && (await store.isOwned(x))) ours = true;
  if (!ours) { await store.patchWebhook(id, { status: 'ignored', eventType, note: 'Not one of this app\'s resources.' }); return 'ignored'; }

  const valid = await verifySignature({ pp, headers: rec.headers, event, webhookId });
  if (!valid) { await store.patchWebhook(id, { status: 'rejected', eventType, note: 'PayPal reported the signature as FAILURE.' }); return 'rejected'; }

  const head = (await store.getMeta('asOf')) || undefined;
  const r = event.resource || {};
  const touched = { payout_items: [], invoices: [], captures: [], disputes: [] };
  if (eventType.startsWith('PAYMENT.PAYOUTSBATCH') || eventType.startsWith('PAYMENT.PAYOUTS-ITEM')) {
    const batchId = r.batch_header?.payout_batch_id || r.payout_batch_id;
    if (batchId) { const batch = await pp.getBatch(batchId); const existing = new Map((await store.getRows('payout_items')).map((x) => [x.id, x])); touched.payout_items = payoutRows(batch, { head }).map((x) => (existing.has(x.id) ? { ...x, ts: existing.get(x.id).ts, day: existing.get(x.id).day } : x)); }
  } else if (eventType.startsWith('INVOICING.INVOICE')) {
    const invId = r.invoice?.id || r.id;
    if (invId) { const inv = await pp.getInvoice(invId); const row = invoiceRow(inv, { head }); const prev = await store.getRow('invoices', invId); touched.invoices = [prev ? { ...row, ts: prev.ts, day: prev.day } : row]; }
  } else if (eventType.startsWith('PAYMENT.CAPTURE')) {
    const prev = r.id ? await store.getRow('captures', r.id) : null;
    if (prev) { const cap = await pp.getCapture(r.id); touched.captures = [{ ...prev, status: cap.status }]; }
  } else if (eventType.startsWith('CUSTOMER.DISPUTE')) {
    const did = r.dispute_id; if (did) touched.disputes = [disputeRow(r, { head })];
  }
  let n = 0, newHead = head || '';
  for (const d of DATASET_IDS) if (touched[d]?.length) { await store.putRows(d, touched[d]); n += touched[d].length; for (const x of touched[d]) if (x.ts > newHead) newHead = x.ts; }
  if (newHead && newHead !== head) await store.putMeta('asOf', newHead);
  await store.patchWebhook(id, { status: 'processed', eventType, upserted: n });
  if (n) await requestScan?.('webhook');
  return 'processed';
}
