// When Bedrock cannot be reached the board still has to say something true. These are fixed templates, built from the
// candidate's own numbers, and every finding and widget they make carries author "rules" so the UI says so.
import { fmtValue } from '../../shared/metrics.mjs';
import { validateWidget, makeWidget } from '../../shared/widgets.mjs';
import { findingIdFor } from './agent.mjs';

const pct = (v) => fmtValue('pct', v);

export function ruleFinding(c, { runId, now }) {
  const m = c.metric;
  const id = findingIdFor(c.id);
  const base = { id, candidateId: c.id, kind: c.kind, severity: c.severity, status: 'open', author: 'rules', metric: m, window: c.window, fingerprint: c.fingerprint, evidenceIds: c.evidenceIds.slice(0, 40), confidence: 0.6, runId, createdAt: now, updatedAt: now };
  switch (c.kind) {
    case 'refund_spike': {
      const conc = c.drill.concentration;
      return { ...base, brief: conc ? `${Math.round(conc.share * 100)}% of the refunds are for ${conc.key}.` : 'Refunds are spread across items.', title: conc ? `Refunds climbing on ${conc.key}` : 'Refund rate climbing', headline: `${pct(m.current)} refunded vs ${pct(m.baseline)} normal`,
        summary: `${m.currentNum} of ${m.currentDen} captures in the ${c.window.label} were refunded, ${m.multiple.toFixed(1)} times the 30-day rate. ${conc ? `${Math.round(conc.share * 100)}% of the refunds are for ${conc.key}.` : ''} This was written from the detector's numbers without the model.`,
        actions: ['Open the refunded captures and read the refund reasons.', conc ? `Check what changed for ${conc.key} in the last day.` : 'Check what changed in the last day.'] };
    }
    case 'payout_cluster':
      return { ...base, brief: `All ${c.drill.statuses.join(' or ').toLowerCase()} (${(c.drill.reasons[0] || 'no reason').toLowerCase().replaceAll('_', ' ')}) across ${m.batches} batches.`, title: `Payouts to ${c.subject} are not arriving`, headline: `${m.recipientItems} items held, ${fmtValue('money', m.recipientValue)}`,
        summary: `${m.recipientItems} payout items to ${c.subject} ended ${c.drill.statuses.join(' or ')} (${c.drill.reasons.join(', ') || 'no reason given'}) across ${m.batches} batches. That recipient is ${Math.round(m.shareOfFailures * 100)}% of all undelivered items. This was written from the detector's numbers without the model.`,
        actions: ['Confirm the PayPal address with the payee.', 'Cancel the unclaimed items and resend to the corrected address.'] };
    case 'invoice_ageing':
      return { ...base, brief: `The oldest is ${c.drill.oldest} days past due.`, title: 'Invoices ageing past terms', headline: `${fmtValue('money', m.current)} overdue by 31+ days`,
        summary: `${m.count} invoices are more than 30 days past their due date, worth ${fmtValue('money', m.current)}. The usual figure is ${fmtValue('money', m.baseline)}. The oldest is ${c.drill.oldest} days overdue. This was written from the detector's numbers without the model.`,
        actions: ['Send a reminder to the customers with the oldest invoices.', 'Decide whether any should go to collections.'] };
    default:
      return { ...base, brief: c.drill.concentration ? `${Math.round(c.drill.concentration.share * 100)}% involve ${c.drill.concentration.key}.` : 'No single item stands out.', title: `${c.subject.replaceAll('_', ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase())} disputes rising`, headline: m.baseline < 0.05 ? `${m.windowCount} in ${c.window.days} days, none before` : `${m.windowCount} in ${c.window.days} days vs ${m.baseline.toFixed(1)} a day normally`,
        summary: `${m.windowCount} disputes with reason ${c.subject} opened in the ${c.window.label}, ${fmtValue('money', m.value)} at stake. ${c.drill.concentration ? `${Math.round(c.drill.concentration.share * 100)}% involve ${c.drill.concentration.key}.` : ''} This was written from the detector's numbers without the model.`,
        actions: ['Respond before each dispute deadline.', 'Look for a shared cause in the disputed item.'] };
  }
}

export function ruleWidgets(c, finding, { runId, now }) {
  const specs = [];
  const add = (type, spec, layout) => specs.push({ type, spec, layout });
  switch (c.kind) {
    case 'refund_spike':
      add('tw-trend', { metric: 'refund_rate', title: 'Refund rate by day', chartType: 'area', flag: c.window.days }, { w: 12, h: 18 });
      add('tw-breakdown', { dataset: 'refunds', by: 'item', title: 'Refunds by item', sinceDays: c.window.days, chartType: 'bar' }, { w: 12, h: 18 });
      add('tw-grid', { dataset: 'refunds', title: 'Refunds in window', sinceDays: c.window.days, columns: [{ field: 'id', pinned: 'left' }, { field: 'item' }, { field: 'channel' }, { field: 'reason' }, { field: 'amount', agg: 'sum', renderer: 'money' }, { field: 'ts' }], totals: true, detail: 'related' }, { w: 24, h: 20 });
      break;
    case 'payout_cluster':
      add('tw-grid', { dataset: 'payout_items', title: 'Items to this recipient', where: { recipient: c.subject }, columns: [{ field: 'id', pinned: 'left' }, { field: 'batch_id' }, { field: 'status', renderer: 'status' }, { field: 'reason' }, { field: 'amount', agg: 'sum', renderer: 'money' }, { field: 'ts' }], totals: true, detail: 'related', rules: [{ field: 'status', op: 'ne', value: 'SUCCESS', tone: 'alert' }] }, { w: 24, h: 20 });
      add('tw-trend', { metric: 'payout_failure_rate', title: 'Undelivered payout items by day', chartType: 'column', flag: 1 }, { w: 12, h: 18 });
      add('tw-breakdown', { dataset: 'payout_items', by: 'recipient', title: 'Undelivered items by recipient', where: { status: ['FAILED', 'UNCLAIMED', 'RETURNED', 'BLOCKED', 'ONHOLD'] }, sinceDays: 14, highlight: [c.subject], chartType: 'bar' }, { w: 12, h: 18 });
      break;
    case 'invoice_ageing':
      add('tw-breakdown', { dataset: 'invoices', by: 'age_bucket', agg: 'sum', field: 'amount', title: 'Open invoice value by age', where: { open: true }, chartType: 'column' }, { w: 12, h: 18 });
      add('tw-trend', { metric: 'severely_overdue_amount', title: 'Value overdue by 31+ days', chartType: 'area', flag: 1 }, { w: 12, h: 18 });
      add('tw-grid', { dataset: 'invoices', title: 'Overdue invoices', where: { open: true, days_overdue: { gte: 1 } }, columns: [{ field: 'number', pinned: 'left' }, { field: 'recipient' }, { field: 'amount', renderer: 'money', agg: 'sum' }, { field: 'due_date' }, { field: 'days_overdue', renderer: 'age' }, { field: 'age_bucket' }], sort: { field: 'days_overdue', dir: 'desc' }, totals: true }, { w: 24, h: 20 });
      break;
    default:
      add('tw-trend', { metric: 'dispute_count', title: 'Disputes opened by day', where: { reason: c.subject }, chartType: 'column', flag: c.window.days }, { w: 12, h: 18 });
      add('tw-breakdown', { dataset: 'disputes', by: 'item', title: 'Disputes by item', where: { reason: c.subject }, sinceDays: c.window.days, chartType: 'bar' }, { w: 12, h: 18 });
      add('tw-grid', { dataset: 'disputes', title: 'Disputes in window', where: { reason: c.subject }, sinceDays: c.window.days, columns: [{ field: 'id', pinned: 'left' }, { field: 'item' }, { field: 'channel' }, { field: 'amount', renderer: 'money', agg: 'sum' }, { field: 'response_due' }, { field: 'status' }], totals: true }, { w: 24, h: 18 });
  }
  return specs.map((s, i) => {
    const v = validateWidget(s);
    if (!v.ok) throw new Error(`Fallback widget invalid: ${v.errors.join(' ')}`);
    return makeWidget({ id: `w-${finding.id.slice(3, 40)}-${i + 1}`, findingId: finding.id, type: s.type, spec: v.spec, layout: v.layout, order: i, author: 'rules', runId, now });
  });
}
