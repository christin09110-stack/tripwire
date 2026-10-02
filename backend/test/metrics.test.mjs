import test from 'node:test';
import assert from 'node:assert/strict';
import { series, compare, breakdown, matches } from '../../shared/metrics.mjs';
import { prepared } from './helpers.mjs';

test('series is zero-filled, contiguous and ends on the stream clock day', () => {
  const d = prepared();
  const s = series(d, 'refund_rate', { buckets: 30 });
  assert.equal(s.points.length, 30);
  assert.equal(s.points.at(-1).t, '2026-10-02');
  assert.equal(s.points[0].t, '2026-09-03');
  assert.equal(s.points.at(-1).num, 7);
  assert.equal(s.points.at(-1).den, 18);
});

test('refund rate today is a proportion-test outlier against the 29 days before', () => {
  const c = compare(series(prepared(), 'refund_rate', { buckets: 30 }).points, { window: 1 });
  assert.ok(c.ok); assert.equal(c.kind, 'ratio');
  assert.ok(c.current > 0.35 && c.current < 0.42, `current ${c.current}`);
  assert.ok(c.baseline < 0.05, `baseline ${c.baseline}`);
  assert.ok(c.z > 8, `z ${c.z}`);
});

test('a quiet stream does not produce an outlier', () => {
  const d = prepared({ planted: false });
  const c = compare(series(d, 'refund_rate', { buckets: 30 }).points.slice(0, 29), { window: 1 });
  assert.ok(c.z < 4, `z ${c.z}`);
});

test('where filters apply to numerator and denominator', () => {
  const d = prepared();
  const s = series(d, 'refund_rate', { buckets: 3, where: { item: 'annual-plan' } });
  assert.equal(s.points.at(-1).num, 7); assert.equal(s.points.at(-1).den, 9);
});

test('breakdown groups, sums and sorts', () => {
  const d = prepared();
  const g = breakdown(d, 'refunds', { by: 'item', since: '2026-10-02T00:00:00Z' });
  assert.deepEqual(g.map((x) => [x.key, x.count]), [['annual-plan', 7]]);
  const s = breakdown(d, 'payout_items', { by: 'recipient', where: { status: 'UNCLAIMED' }, agg: 'sum', field: 'amount', since: '2026-10-02T00:00:00Z' });
  assert.equal(s[0].sum, 1800);
});

test('matches supports scalars, lists and range objects', () => {
  const row = { a: 5, b: 'x' };
  assert.ok(matches(row, { a: { gte: 5, lt: 6 }, b: ['x', 'y'] }));
  assert.ok(!matches(row, { a: { gt: 5 } }));
  assert.ok(!matches(row, { b: { ne: 'x' } }));
});
