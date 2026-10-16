/** Pure progressive motion policy; no media requests before every gate passes. */
export interface MotionState {
  lcpReady: boolean; triggered: boolean; visible: boolean; documentVisible: boolean;
  reducedMotion: boolean; saveData: boolean; failed: boolean; paused: boolean;
}
export function shouldLoadMotion(state: MotionState): boolean {
  return state.lcpReady && state.triggered && state.visible && state.documentVisible && !state.reducedMotion && !state.saveData && !state.failed;
}
export function shouldPlayMotion(state: MotionState): boolean {
  return shouldLoadMotion(state) && !state.paused;
}
