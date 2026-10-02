// One watch run: detect, investigate with the model, fall back to rules where the model could not, persist, narrate.
import { prepare, DATASET_IDS } from '../../shared/datasets.mjs';
import { detectAll } from './detect.mjs';
import { investigate, findingIdFor } from './agent.mjs';
import { BedrockUnavailable } from './bedrock.mjs';
import { ruleFinding, ruleWidgets } from './fallback.mjs';
import { headOf } from './seed.mjs';

const r3 = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);
export const fingerprint = (c) => `${c.kind}|${c.subject}|${c.evidenceIds.length}|${r3(c.metric.current)}`;

export async function loadData(store) {
  const rows = await store.getAllRows();
  const asOf = (await store.getMeta('asOf')) || headOf(rows);
  return { rows, asOf, data: prepare(rows, asOf) };
}

export async function scan({ store, bedrock, runId, trigger = 'manual', force = false, useModel = true, now = () => new Date().toISOString() }) {
  const startedAt = now();
  await store.createRun({ id: runId, trigger, startedAt });
  let chain = Promise.resolve();
  const step = (s) => { chain = chain.then(() => store.step(runId, s)).catch(() => {}); };
  try {
    const { data, asOf } = await loadData(store);
    const cands = detectAll(data).map((c) => ({ ...c, fingerprint: fingerprint(c) }));
    const existing = Object.fromEntries((await store.listFindings()).map((f) => [f.id, f]));
    const dismissed = (await store.getMeta('dismissed')) || {};
    const widgetsNow = await store.listWidgets();
    step({ kind: 'note', detail: `Stream clock ${asOf}. Detector flagged ${cands.length} candidate(s).` });

    const work = [];
    for (const c of cands) {
      const id = findingIdFor(c.id);
      const have = existing[id];
      const hasWidgets = widgetsNow.some((w) => w.findingId === id);
      if (!force && have && have.fingerprint === c.fingerprint && hasWidgets) { step({ kind: 'note', detail: `${c.id}: unchanged since the last scan, skipped.` }); continue; }
      if (!force && dismissed[c.id]?.fingerprint === c.fingerprint) { step({ kind: 'note', detail: `${c.id}: dismissed earlier, nothing new.` }); continue; }
      work.push(c);
    }
    // findings whose pattern has gone away are cleared, not deleted
    const live = new Set(cands.map((c) => findingIdFor(c.id)));
    for (const f of Object.values(existing)) {
      if (!live.has(f.id) && f.status === 'open') { await store.putFinding({ ...f, status: 'cleared', updatedAt: now() }); step({ kind: 'note', detail: `${f.title}: no longer detected, marked cleared.` }); }
    }

    const state = { findings: {}, widgets: {}, dismissed: {}, widgetCount: {} };
    let usage = { input: 0, output: 0, calls: 0 }, summary = '', fallback = null, model = bedrock?.model;
    if (work.length && useModel && bedrock) {
      try {
        const out = await investigate({ bedrock, ctx: { data, candidates: work, state, store, runId, now }, onStep: step });
        usage = out.usage; summary = out.summary;
      } catch (e) {
        if (e instanceof BedrockUnavailable) { fallback = e.message; step({ kind: 'fallback', detail: `${e.message} Remaining candidates use rule-built findings, labelled as such.` }); }
        else throw e;
      }
    } else if (work.length) { fallback = 'The model was not used for this run.'; }

    // anything the model did not settle is built by rules
    for (const c of work) {
      const id = findingIdFor(c.id);
      if (state.dismissed[c.id]) continue;
      if (!state.findings[id]) {
        state.findings[id] = ruleFinding(c, { runId, now: now() });
        step({ kind: 'fallback', detail: `${c.id}: finding written by rules.` });
      }
      const built = Object.values(state.widgets).filter((w) => w.findingId === id);
      if (!built.length) {
        for (const w of ruleWidgets(c, state.findings[id], { runId, now: now() })) state.widgets[w.id] = w;
        step({ kind: 'fallback', detail: `${c.id}: widgets built by rules.` });
      }
    }

    // persist
    for (const [id, f] of Object.entries(state.findings)) {
      for (const w of widgetsNow.filter((x) => x.findingId === id)) await store.deleteWidget(w.id);
      const prev = existing[id];
      await store.putFinding({ ...f, status: prev?.status === 'reviewed' && prev.fingerprint === f.fingerprint ? 'reviewed' : 'open', createdAt: prev?.createdAt || f.createdAt, updatedAt: now() });
    }
    for (const w of Object.values(state.widgets)) await store.putWidget(w);
    if (Object.keys(state.dismissed).length) await store.putMeta('dismissed', { ...dismissed, ...state.dismissed });

    const made = Object.keys(state.findings).length, dis = Object.keys(state.dismissed).length;
    if (!work.length) summary = cands.length ? 'Nothing changed since the last scan. No model call was made.' : 'No unusual patterns in the stream.';
    step({ kind: 'note', detail: `Done: ${made} finding(s) written, ${dis} dismissed, ${Object.keys(state.widgets).length} widget(s) built.` });
    await chain;
    await store.finishRun(runId, { summary, usage, fallback, model, asOf, counts: { candidates: cands.length, investigated: work.length, findings: made, dismissed: dis, widgets: Object.keys(state.widgets).length }, finishedAt: now() });
    return { runId, made, dismissed: dis, fallback, summary };
  } catch (e) {
    step({ kind: 'error', detail: e.message });
    await chain;
    await store.finishRun(runId, { error: e.message, finishedAt: now() });
    throw e;
  }
}
