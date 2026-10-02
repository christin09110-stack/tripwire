// Local dev server on :8788 with the real handler, an in-memory store loaded from seed/snapshot.json, real Bedrock and real PayPal.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { makeStore, memoryPrimitives } from './store.mjs';
import { makeBedrock, MODEL } from './bedrock.mjs';
import { makePayPal } from './paypal.mjs';
import { makeApp } from './handler.mjs';
import { loadEnv } from '../../scripts/env.mjs';
import { DATASET_IDS } from '../../shared/datasets.mjs';

const root = new URL('../../', import.meta.url);
const env = loadEnv();
const snap = JSON.parse(readFileSync(new URL('seed/snapshot.json', root)));
export const store = makeStore(memoryPrimitives());
for (const d of DATASET_IDS) await store.putRows(d, snap.rows[d]);
for (const o of snap.owned) await store.markOwned(o.id, o);
await store.putMeta('asOf', snap.asOf);
const pre = new URL('seed/scan-out.json', root);
if (existsSync(pre) && !process.env.FRESH) {
  const s = JSON.parse(readFileSync(pre));
  for (const f of s.findings) await store.putFinding(f);
  for (const w of s.widgets) await store.putWidget(w);
  if (s.run) { await store.createRun({ id: s.run.id, trigger: s.run.trigger, startedAt: s.run.startedAt }); for (const st of s.run.steps || []) await store.step(s.run.id, st); await store.finishRun(s.run.id, { summary: s.run.summary, usage: s.run.usage, fallback: s.run.fallback, model: s.run.model }); }
}
const pp = makePayPal({ clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_SECRET, api: env.PAYPAL_API });
const app = makeApp({
  store, pp: () => pp, bedrock: process.env.NO_BEDROCK ? null : makeBedrock(), model: MODEL, webhookId: process.env.WEBHOOK_ID || '',
  invoke: async (payload) => { setTimeout(() => app.runOp(payload).catch((e) => console.error('op failed', e)), 0); },
});
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': '*' };
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const u = new URL(req.url, 'http://x');
  const out = await app.route({ method: req.method, path: u.pathname, headers: req.headers, query: Object.fromEntries(u.searchParams), body: Buffer.concat(chunks).toString('utf8') });
  res.writeHead(out.status, { ...cors, ...out.headers });
  res.end(out.isBase64 ? Buffer.from(out.body, 'base64') : out.body);
}).listen(8788, () => console.log('Tripwire API on http://localhost:8788'));
