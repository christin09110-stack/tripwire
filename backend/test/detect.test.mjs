import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAll } from '../src/detect.mjs';
import { prepared } from './helpers.mjs';

test('the four detectors each find their planted pattern', () => {
  const c = detectAll(prepared());
  const kinds = c.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['dispute_pattern', 'invoice_ageing', 'payout_cluster', 'refund_spike']);
  const refund = c.find((x) => x.kind === 'refund_spike');
  assert.equal(refund.subject, 'annual-plan');
  assert.equal(refund.severity, 'high');
  assert.equal(refund.drill.concentration.key, 'annual-plan');
  const payout = c.find((x) => x.kind === 'payout_cluster');
  assert.equal(payout.subject, 'accounts@nordhaven-logistics.example');
  assert.equal(payout.metric.recipientItems, 6);
  assert.equal(payout.drill.batchIds.length, 4);
  const inv = c.find((x) => x.kind === 'invoice_ageing');
  assert.ok(inv.evidenceIds.length >= 4);
});

test('a quiet stream flags nothing', () => {
  assert.deepEqual(detectAll(prepared({ planted: false })).map((x) => x.id), []);
});

test('candidate evidence ids exist in the stream', () => {
  const d = prepared();
  const all = new Set([...d.payout_items, ...d.invoices, ...d.captures, ...d.refunds, ...d.disputes].map((r) => r.id));
  for (const c of detectAll(d)) for (const id of c.evidenceIds) assert.ok(all.has(id), `${c.id} cites unknown ${id}`);
});
