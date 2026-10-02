// Extra invoicing calls the shared client does not expose. Own token cache; same sandbox credentials.
export function makeExtra({ clientId, secret, api = 'https://api-m.sandbox.paypal.com' }) {
  let cached = null;
  async function token() {
    if (cached && cached.exp > Date.now() + 30000) return cached.value;
    const r = await fetch(`${api}/v1/oauth2/token`, { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials' });
    const j = await r.json(); if (!r.ok) throw new Error(`oauth ${r.status}`);
    cached = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 }; return cached.value;
  }
  async function post(path, body) {
    const r = await fetch(`${api}${path}`, { method: 'POST', signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { raw: t }; }
    if (!r.ok) { const e = new Error(`${path}: ${r.status} ${j?.name || ''} ${j?.message || ''}`); e.status = r.status; e.body = j; throw e; }
    return j;
  }
  return {
    recordPayment: (id, value) => post(`/v2/invoicing/invoices/${encodeURIComponent(id)}/payments`, { method: 'BANK_TRANSFER', amount: { currency_code: 'USD', value } }),
    cancelInvoice: (id) => post(`/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, { send_to_invoicer: false, send_to_recipient: false }),
  };
}
