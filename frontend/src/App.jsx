import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepare } from '../../shared/datasets.mjs';
import { boardPages } from '../../shared/widgets.mjs';
import { getBoard, getData, postScan, getRun, setFindingStatus } from './api.js';
import { createContext } from './studio/context.js';
import { mountStudio } from './studio/host.js';
import { setMode } from './theme.js';
import { dt, SEVERITY } from './format.js';
import { narrate } from './narrate.js';
import { TrailDialog, DetailsDialog } from './Dialogs.jsx';
import { Icon } from './Icon.jsx';
import { FindingHeader } from './FindingHeader.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toDoc = (b) => ({ findings: Object.fromEntries(b.findings.map((f) => [f.id, f])), widgets: Object.fromEntries(b.widgets.map((w) => [w.id, w])) });

function useNarrow() {
  const q = '(max-width: 899px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const h = () => setM(mq.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }, []);
  return m;
}

export default function App({ initialTheme }) {
  const ctx = useMemo(() => createContext(), []);
  const hostRef = useRef(null);
  const ctl = useRef(null);
  const [load, setLoad] = useState({ state: 'loading' });
  const [board, setBoard] = useState(null);
  const [asOf, setAsOf] = useState(null);
  const [page, setPage] = useState('overview');
  const [theme, setTheme] = useState(initialTheme);
  const [editing, setEditing] = useState(false);
  const [scan, setScan] = useState({ running: false, message: '', error: false, steps: [] });
  const [trailOpen, setTrailOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const narrow = useNarrow();
  const [sevFilter, setSevFilter] = useState(null);
  const [unreviewed, setUnreviewed] = useState(false);
  const [briefH] = useState(18);
  const [trailH, setTrailH] = useState(12);
  const liveRef = useRef(null);

  const refresh = useCallback(async ({ withData = true } = {}) => {
    const [b, d] = await Promise.all([getBoard(), withData ? getData() : null]);
    const doc = toDoc(b);
    ctx.board = doc;
    if (d) { ctx.data = prepare(d.rows, d.asOf); }
    setBoard({ ...b, doc });
    setAsOf(b.asOf);
    if (d) ctl.current?.setData();
    ctx.notify();
    return b;
  }, [ctx]);

  useEffect(() => {
    ctx.actions.setStatus = async (id, status) => { try { await setFindingStatus(id, status); await refresh({ withData: false }); } catch (e) { setScan((s) => ({ ...s, message: e.message, error: true })); } };
    ctx.actions.openPage = (id) => setPage(id);
    refresh().then(() => setLoad({ state: 'ready' })).catch((e) => { console.error(e); setLoad({ state: 'error', message: e.message }); });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh().catch(() => {}); }, 60000);
    return () => clearInterval(timer);
  }, [ctx, refresh]);

  useEffect(() => { setMode(theme); ctx.mode = theme; ctl.current?.setTheme(theme); ctx.notify(); try { localStorage.setItem('tw-theme', theme); } catch { /* storage blocked */ } }, [theme, ctx]);

  useEffect(() => {
    if (load.state !== 'ready' || !hostRef.current) return undefined;
    ctl.current = mountStudio(hostRef.current, { ctx, page, stack: narrow, briefH, only, trailH, onPage: setPage, onBoardChange: async (pageId) => { await refresh({ withData: false }); if (pageId) setPage(pageId); }, onError: (e) => console.warn('Studio', e) });
    ctl.current.sync({ board: ctx.board, page, stack: narrow, briefH, only, trailH });
    return () => { ctl.current?.destroy(); ctl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.state]);

  const only = useMemo(() => (sevFilter || unreviewed ? (f) => (!sevFilter || f.severity === sevFilter) && (!unreviewed || f.status === 'open') : null), [sevFilter, unreviewed]);
  useEffect(() => { if (ctl.current && board) ctl.current.sync({ board: board.doc, page, stack: narrow, briefH, only, trailH }); }, [board, page, narrow, briefH, only, trailH]);
  // The scan trail takes the height the cards leave, so the Overview never ends in blank space.
  useEffect(() => {
    const el = hostRef.current; if (!el || narrow) return undefined;
    const n = board ? Math.max(1, Math.ceil(Object.values(board.doc.findings).filter((f) => f.status !== 'dismissed' && (!only || only(f))).length / 2)) : 2;
    const calc = () => setTrailH(Math.max(10, Math.floor((el.clientHeight - 40) / 15.6) - n * briefH));
    calc(); const ro = new ResizeObserver(calc); ro.observe(el); return () => ro.disconnect();
  }, [board, narrow, only, load.state, briefH]);
  // The latest run feeds the trail widget on the Overview.
  const lastRunId = board?.runs?.[0]?.id;
  useEffect(() => { if (!lastRunId) return; getRun(lastRunId).then((r) => { ctx.latestRun = r; ctx.notify(); }).catch(() => {}); }, [lastRunId, ctx]);
  useEffect(() => { ctl.current?.setMode(editing ? 'edit' : 'view'); }, [editing]);

  const pages = useMemo(() => (board ? boardPages(board.doc) : { pages: [], findings: [] }), [board]);
  const current = pages.pages.find((p) => p.id === page) || pages.pages[0];
  const windowLabel = asOf ? `${new Date(Date.parse(asOf) - 29 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} to ${new Date(asOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : '';
  const finding = current?.findingId ? board.doc.findings[current.findingId] : null;
  useEffect(() => { if (board && !pages.pages.some((p) => p.id === page)) setPage('overview'); }, [board, pages, page]);

  const announce = (msg) => { if (liveRef.current) liveRef.current.textContent = msg; };

  async function runScan() {
    if (scan.running) return;
    setScan({ running: true, message: 'Starting the watcher.', error: false, steps: [] });
    try {
      const { runId } = await postScan(false);
      let run;
      for (let i = 0; i < 160; i++) {
        await sleep(i < 2 ? 1200 : 2500);
        run = await getRun(runId);
        const last = run.steps[run.steps.length - 1];
        setScan((s) => ({ ...s, steps: run.steps, message: narrate(last) }));
        if (run.done) break;
      }
      if (!run?.done) throw new Error('The scan is still running. Open the agent trail to follow it, then reload.');
      if (run.error) throw new Error(run.error);
      await refresh();
      const msg = run.summary ? run.summary.split('\n').filter(Boolean).slice(-1)[0] : 'Scan finished.';
      setScan({ running: false, message: `${run.fallback ? 'Done, with rule-built findings: ' + run.fallback + ' ' : ''}${msg}`.trim(), error: false, steps: run.steps, done: true });
      announce(`Scan finished. ${pages.findings.length} findings on the board.`);
    } catch (e) {
      setScan({ running: false, message: e.status === 429 ? 'Too many scans in the last hour. Wait a few minutes, then scan again.' : `${e.message}`, error: true, steps: [] });
    }
  }

  if (load.state === 'error') {
    return <main className="empty" role="alert"><h2>Unable to load the board</h2><p>{load.message}</p><p><button className="tw-btn tw-btn-primary" onClick={() => location.reload()}>Reload</button></p></main>;
  }

  const nOpen = pages.findings.filter((f) => f.status === 'open').length;
  return (
    <div className="app">
      <a className="skip" href="#board">Skip to the board</a>
      <header className="topbar">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="var(--steel)" /><path d="M5 25h10l5-11 5 15 4-8h6" fill="none" stroke="var(--onSteel)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="20" cy="14" r="4" fill="var(--signalFill)" /></svg>
          <div><div className="brand-name">Tripwire</div><div className="brand-sub">Watches PayPal activity and builds the widget that explains it</div></div>
        </div>
        {asOf && <div className="clock" title="The stream keeps its own clock. New PayPal activity lands at its head."><span>Stream to</span><b>{dt(asOf)}</b></div>}
        <button type="button" className="tw-btn tw-btn-primary has-icon" onClick={runScan} disabled={scan.running || load.state !== 'ready'}>
          <Icon name={scan.running ? 'spin' : 'scan'} /><span className="btn-label">{scan.running ? 'Scanning' : 'Scan the stream'}</span>
        </button>
        <button type="button" className="tw-btn has-icon" aria-pressed={editing} onClick={() => setEditing((e) => !e)} title="Edit the board with AG Studio's builder and chat panel">
          <Icon name="edit" /><span className="btn-label">{editing ? 'Done editing' : 'Edit board'}</span>
        </button>
        <button type="button" className="tw-btn has-icon" onClick={() => setDetailsOpen(true)}><Icon name="info" /><span className="btn-label">Details</span></button>
        <button type="button" className="tw-btn has-icon" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </header>

      <div className={`statusline ${scan.error ? 'is-error' : ''}`} hidden={!scan.message && !scan.running} role="status">
        <p>{scan.message}</p>
        {scan.steps.length > 0 && <button type="button" onClick={() => setTrailOpen(true)}>Agent trail</button>}
        {!scan.running && <button type="button" onClick={() => setScan({ running: false, message: '', error: false, steps: [] })}>Dismiss</button>}
      </div>
      <div className="tw-sr" aria-live="polite" ref={liveRef} />

      <div className="main">
        <nav className="rail" aria-label="Board">
          {!finding ? (
            <>
              <div className="rail-h">Show</div>
              <div className="filters" role="group" aria-label="Filter findings">
                {['high', 'medium', 'low'].map((sv) => {
                  const n = pages.findings.filter((f) => f.severity === sv).length;
                  return <button key={sv} type="button" className="chip" aria-pressed={sevFilter === sv} disabled={!n} onClick={() => setSevFilter(sevFilter === sv ? null : sv)}><span>{SEVERITY[sv].glyph} {SEVERITY[sv].word}</span><span className="c">{n}</span></button>;
                })}
                <button type="button" className="chip" aria-pressed={unreviewed} onClick={() => setUnreviewed((u) => !u)}><span>Unreviewed only</span><span className="c">{nOpen}</span></button>
              </div>
              <div className="rail-h">Stream</div>
              <dl className="sum">
                <dt>Window</dt><dd>{windowLabel}</dd>
                <dt>Findings</dt><dd>{pages.findings.length}</dd>
                <dt>Reviewed</dt><dd>{pages.findings.filter((f) => f.status === 'reviewed').length}</dd>
                <dt>Written by</dt><dd>{pages.findings.some((f) => f.author === 'rules') ? 'agent + rules' : 'the agent'}</dd>
              </dl>
            </>
          ) : (
            <>
              <button type="button" className="link" onClick={() => setPage('overview')}>All findings</button>
              <div className="rail-h">Jump to</div>
              <ul className="nav jump">
                {pages.findings.map((f) => (
                  <li key={f.id}><button type="button" className={`nav-item ${f.status !== 'open' ? 'is-done' : ''}`} aria-current={current?.id === f.id ? 'page' : undefined} onClick={() => setPage(f.id)}>
                    <span className="t">{f.title}</span></button></li>
                ))}
              </ul>
            </>
          )}
          <div className="rail-foot">
            <button type="button" className="link" onClick={() => setTrailOpen(true)} disabled={!board?.runs?.length}>Agent trail for the last scan</button>
            <p className="rail-note">{board?.runs?.[0] ? `Last scan ${dt(board.runs[0].startedAt)} · ${board.runs[0].fallback ? 'rules fallback used' : 'written by the agent'}` : 'No scan yet.'}</p>
          </div>
        </nav>

        <section className="stage" id="board" aria-label={current?.title || 'Board'}>
          {finding && !editing ? <FindingHeader f={finding} onStatus={ctx.actions.setStatus} /> : (
            <div className="stage-bar"><h1>{finding ? finding.title : (board?.findings?.length
              ? `${(board?.findings || []).filter((f) => f.severity === 'high').length} of ${(board?.findings || []).length} findings need an answer today.`
              : 'Nothing flagged in this stream.')}</h1>{!finding && <p className="stage-sub">The watcher read the stream and built a widget for each one.</p>}</div>
          )}
          {editing && <p className="edit-note">Edit mode is on. Drag and resize widgets, or open the chat panel and ask for a grid or chart. Layout changes last until you reload; widgets added from chat are saved to the board.</p>}
          <div className="studio-wrap">
            <div className="studio-host" ref={hostRef} />
            {load.state === 'loading' && <div className="empty"><h2>Loading the stream</h2><p>Reading findings and widgets.</p></div>}
          </div>
        </section>
      </div>

      <TrailDialog open={trailOpen} onClose={() => setTrailOpen(false)} runs={board?.runs || []} live={scan.running ? scan.steps : null} />
      <DetailsDialog open={detailsOpen} onClose={() => setDetailsOpen(false)} onActivity={async () => { await refresh(); }} />
    </div>
  );
}
