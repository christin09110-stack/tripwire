import test from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../src/watch.mjs';
import { makeBedrock, BedrockUnavailable } from '../src/bedrock.mjs';
import { findingIdFor } from '../src/agent.mjs';
import { memStore, scriptedBedrock, use, say, call } from './helpers.mjs';

const REFUND = 'refund_spike:2026-10-02:1d';
const finding = { candidate_id: REFUND, kind: 'refund_spike', severity: 'high', title: 'Annual plan refunds', headline: '44% refunded vs 3% normal', summary: 'Seven annual-plan captures were refunded today.', actions: ['Check the renewal flow.'], confidence: 0.9 };

test('the loop calls tools, repairs a bad widget spec from the error, and stores a finding with widgets', async () => {
  const store = await memStore();
  const fid = findingIdFor(REFUND);
  const turns = [];
  const bedrock = scriptedBedrock((req, i) => {
    turns.push(req);
    if (i === 0) return call(use('list_candidates', {}), use('compare_baseline', { metric: 'refund_rate' }));
    if (i === 1) return call(use('record_finding', finding), use('build_widget', { finding_id: fid, type: 'tw-grid', spec: { dataset: 'refunds', columns: ['id', 'not_a_field'] } }));
    if (i === 2) return call(use('build_widget', { finding_id: fid, type: 'tw-grid', spec: { dataset: 'refunds', where: { item: 'annual-plan' }, sinceDays: 1, columns: ['id', 'reason', { field: 'amount', agg: 'sum' }], totals: true } }), use('build_widget', { finding_id: fid, type: 'tw-trend', spec: { metric: 'refund_rate', chartType: 'area' } }));
    if (i === 3) return call(...otherDismissals());
    return say('Refunds are climbing on one item. The other candidates were dismissed with reasons.');
  });
  const res = await scan({ store, bedrock, runId: 'r-test', now: () => '2026-10-02T04:00:00Z' });
  const run = await store.getRun('r-test');
  // tool results fed back to the model include the validation error from turn 1
  const toolResultTurn = bedrock.calls[2].messages.at(-1).content.map((b) => b.toolResult.content[0].text).join(' ');
  assert.match(toolResultTurn, /not_a_field.{1,3} is not a field of refunds/);
  assert.equal((await store.listFindings()).find((f) => f.id === fid).author, 'bedrock');
  const widgets = (await store.listWidgets()).filter((w) => w.findingId === fid);
  assert.deepEqual(widgets.map((w) => w.type).sort(), ['tw-grid', 'tw-trend']);
  assert.ok(widgets.every((w) => w.author === 'bedrock'));
  assert.ok(run.steps.some((s) => s.kind === 'tool' && s.tool === 'build_widget' && s.ok === false), 'the failed build is in the trail');
  assert.equal(res.fallback, null);
  assert.equal(run.usage.calls, 5);
});

function otherDismissals() {
  const ids = ['payout_cluster:accounts@nordhaven-logistics.example', 'invoice_ageing:2026-10-02', 'dispute_pattern:DUPLICATE_TRANSACTION:2026-10-02'];
  return ids.map((id) => use('dismiss_candidate', { candidate_id: id, reason: 'Covered by the refund finding in this test run.' }));
}

test('an empty widget is refused so the model must loosen the filter', async () => {
  const store = await memStore();
  const fid = findingIdFor(REFUND);
  let seen = '';
  const bedrock = scriptedBedrock((req, i) => {
    if (i === 0) return call(use('record_finding', finding), use('build_widget', { finding_id: fid, type: 'tw-grid', spec: { dataset: 'refunds', where: { item: 'nonexistent' }, columns: ['id', 'amount'] } }));
    if (i === 1) { seen = JSON.stringify(req.messages.at(-1)); return say('done'); }
    return say('done');
  });
  await scan({ store, bedrock, runId: 'r-empty', now: () => '2026-10-02T04:00:00Z' });
  assert.match(seen, /would be empty/);
});

test('when Bedrock stays unavailable the board still gets findings, built by rules and labelled', async () => {
  const store = await memStore();
  const bedrock = scriptedBedrock(() => new BedrockUnavailable('Bedrock did not answer after 7 attempts (ThrottlingException).', { attempts: 7 }));
  const res = await scan({ store, bedrock, runId: 'r-fallback', now: () => '2026-10-02T04:00:00Z' });
  const fs = await store.listFindings();
  assert.equal(fs.length, 4);
  assert.ok(fs.every((f) => f.author === 'rules'));
  const ws = await store.listWidgets();
  assert.ok(ws.length >= 12 && ws.every((w) => w.author === 'rules'));
  assert.match(res.fallback, /ThrottlingException/);
  const run = await store.getRun('r-fallback');
  assert.ok(run.fallback);
});

test('an unchanged stream is not re-investigated: no model call', async () => {
  const store = await memStore();
  const rules = scriptedBedrock(() => new BedrockUnavailable('x', {}));
  await scan({ store, bedrock: rules, runId: 'r-1', now: () => '2026-10-02T04:00:00Z' });
  const spy = scriptedBedrock(() => say('should not be called'));
  const res = await scan({ store, bedrock: spy, runId: 'r-2', now: () => '2026-10-02T04:05:00Z' });
  assert.equal(spy.calls.length, 0);
  assert.match(res.summary, /Nothing changed/);
});

test('adaptive retry: throttles are retried with growing waits, then succeed', async () => {
  const waits = [];
  let n = 0;
  const client = { send: async () => { n++; if (n <= 3) { const e = new Error('slow down'); e.name = 'ThrottlingException'; throw e; } return { output: { message: { role: 'assistant', content: [{ text: 'ok' }] } }, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }; } };
  const b = makeBedrock({ client, sleep: async (ms) => { waits.push(ms); }, now: (() => { let t = 0; return () => (t += 1000); })(), random: () => 0 });
  const r = await b.converse({ messages: [{ role: 'user', content: [{ text: 'hi' }] }] });
  assert.equal(r.attempts, 4); assert.equal(b.state.throttles, 3);
  const backoffs = waits.filter((w) => w >= 2000);
  assert.ok(backoffs.length >= 3 && backoffs[2] > backoffs[0], `waits ${waits}`);
  assert.ok(b.state.gap > 3500, 'the pacing gap widened after throttling');
});

test('adaptive retry gives up with a typed error', async () => {
  const client = { send: async () => { const e = new Error('no'); e.name = 'ThrottlingException'; throw e; } };
  const b = makeBedrock({ client, maxAttempts: 3, sleep: async () => {}, now: (() => { let t = 0; return () => (t += 500); })(), random: () => 0 });
  await assert.rejects(() => b.converse({ messages: [{ role: 'user', content: [{ text: 'hi' }] }] }), (e) => e instanceof BedrockUnavailable && e.info.attempts === 3);
});

test('a non-retryable Bedrock error is thrown at once', async () => {
  let n = 0;
  const client = { send: async () => { n++; const e = new Error('bad'); e.name = 'ValidationException'; throw e; } };
  const b = makeBedrock({ client, sleep: async () => {}, random: () => 0 });
  await assert.rejects(() => b.converse({ messages: [] }), /bad/);
  assert.equal(n, 1);
});
