// Build the stream from replay + the live manifest and write it to a JSON snapshot (local dev and tests), or to DynamoDB with --dynamo.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadEnv } from './env.mjs';
import { makePayPal } from '../backend/src/paypal.mjs';
import { fetchLiveRows, combine, headOf } from '../backend/src/seed.mjs';
import { makeStore, dynamoPrimitives, memoryPrimitives } from '../backend/src/store.mjs';
import { DATASET_IDS } from '../shared/datasets.mjs';

const args = process.argv.slice(2);
const e = loadEnv();
const pp = makePayPal({ clientId: e.PAYPAL_CLIENT_ID, secret: e.PAYPAL_SECRET, api: e.PAYPAL_API });
const manifest = JSON.parse(readFileSync(new URL('../seed/live-manifest.json', import.meta.url)));
const { rows: live, owned } = await fetchLiveRows(pp, manifest, { log: console.log });
const { rows, endBefore } = combine(live);
const asOf = headOf(rows);
console.log('replay ends before', endBefore, 'asOf', asOf, Object.fromEntries(DATASET_IDS.map((d) => [d, rows[d].length])));
mkdirSync(new URL('../seed/', import.meta.url), { recursive: true });
writeFileSync(new URL('../seed/snapshot.json', import.meta.url), JSON.stringify({ asOf, rows, owned }));
if (args.includes('--dynamo')) {
  const table = process.env.TABLE || 'tripwire';
  const store = makeStore(dynamoPrimitives(table));
  for (const d of DATASET_IDS) await store.putRows(d, rows[d]);
  for (const o of owned) await store.markOwned(o.id, o);
  await store.putMeta('asOf', asOf);
  console.log('wrote to DynamoDB table', table);
}
