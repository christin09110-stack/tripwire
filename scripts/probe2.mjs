import { readFileSync } from 'node:fs';
import { loadEnv } from './env.mjs';
import { makePayPal } from '../backend/src/paypal.mjs';
const e = loadEnv();
const pp = makePayPal({ clientId: e.PAYPAL_CLIENT_ID, secret: e.PAYPAL_SECRET, api: e.PAYPAL_API });
const vault = readFileSync('../guarantee/.deploy-state/vault-token-id', 'utf8').trim();
const stamp = Date.now();
try {
  const o = await pp.createOrder({ intent: 'CAPTURE', purchase_units: [{ custom_id: 'channel:web;item:probe', amount: { currency_code: 'USD', value: '12.00' } }],
    payment_source: { paypal: { vault_id: vault, stored_credential: { payment_initiator: 'MERCHANT', usage: 'SUBSEQUENT', usage_pattern: 'UNSCHEDULED_POSTPAID' } } } }, `tw-probe-o-${stamp}`);
  console.log('order', o.id, o.status, JSON.stringify(o.purchase_units?.[0]?.payments?.captures?.map(c => [c.id, c.status])));
  const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
  if (cap) { const r = await pp.refundCapture(cap.id, { amount: { currency_code: 'USD', value: '12.00' }, note_to_payer: 'tripwire probe' }, `tw-probe-r-${stamp}`); console.log('refund', r.id, r.status); }
} catch (err) { console.log('order err', err.message, JSON.stringify(err.details).slice(0, 400)); }
const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
try {
  const inv = await pp.createInvoice({ detail: { invoice_number: `TW-PROBE-${stamp}`.slice(0, 25), invoice_date: d(45), currency_code: 'USD', payment_term: { term_type: 'NET_30', due_date: d(15) } },
    invoicer: { name: { business_name: 'Tripwire Test Co' }, email_address: 'sb-mixsn53098231@business.example.com' },
    primary_recipients: [{ billing_info: { email_address: 'late-payer@example.com', name: { given_name: 'Late', surname: 'Payer' } } }],
    items: [{ name: 'Retainer', quantity: '1', unit_amount: { currency_code: 'USD', value: '250.00' } }] }, `tw-probe-i-${stamp}`);
  console.log('invoice', inv.href || JSON.stringify(inv).slice(0, 200));
  const id = (inv.href || '').split('/').pop();
  const s = await pp.sendInvoice(id); console.log('sent', JSON.stringify(s).slice(0, 200));
  const g = await pp.getInvoice(id); console.log(g.status, g.detail.invoice_date, g.detail.payment_term);
} catch (err) { console.log('invoice err', err.message, JSON.stringify(err.details).slice(0, 600)); }
try { const dl = await pp.listDisputes('?page_size=20'); console.log('disputes', dl.items?.length ?? 0); } catch (err) { console.log('disputes err', err.message); }
