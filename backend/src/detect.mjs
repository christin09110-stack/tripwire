// Deterministic first pass. The statistics decide WHAT is unusual; the agent decides what it means and how to show it.
// Each detector returns candidates; nothing here calls a model.
import { series, compare, breakdown, matches, METRICS, fmtValue, floorFor } from '../../shared/metrics.mjs';
import { FAILED_STATES } from '../../shared/datasets.mjs';
import { dayKey, DAY } from '../../shared/time.mjs';

const sevFrom = (score) => (score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low');
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const top = (rows) => (rows[0] ? { key: rows[0].key, share: rows[0].count / rows.reduce((s, r) => s + r.count, 0) } : null);

export function detectRefundSpike(data) {
  const out = [];
  for (const window of [1, 3]) {
    const s = series(data, 'refund_rate', { buckets: 31 + window - 1 });
    const c = compare(s.points, { window });
    if (!c.ok || c.currentNum < 3 || c.z < 4 || !(c.multiple >= 2)) continue;
    const from = s.points[s.points.length - window].t;
    const since = `${from}T00:00:00Z`;
    const inWindow = data.refunds.filter((r) => r.ts >= since);
    const byItem = breakdown(data, 'refunds', { by: 'item', since });
    const byChannel = breakdown(data, 'refunds', { by: 'channel', since });
    const byReason = breakdown(data, 'refunds', { by: 'reason', since });
    const concentrated = top(byItem);
    const score = clamp01(0.4 + Math.min(0.35, (c.multiple - 2) / 20) + Math.min(0.25, c.currentNum / 40));
    out.push({
      id: `refund_spike:${from}:${window}d`, kind: 'refund_spike', subject: concentrated ? `${concentrated.key}` : 'all items', label: 'Refund rate climbing',
      severity: sevFrom(score), score,
      metric: { id: 'refund_rate', label: METRICS.refund_rate.label, unit: 'pct', current: c.current, baseline: c.baseline, z: c.z, multiple: c.multiple, currentNum: c.currentNum, currentDen: c.currentDen, baselineMaxDay: c.baselineMax, earlierDaysAtOrAbove: c.exceedances },
      window: { from: since, to: data.asOf, label: window === 1 ? 'latest day' : 'latest 3 days', days: window },
      evidenceIds: inWindow.map((r) => r.id).slice(0, 40),
      drill: { byItem: byItem.slice(0, 5), byChannel: byChannel.slice(0, 5), byReason: byReason.slice(0, 5), concentration: concentrated },
      headlineHint: `${fmtValue('pct', c.current)} of captures refunded vs ${fmtValue('pct', c.baseline)} normally`,
    });
    break; // the shortest window that fires wins; a 3-day echo of the same event is not a second finding
  }
  return out;
}

export function detectPayoutCluster(data, { days = 7 } = {}) {
  const since = new Date(Date.parse(data.asOf) - days * DAY).toISOString();
  const recent = data.payout_items.filter((p) => p.ts >= since);
  const bad = recent.filter((p) => FAILED_STATES.includes(p.status));
  const s = series(data, 'payout_failure_rate', { buckets: 30 });
  const rateNow = recent.length ? bad.length / recent.length : 0;
  const base = compare(s.points.slice(0, 23).concat([{ t: 'w', num: bad.length, den: recent.length, value: rateNow }]), { window: 1 });
  const byRecipient = new Map();
  for (const p of bad) { const g = byRecipient.get(p.recipient) || []; g.push(p); byRecipient.set(p.recipient, g); }
  const out = [];
  for (const [recipient, items] of byRecipient) {
    if (items.length < 3) continue;
    const value = items.reduce((t, i) => t + i.amount, 0);
    const batches = new Set(items.map((i) => i.batch_id));
    const reasons = [...new Set(items.map((i) => i.reason).filter(Boolean))];
    const share = items.length / bad.length;
    const score = clamp01(0.35 + Math.min(0.3, items.length / 12) + Math.min(0.2, value / 4000) + (batches.size >= 3 ? 0.1 : 0));
    out.push({
      id: `payout_cluster:${recipient}`, kind: 'payout_cluster', subject: recipient, label: 'Payout items failing on one recipient', severity: sevFrom(score), score,
      metric: { id: 'payout_failure_rate', label: METRICS.payout_failure_rate.label, unit: 'pct', current: rateNow, baseline: base.ok ? base.baseline : null, z: base.ok ? base.z : null, multiple: base.ok ? base.multiple : null, recipientItems: items.length, recipientValue: Math.round(value * 100) / 100, shareOfFailures: share, batches: batches.size },
      window: { from: since, to: data.asOf, label: `last ${days} days`, days },
      evidenceIds: items.map((i) => i.id),
      drill: { reasons, statuses: [...new Set(items.map((i) => i.status))], batchIds: [...batches], domain: items[0].recipient_domain, otherFailures: bad.length - items.length },
      headlineHint: `${items.length} items to ${recipient} undelivered across ${batches.size} batches, ${fmtValue('money', value)} held`,
    });
  }
  return out;
}

export function detectInvoiceAgeing(data) {
  const s = series(data, 'severely_overdue_amount', { buckets: 31 });
  const c = compare(s.points, { window: 1, floor: floorFor('severely_overdue_amount') });
  const open = data.invoices.filter((i) => i.open && i.days_overdue >= 31);
  if (!c.ok || open.length < 2) return [];
  if (!(c.current >= Math.max(c.baseline * 2, c.baseline + 1500))) return [];
  const value = open.reduce((t, i) => t + i.amount, 0);
  const score = clamp01(0.3 + Math.min(0.25, value / 24000) + Math.min(0.15, open.length / 30));
  const byCustomer = breakdown(data, 'invoices', { by: 'recipient', where: { open: true, days_overdue: { gte: 31 } }, agg: 'sum', field: 'amount' });
  const buckets = breakdown(data, 'invoices', { by: 'age_bucket', where: { open: true }, agg: 'sum', field: 'amount' });
  return [{
    id: `invoice_ageing:${dayKey(data.asOf)}`, kind: 'invoice_ageing', subject: `${open.length} invoices`, label: 'Invoices ageing past terms', severity: sevFrom(score), score,
    metric: { id: 'severely_overdue_amount', label: METRICS.severely_overdue_amount.label, unit: 'money', current: c.current, baseline: c.baseline, z: c.z, multiple: c.multiple, count: open.length },
    window: { from: s.points[0].t + 'T00:00:00Z', to: data.asOf, label: 'as of the stream head', days: 1 },
    evidenceIds: open.map((i) => i.id),
    drill: { byCustomer: byCustomer.slice(0, 6), byAgeBucket: buckets, oldest: Math.max(...open.map((i) => i.days_overdue)) },
    headlineHint: `${fmtValue('money', value)} is more than 30 days overdue across ${open.length} invoices, normally ${fmtValue('money', c.baseline)}`,
  }];
}

export function detectDisputePattern(data, { days = 7 } = {}) {
  const since = new Date(Date.parse(data.asOf) - days * DAY).toISOString();
  const out = [];
  const reasons = [...new Set(data.disputes.map((d) => d.reason))];
  for (const reason of reasons) {
    const s = series(data, 'dispute_count', { buckets: 30 + days - 1, where: { reason } });
    const c = compare(s.points, { window: days });
    const recent = data.disputes.filter((d) => d.reason === reason && d.ts >= since);
    if (!c.ok || recent.length < 4 || !(c.multiple >= 3 || (c.baseline === 0 && recent.length >= 4))) continue;
    const byItem = breakdown(data, 'disputes', { by: 'item', where: { reason }, since });
    const byChannel = breakdown(data, 'disputes', { by: 'channel', where: { reason }, since });
    const value = recent.reduce((t, d) => t + d.amount, 0);
    const score = clamp01(0.3 + Math.min(0.2, recent.length / 40) + Math.min(0.15, value / 5000));
    out.push({
      id: `dispute_pattern:${reason}:${dayKey(data.asOf)}`, kind: 'dispute_pattern', subject: reason, label: 'Dispute pattern', severity: sevFrom(score), score,
      metric: { id: 'dispute_count', label: `${reason} disputes per day`, unit: 'count', current: c.current, baseline: c.baseline, z: c.z, multiple: c.multiple, windowCount: recent.length, value: Math.round(value * 100) / 100 },
      window: { from: since, to: data.asOf, label: `last ${days} days`, days },
      evidenceIds: recent.map((d) => d.id),
      drill: { byItem: byItem.slice(0, 4), byChannel: byChannel.slice(0, 4), concentration: top(byItem) },
      headlineHint: `${recent.length} ${reason} disputes in ${days} days, ${fmtValue('money', value)} at stake`,
    });
  }
  return out;
}

export function detectAll(data) {
  return [...detectRefundSpike(data), ...detectPayoutCluster(data), ...detectInvoiceAgeing(data), ...detectDisputePattern(data)].sort((a, b) => b.score - a.score);
}

export { matches };
