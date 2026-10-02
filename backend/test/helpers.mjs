import { generateReplay } from '../src/replay.mjs';
import { prepare, DATASET_IDS } from '../../shared/datasets.mjs';
import { makeStore, memoryPrimitives } from '../src/store.mjs';

export const ASOF = '2026-10-02T03:30:00Z';

/** 30 days of replay plus a planted live-like morning: refunds on annual-plan/app, undelivered payouts to one recipient, overdue invoices. */
export function rowsWithAnomalies({ planted = true } = {}) {
  const rows = generateReplay({ endBefore: '2026-10-02' });
  if (!planted) { rows.disputes = rows.disputes.filter((d) => d.day < '2026-09-26'); return rows; }
  const mk = (i, item, channel) => ({ id: `LV-CAP-${i}`, order_id: `LV-ORD-${i}`, status: 'COMPLETED', amount: item === 'annual-plan' ? 89 : 30, currency: 'USD', channel, item, payer: 'buyer-x', origin: 'sandbox', ts: `2026-10-02T03:${10 + i}:00Z`, day: '2026-10-02' });
  for (let i = 0; i < 9; i++) rows.captures.push(mk(i, 'annual-plan', 'app'));
  for (let i = 9; i < 18; i++) rows.captures.push(mk(i, 'starter-pack', 'web'));
  for (let i = 0; i < 7; i++) rows.refunds.push({ id: `LV-REF-${i}`, capture_id: `LV-CAP-${i}`, status: 'COMPLETED', amount: 89, currency: 'USD', reason: 'Charged twice', origin: 'sandbox', ts: `2026-10-02T03:${20 + i}:00Z`, day: '2026-10-02' });
  for (let i = 0; i < 6; i++) rows.payout_items.push({ id: `LV-PI-${i}`, batch_id: `LV-B-${i % 4}`, batch_status: 'SUCCESS', status: 'UNCLAIMED', reason: 'RECEIVER_UNREGISTERED', recipient: 'accounts@nordhaven-logistics.example', recipient_domain: 'nordhaven-logistics.example', payee: 'nordhaven', amount: 300, currency: 'USD', fee: 1, note: '', origin: 'sandbox', ts: `2026-10-02T03:0${i}:00Z`, day: '2026-10-02' });
  const inv = (i, daysAgo, amount) => ({ id: `LV-INV-${i}`, number: `LV-${i}`, status: 'UNPAID', recipient: `Customer ${i}`, amount, currency: 'USD', terms: 'NET_30', invoice_date: '2026-07-01', due_date: new Date(Date.parse('2026-10-02') - daysAgo * 86400000).toISOString().slice(0, 10), paid_ts: null, origin: 'sandbox', ts: '2026-07-01T10:00:00Z', day: '2026-07-01' });
  rows.invoices.push(inv(1, 45, 1800), inv(2, 38, 1450), inv(3, 33, 900), inv(4, 52, 700));
  return rows;
}

export const prepared = (opts) => prepare(rowsWithAnomalies(opts), ASOF);

export async function memStore(rows = rowsWithAnomalies()) {
  const store = makeStore(memoryPrimitives());
  for (const d of DATASET_IDS) await store.putRows(d, rows[d] || []);
  await store.putMeta('asOf', ASOF);
  return store;
}

/** A Converse-shaped fake that plays back scripted assistant messages. */
export function scriptedBedrock(script) {
  let i = 0;
  const calls = [];
  return {
    model: 'scripted', calls,
    async converse(req) {
      calls.push(JSON.parse(JSON.stringify(req)));
      const next = typeof script === 'function' ? script(req, i) : script[i];
      i++;
      if (next instanceof Error) throw next;
      return { message: next, stopReason: next.content.some((b) => b.toolUse) ? 'tool_use' : 'end_turn', usage: { inputTokens: 100, outputTokens: 50 }, attempts: 1, waitedMs: 0 };
    },
  };
}
export const use = (name, input, id = `t-${Math.random().toString(36).slice(2, 7)}`) => ({ toolUse: { toolUseId: id, name, input } });
export const say = (text) => ({ role: 'assistant', content: [{ text }] });
export const call = (...blocks) => ({ role: 'assistant', content: blocks });
