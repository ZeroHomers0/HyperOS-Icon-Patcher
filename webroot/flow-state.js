const state = {
  theme: null,
  themeReady: false,
  group: null,
  pendingIconCount: 0,
  patchMode: "missing",
  patchStatus: "idle"
};
const listeners = new Set();

export function getFlowState() {
  return { ...state };
}

export function updateFlowState(patch) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] === value) continue;
    state[key] = value;
    changed = true;
  }
  if (!changed) return;
  const snapshot = getFlowState();
  for (const listener of listeners) listener(snapshot);
}

export function subscribeFlowState(listener) {
  listeners.add(listener);
  listener(getFlowState());
  return () => listeners.delete(listener);
}
