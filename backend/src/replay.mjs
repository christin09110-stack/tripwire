// Replayed history. PayPal's sandbox cannot be back-dated, so the 30 days before the live objects are generated here in
// PayPal's field shapes, deterministically, with ids prefixed RP- and origin "replay". The UI and README label them.
// Planted on top of a quiet baseline: nothing here is random enough to hide the patterns the detectors look for.
const DAY = 86400000;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function weighted(r, pairs) { let t = pairs.reduce((s, p) => s + p[1], 0), x = r() * t; for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; } return pairs[0][0]; }
function poisson(r, lambda) { const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
const money = (n) => Math.round(n * 100) / 100;
const isoAt = (dayMs, hour, r) => new Date(dayMs + hour * 3600000 + Math.floor(r() * 3600000)).toISOString().replace(/\.\d+Z$/, 'Z');
const hex = (r, n) => Array.from({ length: n }, () => '0123456789ABCDEF'[Math.floor(r() * 16)]).join('');

const ITEMS = [
  { slug: 'starter-pack', price: 29 }, { slug: 'add-on-seats', price: 15 }, { slug: 'support-hour', price: 60 }, { slug: 'annual-plan', price: 89 },
];
const PAYEES = [
  ['Kofi Mensah', 'kofi@mensah-studio.example'], ['Amara Osei', 'amara@osei-design.example'], ['Tomas Berg', 'tomas@bergworks.example'], ['Lena Fischer', 'lena@fischer-co.example'],
  ['Idris Bello', 'idris@bello-dev.example'], ['Priya Nair', 'priya@nair-labs.example'], ['Mateo Ruiz', 'mateo@ruiz-media.example'], ['Sana Qureshi', 'sana@qureshi-ops.example'],
  ['Jonas Aalto', 'jonas@aalto-freight.example'], ['Eun-ji Park', 'eunji@park-audio.example'], ['Nadia Haddad', 'nadia@haddad-legal.example'], ['Chidi Eze', 'chidi@eze-farms.example'],
];
const CUSTOMERS = ['Harbourlight Dental', 'Quill & Co', 'Redfern Bikes', 'Marlow Print', 'Ostrander Labs', 'Pinecrest Cafe', 'Tallis Audio', 'Brightwater Yoga', 'Kestrel Courier', 'Ivy Row Florists', 'Copperleaf Tax', 'Fenwick Tools'];
const REFUND_REASONS = ['Did not mean to renew', 'Charged twice', 'Wrong plan chosen', 'Found a cheaper option', 'Price changed at renewal', 'Item not needed'];
const DISPUTE_REASONS = ['ITEM_NOT_RECEIVED', 'UNAUTHORISED', 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 'DUPLICATE_TRANSACTION'];

/** endBefore: ISO date (YYYY-MM-DD). Generates [endBefore - days, endBefore). */
export function generateReplay({ endBefore, days = 30, seed = 20261002 } = {}) {
  const r = rng(seed);
  const end = Date.parse(endBefore + 'T00:00:00Z');
  const out = { payout_items: [], invoices: [], captures: [], refunds: [], disputes: [] };
  let capSeq = 0, refSeq = 0, payoutSeq = 0, invSeq = 0, disSeq = 0;

  for (let d = days; d >= 1; d--) {
    const dayMs = end - d * DAY;
    const dow = new Date(dayMs).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const dayLabel = new Date(dayMs).toISOString().slice(0, 10);

    // captures
    const nCap = poisson(r, weekend ? 17 : 26);
    for (let i = 0; i < nCap; i++) {
      const channel = weighted(r, [['web', 55], ['app', 30], ['pos', 15]]);
      const item = weighted(r, channel === 'pos' ? [['starter-pack', 4], ['support-hour', 3], ['add-on-seats', 2]] : [['starter-pack', 30], ['add-on-seats', 25], ['support-hour', 20], ['annual-plan', 25]]);
      const base = ITEMS.find((x) => x.slug === item).price;
      const amount = money(base * (0.9 + r() * 0.25));
      const ts = isoAt(dayMs, 6 + r() * 16, r);
      const id = `RP-CAP-${String(++capSeq).padStart(5, '0')}`;
      out.captures.push({ id, order_id: `RP-ORD-${hex(r, 10)}`, status: 'COMPLETED', amount, currency: 'USD', channel, item, payer: `buyer-${hex(r, 5).toLowerCase()}`, origin: 'replay', ts, day: ts.slice(0, 10) });
      // baseline refund rate about 3%; one known blip (web support-hour, 17 days ago) that was resolved
      let p = 0.03;
      if (d === 17 && channel === 'web' && item === 'support-hour') p = 0.4;
      if (r() < p) {
        const rts = new Date(Date.parse(ts) + (20 + r() * 2000) * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
        if (Date.parse(rts) < end) out.refunds.push({ id: `RP-REF-${String(++refSeq).padStart(5, '0')}`, capture_id: id, status: 'COMPLETED', amount: Math.min(amount, money(amount * (r() < 0.8 ? 1 : 0.5))), currency: 'USD', reason: pick(r, REFUND_REASONS), origin: 'replay', ts: rts, day: rts.slice(0, 10) });
      }
    }

    // payouts: one batch each weekday
    if (!weekend) {
      const n = 8 + Math.floor(r() * 7);
      const batchId = `RP-BATCH-${dayLabel.replaceAll('-', '')}`;
      for (let i = 0; i < n; i++) {
        const [payee, email] = pick(r, PAYEES);
        let status = 'SUCCESS', reason = null;
        const bad = r() < 0.035;
        if (bad) { status = r() < 0.7 ? 'UNCLAIMED' : 'FAILED'; reason = status === 'UNCLAIMED' ? 'RECEIVER_UNREGISTERED' : 'RECEIVER_ACCOUNT_INVALID'; }
        // a resolved blip: one payee failing twice 20 days ago
        if (d === 20 && i < 2) { status = 'UNCLAIMED'; reason = 'RECEIVER_UNREGISTERED'; }
        const amount = money(40 + r() * 460);
        const ts = isoAt(dayMs, 9, r);
        out.payout_items.push({ id: `RP-PI-${String(++payoutSeq).padStart(5, '0')}`, batch_id: batchId, batch_status: 'SUCCESS', status, reason, recipient: d === 20 && i < 2 ? 'old-ledger@brightpath.example' : email, recipient_domain: '', payee: d === 20 && i < 2 ? 'Brightpath Ledger' : payee, amount, currency: 'USD', fee: money(Math.min(amount * 0.02, 1)), note: 'Weekly contractor payout', origin: 'replay', ts, day: ts.slice(0, 10) });
      }
    }

    // disputes: quiet baseline of 1 every 3 days; then a planted run in the last 6 days
    const nDis = r() < 0.33 ? 1 : 0;
    for (let i = 0; i < nDis; i++) {
      const ts = isoAt(dayMs, 8 + r() * 12, r);
      const reason = weighted(r, [['ITEM_NOT_RECEIVED', 3], ['UNAUTHORISED', 2], ['MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 3], ['DUPLICATE_TRANSACTION', 1]]);
      out.disputes.push(dispute(++disSeq, ts, reason, pick(r, ['web', 'web', 'app', 'pos']), pick(r, ITEMS.map((x) => x.slug)), money(30 + r() * 120), r));
    }
    if (d <= 6 && d >= 1) {
      for (let i = 0; i < (d % 2 === 0 ? 1 : 2); i++) {
        const ts = isoAt(dayMs, 9 + r() * 10, r);
        out.disputes.push(dispute(++disSeq, ts, 'DUPLICATE_TRANSACTION', 'app', 'annual-plan', money(79 + r() * 20), r));
      }
    }
  }

  // invoices reach further back than the other streams so the overdue book is already mature when the window opens
  for (let d = days + 50; d >= 1; d--) {
    const dayMs = end - d * DAY;
    const weekend = [0, 6].includes(new Date(dayMs).getUTCDay());
    const nInv = weekend ? 1 : poisson(r, 4.5);
    for (let i = 0; i < nInv; i++) {
      const terms = weighted(r, [['NET_30', 6], ['NET_15', 3], ['DUE_ON_RECEIPT', 1]]);
      const net = terms === 'NET_30' ? 30 : terms === 'NET_15' ? 15 : 0;
      const amount = money(150 + r() * 1600);
      const invDate = new Date(dayMs).toISOString().slice(0, 10);
      const due = new Date(dayMs + net * DAY).toISOString().slice(0, 10);
      const customer = pick(r, CUSTOMERS);
      // customers pay within terms + a few days, 92% of the time
      const pays = r() < 0.97;
      const payAt = dayMs + (net + (r() * 10 - 4)) * DAY;
      const paid = pays && payAt < end ? new Date(payAt).toISOString().replace(/\.\d+Z$/, 'Z') : null;
      const id = `RP-INV-${String(++invSeq).padStart(5, '0')}`;
      const ts = isoAt(dayMs, 10, r);
      out.invoices.push({ id, number: `RP-${String(invSeq).padStart(4, '0')}`, status: paid ? 'PAID' : 'UNPAID', recipient: customer, amount, currency: 'USD', terms, invoice_date: invDate, due_date: due, paid_ts: paid, origin: 'replay', ts, day: ts.slice(0, 10) });
    }

  }
  for (const p of out.payout_items) p.recipient_domain = p.recipient.split('@')[1];
  return out;
}

function dispute(seq, ts, reason, channel, item, amount, r) {
  const due = new Date(Date.parse(ts) + 10 * DAY).toISOString().slice(0, 10);
  return { id: `RP-D-${String(seq).padStart(4, '0')}`, reason, status: r() < 0.5 ? 'WAITING_FOR_SELLER_RESPONSE' : 'UNDER_REVIEW', stage: 'INQUIRY', amount, currency: 'USD', channel, item, response_due: due, origin: 'replay', ts, day: ts.slice(0, 10) };
}
