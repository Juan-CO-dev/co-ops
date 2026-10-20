/** The P1 pixel hop on a tapped control. Purely decorative: CSS draws the sprite in an
 * ::after box (no element, nothing announced) and draws nothing under reduced motion or
 * Save-Data. It never prevents, delays or waits on the control's own action. */
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
export const HOP_MS = 650;
export function hop(element: HTMLElement): void {
  try {
    clearTimeout(timers.get(element));
    delete element.dataset.hop;
    // Restart the CSS animation when the same control is tapped again.
    void element.offsetWidth;
    element.dataset.hop = '';
    timers.set(element, setTimeout(() => { delete element.dataset.hop; }, HOP_MS));
  } catch { /* Decoration never affects the tap. */ }
}
