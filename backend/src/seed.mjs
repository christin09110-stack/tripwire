// Builds the stream: replayed history plus the live sandbox objects recorded in seed/live-manifest.json.
// Live objects are re-fetched from PayPal so the rows carry PayPal's own statuses, not the manifest's.
import { payoutRows, invoiceRow, captureRow, refundRow, disputeRow } from './ingest.mjs';
import { generateReplay } from './replay.mjs';
import { DATASET_IDS } from '../../shared/datasets.mjs';

export async function fetchLiveRows(pp, manifest, { log = () => {} } = {}) {
  const out = { payout_items: [], invoices: [], captures: [], refunds: [], disputes: [] };
  const owned = [];
  for (const b of manifest.payoutBatches) {
    const batch = await pp.getBatch(b.batchId);
    out.payout_items.push(...payoutRows(batch));
    owned.push({ id: b.batchId, kind: 'payout_batch' }, ...(batch.items || []).map((i) => ({ id: i.payout_item_id, kind: 'payout_item', batch: b.batchId })));
    log(`batch ${b.batchId}: ${batch.items.length} items`);
  }
  for (const i of manifest.invoices) {
    const inv = await pp.getInvoice(i.id);
    out.invoices.push(invoiceRow(inv));
    owned.push({ id: i.id, kind: 'invoice' });
  }
  for (const c of manifest.captures) {
    const cap = await pp.getCapture(c.captureId);
    const row = captureRow({ orderId: c.orderId, capture: { ...cap, custom_id: cap.custom_id || c.customId } });
    out.captures.push(row);
    owned.push({ id: c.captureId, kind: 'capture' }, { id: c.orderId, kind: 'order' });
    for (const r of c.refunds || []) {
      const ref = await pp.getRefund(r.refundId);
      out.refunds.push(refundRow({ refund: ref, captureId: c.captureId, reason: r.reason }));
      owned.push({ id: r.refundId, kind: 'refund', capture: c.captureId });
    }
  }
  log(`live: ${Object.entries(out).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  return { rows: out, owned };
}

/** Combine replay (before the first live event's day) with the live rows. */
export function combine(live, { days = 30, seed } = {}) {
  const firstLive = [...live.payout_items, ...live.captures].map((r) => r.ts).sort()[0];
  const endBefore = firstLive.slice(0, 10);
  const replay = generateReplay({ endBefore, days, seed });
  const rows = {};
  for (const d of DATASET_IDS) rows[d] = [...replay[d], ...(live[d] || [])];
  return { rows, endBefore };
}

export function headOf(rows) {
  let h = '';
  for (const d of DATASET_IDS) for (const r of rows[d]) if (r.ts > h) h = r.ts;
  return h;
}
