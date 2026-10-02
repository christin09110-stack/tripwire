import { TwWidget } from './base.js';
import { esc, SEVERITY, dt, int } from '../format.js';

const KIND = { refund_spike: 'Refund spike', payout_cluster: 'Payouts not arriving', invoice_ageing: 'Invoices ageing', dispute_pattern: 'Dispute pattern' };

export class TwBrief extends TwWidget {
  kind = 'tw-brief-w';
  build() {
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.root);
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const f = this.finding();
      if (!f) return;
      if (b.dataset.act === 'open') this.ctx.actions.openPage?.(f.id);
      if (b.dataset.act === 'review') this.ctx.actions.setStatus?.(f.id, f.status === 'reviewed' ? 'open' : 'reviewed');
    });
  }
  dispose() { this.ro?.disconnect(); }
  /** Show whole lines only: clamp the summary to the lines that fit between the headline and the buttons. */
  fit() {
    const sum = this.root.querySelector('.tw-summary'), foot = this.root.querySelector('.tw-brief-foot');
    if (!sum || !foot || !this.root.classList.contains('is-compact')) return;
    const lh = parseFloat(getComputedStyle(sum).lineHeight) || 22;
    const room = foot.getBoundingClientRect().top - sum.getBoundingClientRect().top - 10;
    sum.style.webkitLineClamp = String(Math.max(1, Math.floor(room / lh)));
  }
  finding() { return this.ctx.finding(this.params.widgetId.replace(/^brief-/, '')); }
  update() {
    const f = this.finding();
    const compact = this.params.widgetId.startsWith('brief-');
    if (!f) { this.root.innerHTML = '<p class="tw-empty">This finding is no longer on the board.</p>'; return; }
    const sev = SEVERITY[f.severity] || SEVERITY.low;
    const cleared = f.status === 'cleared', reviewed = f.status === 'reviewed';
    const author = f.author === 'rules'
      ? '<span class="tw-badge tw-badge-rules" title="Bedrock was rate limited, so a fixed template wrote this from the detector\'s numbers.">Written by rules</span>'
      : '<span class="tw-badge tw-badge-ai" title="Written by the watcher agent after querying the stream.">Written by the agent</span>';
    const actions = (f.actions || []).map((a) => `<li>${esc(a)}</li>`).join('');
    this.root.className = `tw-widget tw-brief-w sev-${f.severity} ${compact ? 'is-compact' : 'is-lead'} ${reviewed || cleared ? 'is-done' : ''}`;
    this.root.setAttribute('aria-label', `${f.title}. ${sev.word} severity.`);
    this.root.innerHTML = `
      <div class="tw-brief-top">
        <span class="tw-sev"><span aria-hidden="true">${sev.glyph}</span> ${sev.word}</span>
        <span class="tw-kind">${KIND[f.kind] || f.kind}</span>
        ${cleared ? '<span class="tw-badge">Cleared</span>' : reviewed ? '<span class="tw-badge">Reviewed</span>' : ''}
        ${author}
      </div>
      <h3 class="tw-brief-title">${esc(f.title)}</h3>
      <p class="tw-headline">${esc(f.headline)}</p>
      ${f.brief ? `<p class="tw-summary">${esc(f.brief)}</p>` : ''}
      ${compact ? '' : `<div class="tw-actions-wrap"><h4>Next steps</h4><ol class="tw-actions">${actions}</ol></div>`}
      <footer class="tw-brief-foot">
        ${compact ? '<button type="button" class="tw-btn tw-btn-primary" data-act="open">Open the board</button>' : ''}
        <button type="button" class="tw-btn" data-act="review" aria-pressed="${reviewed}">${reviewed ? 'Reopen' : 'Mark reviewed'}</button>
        <span class="tw-meta">${int(f.evidenceIds?.length || 0)} rows flagged · ${esc(f.window?.label || '')} · to ${dt(f.window?.to)}</span>
      </footer>`;
    requestAnimationFrame(() => this.fit());
  }
}
