import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGrid, validateTrend, validateBreakdown, validateWidget, validateFinding, pack, toStudioState, MIN_H } from '../../shared/widgets.mjs';

test('a good grid spec passes and is normalised', () => {
  const r = validateGrid({ dataset: 'refunds', columns: [{ field: 'id', pinned: 'left' }, { field: 'amount', agg: 'sum', renderer: 'money' }], totals: true, rules: [{ field: 'amount', op: 'gt', value: 50, tone: 'alert' }] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.spec.totals, true); assert.equal(r.spec.rules.length, 1);
});

test('bad grid specs get exact, fixable errors', () => {
  const r = validateGrid({ dataset: 'payout_items', columns: ['recipient', 'nope'], groupBy: ['recipient'] });
  assert.ok(!r.ok);
  assert.match(r.errors.join(' '), /"nope" is not a field of payout_items/);
  assert.match(r.errors.join(' '), /groupBy needs at least one column with an agg/);
  assert.match(validateGrid({ dataset: 'x' }).errors[0], /dataset must be one of/);
});

test('master/detail and row grouping are refused together', () => {
  const r = validateGrid({ dataset: 'refunds', columns: ['id', { field: 'amount', agg: 'sum' }], groupBy: ['reason'], detail: 'related' });
  assert.ok(!r.ok); assert.match(r.errors.join(' '), /cannot be combined/);
});

test('trend and breakdown validate metric, fields and sum fields', () => {
  assert.ok(validateTrend({ metric: 'refund_rate', chartType: 'area' }).ok);
  assert.match(validateTrend({ metric: 'nope' }).errors[0], /metric must be one of/);
  assert.match(validateTrend({ metric: 'refund_rate', where: { zzz: 1 } }).errors[0], /no such field/);
  assert.ok(validateBreakdown({ dataset: 'refunds', by: 'reason' }).ok);
  assert.match(validateBreakdown({ dataset: 'refunds', by: 'reason', agg: 'sum', field: 'reason' }).errors.join(' '), /numeric field/);
});

test('widget sizes are clamped to the minimum legible height', () => {
  const r = validateWidget({ type: 'tw-grid', spec: { dataset: 'refunds', columns: ['id', 'amount'] }, layout: { w: 99, h: 3 } });
  assert.equal(r.layout.w, 24); assert.equal(r.layout.h, MIN_H['tw-grid']);
});

test('findings need a headline, a summary and actions', () => {
  const bad = validateFinding({ kind: 'refund_spike', severity: 'high', title: 't' });
  assert.ok(!bad.ok); assert.equal(bad.errors.length, 3);
  assert.ok(validateFinding({ candidateId: 'c', kind: 'refund_spike', severity: 'high', title: 't', headline: 'h', summary: 's', actions: ['a'], confidence: 0.8 }).ok);
});

test('pack never overlaps and wraps at 24 tracks', () => {
  const l = pack([{ id: 'a', layout: { w: 12, h: 10 } }, { id: 'b', layout: { w: 12, h: 10 } }, { id: 'c', layout: { w: 24, h: 20 } }, { id: 'd', layout: { w: 8, h: 5 } }]);
  assert.deepEqual(l.c, { xTrack: 0, yTrack: 10, xSpan: 24, ySpan: 20 });
  assert.deepEqual(l.d, { xTrack: 0, yTrack: 30, xSpan: 8, ySpan: 5 });
});

test('board to Studio state: overview briefs, one page per finding, stack mode', () => {
  const board = { findings: { 'fd-a': { id: 'fd-a', severity: 'high', status: 'open', title: 'A', createdAt: '1' }, 'fd-b': { id: 'fd-b', severity: 'medium', status: 'open', title: 'B', createdAt: '2' } },
    widgets: { w1: { id: 'w1', findingId: 'fd-a', type: 'tw-grid', order: 0, layout: { w: 24, h: 4 } } } };
  const s = toStudioState(board);
  assert.deepEqual(s.pages.map((p) => p.id), ['overview', 'fd-a', 'fd-b']);
  assert.deepEqual(Object.keys(s.pages[0].widgets), ['brief-fd-a', 'brief-fd-b']);
  assert.equal(s.pages[1].widgetLayout.w1.ySpan, MIN_H['tw-grid']);
  const st = toStudioState(board, 'fd-a', { stack: true });
  assert.equal(st.selectedPageId, 'fd-a'); assert.equal(st.pages[0].widgetLayout['brief-fd-a'].xSpan, 24);
});

test('card briefs are capped at 22 words and never cut mid-word', async () => {
  const { fitBrief } = await import('../../shared/widgets.mjs');
  const long = 'Seven payouts across five batches in the last 24 hours. All failed with RECEIVER_UNREGISTERED. The recipient email may be incorrect or the account is not registered with PayPal at all.';
  const out = fitBrief(long, 22);
  assert.ok(out.split(' ').length <= 22);
  assert.ok(long.startsWith(out.replace(/…$/, '')), 'a clean prefix of the original');
  assert.equal(out, 'Seven payouts across five batches in the last 24 hours. All failed with RECEIVER_UNREGISTERED.');
  const oneSentence = 'word '.repeat(40).trim();
  assert.match(fitBrief(oneSentence, 22), /word…$/);
  assert.equal(fitBrief('Short one.', 22), 'Short one.');
});
