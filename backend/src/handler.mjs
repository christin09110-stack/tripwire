// Request routing. Pure of AWS specifics: deps (store, PayPal client, Bedrock, async invoker) are injected, so the same
// routes run in Lambda, in the local dev server and in the tests.
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { DATASET_IDS } from '../../shared/datasets.mjs';
import { intake, processWebhook } from './webhook.mjs';
import { scan, loadData } from './watch.mjs';
import { BedrockUnavailable } from './bedrock.mjs';
import { payoutRows } from './ingest.mjs';
import { existingBatchId, isDuplicateRequestId } from './paypal.mjs';
import { validateWidget, makeWidget } from '../../shared/widgets.mjs';
import { previewCheck } from './agent.mjs';

const LIMITS = { scan: [8, 3600], llm: [90, 3600], activity: [6, 3600] };
const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) });
const tooMany = (what) => json(429, { error: 'rate_limited', message: `Too many ${what} requests. Try again in a few minutes.` }, { 'retry-after': '300' });

export function makeApp(deps) {
  const { store, invoke, now = () => new Date().toISOString(), webhookId = '' } = deps;
  const pp = () => deps.pp();

  async function board() {
    const [findings, widgets, runs] = await Promise.all([store.listFindings(), store.listWidgets(), store.listRuns(5)]);
    const asOf = (await store.getMeta('asOf')) || null;
    return { asOf, findings, widgets, runs, model: deps.model || null };
  }

  async function diagnostics() {
    const rows = await store.getAllRows();
    const bySource = {};
    for (const d of DATASET_IDS) { bySource[d] = { sandbox: 0, replay: 0 }; for (const r of rows[d]) bySource[d][r.origin === 'sandbox' ? 'sandbox' : 'replay']++; }
    const hooks = await store.listWebhooks(40);
    const byStatus = {};
    for (const h of hooks) byStatus[h.status] = (byStatus[h.status] || 0) + 1;
    const runs = await store.listRuns(5);
    return { asOf: await store.getMeta('asOf'), bySource, webhooks: { recent: hooks.length, byStatus, last: hooks.slice(0, 5).map((h) => ({ receivedAt: h.receivedAt, status: h.status, eventType: h.eventType || null, note: h.note || null })) }, runs, model: deps.model || null, paypal: 'sandbox', webhookConfigured: !!webhookId };
  }

  async function runDataGzip(headers) {
    const rows = await store.getAllRows();
    const asOf = (await store.getMeta('asOf')) || null;
    const payload = JSON.stringify({ asOf, rows });
    if ((headers['accept-encoding'] || '').includes('gzip')) {
      return { status: 200, isBase64: true, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'no-store' }, body: gzipSync(payload).toString('base64') };
    }
    return { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: payload };
  }

  async function route(req) {
    const { method, path, headers = {}, query = {} } = req;
    const body = req.body || '';
    try {
      if (method === 'OPTIONS') return { status: 204, headers: {}, body: '' };
      if (method === 'GET' && path === '/api/health') return json(200, { ok: true, time: now(), asOf: await store.getMeta('asOf') });
      if (method === 'GET' && path === '/api/board') return json(200, await board());
      if (method === 'GET' && path === '/api/data') return runDataGzip(headers);
      if (method === 'GET' && path === '/api/diagnostics') return json(200, await diagnostics());
      if (method === 'GET' && path === '/api/runs') return json(200, { runs: await store.listRuns(10) });
      if (method === 'GET' && path.startsWith('/api/runs/')) {
        const run = await store.getRun(decodeURIComponent(path.slice('/api/runs/'.length)));
        return run ? json(200, run) : json(404, { error: 'not_found', message: 'No such run.' });
      }
      if (method === 'POST' && path === '/api/scan') {
        if (!(await store.allow('scan', ...LIMITS.scan))) return tooMany('scan');
        const input = body ? safeJson(body) : {};
        const runId = `r-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
        await store.createRun({ id: runId, trigger: 'manual', startedAt: now() });
        await invoke({ op: 'scan', runId, trigger: 'manual', force: !!input.force });
        return json(202, { runId });
      }
      if (method === 'POST' && /^\/api\/findings\/[^/]+\/status$/.test(path)) {
        const id = decodeURIComponent(path.split('/')[3]);
        const status = safeJson(body).status;
        if (!['open', 'reviewed'].includes(status)) return json(400, { error: 'bad_request', message: 'status must be open or reviewed.' });
        const f = await store.getFinding(id);
        if (!f) return json(404, { error: 'not_found', message: 'No such finding.' });
        await store.putFinding({ ...f, status, updatedAt: now() });
        return json(200, { ok: true, status });
      }
      if (method === 'POST' && path === '/api/widgets') {
        if (!(await store.allow('widgets', 40, 3600))) return tooMany('widget');
        const input = safeJson(body);
        const f = await store.getFinding(String(input.findingId || ''));
        if (!f) return json(404, { error: 'not_found', message: 'No such finding. Pick one from the board.' });
        const v = validateWidget({ type: input.type, spec: input.spec, layout: { w: input.width, h: input.height } });
        if (!v.ok) return json(422, { error: 'invalid_spec', message: v.errors.join(' ') });
        const { data } = await loadData(store);
        const chk = previewCheck(data, input.type, v.spec);
        if (chk.error) return json(422, { error: 'empty_widget', message: chk.error });
        const existing = (await store.listWidgets()).filter((w) => w.findingId === f.id);
        const order = existing.reduce((m, w) => Math.max(m, w.order), -1) + 1;
        const w = makeWidget({ id: `w-${f.id.slice(3, 36)}-u${Date.now().toString(36)}`, findingId: f.id, type: input.type, spec: v.spec, layout: v.layout, order, author: 'chat', runId: null, now: now() });
        await store.putWidget(w);
        return json(201, { widgetId: w.id, pageId: w.page });
      }
      if (method === 'POST' && path === '/api/llm') return llm(body);
      if (method === 'POST' && path === '/api/activity') {
        if (!(await store.allow('activity', ...LIMITS.activity))) return tooMany('activity');
        const input = safeJson(body);
        const preset = ['nordhaven', 'mixed'].includes(input.preset) ? input.preset : 'mixed';
        const activityId = `a-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
        await store.putMeta(`activity#${activityId}`, { status: 'queued', preset, at: now() });
        await invoke({ op: 'activity', activityId, preset });
        return json(202, { activityId });
      }
      if (method === 'GET' && path.startsWith('/api/activity/')) {
        const a = await store.getMeta(`activity#${path.slice('/api/activity/'.length)}`);
        return a ? json(200, a) : json(404, { error: 'not_found', message: 'No such activity.' });
      }
      if (method === 'POST' && path === '/api/webhook') {
        const { id, rec } = intake({ headers, body, now });
        await store.putWebhook(id, rec);
        await invoke({ op: 'webhook', id });
        return json(200, { received: true });
      }
      return json(404, { error: 'not_found', message: `No route for ${method} ${path}.` });
    } catch (e) {
      console.error('route error', method, path, e);
      return json(500, { error: 'server_error', message: 'The request failed on the server. Try again in a moment.' });
    }
  }

  async function llm(rawBody) {
    if (!deps.bedrock) return json(503, { error: 'bedrock_unavailable', message: 'The model is not configured.' });
    if (!(await store.allow('llm', ...LIMITS.llm))) return tooMany('model');
    if (rawBody.length > 600000) return json(413, { error: 'too_large', message: 'The conversation is too long. Start a new one.' });
    const { system, messages, toolConfig, maxTokens } = safeJson(rawBody);
    if (!Array.isArray(messages) || !messages.length || messages.length > 80) return json(400, { error: 'bad_request', message: 'messages must be a non-empty array of at most 80 items.' });
    try {
      const out = await deps.bedrock.converse({ system, messages, toolConfig, maxTokens: Math.min(Number(maxTokens) || 2000, 3000), deadlineMs: 100000 });
      return json(200, { message: out.message, stopReason: out.stopReason, usage: out.usage, meta: { attempts: out.attempts, waitedMs: out.waitedMs, model: deps.bedrock.model } });
    } catch (e) {
      if (e instanceof BedrockUnavailable) return json(503, { error: 'bedrock_unavailable', message: 'The model is rate limited right now. Try again in a minute.', info: e.info });
      console.error('llm error', e);
      return json(502, { error: 'model_error', message: 'The model returned an error. Rephrase the request and try again.' });
    }
  }

  // ---- async operations (invoked by the Lambda itself, never by the public)
  async function runScan({ runId, trigger = 'manual', force = false }) {
    return scan({ store, bedrock: deps.bedrock, runId, trigger, force, useModel: !!deps.bedrock, now });
  }

  async function requestScan(trigger) {
    if (!(await store.allow('scan-auto', 1, 120))) return false;
    const runId = `r-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
    await store.createRun({ id: runId, trigger, startedAt: now() });
    await invoke({ op: 'scan', runId, trigger, force: false });
    return true;
  }

  async function runWebhook(id) {
    return processWebhook(id, { store, pp: pp(), webhookId, requestScan });
  }

  /** Real sandbox activity on demand. Idempotent: the sender_batch_id and PayPal-Request-Id come from the activity id. */
  async function runActivity({ activityId, preset }) {
    const set = (v) => store.putMeta(`activity#${activityId}`, { preset, at: now(), ...v });
    try {
      await set({ status: 'sending' });
      const suffix = activityId.replace(/[^a-z0-9]/gi, '').slice(-8);
      const items = [
        { receiver: 'sb-patient@personal.example.com', amount: '45.00', label: 'Studio rent share' },
        preset === 'nordhaven'
          ? { receiver: 'accounts@nordhaven-logistics.example', amount: '240.00', label: 'nordhaven-logistics' }
          : { receiver: `new-vendor-${suffix}@pellucid-print.example`, amount: '130.00', label: 'pellucid-print' },
        { receiver: 'sb-patient@personal.example.com', amount: '88.00', label: 'Courier invoice' },
      ].map((x, i) => ({ recipient_type: 'EMAIL', receiver: x.receiver, amount: { value: x.amount, currency: 'USD' }, note: `tw:${x.label}`, sender_item_id: `${activityId}-${i + 1}`.slice(0, 60) }));
      const sbid = `tw-act-${activityId}`.slice(0, 60);
      let batchId;
      try {
        const created = await pp().createPayout({ sender_batch_header: { sender_batch_id: sbid, email_subject: 'Tripwire test payout' }, items }, sbid);
        batchId = created.batch_header.payout_batch_id;
      } catch (e) {
        batchId = existingBatchId(e);
        if (!batchId && !isDuplicateRequestId(e)) throw e;
      }
      await store.markOwned(batchId, { kind: 'payout_batch' });
      await set({ status: 'polling', batchId });
      let batch;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, i ? 5000 : 3000));
        batch = await pp().getBatch(batchId);
        const settled = ['SUCCESS', 'DENIED', 'CANCELED'].includes(batch.batch_header.batch_status) && batch.items.every((x) => x.transaction_status !== 'PENDING');
        if (settled) break;
      }
      const head = (await store.getMeta('asOf')) || undefined;
      const rows = payoutRows(batch, { head });
      for (const it of batch.items) await store.markOwned(it.payout_item_id, { kind: 'payout_item', batch: batchId });
      await store.putRows('payout_items', rows);
      const newHead = rows.map((r) => r.ts).sort().pop();
      if (newHead && (!head || newHead > head)) await store.putMeta('asOf', newHead);
      await set({ status: 'done', batchId, items: batch.items.map((x) => ({ id: x.payout_item_id, status: x.transaction_status, reason: x.errors?.name || null })) });
      await requestScan('activity');
    } catch (e) {
      console.error('activity error', e);
      await set({ status: 'failed', error: e.message });
    }
  }

  /** Lambda direct-invoke entrypoint for async work. */
  async function runOp(ev) {
    if (ev.op === 'scan') return runScan(ev);
    if (ev.op === 'webhook') return runWebhook(ev.id);
    if (ev.op === 'activity') return runActivity(ev);
    return null;
  }

  return { route, runOp, runScan, runWebhook, runActivity, requestScan, board, diagnostics };
}

function safeJson(s) { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } }
