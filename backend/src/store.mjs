// One DynamoDB table (PK, SK), on-demand. A memory implementation with the same primitives backs the tests and local dev.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, BatchWriteCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { DATASET_IDS } from '../../shared/datasets.mjs';

export function dynamoPrimitives(table, client) {
  const doc = client || DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const strip = (it) => { if (!it) return null; const { PK, SK, ...rest } = it; return rest; };
  return {
    async put(pk, sk, obj) { await doc.send(new PutCommand({ TableName: table, Item: { PK: pk, SK: sk, ...obj } })); },
    async get(pk, sk) { const r = await doc.send(new GetCommand({ TableName: table, Key: { PK: pk, SK: sk } })); return strip(r.Item); },
    async del(pk, sk) { await doc.send(new DeleteCommand({ TableName: table, Key: { PK: pk, SK: sk } })); },
    async query(pk) {
      const out = []; let key;
      do {
        const r = await doc.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': pk }, ExclusiveStartKey: key }));
        for (const it of r.Items || []) out.push({ _sk: it.SK, ...strip(it) });
        key = r.LastEvaluatedKey;
      } while (key);
      return out;
    },
    async batchPut(pk, entries) {
      for (let i = 0; i < entries.length; i += 25) {
        let reqs = entries.slice(i, i + 25).map(([sk, obj]) => ({ PutRequest: { Item: { PK: pk, SK: sk, ...obj } } }));
        for (let attempt = 0; reqs.length && attempt < 6; attempt++) {
          const r = await doc.send(new BatchWriteCommand({ RequestItems: { [table]: reqs } }));
          reqs = r.UnprocessedItems?.[table] || [];
          if (reqs.length) await new Promise((res) => setTimeout(res, 100 * 2 ** attempt));
        }
        if (reqs.length) throw new Error('DynamoDB batch write left unprocessed items.');
      }
    },
    async append(pk, sk, attr, values) {
      await doc.send(new UpdateCommand({ TableName: table, Key: { PK: pk, SK: sk }, UpdateExpression: 'SET #a = list_append(if_not_exists(#a, :e), :v)', ExpressionAttributeNames: { '#a': attr }, ExpressionAttributeValues: { ':e': [], ':v': values } }));
    },
    async patch(pk, sk, patch) {
      const names = {}, vals = {}, sets = [];
      Object.entries(patch).forEach(([k, v], i) => { names[`#k${i}`] = k; vals[`:v${i}`] = v; sets.push(`#k${i} = :v${i}`); });
      await doc.send(new UpdateCommand({ TableName: table, Key: { PK: pk, SK: sk }, UpdateExpression: 'SET ' + sets.join(', '), ExpressionAttributeNames: names, ExpressionAttributeValues: vals }));
    },
    /** Atomically add 1 to a counter unless it has reached limit. Returns the new count, or null when over the limit. */
    async bump(pk, sk, limit, ttlSeconds) {
      try {
        const r = await doc.send(new UpdateCommand({ TableName: table, Key: { PK: pk, SK: sk }, UpdateExpression: 'ADD n :one SET expires = if_not_exists(expires, :ttl)', ConditionExpression: 'attribute_not_exists(n) OR n < :lim', ExpressionAttributeValues: { ':one': 1, ':lim': limit, ':ttl': Math.floor(Date.now() / 1000) + ttlSeconds }, ReturnValues: 'UPDATED_NEW' }));
        return r.Attributes.n;
      } catch (e) { if (e.name === 'ConditionalCheckFailedException') return null; throw e; }
    },
  };
}

export function memoryPrimitives() {
  const m = new Map();
  const bucket = (pk) => { if (!m.has(pk)) m.set(pk, new Map()); return m.get(pk); };
  const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
  return {
    async put(pk, sk, obj) { bucket(pk).set(sk, clone(obj)); },
    async get(pk, sk) { return clone(bucket(pk).get(sk)) ?? null; },
    async del(pk, sk) { bucket(pk).delete(sk); },
    async query(pk) { return [...bucket(pk).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([sk, v]) => ({ _sk: sk, ...clone(v) })); },
    async batchPut(pk, entries) { for (const [sk, obj] of entries) bucket(pk).set(sk, clone(obj)); },
    async append(pk, sk, attr, values) { const cur = bucket(pk).get(sk) || {}; cur[attr] = [...(cur[attr] || []), ...clone(values)]; bucket(pk).set(sk, cur); },
    async patch(pk, sk, patch) { bucket(pk).set(sk, { ...(bucket(pk).get(sk) || {}), ...clone(patch) }); },
    async bump(pk, sk, limit) { const cur = bucket(pk).get(sk) || { n: 0 }; if (cur.n >= limit) return null; cur.n++; bucket(pk).set(sk, cur); return cur.n; },
    dump() { return m; },
  };
}

const shrink = (v, max = 1800) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > max ? s.slice(0, max) + '…' : s; };

export function makeStore(prim) {
  return {
    prim,
    // ---- rows
    async getRows(dataset) { return (await prim.query(`ROW#${dataset}`)).map(({ _sk, d }) => d); },
    async getAllRows() { const out = {}; await Promise.all(DATASET_IDS.map(async (d) => { out[d] = await this.getRows(d); })); return out; },
    async putRows(dataset, rows) { if (rows.length) await prim.batchPut(`ROW#${dataset}`, rows.map((r) => [r.id, { d: r }])); },
    async getRow(dataset, id) { return (await prim.get(`ROW#${dataset}`, id))?.d ?? null; },
    // ---- meta
    async getMeta(key) { return (await prim.get('META', key))?.v ?? null; },
    async putMeta(key, v) { await prim.put('META', key, { v }); },
    // ---- findings
    async putFinding(f) { await prim.put('FINDING', f.id, { f }); },
    async getFinding(id) { return (await prim.get('FINDING', id))?.f ?? null; },
    async listFindings() { return (await prim.query('FINDING')).map((x) => x.f); },
    // ---- widgets
    async putWidget(w) { await prim.put('WIDGET', w.id, { w }); },
    async listWidgets() { return (await prim.query('WIDGET')).map((x) => x.w); },
    async deleteWidget(id) { await prim.del('WIDGET', id); },
    // ---- layout overrides edited by people in Studio edit mode
    async getLayout() { return (await prim.get('BOARD', 'layout'))?.v ?? {}; },
    async putLayout(v) { await prim.put('BOARD', 'layout', { v }); },
    // ---- runs (the agent's trail)
    async createRun(run) { await prim.put('RUN', run.id, { run, steps: [] }); },
    async step(runId, step) { await prim.append('RUN', runId, 'steps', [{ ...step, at: new Date().toISOString(), detail: step.detail === undefined ? undefined : shrink(step.detail) }]); },
    async finishRun(runId, patch) { await prim.patch('RUN', runId, { done: true, ...patch }); },
    async getRun(id) { const r = await prim.get('RUN', id); return r ? { ...r.run, steps: r.steps || [], done: !!r.done, summary: r.summary, error: r.error, fallback: r.fallback, usage: r.usage } : null; },
    async listRuns(limit = 8) { return (await prim.query('RUN')).sort((a, b) => (a._sk < b._sk ? 1 : -1)).slice(0, limit).map((r) => ({ ...r.run, done: !!r.done, summary: r.summary, error: r.error, fallback: r.fallback, usage: r.usage, model: r.model, stepCount: (r.steps || []).length })); },
    // ---- ownership: which PayPal resources this app created (webhooks are per app, so other projects' events arrive too)
    async markOwned(id, info) { await prim.put('OWN', id, info || { kind: 'x' }); },
    async isOwned(id) { return !!(await prim.get('OWN', id)); },
    async listOwned() { return (await prim.query('OWN')).map(({ _sk, ...rest }) => ({ id: _sk, ...rest })); },
    // ---- webhooks
    async putWebhook(id, rec) { await prim.put('WH', id, { ...rec, expires: Math.floor(Date.now() / 1000) + 14 * 86400 }); },
    async getWebhook(id) { return prim.get('WH', id); },
    async patchWebhook(id, patch) { await prim.patch('WH', id, patch); },
    async listWebhooks(limit = 20) { return (await prim.query('WH')).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)).slice(0, limit); },
    // ---- fixed-window rate limits for public endpoints
    async allow(name, limit, windowSeconds) {
      const w = Math.floor(Date.now() / 1000 / windowSeconds);
      return (await prim.bump('LIMIT', `${name}#${w}`, limit, windowSeconds * 3)) !== null;
    },
  };
}
