// Thin PayPal REST client. Direct REST, because the agent toolkit has no Payouts and hides item-level truth.
export class PayPalError extends Error {
  constructor(status, body, where) {
    super(`${where}: ${status} ${body?.name || ''} ${body?.message || ''}`.trim());
    this.status = status; this.body = body; this.where = where;
    this.name = body?.name || 'PAYPAL_ERROR';
    this.details = body?.details || [];
  }
}

export function makePayPal({ clientId, secret, api = 'https://api-m.sandbox.paypal.com', fetchImpl = fetch }) {
  let cached = null;
  async function token() {
    if (cached && cached.exp > Date.now() + 30000) return cached.value;
    const r = await fetchImpl(`${api}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const j = await r.json();
    if (!r.ok) throw new PayPalError(r.status, j, 'oauth');
    cached = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return cached.value;
  }
  async function call(method, path, body, where, headers = {}) {
    const r = await fetchImpl(`${api}${path}`, {
      signal: AbortSignal.timeout(25000),
      method,
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = { raw: text }; }
    if (!r.ok) throw new PayPalError(r.status, j, where || `${method} ${path}`);
    return j;
  }
  const rid = (id) => (id ? { 'PayPal-Request-Id': id } : {});
  return {
    api,
    createPayout: (body, requestId) => call('POST', '/v1/payments/payouts', body, 'create payout', rid(requestId)),
    getBatch: (id) => call('GET', `/v1/payments/payouts/${encodeURIComponent(id)}?page_size=100`, undefined, 'get batch'),
    createInvoice: (body, requestId) => call('POST', '/v2/invoicing/invoices', body, 'create invoice', rid(requestId)),
    sendInvoice: (id, body = { send_to_recipient: false, send_to_invoicer: false }) => call('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, body, 'send invoice'),
    getInvoice: (id) => call('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`, undefined, 'get invoice'),
    searchInvoices: (body, page = 1) => call('POST', `/v2/invoicing/search-invoices?page=${page}&page_size=100&total_required=true`, body, 'search invoices'),
    listDisputes: (qs = '') => call('GET', `/v1/customer/disputes${qs}`, undefined, 'list disputes'),
    createOrder: (body, requestId) => call('POST', '/v2/checkout/orders', body, 'create order', rid(requestId)),
    getOrder: (id) => call('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`, undefined, 'get order'),
    captureOrder: (id, requestId) => call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, undefined, 'capture order', rid(requestId)),
    getRefund: (id) => call('GET', `/v2/payments/refunds/${encodeURIComponent(id)}`, undefined, 'get refund'),
    getCapture: (id) => call('GET', `/v2/payments/captures/${encodeURIComponent(id)}`, undefined, 'get capture'),
    refundCapture: (id, body, requestId) => call('POST', `/v2/payments/captures/${encodeURIComponent(id)}/refund`, body ?? {}, 'refund capture', rid(requestId)),
    verifyWebhook: (body) => call('POST', '/v1/notifications/verify-webhook-signature', body, 'verify webhook'),
    listWebhooks: () => call('GET', '/v1/notifications/webhooks', undefined, 'list webhooks'),
    createWebhook: (body) => call('POST', '/v1/notifications/webhooks', body, 'create webhook'),
  };
}

/** A repeated sender_batch_id is refused with a link to the batch it already made. Returns that batch id, or null. */
export function existingBatchId(err) {
  const link = err?.details?.find?.((d) => d.link)?.link?.[0]?.href;
  return link ? link.split('/').pop().split('?')[0] : null;
}
export const isDuplicateInvoice = (err) => err?.status === 422 && JSON.stringify(err.details || []).includes('DUPLICATE_INVOICE_NUMBER');
/** PayPal-Request-Id replays come back 200/201 with the original; a 409/422 duplicate-id refusal is also success. */
export const isDuplicateRequestId = (err) => err?.status === 409 || (err?.status === 422 && /DUPLICATE|ALREADY/i.test(JSON.stringify(err.body || '')));
