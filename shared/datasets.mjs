// The five datasets the stream is made of. One definition feeds the Lambda, the grids, the charts,
// the Studio data sources and the agent's tool schemas, so a field cannot exist in one place only.
export const FAILED_STATES = ['FAILED', 'UNCLAIMED', 'RETURNED', 'BLOCKED', 'ONHOLD'];
export const OPEN_INVOICE_STATES = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'VIEWED'];

const f = (type, label, extra = {}) => ({ type, label, ...extra });

export const DATASETS = {
  payout_items: {
    label: 'Payout items', noun: 'payout item', idField: 'id',
    fields: {
      id: f('string', 'Item'), batch_id: f('string', 'Batch'), batch_status: f('string', 'Batch status'),
      status: f('string', 'Status', { enum: ['SUCCESS', 'PENDING', 'UNCLAIMED', 'FAILED', 'RETURNED', 'BLOCKED', 'ONHOLD'] }),
      reason: f('string', 'Reason'), recipient: f('string', 'Recipient'), recipient_domain: f('string', 'Recipient domain'),
      payee: f('string', 'Payee'), amount: f('number', 'Amount', { money: true }), currency: f('string', 'Currency'),
      fee: f('number', 'Fee', { money: true }), note: f('string', 'Note'), origin: f('string', 'Source', { enum: ['sandbox', 'replay'] }), paypal_ts: f('date', 'PayPal time'),
      ts: f('date', 'Time'), day: f('string', 'Day'),
    },
  },
  invoices: {
    label: 'Invoices', noun: 'invoice', idField: 'id',
    fields: {
      id: f('string', 'Invoice'), number: f('string', 'Number'),
      status: f('string', 'Status', { enum: ['DRAFT', 'SENT', 'UNPAID', 'PAID', 'PARTIALLY_PAID', 'CANCELLED'] }),
      recipient: f('string', 'Customer'), amount: f('number', 'Amount', { money: true }), currency: f('string', 'Currency'),
      terms: f('string', 'Terms'), invoice_date: f('string', 'Invoiced'), due_date: f('string', 'Due'), paid_ts: f('date', 'Paid'),
      origin: f('string', 'Source', { enum: ['sandbox', 'replay'] }), paypal_ts: f('date', 'PayPal time'), ts: f('date', 'Time'), day: f('string', 'Day'),
      open: f('boolean', 'Open'), days_overdue: f('number', 'Days overdue'),
      age_bucket: f('string', 'Age', { enum: ['Not yet due', '1-7 days', '8-30 days', '31+ days', 'Settled'] }),
    },
  },
  captures: {
    label: 'Captures', noun: 'capture', idField: 'id',
    fields: {
      id: f('string', 'Capture'), order_id: f('string', 'Order'), status: f('string', 'Status'),
      amount: f('number', 'Amount', { money: true }), currency: f('string', 'Currency'),
      channel: f('string', 'Channel', { enum: ['web', 'app', 'pos'] }), item: f('string', 'Item'), payer: f('string', 'Payer'),
      origin: f('string', 'Source', { enum: ['sandbox', 'replay'] }), paypal_ts: f('date', 'PayPal time'), ts: f('date', 'Time'), day: f('string', 'Day'),
      refunded_amount: f('number', 'Refunded', { money: true }), refund_count: f('number', 'Refunds'),
    },
  },
  refunds: {
    label: 'Refunds', noun: 'refund', idField: 'id',
    fields: {
      id: f('string', 'Refund'), capture_id: f('string', 'Capture'), status: f('string', 'Status'),
      amount: f('number', 'Amount', { money: true }), currency: f('string', 'Currency'), reason: f('string', 'Reason'),
      channel: f('string', 'Channel'), item: f('string', 'Item'), minutes_to_refund: f('number', 'Minutes to refund'),
      origin: f('string', 'Source', { enum: ['sandbox', 'replay'] }), paypal_ts: f('date', 'PayPal time'), ts: f('date', 'Time'), day: f('string', 'Day'),
    },
  },
  disputes: {
    label: 'Disputes', noun: 'dispute', idField: 'id',
    fields: {
      id: f('string', 'Dispute'), reason: f('string', 'Reason'), status: f('string', 'Status'), stage: f('string', 'Stage'),
      amount: f('number', 'Amount', { money: true }), currency: f('string', 'Currency'),
      channel: f('string', 'Channel'), item: f('string', 'Item'), response_due: f('string', 'Respond by'),
      origin: f('string', 'Source', { enum: ['sandbox', 'replay'] }), paypal_ts: f('date', 'PayPal time'), ts: f('date', 'Time'), day: f('string', 'Day'),
    },
  },
};
export const DATASET_IDS = Object.keys(DATASETS);
export const fieldIds = (dataset) => Object.keys(DATASETS[dataset]?.fields || {});

/** One-line schema the model sees: dataset, fields and enums, nothing about rows. */
export function schemaText() {
  return DATASET_IDS.map((d) => {
    const fs = Object.entries(DATASETS[d].fields).map(([k, v]) => `${k}:${v.type}${v.enum ? `{${v.enum.join('|')}}` : ''}`).join(', ');
    return `${d}: ${fs}`;
  }).join('\n');
}

const parseDomain = (e) => (typeof e === 'string' && e.includes('@') ? e.split('@')[1].toLowerCase() : '');

/** Derived columns shared by server and browser so both compute identically. Pure; returns new arrays. */
export function prepare(raw, asOf) {
  const asOfMs = Date.parse(asOf);
  const asOfDay = Date.parse(asOf.slice(0, 10) + 'T00:00:00Z');
  const captures = (raw.captures || []).map((c) => ({ ...c }));
  const capById = new Map(captures.map((c) => [c.id, c]));
  const refunds = (raw.refunds || []).map((r) => {
    const c = capById.get(r.capture_id);
    const out = { ...r, channel: r.channel || c?.channel || '', item: r.item || c?.item || '' };
    out.minutes_to_refund = c ? Math.max(0, Math.round((Date.parse(r.ts) - Date.parse(c.ts)) / 60000)) : r.minutes_to_refund ?? null;
    if (c) { c.refunded_amount = Math.round(((c.refunded_amount || 0) + r.amount) * 100) / 100; c.refund_count = (c.refund_count || 0) + 1; }
    return out;
  });
  for (const c of captures) { c.refunded_amount ||= 0; c.refund_count ||= 0; }
  const invoices = (raw.invoices || []).map((i) => {
    const settled = i.status === 'PAID' || i.status === 'CANCELLED';
    const due = Date.parse(i.due_date + 'T00:00:00Z');
    const over = settled ? 0 : Math.max(0, Math.floor((asOfDay - due) / 86400000));
    const bucket = settled ? 'Settled' : over <= 0 ? 'Not yet due' : over <= 7 ? '1-7 days' : over <= 30 ? '8-30 days' : '31+ days';
    return { ...i, open: !settled && i.status !== 'DRAFT', days_overdue: over, age_bucket: bucket };
  });
  const payout_items = (raw.payout_items || []).map((p) => ({ ...p, recipient_domain: p.recipient_domain || parseDomain(p.recipient) }));
  return { payout_items, invoices, captures, refunds, disputes: raw.disputes || [], asOf, asOfMs };
}
