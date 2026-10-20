/** v4.2 (Juan): the sticky order control is ONE slim "Order" pill that opens the shop chooser.
 * It shows only where no other usable order control is on screen. Pure rule; the component feeds
 * it IntersectionObserver / attribute facts (no per-frame layout reads). No storage of any kind. */

/** The page's STATIC order controls, each observed on its own (never a whole card or section:
 * a card's heading or ingredients on screen is not a way to order). The sheet triggers (fighter
 * card, crunch story, Field Guide) swap from native links to a button, so they register
 * themselves through `registerOrderControl` instead. */
export const STATIC_ORDER_CONTROL_SELECTOR = [
  '[data-hero-actions] [data-landing-placement]',     // the hero's two shop buttons (not "Find your shop")
  '[data-guide-cta]',                                 // the Field Guide's slot, tight around its action (counts once revealed)
  '#shops [data-landing-placement]',                  // each shop card's order button (+ Dupont's Uber Eats)
  '.landing-v4-catering-act [data-landing-placement]',// catering's order action (not the walker)
  'footer [data-landing-placement]',                  // the footer's shop buttons and delivery links
].join(', ');

/** A reserved-but-unrevealed slot is not an order control yet. */
export function blocksPill(element: { getAttribute(name: string): string | null }): boolean {
  return element.getAttribute('data-ready') !== 'false';
}

/** A control counts as on screen (usable) once at least half of it is inside the viewport. */
export const USABLE_RATIO = 0.5;
export function usableRatio(ratio: number): boolean { return ratio >= USABLE_RATIO; }

/** At or below this visual height (landscape phone, short window) the pill stays, compact. */
export const PILL_COMPACT_MAX_HEIGHT = 499;

export interface PillFacts {
  /** A usable order control (or the hero's buttons) is on screen. */
  orderInView: boolean;
  /** The consent notice is showing in any form (unanswered, collapsed-unanswered, or reopened). */
  consentShowing: boolean;
  pageHidden: boolean;
  /** The pill's own shop sheet is open: never pull its trigger out from under it. */
  sheetOpen: boolean;
}
export function stickyPillVisible(facts: PillFacts): boolean {
  if (facts.sheetOpen) return true;
  return !facts.orderInView && !facts.consentShowing && !facts.pageHidden;
}

/** Clear time required before the pill appears (it hides at once): no flicker while scrolling
 * from one order surface to the next. */
export const PILL_SHOW_DWELL_MS = 300;
export function createPillPolicy() {
  let visible = false, clearSince: number | null = null;
  return {
    update(facts: PillFacts, now: number): { visible: boolean; wait: number | null } {
      if (!stickyPillVisible(facts)) { visible = false; clearSince = null; return { visible, wait: null }; }
      if (visible || facts.sheetOpen) { visible = true; clearSince = null; return { visible, wait: null }; }
      clearSince ??= now;
      visible = now - clearSince >= PILL_SHOW_DWELL_MS;
      return { visible, wait: visible ? null : PILL_SHOW_DWELL_MS - (now - clearSince) };
    },
  };
}

/** Live registry of the sheet triggers' current element (native links, then the button).
 * Registration is an event, not a scroll-time query. Browser module state; no storage. */
type ControlListener = (element: Element, added: boolean) => void;
const controls = new Set<Element>();
const listeners = new Set<ControlListener>();
export function registerOrderControl(element: Element): () => void {
  controls.add(element);
  for (const listener of listeners) listener(element, true);
  return () => { controls.delete(element); for (const listener of listeners) listener(element, false); };
}
export function subscribeOrderControls(listener: ControlListener): () => void {
  listeners.add(listener);
  for (const element of controls) listener(element, true);
  return () => { listeners.delete(listener); };
}
