// tw-trend and tw-breakdown: AG Charts (Community). The "normal range" band is two stacked area series (an invisible
// base and a tinted width), so no Enterprise chart feature is needed. Out-of-range points are marked by shape, label and colour.
import { AgCharts } from 'ag-charts-community';
import { TwWidget } from './base.js';
import { DATASETS } from '../../../shared/datasets.mjs';
import { METRICS, series, breakdown, matches } from '../../../shared/metrics.mjs';
import { chartTheme, tok } from '../theme.js';
import { esc, money, pct, int, dayLabel, midTrunc, trunc } from '../format.js';

/** A little headroom so the flagged label above the tallest point is not clipped. */
const niceMax = (v) => (v > 0 ? v * 1.18 : 1);
const unitFmt = (unit) => (unit === 'pct' ? (v) => pct(v) : unit === 'money' ? (v) => money(v) : (v) => int(v));

function bandFor(points, flag) {
  const base = points.slice(0, points.length - flag).filter((p) => p.den === null || p.den > 0);
  const ratio = points[0]?.den !== null && points[0]?.den !== undefined;
  if (ratio) {
    const n = base.reduce((s, p) => s + p.num, 0), d = base.reduce((s, p) => s + p.den, 0);
    const p0 = d ? n / d : 0;
    return points.map((p) => { const se = Math.sqrt(Math.max(p0 * (1 - p0), 0.0004) / Math.max(p.den || 1, 4)); return { lo: Math.max(0, p0 - 2 * se), hi: p0 + 2 * se, mid: p0 }; });
  }
  const vals = base.map((p) => p.value);
  const m = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(vals.length - 1, 1));
  const w = 2 * Math.max(sd, Math.abs(m) * 0.25, 0.5);
  return points.map(() => ({ lo: Math.max(0, m - w), hi: m + w, mid: m }));
}

export class TwTrend extends TwWidget {
  kind = 'tw-chart-w';
  build() {
    this.root.innerHTML = `<div class="tw-head"></div><p class="tw-caption"></p><div class="tw-chart-host" role="img"></div><p class="tw-sr tw-chart-sr"></p>`;
    this.head = this.root.querySelector('.tw-head');
    this.cap = this.root.querySelector('.tw-caption');
    this.host = this.root.querySelector('.tw-chart-host');
    this.sr = this.root.querySelector('.tw-chart-sr');
  }
  dispose() { this.chart?.destroy(); this.chart = null; }
  update() {
    const rec = this.record; const d = this.ctx.data;
    if (!rec || !d) return;
    const spec = rec.spec, m = METRICS[spec.metric], mode = this.ctx.mode, t = tok(mode);
    const s = series(d, spec.metric, { buckets: spec.buckets, bucket: spec.bucket, where: spec.where });
    const band = spec.baseline === 'none' ? null : bandFor(s.points, spec.flag);
    const fmt = unitFmt(m.unit);
    const rows = s.points.map((p, i) => ({ label: spec.bucket === 'hour' ? p.t.slice(11, 16) : dayLabel(p.t), value: p.value, lo: band?.[i].lo ?? 0, band: band ? band[i].hi - band[i].lo : 0, mid: band?.[i].mid, flagged: spec.flag > 0 && i >= s.points.length - spec.flag }));
    this.head.innerHTML = this.headerHtml(spec.title, rec);
    const last = rows[rows.length - 1];
    const key = band ? 'Shaded band is the normal range.' : '';
    this.cap.textContent = [spec.caption, key].filter(Boolean).join(' ');
    this.cap.hidden = !this.cap.textContent;
    this.sr.textContent = `${spec.title}. Latest ${fmt(last.value)}${band ? `, normal ${fmt(last.mid)}` : ''}. ${rows.length} ${spec.bucket}s shown.`;
    this.host.setAttribute('aria-label', this.sr.textContent);
    const flagStyle = { fill: t.signalFill, stroke: t.signalFill };
    const main = spec.chartType === 'column'
      ? { type: 'bar', direction: 'vertical', xKey: 'label', yKey: 'value', yName: m.label, fill: t.steel, cornerRadius: 3, itemStyler: (p) => (p.datum.flagged ? flagStyle : {}), label: { enabled: true, color: t.ink, placement: 'outside-end', formatter: (p) => (p.datum.flagged ? fmt(p.value) : '') }, tooltip: { renderer: (p) => ({ heading: p.datum.label, data: [{ label: m.label, value: fmt(p.datum.value) }, ...(band ? [{ label: 'Normal', value: fmt(p.datum.mid) }] : [])] }) } }
      : { type: spec.chartType === 'area' ? 'area' : 'line', xKey: 'label', yKey: 'value', yName: m.label, stroke: t.steel, strokeWidth: 2.5, ...(spec.chartType === 'area' ? { fill: t.steel, fillOpacity: 0.22 } : {}),
        marker: { enabled: true, size: 6, fill: t.steel, stroke: t.steel, itemStyler: (p) => (p.datum.flagged ? { ...flagStyle, size: 12, shape: 'diamond' } : {}) },
        label: { enabled: true, color: t.ink, fontWeight: 'bold', formatter: (p) => (p.datum.flagged ? fmt(p.value) : '') },
        tooltip: { renderer: (p) => ({ heading: p.datum.label, data: [{ label: m.label, value: fmt(p.datum.value) }, ...(band ? [{ label: 'Normal', value: fmt(p.datum.mid) }] : [])] }) } };
    const bandSeries = band ? [
      { type: 'area', xKey: 'label', yKey: 'lo', stacked: true, stackGroup: 'band', fillOpacity: 0, strokeWidth: 0, showInLegend: false, tooltip: { enabled: false }, marker: { enabled: false } },
      { type: 'area', xKey: 'label', yKey: 'band', yName: 'Normal range', stacked: true, stackGroup: 'band', fill: t.band, fillOpacity: 0.9, strokeWidth: 0, marker: { enabled: false }, tooltip: { enabled: false } },
    ] : [];
    const options = {
      container: this.host, data: rows, theme: chartTheme(mode), background: { fill: 'transparent' },
      series: [...bandSeries, main],
      axes: {
        x: { type: 'category', position: 'bottom', label: { avoidCollisions: true, minSpacing: 12, autoRotate: false }, line: { enabled: true } },
        y: { type: 'number', position: 'left', min: 0, max: niceMax(Math.max(...rows.map((r) => Math.max(r.value, r.lo + r.band)))), label: { formatter: (p) => fmt(p.value) }, gridLine: { style: [{ stroke: t.grid }] } },
      },
      legend: { enabled: false },
      padding: { top: 14, right: 18, bottom: 6, left: 6 },
    };
    if (this.chart) this.chart.update(options); else this.chart = AgCharts.create(options);
  }
}

export class TwBreakdown extends TwWidget {
  kind = 'tw-chart-w';
  build() {
    this.root.innerHTML = `<div class="tw-head"></div><p class="tw-caption"></p><div class="tw-chart-host" role="img"></div><p class="tw-sr tw-chart-sr"></p>`;
    this.head = this.root.querySelector('.tw-head');
    this.cap = this.root.querySelector('.tw-caption');
    this.host = this.root.querySelector('.tw-chart-host');
    this.sr = this.root.querySelector('.tw-chart-sr');
  }
  dispose() { this.chart?.destroy(); this.chart = null; }
  update() {
    const rec = this.record; const d = this.ctx.data;
    if (!rec || !d) return;
    const spec = rec.spec, mode = this.ctx.mode, t = tok(mode);
    const since = spec.sinceDays ? new Date(Date.parse(d.asOf) - spec.sinceDays * 86400000).toISOString() : null;
    let rows = breakdown(d, spec.dataset, { by: spec.by, where: spec.where, agg: spec.agg, field: spec.field, limit: spec.limit, since });
    const isMoney = spec.agg === 'sum' && DATASETS[spec.dataset].fields[spec.field]?.money;
    const fmt = isMoney ? (v) => money(v) : (v) => int(v);
    const hl = new Set(spec.highlight || []);
    const top = rows[0];
    const data = rows.map((r) => ({ key: r.key, label: (hl.has(r.key) ? '▲ ' : '') + (r.key.includes('@') ? midTrunc(r.key, 24) : trunc(r.key, 22)), value: r.value, flagged: hl.has(r.key), share: top ? r.value / rows.reduce((s, x) => s + x.value, 0) : 0 }));
    if (spec.chartType === 'bar') data.reverse();
    this.head.innerHTML = this.headerHtml(spec.title, rec);
    this.cap.textContent = spec.caption || '';
    this.cap.hidden = !spec.caption;
    this.sr.textContent = `${spec.title}. ${rows.slice(0, 4).map((r) => `${r.key} ${fmt(r.value)}`).join(', ')}.`;
    this.host.setAttribute('aria-label', this.sr.textContent);
    const flagStyle = { fill: t.signalFill, stroke: t.signalFill };
    const tip = { renderer: (p) => ({ heading: p.datum.key, data: [{ label: spec.agg === 'sum' ? 'Total' : 'Count', value: fmt(p.datum.value) }, { label: 'Share', value: pct(p.datum.share) }] }) };
    let options;
    if (spec.chartType === 'donut') {
      options = { container: this.host, data, theme: chartTheme(mode), background: { fill: 'transparent' },
        series: [{ type: 'donut', angleKey: 'value', calloutLabelKey: 'label', sectorLabelKey: 'value', calloutLabel: { enabled: true }, innerRadiusRatio: 0.6, sectorLabel: { formatter: (p) => fmt(p.datum.value), color: t.onSteel, fontWeight: 'bold' }, tooltip: tip, fills: [t.steel, t.series2, t.series3, t.steelStrong, t.signalFill, t.band, t.lineStrong, t.muted] }],
        legend: { enabled: false }, padding: { top: 8, right: 12, bottom: 8, left: 12 } };
    } else {
      const horizontal = spec.chartType === 'bar';
      options = { container: this.host, data, theme: chartTheme(mode), background: { fill: 'transparent' },
        series: [{ type: 'bar', direction: horizontal ? 'horizontal' : 'vertical', xKey: 'label', yKey: 'value', yName: spec.agg === 'sum' ? 'Total' : 'Count', fill: t.steel, cornerRadius: 3, itemStyler: (p) => (p.datum.flagged ? flagStyle : {}), label: { enabled: true, color: t.ink, placement: 'outside-end', formatter: (p) => fmt(p.value) }, tooltip: tip }],
        axes: { x: { type: 'category', position: horizontal ? 'left' : 'bottom', label: { avoidCollisions: true }, line: { enabled: true } }, y: { type: 'number', position: horizontal ? 'bottom' : 'left', min: 0, max: niceMax(Math.max(...data.map((r) => r.value)) * 1.12), label: { formatter: (p) => fmt(p.value) }, gridLine: { style: [{ stroke: t.grid }] } } },
        legend: { enabled: false }, padding: { top: 10, right: 44, bottom: 6, left: 16 } };
    }
    if (this.chart && this.lastType === spec.chartType) this.chart.update(options);
    else { this.chart?.destroy(); this.chart = AgCharts.create(options); this.lastType = spec.chartType; }
  }
}
