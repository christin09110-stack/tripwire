// The metric engine behind the agent's tools and the trend widgets. Pure functions over prepared datasets.
import { DATASETS, FAILED_STATES } from './datasets.mjs';
import { bucketLabels, keyOf, DAY } from './time.mjs';

/** where: { field: scalar | [in] | {gt,gte,lt,lte,ne,nin,prefix,contains} } — all keys must match. */
export function matches(row, where) {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    const v = row[k];
    if (Array.isArray(cond)) { if (!cond.includes(v)) return false; continue; }
    if (cond !== null && typeof cond === 'object') {
      if ('gt' in cond && !(v > cond.gt)) return false;
      if ('gte' in cond && !(v >= cond.gte)) return false;
      if ('lt' in cond && !(v < cond.lt)) return false;
      if ('lte' in cond && !(v <= cond.lte)) return false;
      if ('ne' in cond && v === cond.ne) return false;
      if ('nin' in cond && cond.nin.includes(v)) return false;
      if ('prefix' in cond && !(typeof v === 'string' && v.startsWith(cond.prefix))) return false;
      if ('contains' in cond && !(typeof v === 'string' && v.toLowerCase().includes(String(cond.contains).toLowerCase()))) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

const FAIL = { status: [...FAILED_STATES] };
/** Named metrics. num/den are {dataset, where?, agg:'count'|'sum', field?}. ratio metrics have a den. */
export const METRICS = {
  refund_rate: { label: 'Refund rate', unit: 'pct', num: { dataset: 'refunds', agg: 'count' }, den: { dataset: 'captures', agg: 'count' }, help: 'Refunds issued per capture in the same period.' },
  refund_count: { label: 'Refunds', unit: 'count', num: { dataset: 'refunds', agg: 'count' } },
  refund_volume: { label: 'Refunded value', unit: 'money', num: { dataset: 'refunds', agg: 'sum', field: 'amount' } },
  capture_volume: { label: 'Captured value', unit: 'money', num: { dataset: 'captures', agg: 'sum', field: 'amount' } },
  capture_count: { label: 'Captures', unit: 'count', num: { dataset: 'captures', agg: 'count' } },
  payout_failure_rate: { label: 'Payout items not delivered', unit: 'pct', num: { dataset: 'payout_items', where: FAIL, agg: 'count' }, den: { dataset: 'payout_items', agg: 'count' }, help: 'Items that ended FAILED, UNCLAIMED, RETURNED, BLOCKED or ONHOLD, per item sent.' },
  payout_unclaimed_rate: { label: 'Unclaimed payout items', unit: 'pct', num: { dataset: 'payout_items', where: { status: 'UNCLAIMED' }, agg: 'count' }, den: { dataset: 'payout_items', agg: 'count' } },
  payout_volume: { label: 'Payout value sent', unit: 'money', num: { dataset: 'payout_items', agg: 'sum', field: 'amount' } },
  payout_stuck_value: { label: 'Payout value not delivered', unit: 'money', num: { dataset: 'payout_items', where: FAIL, agg: 'sum', field: 'amount' } },
  dispute_count: { label: 'Disputes opened', unit: 'count', num: { dataset: 'disputes', agg: 'count' } },
  dispute_value: { label: 'Disputed value', unit: 'money', num: { dataset: 'disputes', agg: 'sum', field: 'amount' } },
  invoice_count: { label: 'Invoices sent', unit: 'count', num: { dataset: 'invoices', where: { status: { ne: 'DRAFT' } }, agg: 'count' } },
  overdue_amount: { label: 'Overdue invoice value', unit: 'money', special: 'overdue', minOverdue: 1 },
  severely_overdue_amount: { label: 'Invoice value overdue by more than 30 days', unit: 'money', special: 'overdue', minOverdue: 31, help: 'Open invoices more than 30 days past their due date (the 31+ days bucket).' },
};
export const METRIC_IDS = Object.keys(METRICS);

function aggregate(rows, agg, field) {
  if (agg === 'sum') { let s = 0; for (const r of rows) s += Number(r[field]) || 0; return Math.round(s * 100) / 100; }
  return rows.length;
}

/** Build the series for one metric. Returns { points:[{t,value,num,den}], metric }. Zero-filled, oldest first. */
export function series(data, metricId, { buckets = 30, bucket = 'day', where } = {}) {
  const m = typeof metricId === 'string' ? METRICS[metricId] : metricId;
  if (!m) throw new Error(`Unknown metric ${metricId}`);
  const labels = bucketLabels(data.asOf, buckets, bucket);
  const idx = new Map(labels.map((l, i) => [l, i]));
  if (m.special === 'overdue') {
    const pts = labels.map((t) => {
      const dayStart = Date.parse(t.slice(0, 10) + 'T00:00:00Z');
      const endOfBucket = bucket === 'hour' ? Date.parse(t + ':00Z') + 3600000 : dayStart + DAY;
      let s = 0, n = 0;
      for (const i of data.invoices) {
        if (i.status === 'DRAFT' || i.status === 'CANCELLED') continue;
        if (where && !matches(i, where)) continue;
        if (Date.parse(i.invoice_date + 'T00:00:00Z') >= endOfBucket) continue;
        if ((dayStart - Date.parse(i.due_date + 'T00:00:00Z')) / DAY < (m.minOverdue || 1)) continue;
        if (i.paid_ts && Date.parse(i.paid_ts) < endOfBucket) continue;
        s += i.amount; n++;
      }
      return { t, value: Math.round(s * 100) / 100, num: Math.round(s * 100) / 100, den: null, count: n };
    });
    return { metric: m, points: pts };
  }
  const part = (spec) => {
    const sums = labels.map(() => []);
    for (const r of data[spec.dataset] || []) {
      const b = idx.get(keyOf(r.ts, bucket));
      if (b === undefined) continue;
      if (spec.where && !matches(r, spec.where)) continue;
      if (where && !matches(r, where)) continue;
      sums[b].push(r);
    }
    return sums.map((rows) => aggregate(rows, spec.agg, spec.field));
  };
  const nums = part(m.num);
  const dens = m.den ? part(m.den) : null;
  const points = labels.map((t, i) => ({
    t, num: nums[i], den: dens ? dens[i] : null,
    value: dens ? (dens[i] ? nums[i] / dens[i] : 0) : nums[i],
  }));
  return { metric: m, points };
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

/**
 * Compare the latest `window` buckets with the buckets before them.
 * Ratio metrics use a one-proportion z-test against the pooled baseline rate; others use mean and standard
 * deviation of the baseline buckets with a floor so a flat baseline cannot make z infinite.
 */
export function compare(points, { window = 1, minBaseline = 7, floor: minFloor } = {}) {
  const cur = points.slice(-window);
  const base = points.slice(0, points.length - window);
  const usable = base.filter((p) => p.den === null || p.den > 0);
  const ratio = points.length && points[0].den !== null;
  if (usable.length < Math.min(minBaseline, base.length) || !usable.length) return { ok: false, reason: 'Not enough baseline history.' };
  if (ratio) {
    const bn = usable.reduce((s, p) => s + p.num, 0), bd = usable.reduce((s, p) => s + p.den, 0);
    const cn = cur.reduce((s, p) => s + p.num, 0), cd = cur.reduce((s, p) => s + p.den, 0);
    const p0 = bd ? bn / bd : 0, p1 = cd ? cn / cd : 0;
    const se = Math.sqrt(Math.max(p0 * (1 - p0), 0.0005) / Math.max(cd, 1));
    const dayRates = usable.map((p) => (p.den ? p.num / p.den : 0));
    return {
      ok: true, kind: 'ratio', current: p1, baseline: p0, delta: p1 - p0, multiple: p0 ? p1 / p0 : null, z: (p1 - p0) / se,
      currentNum: cn, currentDen: cd, baselineNum: bn, baselineDen: bd, baselineMax: Math.max(...dayRates), baselineDays: usable.length,
      exceedances: dayRates.filter((r) => r >= p1 && p1 > 0).length,
    };
  }
  const vals = usable.map((p) => p.value);
  const m = mean(vals), s = sd(vals), cv = mean(cur.map((p) => p.value));
  const floor = Math.max(s, Math.abs(m) * 0.25, minFloor ?? 0.5);
  return { ok: true, kind: 'level', current: cv, baseline: m, delta: cv - m, multiple: m ? cv / m : null, z: (cv - m) / floor, baselineMax: Math.max(...vals), baselineMedian: median(vals), baselineStd: s, baselineDays: vals.length, exceedances: vals.filter((v) => v >= cv && cv > 0).length };
}

export const floorFor = (metricId) => (METRICS[metricId]?.unit === 'money' ? 250 : 0.5);

export const fmtValue = (unit, v, currency = 'USD') => {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  if (unit === 'pct') return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
  if (unit === 'money') return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  return String(Math.round(v * 100) / 100);
};

/** Group a dataset by a field and aggregate; used by breakdown widgets and the group_by tool. */
export function breakdown(data, dataset, { by, where, agg = 'count', field, limit = 12, since } = {}) {
  const groups = new Map();
  for (const r of data[dataset] || []) {
    if (where && !matches(r, where)) continue;
    if (since && Date.parse(r.ts) < Date.parse(since)) continue;
    const key = r[by] === undefined || r[by] === null || r[by] === '' ? '(none)' : String(r[by]);
    const g = groups.get(key) || { key, count: 0, sum: 0 };
    g.count++; g.sum += Number(r[field]) || 0;
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => ({ key: g.key, count: g.count, sum: Math.round(g.sum * 100) / 100, value: agg === 'sum' ? Math.round(g.sum * 100) / 100 : g.count }));
  rows.sort((a, b) => b.value - a.value);
  return rows.slice(0, limit);
}
