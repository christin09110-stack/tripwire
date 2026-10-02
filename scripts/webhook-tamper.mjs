// Proves signature verification against PayPal itself: a real delivered event verifies, the same event with one field changed does not.
import { DynamoDBClient } from '../backend/node_modules/@aws-sdk/client-dynamodb/dist-cjs/index.js';
import { DynamoDBDocumentClient, QueryCommand } from '../backend/node_modules/@aws-sdk/lib-dynamodb/dist-cjs/index.js';
import { readFileSync } from 'node:fs';
import { loadEnv } from './env.mjs';
import { makePayPal } from '../backend/src/paypal.mjs';
const e = loadEnv();
const pp = makePayPal({ clientId: e.PAYPAL_CLIENT_ID, secret: e.PAYPAL_SECRET, api: e.PAYPAL_API });
const url = JSON.parse(readFileSync(new URL('../deploy-output.json', import.meta.url))).functionUrl;
const webhookId = JSON.parse(readFileSync(new URL('../deploy-output.json', import.meta.url))).webhookId;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const items = (await doc.send(new QueryCommand({ TableName: 'tripwire', KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': 'WH' } }))).Items.filter((i) => i.status === 'processed' && i.headers?.transmission_sig);
const victim = items[0];
const event = JSON.parse(victim.body);
console.log('event', event.event_type, victim.headers.transmission_id);
const verify = async (ev) => (await pp.verifyWebhook({ ...victim.headers, webhook_id: webhookId, webhook_event: ev })).verification_status;
console.log('1. original event       ->', await verify(event));
const tampered = structuredClone(event);
if (tampered.resource?.payout_item?.amount) tampered.resource.payout_item.amount.value = '99999.00';
else if (tampered.resource?.batch_header?.amount) tampered.resource.batch_header.amount.value = '99999.00';
else tampered.resource.status = 'TAMPERED';
console.log('2. one field changed    ->', await verify(tampered));
// round trip through the deployed listener: original headers, tampered body. It must answer 200 at once, then mark the delivery rejected.
const other = items.find((i) => i.headers.transmission_id !== victim.headers.transmission_id && JSON.parse(i.body).event_type.includes('ITEM'));
if (other) {
  const ev2 = JSON.parse(other.body); if (ev2.resource?.payout_item?.amount) ev2.resource.payout_item.amount.value = '99999.00'; else ev2.resource.transaction_status = 'TAMPERED';
  const t0 = Date.now();
  const res = await fetch(`${url}/api/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'paypal-transmission-id': 'tamper-' + other.headers.transmission_id, 'paypal-auth-algo': other.headers.auth_algo, 'paypal-cert-url': other.headers.cert_url, 'paypal-transmission-sig': other.headers.transmission_sig, 'paypal-transmission-time': other.headers.transmission_time }, body: JSON.stringify(ev2) });
  console.log(`3. deployed listener    -> HTTP ${res.status} in ${Date.now() - t0} ms`);
  await new Promise((r) => setTimeout(r, 8000));
  const d = await (await fetch(`${url}/api/diagnostics`)).json();
  console.log('   recent deliveries    ->', JSON.stringify(d.webhooks.byStatus));
  const rec = (await doc.send(new QueryCommand({ TableName: 'tripwire', KeyConditionExpression: 'PK = :p AND SK = :s', ExpressionAttributeValues: { ':p': 'WH', ':s': 'tamper-' + other.headers.transmission_id } }))).Items[0];
  console.log('   tampered delivery    ->', rec?.status, '|', rec?.note);
}
