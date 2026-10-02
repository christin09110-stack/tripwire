import { loadEnv } from './env.mjs';
import { makePayPal } from '../backend/src/paypal.mjs';
const e = loadEnv();
const pp = makePayPal({ clientId: e.PAYPAL_CLIENT_ID, secret: e.PAYPAL_SECRET, api: e.PAYPAL_API });
const stamp = Date.now();
const mk = (receiver, extra = {}) => ({ recipient_type: 'EMAIL', amount: { value: '3.00', currency: 'USD' }, receiver, note: 'tripwire probe', sender_item_id: `probe-${stamp}-${receiver.slice(0,12)}`, ...extra });
const body = { sender_batch_header: { sender_batch_id: `tw-probe-${stamp}`, email_subject: 'Tripwire probe' }, items: [
  mk('sb-patient@personal.example.com'),
  mk(`nobody-${stamp}@unregistered-tripwire.example.com`),
  { recipient_type: 'PAYPAL_ID', amount: { value: '3.00', currency: 'USD' }, receiver: 'ZZZZZZZZZZZZZ', note: 'bogus id', sender_item_id: `probe-${stamp}-bogus` },
] };
const b = await pp.createPayout(body, `tw-probe-${stamp}`);
console.log('created', b.batch_header.payout_batch_id, b.batch_header.batch_status);
for (let i = 0; i < 12; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const g = await pp.getBatch(b.batch_header.payout_batch_id);
  console.log(i, g.batch_header.batch_status, g.items.map(x => `${x.transaction_status}/${x.errors?.name || '-'}`).join(' '));
  if (['SUCCESS', 'DENIED', 'CANCELED'].includes(g.batch_header.batch_status)) { console.log(JSON.stringify(g.items[1], null, 1).slice(0, 1200)); break; }
}
