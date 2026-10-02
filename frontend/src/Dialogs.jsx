import React, { useEffect, useRef, useState } from 'react';
import { getRun, getDiagnostics, postActivity, getActivity } from './api.js';
import { narrate } from './narrate.js';
import { dt, int, sentence } from './format.js';
import { Icon } from './Icon.jsx';
import { DATASETS } from '../../shared/datasets.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function useDialog(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => { const d = ref.current; const h = () => onClose(); d?.addEventListener('close', h); return () => d?.removeEventListener('close', h); }, [onClose]);
  return ref;
}

const KIND = { model: 'Agent', tool: 'Tool', fallback: 'Fallback', retry: 'Retry', note: 'Note', error: 'Error' };

export function TrailDialog({ open, onClose, runs, live }) {
  const ref = useDialog(open, onClose);
  const [run, setRun] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    if (live) { setRun({ id: 'live', steps: live, done: false }); return; }
    if (!runs[0]) { setRun(null); return; }
    setErr('');
    getRun(runs[0].id).then(setRun).catch((e) => setErr(e.message));
  }, [open, runs, live]);
  return (
    <dialog ref={ref} aria-labelledby="trail-h" onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dlg-h"><h2 id="trail-h">Agent trail</h2><button type="button" className="tw-btn has-icon" onClick={onClose} aria-label="Close the agent trail"><Icon name="close" /></button></div>
      <div className="dlg-b">
        {err && <p role="alert">{err}</p>}
        {!run && !err && <p className="muted">No scan has run yet. Press Scan the stream.</p>}
        {run && (
          <>
            <dl className="kv">
              <dt>Started</dt><dd>{run.startedAt ? dt(run.startedAt) : 'Now'} · {run.trigger || 'manual'}</dd>
              <dt>Model</dt><dd>{run.model || 'Not used in this run'}{run.usage?.calls ? ` · ${run.usage.calls} requests, ${int(run.usage.input)} tokens in, ${int(run.usage.output)} out` : ''}</dd>
              {run.fallback && <><dt>Fallback</dt><dd>{run.fallback}</dd></>}
              {run.summary && <><dt>Result</dt><dd>{run.summary}</dd></>}
            </dl>
            <ol className="trail">
              {(run.steps || []).map((s, i) => (
                <li key={i}>
                  <span className={`k ${s.kind === 'error' ? 'err' : ''}`}>{KIND[s.kind] || s.kind}{s.tool ? ` · ${s.tool}` : ''}</span>
                  <div>
                    <div className="txt">{narrate(s)}</div>
                    {s.kind === 'tool' && <details><summary>Show the call</summary><pre>{JSON.stringify({ input: s.input, result: typeof s.detail === 'string' ? safe(s.detail) : s.detail }, null, 2)}</pre></details>}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </dialog>
  );
}
const safe = (s) => { try { return JSON.parse(s); } catch { return s; } };

export function DetailsDialog({ open, onClose, onActivity }) {
  const ref = useDialog(open, onClose);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [act, setAct] = useState({ busy: false, msg: '', error: false });
  useEffect(() => { if (!open) return; setErr(''); getDiagnostics().then(setD).catch((e) => setErr(e.message)); }, [open]);

  async function send(preset) {
    setAct({ busy: true, msg: 'Sending the payout batch to PayPal.', error: false });
    try {
      const { activityId } = await postActivity(preset);
      let a;
      for (let i = 0; i < 40; i++) {
        await sleep(3000);
        a = await getActivity(activityId);
        setAct({ busy: true, msg: a.status === 'polling' ? `Batch ${a.batchId} created. Waiting for PayPal to settle each item.` : 'Sending the payout batch to PayPal.', error: false });
        if (a.status === 'done' || a.status === 'failed') break;
      }
      if (a?.status !== 'done') throw new Error(a?.error || 'PayPal did not settle the batch in time. Check the board later.');
      const counts = a.items.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] || 0) + 1 }), {});
      setAct({ busy: false, msg: `Settled: ${Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}. The watcher is re-checking the stream.`, error: false });
      await onActivity();
      getDiagnostics().then(setD).catch(() => {});
    } catch (e) { setAct({ busy: false, msg: e.status === 429 ? 'Too many test payouts this hour. Try again later.' : e.message, error: true }); }
  }

  return (
    <dialog ref={ref} aria-labelledby="det-h" onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dlg-h"><h2 id="det-h">Details</h2><button type="button" className="tw-btn has-icon" onClick={onClose} aria-label="Close the details"><Icon name="close" /></button></div>
      <div className="dlg-b">
        {err && <p role="alert">{err}</p>}
        <section>
          <h3>What the stream is made of</h3>
          
          {d ? <table className="tbl"><thead><tr><th>Dataset</th><th className="n">Sandbox</th><th className="n">Replayed</th></tr></thead><tbody>
            {Object.entries(d.bySource).map(([k, v]) => <tr key={k}><td>{DATASETS[k].label}</td><td className="n">{int(v.sandbox)}</td><td className="n">{int(v.replay)}</td></tr>)}
          </tbody></table> : <p className="muted">Loading.</p>}
        </section>
        <section>
          <h3>Stream clock</h3>
          <p>{d?.asOf ? `The stream runs to ${dt(d.asOf)}.` : ''} It keeps its own clock so a board opened weeks later still shows its anomalies. Activity that PayPal reports later than six hours past the head lands one minute after it, and the real PayPal time stays on the row.</p>
        </section>
        <section>
          <h3>Webhooks</h3>
          {d ? <><p className="muted">{d.webhookConfigured ? 'Receiving PayPal events. Events for other projects on the same app are acknowledged and ignored.' : 'No webhook is registered for this deployment.'}</p>
            <table className="tbl"><thead><tr><th>Received</th><th>Result</th><th>Event</th></tr></thead><tbody>
              {d.webhooks.last.length ? d.webhooks.last.map((h, i) => <tr key={i}><td>{dt(h.receivedAt)}</td><td>{sentence(h.status)}</td><td>{h.eventType || ''}</td></tr>) : <tr><td colSpan="3" className="muted">No deliveries yet.</td></tr>}
            </tbody></table></> : null}
        </section>
        <section>
          <h3>Send new test activity</h3>
          <p className="muted">Creates a real payout batch in the PayPal sandbox, waits for every item to settle, then lets the watcher re-check. Limited to a few batches an hour.</p>
          <p style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="tw-btn" disabled={act.busy} onClick={() => send('mixed')}>Send a mixed batch</button>
            <button type="button" className="tw-btn" disabled={act.busy} onClick={() => send('nordhaven')}>Pay the unclaimed recipient again</button>
          </p>
          {act.msg && <p role="status" style={{ color: act.error ? 'var(--signal)' : undefined }}>{act.msg}</p>}
        </section>
        <section>
          <h3>Model and licences</h3>
          <p>The watcher and the chat panel use {d?.model || 'Claude Sonnet 4.5'} on Amazon Bedrock through the Converse API with tool use. Bedrock allows about ten requests a minute here, so calls are paced, retried with backoff, and fall back to labelled rule-built findings if the model stays unavailable.</p>
          <p>AG Grid Community and AG Charts Community are MIT licensed. Row grouping, master/detail, the status bar, set filters and range selection are AG Grid Enterprise features, and AG Studio is a commercial product; both run here on their unlicensed trial terms, which print a licence notice in the console.</p>
        </section>
      </div>
    </dialog>
  );
}
