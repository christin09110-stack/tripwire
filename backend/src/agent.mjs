// The watcher agent: a Bedrock Converse tool-use loop. The model investigates detector candidates with real tools
// (query the stream, compute a rate, compare to baseline), records a finding, and builds the widgets that show it.
// Every tool validates its input and answers with exact errors, so a bad widget spec is corrected in the loop
// instead of reaching the board.
import { DATASETS, DATASET_IDS, schemaText, fieldIds } from '../../shared/datasets.mjs';
import { METRICS, METRIC_IDS, series, compare, breakdown, matches, floorFor } from '../../shared/metrics.mjs';
import { validateFinding, validateWidget, WIDGET_TYPES, findingPageId, makeWidget, TONES, RENDERERS, AGGS, OPS } from '../../shared/widgets.mjs';
import { BedrockUnavailable } from './bedrock.mjs';

const MAX_WIDGETS_PER_FINDING = 5;
const MAX_TURNS = 18;
export const findingIdFor = (candidateId) => 'fd-' + candidateId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);

export const SYSTEM = `You are Tripwire's watcher. You monitor a stream of PayPal activity (payout items, invoices, captures, refunds, disputes) for a small marketplace and decide which unusual patterns are real, explain them, and build the dashboard widgets that show them.

A deterministic detector has already flagged candidates. Your job:
1. Call list_candidates once. Then investigate with query_stream, compute_rate and compare_baseline. Call several tools in one turn when they are independent.
2. For each candidate decide: real problem (record_finding) or noise (dismiss_candidate with a reason a person would accept). Look for the cause: break the pattern down by item, channel, recipient or reason until one value explains most of it. Check whether it has happened before in the last 30 days. If two candidates share a cause (the same item, the same channel), say so in both summaries.
3. Each candidate in list_candidates carries the finding_id you will get from record_finding. You may call record_finding and that finding's build_widget calls in the same turn, and handle several candidates in one turn. After record_finding, call build_widget two to four times for that finding, choosing the widget and its configuration to fit this anomaly. Do not reuse one layout for every finding. Guidance:
   - tw-trend: a rate or volume over time with a baseline band. Use it when the question is "how did this change". Pick the metric and chartType (line, area, column) to suit it; bucket "hour" only when the event is within the last two days.
   - tw-breakdown: where the problem concentrates (by item, channel, recipient, reason, age bucket). chartType bar for long labels, column for few, donut for shares of a whole.
   - tw-grid: the rows behind the finding. Filter with where so every row is relevant, choose 4 to 8 columns, group with groupBy and give number columns an agg when it helps, set totals true when a sum matters, pin the id or recipient column left, add rules to colour the values that matter, and set detail "related" when a row has useful neighbours (the other items in a payout batch, the refunds on a capture).
   Sizes: width 6 to 24 and height in grid tracks of about 15px. A grid wants width 24 and height 22 to 30. Charts want width 12 and height 18 to 22. Smaller heights are raised to the minimum (grid 20, chart 16).
4. Never state a number you did not get from a tool. Give each finding a brief for its card: at most 22 words, one or two short sentences, adding only what the title and headline leave out. Write for the person who runs the account: say what happened, how far from normal, the likely cause, and what to do. Plain sentences, no marketing words, no "we".
5. Stop when every candidate is recorded or dismissed. End with two plain sentences summarising what you found.

Datasets and fields:
${schemaText()}

Metrics: ${METRIC_IDS.join(', ')}.
Source: origin "sandbox" rows are real PayPal sandbox objects; origin "replay" rows are replayed history. Say which when it matters.
The stream clock is in each call's result as asOf; never assume today's date.`;

const j = (o) => ({ json: o });

export function toolSpecs() {
  const ds = { type: 'string', enum: DATASET_IDS };
  const where = { type: 'object', description: 'Filter. Keys are fields of the dataset. Values: a scalar, an array (any of), or an object with gt, gte, lt, lte, ne, nin, prefix, contains.' };
  const metric = { type: 'string', enum: METRIC_IDS };
  const t = (name, description, properties, required = []) => ({ toolSpec: { name, description, inputSchema: j({ type: 'object', properties, required }) } });
  return {
    tools: [
      t('list_candidates', 'List the anomaly candidates the detector flagged, with their numbers. Call this first.', {}),
      t('query_stream', 'Query a dataset. With group_by it returns grouped counts or sums; without it returns matching rows (newest first, at most 20) and totals.', {
        dataset: ds, where, group_by: { type: 'string', description: 'A field to group by.' }, agg: { type: 'string', enum: ['count', 'sum'] }, field: { type: 'string', description: 'Numeric field to sum.' },
        since_days: { type: 'integer', minimum: 1, maximum: 60 }, limit: { type: 'integer', minimum: 1, maximum: 20 },
      }, ['dataset']),
      t('compute_rate', 'Compute a metric as a time series (day or hour buckets) with the latest bucket compared with the baseline.', {
        metric, where, bucket: { type: 'string', enum: ['day', 'hour'] }, buckets: { type: 'integer', minimum: 7, maximum: 60 },
      }, ['metric']),
      t('compare_baseline', 'Compare the latest window of a metric with the buckets before it: baseline, multiple, z-score, and how many earlier days were as bad.', {
        metric, where, window: { type: 'integer', minimum: 1, maximum: 7, description: 'How many latest day buckets form the current window.' },
      }, ['metric']),
      t('record_finding', 'Record a confirmed finding for a candidate. Returns the finding_id to attach widgets to.', {
        candidate_id: { type: 'string' }, kind: { type: 'string', enum: ['refund_spike', 'payout_cluster', 'invoice_ageing', 'dispute_pattern'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        title: { type: 'string', description: 'Up to 90 characters, specific: name the item, recipient or reason.' }, headline: { type: 'string', description: 'The one number that matters, e.g. "44% refunded vs 2.5% normal".' },
        summary: { type: 'string', description: 'Three or four sentences: what happened, how far from normal, likely cause, whether it has happened before. Shown on the finding page.' },
        brief: { type: 'string', description: 'The card text: at most 22 words in one or two short sentences, so it fits two lines on a card. It carries ONLY what the title and headline do not already say (for example: first time in 30 days; what is still awaiting action; the likely cause). Never repeat the title, the headline or their numbers.' },
        actions: { type: 'array', items: { type: 'string' }, description: 'One to three concrete next steps.' },
        evidence_ids: { type: 'array', items: { type: 'string' }, description: 'Ids of the rows that show it (at most 40).' }, confidence: { type: 'number', minimum: 0, maximum: 1 },
      }, ['candidate_id', 'kind', 'severity', 'title', 'headline', 'summary', 'actions', 'confidence']),
      t('build_widget', 'Construct a dashboard widget for a recorded finding. The spec is validated and checked against the data; errors say exactly what to fix.', {
        finding_id: { type: 'string' }, type: { type: 'string', enum: WIDGET_TYPES.filter((x) => x !== 'tw-brief') },
        spec: { type: 'object', description: `tw-grid: {dataset, title, where, columns:[{field, header?, width?, pinned?:"left"|"right", agg?:${AGGS.join('|')}, renderer?:${RENDERERS.join('|')}}], groupBy?:[field], sort?:{field,dir}, totals?:bool, detail?:"none"|"related", rules?:[{field, op:${OPS.join('|')}, value, tone:${TONES.join('|')}, label?}], highlight?:[ids], sinceDays?}. tw-trend: {metric, title, bucket?:"day"|"hour", buckets?, chartType?:"line"|"area"|"column", baseline?:"band"|"none", flag?:number of latest buckets to mark, where?, caption?}. tw-breakdown: {dataset, by, agg?:"count"|"sum", field?, where?, limit?, chartType?:"bar"|"column"|"donut", highlight?:[keys], sinceDays?, title, caption?}.` },
        width: { type: 'integer', minimum: 6, maximum: 24 }, height: { type: 'integer', minimum: 8, maximum: 44 },
      }, ['finding_id', 'type', 'spec']),
      t('dismiss_candidate', 'Dismiss a candidate that is noise or already explained. Give a reason a person would accept.', { candidate_id: { type: 'string' }, reason: { type: 'string' } }, ['candidate_id', 'reason']),
    ],
  };
}

const round = (x, d = 4) => (typeof x === 'number' ? Math.round(x * 10 ** d) / 10 ** d : x);
const compactCompare = (c) => (c.ok ? { kind: c.kind, current: round(c.current), baseline: round(c.baseline), multiple: round(c.multiple, 2), z: round(c.z, 1), earlier_buckets_as_high: c.exceedances, baseline_max_bucket: round(c.baselineMax), current_num: c.currentNum, current_den: c.currentDen } : { error: c.reason });

/** ctx: { data, candidates, store, runId, now, state } — state accumulates findings/widgets/dismissed. */
export function makeTools(ctx) {
  const { data, candidates, state } = ctx;
  const byCand = new Map(candidates.map((c) => [c.id, c]));
  const sinceFor = (days) => (days ? new Date(Date.parse(data.asOf) - days * 86400000).toISOString() : null);

  const impl = {
    list_candidates() {
      return { asOf: data.asOf, count: candidates.length, candidates: candidates.map((c) => ({ id: c.id, finding_id: findingIdFor(c.id), kind: c.kind, subject: c.subject, severity_hint: c.severity, metric: { id: c.metric.id, current: round(c.metric.current), baseline: round(c.metric.baseline), multiple: round(c.metric.multiple, 2), z: round(c.metric.z, 1) }, window: c.window.label, evidence_count: c.evidenceIds.length, hint: c.headlineHint, drill: c.drill })) };
    },
    query_stream({ dataset, where, group_by, agg = 'count', field, since_days, limit = 8 }) {
      if (!DATASETS[dataset]) return { error: `dataset must be one of ${DATASET_IDS.join(', ')}.` };
      const ids = fieldIds(dataset);
      for (const k of Object.keys(where || {})) if (!ids.includes(k)) return { error: `where.${k} is not a field of ${dataset}. Fields: ${ids.join(', ')}.` };
      if (group_by && !ids.includes(group_by)) return { error: `group_by ${group_by} is not a field of ${dataset}.` };
      if (agg === 'sum' && !(field && DATASETS[dataset].fields[field]?.type === 'number')) return { error: 'agg sum needs a numeric field.' };
      const since = sinceFor(since_days);
      if (group_by) return { dataset, asOf: data.asOf, group_by, agg, groups: breakdown(data, dataset, { by: group_by, where, agg, field, since, limit: Math.min(limit, 20) }) };
      const rows = data[dataset].filter((r) => matches(r, where) && (!since || r.ts >= since)).sort((a, b) => (a.ts < b.ts ? 1 : -1));
      const sum = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
      return { dataset, asOf: data.asOf, matched: rows.length, total_amount: round(sum, 2), rows: rows.slice(0, Math.min(limit, 20)) };
    },
    compute_rate({ metric, where, bucket = 'day', buckets }) {
      if (!METRICS[metric]) return { error: `metric must be one of ${METRIC_IDS.join(', ')}.` };
      const n = buckets || (bucket === 'hour' ? 36 : 30);
      const s = series(data, metric, { buckets: n, bucket, where });
      const pts = s.points.slice(-14).map((p) => [p.t, round(p.value), p.num, p.den]);
      return { metric, unit: METRICS[metric].unit, bucket, asOf: data.asOf, points_t_value_num_den: pts, latest_vs_baseline: compactCompare(compare(s.points, { window: 1, floor: floorFor(metric) })) };
    },
    compare_baseline({ metric, where, window = 1 }) {
      if (!METRICS[metric]) return { error: `metric must be one of ${METRIC_IDS.join(', ')}.` };
      const s = series(data, metric, { buckets: 30 + window, where });
      const c = compare(s.points, { window, floor: floorFor(metric) });
      const base = s.points.slice(0, s.points.length - window);
      const cur = c.ok ? c.current : 0;
      const days = c.ok ? base.filter((p) => (p.den !== null ? (p.den ? p.num / p.den : 0) : p.value) >= cur && cur > 0).map((p) => p.t) : [];
      return { metric, window_buckets: window, asOf: data.asOf, ...compactCompare(c), earlier_days_as_high: days.slice(0, 6), first_time_in_30_days: c.ok ? days.length === 0 : null };
    },
    record_finding(a) {
      const cand = byCand.get(a.candidate_id);
      if (!cand) return { error: `candidate_id must be one of ${[...byCand.keys()].join(', ')}.` };
      const v = validateFinding({ candidateId: a.candidate_id, kind: a.kind, severity: a.severity, title: a.title, headline: a.headline, summary: a.summary, brief: a.brief, actions: a.actions, evidenceIds: a.evidence_ids?.length ? a.evidence_ids : cand.evidenceIds, confidence: a.confidence });
      if (!v.ok) return { error: v.errors.join(' ') };
      const id = findingIdFor(cand.id);
      const known = new Set([...data.payout_items, ...data.invoices, ...data.captures, ...data.refunds, ...data.disputes].map((r) => r.id));
      const unknown = v.finding.evidenceIds.filter((e) => !known.has(e));
      if (unknown.length) return { error: `evidence_ids not in the stream: ${unknown.slice(0, 5).join(', ')}. Use ids returned by query_stream.` };
      state.findings[id] = { ...v.finding, id, status: 'open', author: 'bedrock', metric: cand.metric, window: cand.window, fingerprint: cand.fingerprint, runId: ctx.runId, createdAt: ctx.now(), updatedAt: ctx.now() };
      state.widgetCount[id] = state.widgetCount[id] || 0;
      return { finding_id: id, note: 'Now call build_widget two to four times for this finding.' };
    },
    build_widget({ finding_id, type, spec, width, height }) {
      const f = state.findings[finding_id];
      if (!f) return { error: `finding_id ${finding_id} has not been recorded in this run. Call record_finding first.` };
      if ((state.widgetCount[finding_id] || 0) >= MAX_WIDGETS_PER_FINDING) return { error: `A finding takes at most ${MAX_WIDGETS_PER_FINDING} widgets.` };
      if (!WIDGET_TYPES.includes(type) || type === 'tw-brief') return { error: `type must be one of ${WIDGET_TYPES.filter((x) => x !== 'tw-brief').join(', ')}. The brief card is added automatically.` };
      const v = validateWidget({ type, spec, layout: { w: width, h: height } });
      if (!v.ok) return { error: v.errors.join(' ') };
      const check = previewCheck(data, type, v.spec);
      if (check.error) return { error: check.error };
      const order = state.widgetCount[finding_id]++;
      const w = makeWidget({ id: `w-${finding_id.slice(3, 40)}-${order + 1}`, findingId: finding_id, type, spec: v.spec, layout: v.layout, order, author: 'bedrock', runId: ctx.runId, now: ctx.now() });
      state.widgets[w.id] = w;
      return { widget_id: w.id, page: findingPageId(finding_id), preview: check.preview };
    },
    dismiss_candidate({ candidate_id, reason }) {
      const cand = byCand.get(candidate_id);
      if (!cand) return { error: `candidate_id must be one of ${[...byCand.keys()].join(', ')}.` };
      if (!reason || reason.length < 12) return { error: 'Give a reason of at least a sentence.' };
      state.dismissed[candidate_id] = { reason: reason.slice(0, 400), fingerprint: cand.fingerprint, at: ctx.now() };
      return { dismissed: candidate_id };
    },
  };
  return { impl, run(name, input) { const f = impl[name]; if (!f) return { error: `Unknown tool ${name}.` }; try { return f(input || {}); } catch (e) { return { error: `Tool failed: ${e.message}` }; } } };
}

/** The data check behind build_widget: a widget that would render empty is an error the model must fix. */
export function previewCheck(data, type, spec) {
  if (type === 'tw-grid' || type === 'tw-breakdown') {
    const since = spec.sinceDays ? new Date(Date.parse(data.asOf) - spec.sinceDays * 86400000).toISOString() : null;
    const rows = data[spec.dataset].filter((r) => matches(r, spec.where) && (!since || r.ts >= since));
    if (!rows.length) return { error: `This ${type} would be empty: no ${spec.dataset} rows match where=${JSON.stringify(spec.where || {})}${since ? ` in the last ${spec.sinceDays} days` : ''}. Loosen the filter.` };
    return { preview: { rows: rows.length } };
  }
  if (type === 'tw-trend') {
    const s = series(data, spec.metric, { buckets: spec.buckets, bucket: spec.bucket, where: spec.where });
    const max = Math.max(...s.points.map((p) => p.value));
    if (!(max > 0)) return { error: `The ${spec.metric} series is all zero for this filter and bucket. Pick a wider window or a different metric.` };
    return { preview: { buckets: s.points.length, max: round(max) } };
  }
  return { preview: {} };
}

function blocksText(msg) { return (msg.content || []).filter((b) => b.text).map((b) => b.text).join('\n'); }

/**
 * The Converse loop. Returns { summary, turns, usage }. Throws BedrockUnavailable when the model cannot be reached;
 * the caller keeps whatever state the loop had already built and falls back to rules for the rest.
 */
export async function investigate({ bedrock, ctx, onStep, maxTurns = MAX_TURNS }) {
  const tools = makeTools(ctx);
  const toolConfig = toolSpecs();
  const first = `Stream clock: ${ctx.data.asOf}. ${ctx.candidates.length} candidate(s) flagged by the detector. Begin.`;
  const messages = [{ role: 'user', content: [{ text: first }] }];
  const usage = { input: 0, output: 0, calls: 0 };
  let summary = '';
  for (let turn = 0; turn < maxTurns; turn++) {
    const r = await bedrock.converse({ system: SYSTEM, messages, toolConfig, onRetry: (x) => onStep?.({ kind: 'retry', detail: `Bedrock ${x.error}; waiting ${Math.round(x.delay / 1000)}s (attempt ${x.attempt}).` }) });
    usage.input += r.usage.inputTokens || 0; usage.output += r.usage.outputTokens || 0; usage.calls++;
    messages.push(r.message);
    const text = blocksText(r.message);
    const uses = (r.message.content || []).filter((b) => b.toolUse).map((b) => b.toolUse);
    if (text) onStep?.({ kind: 'model', detail: text });
    if (!uses.length) { summary = text; break; }
    const results = [];
    for (const u of uses) {
      const out = tools.run(u.name, u.input);
      const failed = !!out.error;
      onStep?.({ kind: 'tool', tool: u.name, input: u.input, detail: failed ? `Error: ${out.error}` : out, ok: !failed });
      let body = JSON.stringify(out);
      if (body.length > 9000) body = body.slice(0, 9000) + '…truncated';
      results.push({ toolResult: { toolUseId: u.toolUseId, content: [{ text: body }], status: failed ? 'error' : 'success' } });
    }
    messages.push({ role: 'user', content: results });
    if (r.stopReason === 'max_tokens') onStep?.({ kind: 'note', detail: 'Model reply hit the token limit; continuing.' });
  }
  return { summary, usage, messages };
}

export { BedrockUnavailable };
