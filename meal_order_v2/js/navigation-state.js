let state = { dirty: () => false, busy: () => false };
let leaving = false;
export function registerNavigationState(next) { state = next; }
export function navigationDirty() { return state.dirty(); }
export function navigationBusy() { return state.busy(); }
export function isNavigationLeaving() { return leaving; }
export function markNavigationLeaving() { leaving = true; }
