// Shared, mutable context handed to Studio as its `context` property. Custom widgets read from it and re-render when it notifies.
export function createContext() {
  const subs = new Set();
  const ctx = {
    mode: 'light',
    data: null,
    board: { findings: {}, widgets: {} },
    actions: {},
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    notify() { for (const f of [...subs]) { try { f(); } catch (e) { console.error(e); } } },
    widget(id) { return ctx.board.widgets[id] || null; },
    finding(id) { return ctx.board.findings[id] || null; },
  };
  return ctx;
}
