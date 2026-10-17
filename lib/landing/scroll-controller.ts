/** One event-driven viewport scheduler for landing features. No continuous RAF loop.
 * Functional visibility still updates under reduced motion; decorative consumers
 * must use reducedMotion and active to omit motion and offscreen work.
 */
export interface ScrollFrame { reducedMotion: boolean; active: boolean }
type Listener = { element: Element; callback: (frame: ScrollFrame) => void; offscreen: boolean; wasActive: boolean };
const listeners = new Set<Listener>();
let observer: IntersectionObserver | undefined;
let resize: ResizeObserver | undefined;
let motion: MediaQueryList | undefined;
let frame = 0;
function flush() {
  frame = 0;
  if (document.hidden) return;
  for (const listener of listeners) {
    const box = listener.element.getBoundingClientRect();
    const active = box.bottom > 0 && box.top < innerHeight;
    if (active || listener.wasActive || listener.offscreen) listener.callback({active, reducedMotion: motion?.matches ?? true});
    listener.wasActive = active;
  }
}
function schedule() {
  if (!document.hidden && !frame) frame = requestAnimationFrame(flush);
}
function visibility() {
  if (document.hidden) {
    cancelAnimationFrame(frame); frame = 0;
    for (const listener of listeners) {
      if (listener.wasActive) listener.callback({active:false,reducedMotion:motion?.matches??true});
      listener.wasActive=false;
    }
  }
  else schedule();
}
export function observeLandingViewport(element: Element, callback: Listener['callback'], options: {offscreen?: boolean} = {}) {
  if (!listeners.size) {
    motion = matchMedia('(prefers-reduced-motion: reduce)');
    observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(schedule, {threshold: [0, .5, 1]});
    resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    window.addEventListener('scroll', schedule, {passive: true});
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', schedule);
  }
  const listener = {element, callback, offscreen: options.offscreen ?? false, wasActive:false};
  listeners.add(listener); observer?.observe(element); resize?.observe(element); schedule();
  return () => {
    listeners.delete(listener);
    if (![...listeners].some(other => other.element === element)) { observer?.unobserve(element); resize?.unobserve(element); }
    if (listeners.size) return;
    observer?.disconnect(); resize?.disconnect(); cancelAnimationFrame(frame); frame = 0;
    window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); window.removeEventListener('pageshow', schedule);
    window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule);
    document.removeEventListener('visibilitychange', visibility); motion?.removeEventListener('change', schedule);
  };
}
