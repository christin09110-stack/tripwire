export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
async function call(method, path, body) {
  let r;
  try { r = await fetch(`${API}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Unable to reach the Tripwire API. Check your connection and reload.'); }
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!r.ok) { const e = new Error(j?.message || `The API answered ${r.status}.`); e.status = r.status; e.code = j?.error; throw e; }
  return j;
}
export const getBoard = () => call('GET', '/api/board');
export const getData = () => call('GET', '/api/data');
export const getDiagnostics = () => call('GET', '/api/diagnostics');
export const postScan = (force = false) => call('POST', '/api/scan', { force });
export const getRun = (id) => call('GET', `/api/runs/${encodeURIComponent(id)}`);
export const setFindingStatus = (id, status) => call('POST', `/api/findings/${encodeURIComponent(id)}/status`, { status });
export const putLayout = (pageId, layout) => call('PUT', '/api/layout', { pageId, layout });
export const postActivity = (preset) => call('POST', '/api/activity', { preset });
export const getActivity = (id) => call('GET', `/api/activity/${encodeURIComponent(id)}`);
export const postLlm = (payload, signal) => fetch(`${API}/api/llm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal });
