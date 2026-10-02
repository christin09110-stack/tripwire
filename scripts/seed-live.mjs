// Generates real sandbox activity for Tripwire. Idempotent + resumable via seed/live-manifest.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadEnv } from './env.mjs';
import { makePayPal, existingBatchId, isDuplicateInvoice, isDuplicateRequestId } from '../backend/src/paypal.mjs';
import { makeExtra } from './seed-extra.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const MANIFEST = join(root, 'seed', 'live-manifest.json');
const SUMMARY = join(root, 'seed', 'live-summary.txt');
mkdirSync(join(root, 'seed'), { recursive: true });
const e = loadEnv();
const base = makePayPal({ clientId: e.PAYPAL_CLIENT_ID, secret: e.PAYPAL_SECRET, api: e.PAYPAL_API });
const extra = makeExtra({ clientId: e.PAYPAL_CLIENT_ID, secret: e.PAYPAL_SECRET, api: e.PAYPAL_API });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pp = new Proxy(base, { get(t, k) { const v = t[k]; return typeof v === 'function' ? async (...a) => { await sleep(300); return v(...a); } : v; } });
const vault = readFileSync(resolve(root, '..', 'guarantee', '.deploy-state', 'vault-token-id'), 'utf8').trim();

const failures = [];
const M = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { createdAt: new Date().toISOString(), payoutBatches: [], invoices: [], captures: [], disputes: null };
const save = () => writeFileSync(MANIFEST, JSON.stringify(M, null, 2));
const fail = (where, err) => { const m = `${where}: ${err.message} ${JSON.stringify(err.details || err.body || '').slice(0, 300)}`; console.log('FAIL', m); failures.push(m); };

// ---------- 1. payouts ----------
const GOOD = 'sb-patient@personal.example.com';
const NORD = 'accounts@nordhaven-logistics.example';
const payees = ['harbor-goods', 'lumen-crafts', 'oakline-print', 'fernwood-tea', 'brightwave-audio', 'copperkettle', 'tidepool-toys', 'ridgeback-gear', 'saltmarsh-soap', 'paperkite-co', 'wildroot-farm', 'quillandink', 'stonebridge-wood'];
let seed = 20261002; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const amt = (lo, hi) => (lo + Math.floor(rnd() * (hi - lo)) + 0.5 * Math.round(rnd()) ).toFixed(2);
const special = {
  2: [[NORD, 'nordhaven-logistics', 'EMAIL', 212.5], [NORD, 'nordhaven-logistics', 'EMAIL', 340], ['billing@kestrel-freight.example', 'kestrel-freight', 'EMAIL', 96.25], ['ZZZZZZZZZZZZZ', 'unknown-id-a', 'PAYPAL_ID', 148]],
  3: [[NORD, 'nordhaven-logistics', 'EMAIL', 455.75], ['YYYYYYYYYYYYY', 'unknown-id-b', 'PAYPAL_ID', 77.5]],
  4: [[NORD, 'nordhaven-logistics', 'EMAIL', 180], [NORD, 'nordhaven-logistics', 'EMAIL', 289.4], ['pay@greywell-supply.example.org', 'greywell-supply', 'EMAIL', 310]],
  5: [[NORD, 'nordhaven-logistics', 'EMAIL', 398.9], ['ops@marlowe-and-sons.example', 'marlowe-and-sons', 'EMAIL', 58.75], ['XXXXXXXXXXXXX', 'unknown-id-c', 'PAYPAL_ID', 215]],
};
// batch 5 has a third bogus id above; spec wants exactly 2 PAYPAL_ID -> keep batch 5 with 3 specials only if count ok
special[5] = [[NORD, 'nordhaven-logistics', 'EMAIL', 398.9], ['ops@marlowe-and-sons.example', 'marlowe-and-sons', 'EMAIL', 58.75]];
const sizes = { 1: 10, 2: 12, 3: 11, 4: 12, 5: 13 };
const plans = [];
for (let b = 1; b <= 5; b++) {
  const items = []; let n = 1;
  for (const [receiver, label, type, a] of special[b] || []) items.push({ receiver, label, type, amount: a.toFixed(2) });
  while (items.length < sizes[b]) items.push({ receiver: GOOD, label: payees[(b * 3 + items.length) % payees.length], type: 'EMAIL', amount: amt(15, 470) });
  // deterministic interleave: rotate specials into the middle
  const sp = items.slice(0, (special[b] || []).length), rest = items.slice(sp.length);
  const mixed = []; sp.forEach((s, i) => { const at = Math.floor(((i + 1) * rest.length) / (sp.length + 1)); mixed.push([at, s]); });
  const out = [...rest]; mixed.reverse().forEach(([at, s]) => out.splice(at, 0, s));
  plans.push({ b, items: out.map((it, i) => ({ ...it, senderItemId: `p${b}-${i + 1}-${it.label}`.slice(0, 60) })) });
}

const TERMINAL = new Set(['SUCCESS', 'DENIED', 'CANCELED']);
function readBatch(g, plan, senderBatchId) {
  const labels = Object.fromEntries(plan.items.map((i) => [i.senderItemId, i.label]));
  return {
    batchId: g.batch_header.payout_batch_id, senderBatchId, label: `Tripwire seed payout batch ${plan.b}`,
    finalBatchStatus: g.batch_header.batch_status,
    items: (g.items || []).map((it) => ({
      payoutItemId: it.payout_item_id, senderItemId: it.payout_item?.sender_item_id, receiver: it.payout_item?.receiver,
      recipientType: it.payout_item?.recipient_type, amount: it.payout_item?.amount?.value, currency: it.payout_item?.amount?.currency,
      finalStatus: it.transaction_status, errorName: it.errors?.name || null,
      payeeLabel: labels[it.payout_item?.sender_item_id] || null, timeProcessed: it.time_processed || null,
    })),
  };
}
const settled = (g) => TERMINAL.has(g.batch_header.batch_status) && (g.items || []).length > 0 && !(g.items || []).some((i) => ['PENDING', 'PROCESSING', 'ONHOLD'].includes(i.transaction_status));

async function seedPayouts() {
  for (const plan of plans) {
    const senderBatchId = `tw-seed-v1-pay-${plan.b}`;
    if (M.payoutBatches.find((x) => x.senderBatchId === senderBatchId && x._done)) continue;
    try {
      let batchId = M.payoutBatches.find((x) => x.senderBatchId === senderBatchId)?.batchId;
      if (!batchId) {
        try {
          const r = await pp.createPayout({ sender_batch_header: { sender_batch_id: senderBatchId, email_subject: 'Tripwire seed payout', email_message: 'Sandbox seed' },
            items: plan.items.map((i) => ({ recipient_type: i.type, receiver: i.receiver, amount: { value: i.amount, currency: 'USD' }, note: `tw:${i.label}`, sender_item_id: i.senderItemId })) }, senderBatchId);
          batchId = r.batch_header.payout_batch_id;
        } catch (err) {
          batchId = existingBatchId(err);
          if (!batchId) throw err;
          console.log('batch exists', senderBatchId, batchId);
        }
        M.payoutBatches = M.payoutBatches.filter((x) => x.senderBatchId !== senderBatchId);
        M.payoutBatches.push({ batchId, senderBatchId, label: `Tripwire seed payout batch ${plan.b}`, finalBatchStatus: 'PENDING', items: [], _plan: plan.b });
        save(); console.log('created', senderBatchId, batchId);
      }
    } catch (err) { fail(`create payout ${plan.b}`, err); }
  }
  // poll
  const deadline = Date.now() + 180000;
  for (const entry of M.payoutBatches) {
    if (entry._done) continue;
    const plan = plans.find((p) => p.b === entry._plan || `tw-seed-v1-pay-${p.b}` === entry.senderBatchId);
    let last = null;
    while (Date.now() < deadline + 60000) {
      try {
        const g = await pp.getBatch(entry.batchId); last = g;
        if (settled(g)) break;
      } catch (err) { fail(`get batch ${entry.batchId}`, err); break; }
      await sleep(5000);
    }
    if (last) {
      const full = readBatch(last, plan, entry.senderBatchId);
      Object.assign(entry, full, { _done: settled(last) });
      save();
      console.log('polled', entry.senderBatchId, entry.finalBatchStatus, entry.items.length, 'items done=', entry._done);
    }
  }
}

// ---------- 2. invoices ----------
const isoDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const names = [['Marta', 'Okafor'], ['Dev', 'Lindqvist'], ['Priya', 'Castellanos'], ['Tomas', 'Brevik'], ['Aisha', 'Whitcombe'], ['Joon', 'Marchetti'], ['Elena', 'Duarte'], ['Sam', 'Hargreave'], ['Noor', 'Pellegrino'], ['Callum', 'Adeyemi'], ['Ines', 'Vandermeer'], ['Rafi', 'Koskinen'], ['Lucia', 'Thornbury'], ['Owen', 'Takahashi']];
// [dueDaysAgo (negative = in future), terms, amount, state]
const invPlan = [
  [3, 'NET_15', 240, 'overdue'], [6, 'NET_30', 120, 'overdue'], [12, 'NET_30', 560, 'overdue'], [20, 'NET_15', 385, 'overdue'],
  [28, 'NET_30', 910, 'overdue'], [38, 'NET_30', 1450, 'overdue'], [45, 'NET_30', 1800, 'overdue'], [33, 'NET_15', 675, 'overdue'],
  [-5, 'NET_15', 330, 'upcoming'], [-12, 'NET_30', 780, 'upcoming'], [-20, 'NET_30', 1150, 'upcoming'],
  [15, 'NET_30', 450, 'paid'], [-3, 'NET_15', 215, 'paid'], [10, 'NET_30', 600, 'cancelled'],
];
async function seedInvoices() {
  for (let i = 0; i < invPlan.length; i++) {
    const number = `TW-INV-${String(i + 1).padStart(3, '0')}`;
    const [dueAgo, terms, amount, state] = invPlan[i];
    let rec = M.invoices.find((x) => x.number === number);
    const value = amount.toFixed(2);
    const termDays = terms === 'NET_15' ? 15 : 30;
    const [given, sur] = names[i];
    const email = `${given.toLowerCase()}.${sur.toLowerCase()}@${i % 2 ? 'example.org' : 'example.com'}`;
    try {
      if (!rec) {
        let id;
        try {
          const inv = await pp.createInvoice({
            detail: { invoice_number: number, invoice_date: isoDaysAgo(dueAgo + termDays), currency_code: 'USD', note: `tw:${state}`, payment_term: { term_type: terms, due_date: isoDaysAgo(dueAgo) } },
            invoicer: { name: { business_name: 'Tripwire Test Co' }, email_address: 'sb-mixsn53098231@business.example.com' },
            primary_recipients: [{ billing_info: { email_address: email, name: { given_name: given, surname: sur } } }],
            items: [{ name: 'Marketplace services', description: `Services ${number}`, quantity: '1', unit_amount: { currency_code: 'USD', value } }],
          }, `tw-seed-v1-${number}`);
          id = (inv.href || '').split('/').pop();
        } catch (err) {
          if (isDuplicateInvoice(err) || isDuplicateRequestId(err)) {
            const s = await pp.searchInvoices({ invoice_number: number });
            id = s.items?.[0]?.id; if (!id) throw err;
          } else throw err;
        }
        rec = { id, number, status: 'DRAFT', invoiceDate: null, dueDate: null, amount: value, currency: 'USD', recipientEmail: email, terms, _state: state, _sent: false, _final: false };
        M.invoices.push(rec); save();
      }
      if (!rec._sent) {
        try { await pp.sendInvoice(rec.id); } catch (err) { if (!/ALREADY|INVALID_INVOICE_STATUS|STATUS/i.test(JSON.stringify(err.body || ''))) throw err; }
        rec._sent = true; save();
      }
      const cur = (await pp.getInvoice(rec.id)).status;
      if (state === 'paid' && !['PAID', 'MARKED_AS_PAID'].includes(cur)) { await extra.recordPayment(rec.id, value); }
      if (state === 'cancelled' && cur !== 'CANCELLED') { await extra.cancelInvoice(rec.id); }
      const g = await pp.getInvoice(rec.id);
      Object.assign(rec, { status: g.status, invoiceDate: g.detail?.invoice_date, dueDate: g.detail?.payment_term?.due_date, amount: g.amount?.value ?? value, _final: true });
      save(); console.log('invoice', number, rec.status, rec.invoiceDate, rec.dueDate, rec.amount);
    } catch (err) { fail(`invoice ${number}`, err); }
  }
}

// ---------- 3. captures + refunds ----------
const annual = [79, 84.5, 99, 89, 79, 92.25, 95, 85, 99];
const others = [
  ['web', 'starter-pack', 19, 'Starter pack'], ['pos', 'starter-pack', 24.5, 'Starter pack'], ['web', 'add-on-seats', 45, 'Extra seats add-on'],
  ['pos', 'add-on-seats', 38, 'Extra seats add-on'], ['web', 'support-hour', 120, 'Support hour'], ['pos', 'support-hour', 140, 'Support hour'],
  ['web', 'starter-pack', 9, 'Starter pack'], ['web', 'add-on-seats', 60, 'Extra seats add-on'], ['pos', 'support-hour', 72, 'Support hour'],
];
const orderPlan = [];
for (let i = 0; i < 9; i++) { orderPlan.push({ channel: 'app', item: 'annual-plan', amount: annual[i], desc: 'Annual plan renewal' }); if (others[i]) orderPlan.push({ channel: others[i][0], item: others[i][1], amount: others[i][2], desc: others[i][3] }); }
const reasons = ['Charged twice', 'Did not mean to renew', 'Price changed at renewal', 'Charged twice', 'Did not mean to renew', 'Price changed at renewal', 'Charged twice', 'Did not mean to renew'];
async function seedCaptures() {
  let annualIdx = 0, refundN = 0;
  for (let i = 0; i < orderPlan.length; i++) {
    const p = orderPlan[i]; const key = `tw-seed-v1-order-${i + 1}`;
    const value = p.amount.toFixed(2);
    const customId = `channel:${p.channel};item:${p.item}`;
    let rec = M.captures.find((x) => x._key === key);
    try {
      if (!rec) {
        const o = await pp.createOrder({ intent: 'CAPTURE', purchase_units: [{ custom_id: customId, description: p.desc, amount: { currency_code: 'USD', value } }],
          payment_source: { paypal: { vault_id: vault, stored_credential: { payment_initiator: 'MERCHANT', usage: 'SUBSEQUENT', usage_pattern: 'UNSCHEDULED_POSTPAID' } } } }, key);
        const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
        if (!cap) throw Object.assign(new Error(`order ${o.id} status ${o.status} had no capture`), { body: o });
        rec = { _key: key, orderId: o.id, captureId: cap.id, status: cap.status, amount: cap.amount?.value || value, currency: 'USD', customId, channel: p.channel, item: p.item, createTime: cap.create_time || o.create_time || null, refunds: [] };
        M.captures.push(rec); save(); console.log('order', key, o.id, cap.status);
      }
    } catch (err) { fail(`order ${key}`, err); continue; }
    // refund plan
    let want = null;
    if (p.item === 'annual-plan') { annualIdx++; if (annualIdx <= 8) want = { amount: value, reason: reasons[annualIdx - 1] }; }
    else if (p.item === 'support-hour' && p.amount === 120) want = { amount: (p.amount / 2).toFixed(2), reason: 'Partial credit for unused hours' };
    if (want && rec.refunds.length === 0) {
      refundN++;
      try {
        const r = await pp.refundCapture(rec.captureId, { amount: { currency_code: 'USD', value: want.amount }, note_to_payer: want.reason }, `tw-seed-v1-refund-${refundN}`);
        rec.refunds.push({ refundId: r.id, status: r.status, amount: want.amount, reason: want.reason }); save();
        console.log('refund', refundN, r.id, r.status);
      } catch (err) {
        if (isDuplicateRequestId(err)) { console.log('refund duplicate treated as success', refundN); }
        else fail(`refund ${refundN}`, err);
      }
    }
  }
}

// ---------- 4. disputes ----------
async function seedDisputes() {
  try { const d = await pp.listDisputes('?page_size=20'); M.disputes = { count: d.items?.length ?? 0 }; save(); console.log('disputes', M.disputes.count); }
  catch (err) { fail('disputes', err); M.disputes = M.disputes || { count: null }; }
}

const stage = process.argv[2] || 'all';
if (stage === 'all' || stage === 'payouts') await seedPayouts();
if (stage === 'all' || stage === 'invoices') await seedInvoices();
if (stage === 'all' || stage === 'captures') await seedCaptures();
if (stage === 'all' || stage === 'disputes') await seedDisputes();
M.failures = failures;
save();

// summary
const statusCounts = {}; for (const b of M.payoutBatches) for (const it of b.items) statusCounts[it.finalStatus] = (statusCounts[it.finalStatus] || 0) + 1;
const today = new Date().toISOString().slice(0, 10);
const overdue = M.invoices.filter((i) => ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(i.status) && i.dueDate && i.dueDate < today).length;
const refunded = M.captures.filter((c) => c.refunds.length).length;
const lines = [`Payout items by final status: ${JSON.stringify(statusCounts)} (total ${Object.values(statusCounts).reduce((a, b) => a + b, 0)})`,
  `Payout batches: ${M.payoutBatches.map((b) => `${b.senderBatchId}=${b.finalBatchStatus}/${b.items.length}`).join(', ')}`,
  `Invoices: ${M.invoices.length}; overdue (open, past due): ${overdue}; by status: ${JSON.stringify(M.invoices.reduce((a, i) => (a[i.status] = (a[i.status] || 0) + 1, a), {}))}`,
  `Captures: ${M.captures.length}; refunded: ${refunded}; refunds/captures ratio: ${(refunded / Math.max(1, M.captures.length)).toFixed(3)}`,
  `annual-plan/app captures: ${M.captures.filter((c) => c.item === 'annual-plan' && c.channel === 'app').length}, refunded ${M.captures.filter((c) => c.item === 'annual-plan' && c.refunds.length).length}`,
  `Disputes: ${M.disputes?.count}`, `Failures: ${failures.length}`, ...failures];
writeFileSync(SUMMARY, lines.join('\n') + '\n'); console.log(lines.join('\n'));
