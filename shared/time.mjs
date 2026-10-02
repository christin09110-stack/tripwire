// Pure time helpers. Everything is UTC; the stream has its own clock (asOf), never Date.now().
export const DAY = 86400000;
export const HOUR = 3600000;
export const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
export const hourKey = (ts) => new Date(ts).toISOString().slice(0, 13) + ':00';
export const startOfDay = (ts) => Date.parse(dayKey(ts) + 'T00:00:00Z');
export const addDays = (ts, n) => new Date(Date.parse(ts) + n * DAY).toISOString();
export const daysBetween = (a, b) => Math.floor((startOfDay(b) - startOfDay(a)) / DAY);

/** Contiguous bucket labels ending at asOf, oldest first. */
export function bucketLabels(asOf, count, bucket = 'day') {
  const end = Date.parse(asOf);
  const out = [];
  if (bucket === 'hour') {
    const base = Math.floor(end / HOUR) * HOUR;
    for (let i = count - 1; i >= 0; i--) out.push(hourKey(base - i * HOUR));
  } else {
    const base = startOfDay(end);
    for (let i = count - 1; i >= 0; i--) out.push(dayKey(base - i * DAY));
  }
  return out;
}
export const keyOf = (ts, bucket) => (bucket === 'hour' ? hourKey(ts) : dayKey(ts));

export function fmtDay(label) {
  const d = new Date(label.length === 10 ? label + 'T00:00:00Z' : label + ':00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
