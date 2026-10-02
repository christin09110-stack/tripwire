import React from 'react';
import { SEVERITY, dt, int } from './format.js';

const KIND = { refund_spike: 'Refund spike', payout_cluster: 'Payouts not arriving', invoice_ageing: 'Invoices ageing', dispute_pattern: 'Dispute pattern' };

export function FindingHeader({ f, onStatus }) {
  const sev = SEVERITY[f.severity] || SEVERITY.low;
  const reviewed = f.status === 'reviewed';
  return (
    <article className={`fhead sev-${f.severity} ${reviewed || f.status === 'cleared' ? 'is-done' : ''}`}>
      <div className="fhead-main">
        <div className="fhead-tags">
          <span className={`sevtag sev-${f.severity}`}><span className="g" aria-hidden="true">{sev.glyph}</span> {sev.word} severity</span>
          <span className="fhead-kind">{KIND[f.kind] || f.kind}</span>
          {f.status === 'cleared' && <span className="tw-badge">Cleared</span>}
          {reviewed && <span className="tw-badge">Reviewed</span>}
          {f.author === 'rules'
            ? <span className="tw-badge tw-badge-rules" title="Bedrock was rate limited, so a fixed template wrote this from the detector's numbers.">Written by rules</span>
            : <span className="tw-badge tw-badge-ai" title="Written by the watcher agent after querying the stream.">Written by the agent</span>}
        </div>
        <h1 className="fhead-title">{f.title}</h1>
        <p className="fhead-headline">{f.headline}</p>
        <p className="fhead-summary">{f.summary}</p>
        <div className="fhead-foot">
          <button type="button" className="tw-btn" aria-pressed={reviewed} onClick={() => onStatus(f.id, reviewed ? 'open' : 'reviewed')}>{reviewed ? 'Reopen' : 'Mark reviewed'}</button>
          <span className="tw-meta">{int(f.evidenceIds?.length || 0)} rows flagged · {f.window?.label} · to {dt(f.window?.to)}</span>
        </div>
      </div>
      <aside className="fhead-actions" aria-label="Next steps">
        <h2>Next steps</h2>
        <ol>{(f.actions || []).map((a, i) => <li key={i}>{a}</li>)}</ol>
      </aside>
    </article>
  );
}
