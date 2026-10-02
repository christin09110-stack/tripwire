// Owns the AG Studio instance: creates it once, then pushes board, data, mode and layout changes into it.
import { createStudio, AgStudioModuleRegistry, AgStudioAiModule, enableStudioDevValidations } from 'ag-studio';
import { toStudioState } from '../../../shared/widgets.mjs';
import { DATASET_IDS } from '../../../shared/datasets.mjs';
import { studioThemeTripwire, tok } from '../theme.js';
import { widgetsConfig } from './definitions.js';
import { createAi } from './ai.js';

let registered = false;
export function mountStudio(el, { ctx, page = 'overview', stack = false, briefH = 18, only = null, trailH = 12, onPage, onBoardChange, onError }) {
  if (!registered) { AgStudioModuleRegistry.registerModules([AgStudioAiModule]); registered = true; }
  if (import.meta.env.DEV) enableStudioDevValidations();
  const sources = () => ({ sources: DATASET_IDS.map((id) => ({ id, data: ctx.data?.[id] || [] })) });
  const layoutFor = (mode) => { const t = tok(mode); return { minWidth: 0, pagePadding: 12, widgetPadding: 0, backgroundColor: t.bg, widgetBackgroundColor: t.surface, widgetBorderEnabled: true, widgetBorderColor: t.line, widgetBorderWidth: 1, widgetBorderRadius: 10 }; };
  let current = { board: ctx.board, page, stack, briefH, only, trailH };
  const state = () => toStudioState(current.board, current.page, { stack: current.stack, briefH: current.briefH, only: current.only, trailH: current.trailH, stackBriefH: window.innerWidth < 460 ? 33 : window.innerWidth < 640 ? 24 : 17 });
  let settingState = false;
  const api = createStudio(el, {
    mode: 'view', theme: studioThemeTripwire, layout: layoutFor(ctx.mode), panels: { view: { left: [], right: [] }, edit: { left: ['data'], right: ['ai', 'edit'] } }, widgets: widgetsConfig, context: ctx, data: sources(),
    initialState: state(),
    ai: createAi(ctx, { onBoardChange }),
    onStateUpdated: (e) => { if (!settingState && e.state.selectedPageId !== current.page) { current.page = e.state.selectedPageId; onPage?.(current.page); } },
    onErrorRaised: (e) => onError?.(e),
  });
  if (import.meta.env.DEV) window.__studio = api;
  let curMode = 'view';
  let curTheme = ctx.mode;
  const controller = {
    api,
    sync({ board, page, stack, briefH, only, trailH }) {
      current = { board, page, stack, briefH, only, trailH };
      settingState = true;
      try { api.setState(state()); } finally { settingState = false; }
    },
    setData() { api.setProperty('data', sources()); ctx.notify(); },
    setMode(mode) { if (mode !== curMode) { curMode = mode; api.setProperty('mode', mode); } },
    setTheme(mode) { if (mode !== curTheme) { curTheme = mode; api.setProperty('layout', layoutFor(mode)); } },
    destroy() { api.destroy(); },
  };
  return controller;
}
