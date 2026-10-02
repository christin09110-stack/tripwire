// AWS Lambda entry (Node 22, Function URL). The SDK v3 clients ship in the runtime, so nothing is bundled.
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { makeStore, dynamoPrimitives } from './store.mjs';
import { makeBedrock, MODEL } from './bedrock.mjs';
import { makePayPal } from './paypal.mjs';
import { makeApp } from './handler.mjs';

let cached;
async function boot() {
  if (cached) return cached;
  const prefix = process.env.SSM_PREFIX || '/tripwire/';
  const out = await new SSMClient({}).send(new GetParametersByPathCommand({ Path: prefix, WithDecryption: true }));
  const p = Object.fromEntries((out.Parameters || []).map((x) => [x.Name.slice(prefix.length), x.Value]));
  const store = makeStore(dynamoPrimitives(process.env.TABLE || 'tripwire'));
  const lambda = new LambdaClient({});
  const pp = makePayPal({ clientId: p.PAYPAL_CLIENT_ID, secret: p.PAYPAL_SECRET, api: p.PAYPAL_API || 'https://api-m.sandbox.paypal.com' });
  const app = makeApp({
    store, pp: () => pp, bedrock: makeBedrock(), model: MODEL, webhookId: p.PAYPAL_WEBHOOK_ID || '',
    invoke: (payload) => lambda.send(new InvokeCommand({ FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(payload)) })),
  });
  cached = { app };
  return cached;
}

export const handler = async (event) => {
  const { app } = await boot();
  if (event.op) { await app.runOp(event); return { ok: true }; }
  const http = event.requestContext?.http || {};
  const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body || '';
  const res = await app.route({ method: http.method, path: event.rawPath || http.path, headers: event.headers || {}, query: event.queryStringParameters || {}, body: raw });
  return { statusCode: res.status, headers: res.headers, body: res.body, isBase64Encoded: !!res.isBase64 };
};
