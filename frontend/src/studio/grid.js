// tw-grid: an AG Grid configured by a spec the agent wrote. Uses row grouping with aggregation, master/detail,
// pinned columns and pinned total rows, value formatters, cell renderers, rule-driven cell styling, a status bar with a
// custom panel, the quick filter, and grid state persistence (initialState / onStateUpdated).
import { createGrid } from 'ag-grid-community';
import { TwWidget } from './base.js';
import { DATASETS } from '../../../shared/datasets.mjs';
import { matches } from '../../../shared/metrics.mjs';
import { gridTheme } from '../theme.js';
import { esc, money, dtShort, midTrunc, STATUS_WORDS, STATUS_TONE, TONE_GLYPH, slugName, sentence } from '../format.js';

const OPFN = { eq: (a, b) => a === b, ne: (a, b) => a !== b, gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, in: (a, b) => Array.isArray(b) && b.includes(a) };
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

function pill(status) {
  const tone = STATUS_TONE[status] || 'info';
  const el = document.createElement('span');
  el.className = `tw-pill tw-pill-${tone}`;
  el.innerHTML = `<span aria-hidden="true">${TONE_GLYPH[tone]}</span> ${esc(STATUS_WORDS[status] || sentence(status))}`;
  return el;
}

function cellRenderer(col, f, maxOf) {
  switch (col.renderer) {
    case 'status': return (p) => (p.value ? pill(p.value) : '');
    case 'id': return (p) => { if (p.node?.rowPinned) return p.value ?? ''; const el = document.createElement('span'); el.className = 'tw-mono'; el.textContent = midTrunc(p.value, 16); el.title = p.value || ''; return el; };
    case 'origin': return (p) => { const el = document.createElement('span'); el.className = `tw-badge ${p.value === 'sandbox' ? 'tw-badge-ai' : ''}`; el.textContent = p.value === 'sandbox' ? 'Sandbox' : 'Replay'; el.title = p.value === 'sandbox' ? 'A real PayPal sandbox object' : 'Replayed history in PayPal\'s field shapes'; return el; };
    case 'age': return (p) => { if (p.value === null || p.value === undefined || p.node?.group) return p.value ?? ''; const el = document.createElement('span'); el.className = 'tw-agebar'; const w = Math.min(100, (p.value / 60) * 100); el.innerHTML = `<span class="tw-agebar-fill" style="width:${w}%"></span><span class="tw-agebar-n">${p.value}d</span>`; el.title = `${p.value} days past the due date`; return el; };
    case 'bar': return (p) => { if (typeof p.value !== 'number') return p.value ?? ''; const el = document.createElement('span'); el.className = 'tw-agebar'; const w = maxOf(col.field) ? Math.min(100, (p.value / maxOf(col.field)) * 100) : 0; el.innerHTML = `<span class="tw-agebar-fill" style="width:${w}%"></span><span class="tw-agebar-n">${f.money ? money(p.value) : p.value}</span>`; return el; };
    default: return undefined;
  }
}

function valueFormatter(col, f) {
  if (col.renderer === 'money' || f.money) return (p) => (typeof p.value === 'number' ? money(p.value, p.data?.currency) : p.value ?? '');
  if (f.type === 'date') return (p) => dtShort(p.value);
  if (col.field === 'payee') return (p) => slugName(p.value) || '';
  if (col.field === 'status' || col.field === 'reason' || col.field === 'stage') return (p) => (p.value ? (STATUS_WORDS[p.value] ? STATUS_WORDS[p.value] : sentence(p.value)) : '');
  return undefined;
}

function related(ds, row, data) {
  const rel = (relation, r, extra = {}) => ({ relation, id: r.id, status: r.status, amount: r.amount, currency: r.currency, ts: r.ts, note: extra.note ?? '' });
  switch (ds) {
    case 'payout_items': return data.payout_items.filter((r) => r.batch_id === row.batch_id && r.id !== row.id).map((r) => rel('Same batch', r, { note: slugName(r.payee) }));
    case 'captures': return data.refunds.filter((r) => r.capture_id === row.id).map((r) => rel('Refund', r, { note: r.reason }));
    case 'refunds': return [...data.captures.filter((c) => c.id === row.capture_id).map((c) => rel('Original capture', c, { note: `${c.item} via ${c.channel}` })), ...data.refunds.filter((r) => r.capture_id === row.capture_id && r.id !== row.id).map((r) => rel('Other refund', r, { note: r.reason }))];
    case 'invoices': return data.invoices.filter((r) => r.recipient === row.recipient && r.id !== row.id).map((r) => rel('Same customer', r, { note: r.number }));
    case 'disputes': return data.disputes.filter((r) => r.item === row.item && r.id !== row.id && row.item).map((r) => rel('Same item', r, { note: r.reason }));
    default: return [];
  }
}

class SourceMix {
  init(params) {
    this.el = document.createElement('div'); this.el.className = 'tw-sb-mix';
    this.api = params.api;
    this.h = () => this.render();
    this.api.addEventListener('modelUpdated', this.h);
    this.render();
  }
  render() {
    let sb = 0, rp = 0;
    this.api.forEachNodeAfterFilterAndSort((n) => { if (n.data) (n.data.origin === 'sandbox' ? sb++ : rp++); });
    this.el.textContent = sb + rp ? `${sb} sandbox · ${rp} replayed` : '';
  }
  getGui() { return this.el; }
  destroy() { this.api.removeEventListener('modelUpdated', this.h); }
}

export class TwGrid extends TwWidget {
  kind = 'tw-grid-w';
  build() {
    this.root.innerHTML = `
      <div class="tw-head"></div>
      <div class="tw-tools">
        <label class="tw-qf"><span class="tw-sr">Filter rows</span><input type="search" placeholder="Filter rows" autocomplete="off"></label>
        <button type="button" class="tw-btn" data-act="reset">Reset columns</button>
        <button type="button" class="tw-btn" data-act="csv">Download CSV</button>
      </div>
      <div class="tw-grid-host"></div>`;
    this.head = this.root.querySelector('.tw-head');
    this.host = this.root.querySelector('.tw-grid-host');
    this.root.querySelector('.tw-qf input').addEventListener('input', (e) => this.api?.setGridOption('quickFilterText', e.target.value));
    this.root.querySelector('[data-act=reset]').addEventListener('click', () => { try { localStorage.removeItem(this.stateKey()); } catch { /* storage blocked */ } this.sig = null; this.update(); this.api?.resetColumnState?.(); });
    this.root.querySelector('[data-act=csv]').addEventListener('click', () => this.api?.exportDataAsCsv({ fileName: `${this.record?.spec?.dataset || 'rows'}.csv` }));
  }
  stateKey() { return `tw-grid:${this.params.widgetId}:${this.specHash || ''}`; }
  rows() {
    const spec = this.record.spec, d = this.ctx.data;
    if (!d) return [];
    const since = spec.sinceDays ? new Date(Date.parse(d.asOf) - spec.sinceDays * 86400000).toISOString() : null;
    return d[spec.dataset].filter((r) => matches(r, spec.where) && (!since || r.ts >= since));
  }
  dispose() { this.api?.destroy(); this.api = null; }
  update() {
    const rec = this.record;
    if (!rec || !this.ctx.data) return;
    const spec = rec.spec;
    this.head.innerHTML = this.headerHtml(spec.title, rec);
    this.root.setAttribute('aria-label', spec.title);
    const rows = this.rows();
    const sig = JSON.stringify(spec);
    if (sig !== this.sig || !this.api) {
      this.sig = sig; this.specHash = hash(sig);
      this.api?.destroy();
      this.api = createGrid(this.host, this.options(spec, rows));
      return;
    }
    this.api.setGridOption('rowData', rows);
    if (spec.totals && !spec.groupBy.length) this.api.setGridOption('pinnedBottomRowData', this.totalRow(spec, rows));
  }
  totalRow(spec, rows) {
    const out = { id: '__total', __total: true };
    const first = spec.columns[0].field;
    out[first] = 'Total';
    for (const c of spec.columns) {
      const f = DATASETS[spec.dataset].fields[c.field];
      if (f.type !== 'number' || !(c.agg || f.money)) continue;
      const vals = rows.map((r) => Number(r[c.field]) || 0);
      const agg = c.agg || 'sum';
      out[c.field] = agg === 'avg' ? vals.reduce((a, b) => a + b, 0) / (vals.length || 1) : agg === 'max' ? Math.max(0, ...vals) : agg === 'min' ? Math.min(...vals) : agg === 'count' ? vals.length : vals.reduce((a, b) => a + b, 0);
    }
    out.currency = rows[0]?.currency;
    return [out];
  }
  options(spec, rows) {
    const ds = DATASETS[spec.dataset];
    const maxCache = {};
    const maxOf = (field) => (maxCache[field] ??= Math.max(0, ...rows.map((r) => Number(r[field]) || 0)));
    const rulesByField = {};
    for (const r of spec.rules) (rulesByField[r.field] ||= []).push(r);
    const hl = new Set(spec.highlight || []);
    const cols = spec.columns.map((c) => {
      const f = ds.fields[c.field];
      const def = {
        field: c.field, headerName: c.header || f.label, minWidth: Math.max(c.width || 0, f.type === 'number' ? 120 : c.renderer === 'status' ? 150 : c.renderer === 'age' ? 150 : 110), pinned: c.pinned || null, aggFunc: c.agg || undefined, sortable: true, resizable: true,
        filter: f.type === 'number' ? 'agNumberColumnFilter' : f.enum ? 'agSetColumnFilter' : 'agTextColumnFilter',
        type: f.type === 'number' ? 'numericColumn' : undefined, valueFormatter: valueFormatter(c, f), cellRenderer: cellRenderer(c, f, maxOf),
        enableRowGroup: true, suppressHeaderFilterButton: true,
        cellClass: [c.renderer === 'id' ? 'tw-mono' : '', f.type === 'number' ? 'tw-num' : ''].filter(Boolean),
      };
      if (c.renderer === 'id') def.valueFormatter = undefined;
      if (rulesByField[c.field]) {
        def.cellClassRules = {};
        for (const r of rulesByField[c.field]) def.cellClassRules[`tw-tone tw-tone-${r.tone}`] = (p) => !p.node?.group && !p.node?.rowPinned && OPFN[r.op](p.value, r.value);
      }
      def.flex = c.field === 'reason' || c.field === 'recipient' ? 2 : 1;
      if (spec.sort?.field === c.field) def.sort = spec.sort.dir;
      return def;
    });
    for (const g of spec.groupBy) if (!cols.some((c) => c.field === g)) cols.unshift({ field: g, hide: true, rowGroup: true });
    for (const c of cols) if (spec.groupBy.includes(c.field)) { c.rowGroup = true; c.hide = true; }
    if (spec.sort && !cols.some((c) => c.field === spec.sort.field)) cols.push({ field: spec.sort.field, hide: true, sort: spec.sort.dir });
    if (hl.size) cols.unshift({ headerName: '', colId: '__flag', width: 52, minWidth: 52, maxWidth: 52, pinned: 'left', sortable: false, resizable: false, filter: false, enableRowGroup: false, suppressHeaderMenuButton: true, headerTooltip: 'Flagged by the watcher',
      valueGetter: (p) => (p.data && hl.has(p.data.id) ? 1 : 0), cellRenderer: (p) => { if (!p.value) return ''; const el = document.createElement('span'); el.className = 'tw-flag'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'Flagged by the watcher'); el.textContent = '▲'; return el; } });
    const data = this.ctx.data;
    let stored; try { stored = JSON.parse(localStorage.getItem(this.stateKey()) || 'null'); } catch { stored = null; }
    let timer;
    const options = {
      theme: gridTheme, rowData: rows, columnDefs: cols, getRowId: (p) => p.data.id,
      defaultColDef: { sortable: true, resizable: true, filter: true, menuTabs: ['filterMenuTab', 'generalMenuTab'] },
      quickFilterText: '', animateRows: true, cellSelection: true, enableBrowserTooltips: false, tooltipShowDelay: 300,
      initialState: stored || undefined,
      onStateUpdated: () => { clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(this.stateKey(), JSON.stringify(this.api.getState())); } catch { /* storage blocked */ } }, 400); },
      rowClassRules: { 'tw-row-flagged': (p) => !!p.data && hl.has(p.data.id) },
      statusBar: { statusPanels: [
        { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
        { statusPanel: SourceMix, align: 'center' },
        { statusPanel: 'agAggregationComponent', align: 'right' },
      ] },
      autoSizeStrategy: undefined,
    };
    if (spec.groupBy.length) {
      options.groupDefaultExpanded = 1;
      options.suppressAggFuncInHeader = true;
      options.autoGroupColumnDef = { headerName: spec.groupBy.map((g) => ds.fields[g].label).join(' / '), minWidth: 230, pinned: 'left', cellRendererParams: { suppressCount: false } };
      options.groupDisplayType = 'singleColumn';
      if (spec.totals) options.grandTotalRow = 'pinnedBottom';
    } else if (spec.totals) {
      options.pinnedBottomRowData = this.totalRow(spec, rows);
      options.getRowClass = (p) => (p.node.rowPinned ? 'tw-row-total' : undefined);
    }
    if (spec.detail === 'related' && !spec.groupBy.length) {
      options.masterDetail = true;
      options.detailRowAutoHeight = true;
      options.isRowMaster = (d) => related(spec.dataset, d, data).length > 0;
      options.detailCellRendererParams = {
        detailGridOptions: {
          theme: gridTheme, domLayout: 'autoHeight',
          columnDefs: [
            { field: 'relation', headerName: 'Relation', width: 150 }, { field: 'id', headerName: 'Id', cellClass: 'tw-mono', valueFormatter: (p) => midTrunc(p.value, 18), width: 170 },
            { field: 'status', headerName: 'Status', cellRenderer: (p) => (p.value ? pill(p.value) : ''), width: 140 }, { field: 'amount', headerName: 'Amount', type: 'numericColumn', valueFormatter: (p) => money(p.value, p.data?.currency), width: 110 },
            { field: 'ts', headerName: 'Time', valueFormatter: (p) => dtShort(p.value), width: 140 }, { field: 'note', headerName: 'Note', flex: 1, minWidth: 140 },
          ],
          defaultColDef: { sortable: true, resizable: true },
        },
        getDetailRowData: (p) => p.successCallback(related(spec.dataset, p.data, data)),
      };
    }
    return options;
  }
}

export { SourceMix };
