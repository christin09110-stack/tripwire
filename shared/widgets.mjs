// The widget-construction layer. A "widget spec" is plain JSON the agent writes through a tool; this file is the
// single place that says what a valid spec is, so the model gets exact error messages back and the browser can trust
// what it renders. It also turns a board document into AG Studio report state.
import { DATASETS, fieldIds } from './datasets.mjs';
import { METRICS } from './metrics.mjs';

export const WIDGET_TYPES = ['tw-brief', 'tw-grid', 'tw-trend', 'tw-breakdown'];
export const TONES = ['alert', 'warn', 'ok', 'info'];
export const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'];
export const RENDERERS = ['status', 'money', 'age', 'id', 'origin', 'bar'];
export const AGGS = ['sum', 'avg', 'count', 'max', 'min'];
export const DETAIL_KINDS = ['none', 'related'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : d);
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function checkWhere(dataset, where, errors, path = 'where') {
  if (where === undefined || where === null) return undefined;
  if (!isObj(where)) { errors.push(`${path} must be an object of field to value, list or {gt,lt,...}.`); return undefined; }
  const out = {};
  const ids = fieldIds(dataset);
  for (const [k, v] of Object.entries(where)) {
    if (!ids.includes(k)) { errors.push(`${path}.${k}: no such field on ${dataset}. Fields: ${ids.join(', ')}.`); continue; }
    out[k] = v;
  }
  return out;
}

export function validateGrid(input) {
  const errors = [];
  if (!isObj(input)) return { ok: false, errors: ['spec must be an object.'] };
  const dataset = input.dataset;
  if (!DATASETS[dataset]) return { ok: false, errors: [`dataset must be one of ${Object.keys(DATASETS).join(', ')}.`] };
  const ids = fieldIds(dataset);
  const spec = { dataset, title: str(input.title) || DATASETS[dataset].label };
  spec.where = checkWhere(dataset, input.where, errors);
  const cols = Array.isArray(input.columns) ? input.columns : [];
  if (!cols.length) errors.push(`columns must list 2 to 9 columns. Fields: ${ids.join(', ')}.`);
  spec.columns = [];
  let pinnedLeft = 0;
  for (const [i, c] of cols.slice(0, 9).entries()) {
    const col = typeof c === 'string' ? { field: c } : c;
    if (!isObj(col) || !ids.includes(col.field)) { errors.push(`columns[${i}].field "${col?.field}" is not a field of ${dataset}. Fields: ${ids.join(', ')}.`); continue; }
    const out = { field: col.field };
    if (col.header) out.header = str(col.header, 40);
    if (col.width) out.width = clamp(col.width, 70, 420, 120);
    if (col.pinned) { if (col.pinned === 'left' || col.pinned === 'right') { out.pinned = col.pinned; if (col.pinned === 'left') pinnedLeft++; } else errors.push(`columns[${i}].pinned must be left or right.`); }
    if (col.agg) { if (AGGS.includes(col.agg)) out.agg = col.agg; else errors.push(`columns[${i}].agg must be one of ${AGGS.join(', ')}.`); }
    if (col.renderer) { if (RENDERERS.includes(col.renderer)) out.renderer = col.renderer; else errors.push(`columns[${i}].renderer must be one of ${RENDERERS.join(', ')}.`); }
    spec.columns.push(out);
  }
  if (pinnedLeft > 2) errors.push('Pin at most 2 columns to the left.');
  const groupBy = Array.isArray(input.groupBy) ? input.groupBy : [];
  spec.groupBy = [];
  for (const g of groupBy.slice(0, 2)) { if (ids.includes(g)) spec.groupBy.push(g); else errors.push(`groupBy "${g}" is not a field of ${dataset}.`); }
  if (spec.groupBy.length && !spec.columns.some((c) => c.agg)) errors.push('groupBy needs at least one column with an agg (sum, avg, count, max, min), otherwise groups show nothing.');
  if (input.sort) {
    if (isObj(input.sort) && ids.includes(input.sort.field)) spec.sort = { field: input.sort.field, dir: input.sort.dir === 'asc' ? 'asc' : 'desc' };
    else errors.push(`sort must be {field, dir} with a field of ${dataset}.`);
  }
  spec.totals = input.totals === true;
  spec.detail = DETAIL_KINDS.includes(input.detail) ? input.detail : 'none';
  if (spec.detail === 'related' && spec.groupBy.length) errors.push('detail "related" cannot be combined with groupBy: AG Grid does not support master/detail inside row groups. Use one or the other.');
  spec.rules = [];
  for (const [i, r] of (Array.isArray(input.rules) ? input.rules : []).slice(0, 6).entries()) {
    if (!isObj(r) || !ids.includes(r.field) || !OPS.includes(r.op) || !TONES.includes(r.tone) || r.value === undefined) {
      errors.push(`rules[${i}] needs field (of ${dataset}), op (${OPS.join('|')}), value and tone (${TONES.join('|')}).`); continue;
    }
    spec.rules.push({ field: r.field, op: r.op, value: r.value, tone: r.tone, label: str(r.label, 40) });
  }
  spec.highlight = (Array.isArray(input.highlight) ? input.highlight : []).filter((x) => typeof x === 'string').slice(0, 60);
  spec.sinceDays = input.sinceDays ? clamp(input.sinceDays, 1, 60, 30) : undefined;
  return errors.length ? { ok: false, errors } : { ok: true, spec };
}

export function validateTrend(input) {
  const errors = [];
  if (!isObj(input)) return { ok: false, errors: ['spec must be an object.'] };
  if (!METRICS[input.metric]) return { ok: false, errors: [`metric must be one of ${Object.keys(METRICS).join(', ')}.`] };
  const m = METRICS[input.metric];
  const spec = { metric: input.metric, title: str(input.title) || m.label };
  spec.bucket = input.bucket === 'hour' ? 'hour' : 'day';
  spec.buckets = clamp(input.buckets, 7, spec.bucket === 'hour' ? 72 : 60, spec.bucket === 'hour' ? 48 : 30);
  spec.chartType = ['line', 'area', 'column'].includes(input.chartType) ? input.chartType : 'line';
  spec.baseline = input.baseline === 'none' ? 'none' : 'band';
  spec.flag = clamp(input.flag, 0, 6, 1);
  const dsOfMetric = m.num?.dataset;
  const where = dsOfMetric ? checkWhere(dsOfMetric, input.where, errors) : undefined;
  if (where && Object.keys(where).length) spec.where = where;
  spec.caption = str(input.caption, 160);
  return errors.length ? { ok: false, errors } : { ok: true, spec };
}

export function validateBreakdown(input) {
  const errors = [];
  if (!isObj(input)) return { ok: false, errors: ['spec must be an object.'] };
  const dataset = input.dataset;
  if (!DATASETS[dataset]) return { ok: false, errors: [`dataset must be one of ${Object.keys(DATASETS).join(', ')}.`] };
  const ids = fieldIds(dataset);
  if (!ids.includes(input.by)) errors.push(`by "${input.by}" is not a field of ${dataset}. Fields: ${ids.join(', ')}.`);
  const spec = { dataset, by: input.by, title: str(input.title) || `${DATASETS[dataset].label} by ${input.by}` };
  spec.agg = input.agg === 'sum' ? 'sum' : 'count';
  if (spec.agg === 'sum') {
    if (!ids.includes(input.field) || DATASETS[dataset].fields[input.field].type !== 'number') errors.push(`field "${input.field}" must be a numeric field of ${dataset} when agg is sum.`);
    spec.field = input.field;
  }
  spec.where = checkWhere(dataset, input.where, errors);
  spec.limit = clamp(input.limit, 3, 15, 8);
  spec.chartType = ['bar', 'column', 'donut'].includes(input.chartType) ? input.chartType : 'bar';
  spec.highlight = (Array.isArray(input.highlight) ? input.highlight : []).filter((x) => typeof x === 'string').slice(0, 6);
  spec.sinceDays = input.sinceDays ? clamp(input.sinceDays, 1, 60, 30) : undefined;
  spec.caption = str(input.caption, 160);
  return errors.length ? { ok: false, errors } : { ok: true, spec };
}

export function validateBrief(input) {
  if (!isObj(input) || typeof input.findingId !== 'string') return { ok: false, errors: ['spec.findingId is required.'] };
  return { ok: true, spec: { findingId: input.findingId } };
}

export const VALIDATORS = { 'tw-grid': validateGrid, 'tw-trend': validateTrend, 'tw-breakdown': validateBreakdown, 'tw-brief': validateBrief };
// Smallest heights (grid tracks, about 15px each) at which a widget stays legible.
export const MIN_H = { 'tw-brief': 14, 'tw-grid': 20, 'tw-trend': 16, 'tw-breakdown': 16 };
export const DEFAULT_SIZE = { 'tw-brief': { w: 12, h: 21 }, 'tw-grid': { w: 24, h: 24 }, 'tw-trend': { w: 12, h: 18 }, 'tw-breakdown': { w: 12, h: 18 } };

export function validateWidget({ type, spec, layout }) {
  const v = VALIDATORS[type];
  if (!v) return { ok: false, errors: [`type must be one of ${WIDGET_TYPES.join(', ')}.`] };
  const r = v(spec);
  if (!r.ok) return r;
  const d = DEFAULT_SIZE[type];
  const w = clamp(layout?.w, 6, 24, d.w);
  const h = clamp(layout?.h, MIN_H[type], 44, d.h);
  return { ok: true, spec: r.spec, layout: { w, h } };
}

// ---------- findings ----------
export const SEVERITIES = ['high', 'medium', 'low'];
export const KINDS = ['refund_spike', 'payout_cluster', 'invoice_ageing', 'dispute_pattern'];
/** Card text: at most `max` words, ending on a whole sentence if one fits, otherwise on a whole word. Never mid-word. */
export function fitBrief(text, max = 22) {
  const t = (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter(Boolean);
  if (words.length <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+(\s|$)/g) || [];
  let out = '';
  for (const s of sentences) { if ((out + s).trim().split(' ').length > max) break; out += s; }
  if (out.trim()) return out.trim();
  return words.slice(0, max).join(' ').replace(/[,;:\s]+$/, '') + '…';
}

export function validateFinding(f) {
  const errors = [];
  if (!isObj(f)) return { ok: false, errors: ['finding must be an object.'] };
  const out = {
    candidateId: str(f.candidateId, 120), kind: f.kind, severity: f.severity, title: str(f.title, 90), headline: str(f.headline, 90),
    summary: str(f.summary, 700), brief: fitBrief(f.brief, 22), actions: (Array.isArray(f.actions) ? f.actions : []).map((a) => str(a, 160)).filter(Boolean).slice(0, 3),
    evidenceIds: (Array.isArray(f.evidenceIds) ? f.evidenceIds : []).filter((x) => typeof x === 'string').slice(0, 40),
    confidence: Math.min(1, Math.max(0, Number(f.confidence) || 0)),
  };
  if (!KINDS.includes(out.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}.`);
  if (!SEVERITIES.includes(out.severity)) errors.push(`severity must be one of ${SEVERITIES.join(', ')}.`);
  if (!out.title) errors.push('title is required.');
  if (!out.summary) errors.push('summary is required: say what happened, how it differs from normal, and the likely cause.');
  if (!out.headline) errors.push('headline is required: the one number that matters, e.g. "44% refund rate vs 3.1% normal".');
  if (!out.actions.length) errors.push('actions needs 1 to 3 concrete next steps.');
  return errors.length ? { ok: false, errors } : { ok: true, finding: out };
}

// ---------- board -> AG Studio ----------
export const GRID_TRACKS = 24;

/** Row-flow packer: widgets in order, left to right, wrapping at 24 tracks. Returns Studio widgetLayout. */
export function pack(items) {
  const layout = {};
  let x = 0, y = 0, rowH = 0;
  for (const it of items) {
    const w = Math.min(GRID_TRACKS, it.layout.w), h = it.layout.h;
    if (x + w > GRID_TRACKS) { x = 0; y += rowH; rowH = 0; }
    layout[it.id] = { xTrack: x, yTrack: y, xSpan: w, ySpan: h };
    x += w; rowH = Math.max(rowH, h);
  }
  return layout;
}

const SEV_RANK = { high: 0, medium: 1, low: 2 };
export const findingPageId = (id) => id;

/**
 * board = { findings: {id: finding}, widgets: {id: {id,page,type,spec,layout,order,findingId,author}}, layoutOverrides?: {pageId:{wid:layout}} }
 * Pages: "overview" is derived (one brief per open finding, plus the widgets the agent pinned); each finding has its own page.
 */
export function boardPages(board) {
  const findings = Object.values(board.findings || {}).filter((f) => f.status !== 'dismissed');
  findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const pages = [{ id: 'overview', title: 'Overview', findingId: null }];
  for (const f of findings) pages.push({ id: findingPageId(f.id), title: f.title, findingId: f.id });
  return { pages, findings };
}

export function toStudioState(board, selectedPageId = 'overview', { stack = false, briefH = 18, only = null, trailH = 0, stackBriefH = 17 } = {}) {
  const { pages, findings } = boardPages(board);
  const widgetsById = board.widgets || {};
  const outPages = pages.map((p) => {
    let items;
    if (p.id === 'overview') {
      items = findings.filter((f) => !only || only(f)).map((f) => ({ id: `brief-${f.id}`, type: 'tw-brief', layout: { w: 12, h: briefH } }));
      const pinned = Object.values(widgetsById).filter((w) => w.page === 'overview').sort((a, b) => a.order - b.order);
      items.push(...pinned.map((w) => ({ id: w.id, type: w.type, layout: w.layout })));
      if (trailH > 0 && !stack) items.push({ id: 'trail-run', type: 'tw-trail', layout: { w: 24, h: trailH } });
      if (stack) items.push({ id: 'trail-run', type: 'tw-trail', layout: { w: 24, h: 24 } });
    } else {
      items = Object.values(widgetsById).filter((w) => w.findingId === p.findingId).sort((a, b) => a.order - b.order).map((w) => ({ id: w.id, type: w.type, layout: { w: w.layout.w, h: Math.max(w.layout.h, MIN_H[w.type] || 14) } }));
    }
    const widgets = {};
    for (const it of items) widgets[it.id] = { type: it.type, dataMapping: {} };
    const widgetLayout = pack(stack ? items.map((it) => ({ ...it, layout: { w: 24, h: Math.max(it.layout.h, it.type === 'tw-brief' ? stackBriefH : it.type === 'tw-grid' ? 34 : 22) } })) : items);
    return { id: p.id, widgets, widgetLayout };
  });
  const sel = outPages.some((p) => p.id === selectedPageId) ? selectedPageId : 'overview';
  return { pages: outPages, selectedPageId: sel, panels: { filters: { collapsed: true }, data: { collapsed: true }, edit: { collapsed: true } } };
}

/** The widget record the agent's build_widget tool stores. */
export function makeWidget({ id, findingId, type, spec, layout, order, author, runId, now }) {
  return { id, page: findingPageId(findingId), findingId, type, spec, layout, order, author, runId, createdAt: now };
}
