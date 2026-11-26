// A tiny external store linking the simulation engine (engine.js) to React.
// The engine calls buildUI(initialState, handlers) exactly as before and gets
// back an API whose methods only update this store; components subscribe to it.
import { useSyncExternalStore } from 'react';

let state = {
  ready: false,
  init: null, // initial settings snapshot from the engine
  modes: {},
  preset: 'balanced',
  paused: false,
  warmed: false,
  summary: null,
  pressureRange: null,
  view: null,
  flat: false,
  toast: null, // { text, n }
};
const listeners = new Set();

export const store = {
  get: () => state,
  set(patch) {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  },
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Subscribe to one slice of the store. The selector must return stored values, not new objects. */
export const useStore = (select) => useSyncExternalStore(store.subscribe, () => select(store.get()));

let handlers = null;
let viewRef = null;
let toastN = 0;

/** Call an engine handler (no-op until the engine has started). */
export const call = (name, ...args) => handlers?.[name]?.(...args);

/** Re-read the engine's view object (it is mutated in place). */
export const syncView = () => viewRef && store.set({ view: { ...viewRef } });

export function buildUI(init, h) {
  handlers = h;
  viewRef = init.view;
  store.set({ ready: true, init, modes: { ...init.modes }, view: { ...init.view } });
  return {
    updateStats(summary, extra) {
      if (!summary) return;
      store.set({ summary, warmed: true, pressureRange: extra?.pressureRange ?? null });
    },
    updateLegend: syncView,
    toast(text) { store.set({ toast: { text, n: ++toastN } }); },
    setModes(modes) { store.set({ modes: { ...modes } }); },
    setActivePreset(id) { store.set({ preset: id || null }); },
    setPaused(p) { store.set({ paused: p }); },
    setCount: syncView,
  };
}
