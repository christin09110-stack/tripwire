// PayPal API objects -> dataset rows. Pure functions; the Lambda and the seed loader both use them.
const iso = (t) => (t ? new Date(t).toISOString().replace(/\.\d+Z$/, 'Z') : null);
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Math.round(Number(v) * 100) / 100);

/**
 * The stream keeps its own clock so a demo opened weeks later still has its anomalies in window. A PayPal event that
 * happened within six hours of the stream head keeps its real time; anything later lands one minute after the head.
 * The real PayPal time stays on the row as paypal_ts.
 */
export function placeTs(paypalIso, headIso) {
  const p = Date.parse(paypalIso);
  if (!headIso) return iso(paypalIso);
  const h = Date.parse(headIso);
  if (p <= h + 6 * 3600000) return iso(paypalIso);
  return iso(h + 60000);
}
const day = (ts) => ts.slice(0, 10);

export function payoutRows(batch, { head } = {}) {
  const h = batch.batch_header || {};
  return (batch.items || []).map((it) => {
    const pi = it.payout_item || {};
    const when = it.time_processed || h.time_completed || h.time_created;
    const ts = placeTs(when, head);
    const note = pi.note || '';
    const receiver = pi.receiver || '';
    return {
      id: it.payout_item_id, batch_id: it.payout_batch_id || h.payout_batch_id, batch_status: h.batch_status,
      status: it.transaction_status, reason: it.errors?.name || null,
      recipient: receiver, recipient_domain: receiver.includes('@') ? receiver.split('@')[1].toLowerCase() : '',
      payee: note.startsWith('tw:') ? note.slice(3) : (pi.sender_item_id || ''),
      amount: num(pi.amount?.value), currency: pi.amount?.currency || 'USD', fee: num(it.payout_item_fee?.value),
      note, origin: 'sandbox', paypal_ts: iso(when), ts, day: day(ts),
    };
  });
}

export function invoiceRow(inv, { head } = {}) {
  const d = inv.detail || {};
  const rec = inv.primary_recipients?.[0]?.billing_info || {};
  const name = rec.name?.business_name || [rec.name?.given_name, rec.name?.surname].filter(Boolean).join(' ') || rec.email_address || 'Unknown';
  const when = `${d.invoice_date}T10:00:00Z`;
  const ts = placeTs(when, head);
  const paidTx = inv.payments?.transactions || [];
  const paid = inv.status === 'PAID' && paidTx.length ? paidTx[paidTx.length - 1].payment_date : null;
  return {
    id: inv.id, number: d.invoice_number, status: inv.status, recipient: name, amount: num(inv.amount?.value), currency: inv.amount?.currency_code || 'USD',
    terms: d.payment_term?.term_type || '', invoice_date: d.invoice_date, due_date: d.payment_term?.due_date || d.invoice_date,
    paid_ts: paid ? iso(paid) : null, origin: 'sandbox', paypal_ts: iso(d.metadata?.create_time || when), ts, day: day(ts),
  };
}

const parseCustom = (c = '') => Object.fromEntries(c.split(';').map((kv) => kv.split(':')).filter((p) => p.length === 2));

export function captureRow({ orderId, capture, customId, payerId }, { head } = {}) {
  const meta = parseCustom(customId || capture.custom_id);
  const ts = placeTs(capture.create_time, head);
  return {
    id: capture.id, order_id: orderId, status: capture.status, amount: num(capture.amount?.value), currency: capture.amount?.currency_code || 'USD',
    channel: meta.channel || 'web', item: meta.item || 'unknown', payer: payerId ? `buyer-${String(payerId).slice(-5).toLowerCase()}` : 'buyer',
    origin: 'sandbox', paypal_ts: iso(capture.create_time), ts, day: day(ts),
  };
}

export function refundRow({ refund, captureId, reason }, { head } = {}) {
  const when = refund.create_time;
  const ts = placeTs(when, head);
  return {
    id: refund.id, capture_id: captureId, status: refund.status, amount: num(refund.amount?.value), currency: refund.amount?.currency_code || 'USD',
    reason: reason || refund.note_to_payer || '', origin: 'sandbox', paypal_ts: iso(when), ts, day: day(ts),
  };
}

export function disputeRow(d, { head } = {}) {
  const when = d.create_time;
  const ts = placeTs(when, head);
  return {
    id: d.dispute_id, reason: d.reason || '', status: d.status || '', stage: d.dispute_life_cycle_stage || '', amount: num(d.dispute_amount?.value),
    currency: d.dispute_amount?.currency_code || 'USD', channel: '', item: '', response_due: (d.seller_response_due_date || '').slice(0, 10),
    origin: 'sandbox', paypal_ts: iso(when), ts, day: day(ts),
  };
}
