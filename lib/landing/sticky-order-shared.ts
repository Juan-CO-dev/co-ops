/** v4.2 (Juan): the sticky order control is ONE slim "Order" pill that opens the shop chooser.
 * It shows only where no other way to order is on screen. Pure rule; the component feeds it
 * IntersectionObserver / attribute facts (no per-frame layout reads). No storage of any kind. */

/** In-content order surfaces. While any of them is in view the pill stays hidden. Stable wrappers
 * (a sheet's own trigger swaps from native links to a button, so its container is observed). */
export const IN_CONTENT_ORDER_SELECTOR = [
  '[data-hero-actions]',            // the hero's two shop buttons
  '.landing-v3-plate',              // the fighter card (name, order action, ingredients)
  '.landing-v4-crave-cta',          // the crunch story's order action
  '[data-guide-cta]',               // the Field Guide's six-of-six action (counts once revealed)
  '.landing-v4-shop-order',         // each shop card's order button
  '.landing-v4-catering-act',       // catering's order action
  'footer',                         // the footer's shop buttons and its links
].join(', ');

/** A reserved-but-unrevealed slot is not an order control yet. */
export function blocksPill(element: { getAttribute(name: string): string | null }): boolean {
  return element.getAttribute('data-ready') !== 'false';
}

/** Below this visual height (keyboard up, landscape phone, zoom) no floating chrome at all. */
export const PILL_MIN_VISUAL_HEIGHT = 500;

export interface PillFacts {
  /** Any in-content order surface (or the hero's buttons) intersects the viewport. */
  orderInView: boolean;
  /** The consent notice is showing in any form (unanswered, collapsed-unanswered, or reopened). */
  consentShowing: boolean;
  pageHidden: boolean;
  visualHeight: number;
  /** The pill's own shop sheet is open: never pull its trigger out from under it. */
  sheetOpen: boolean;
}
export function stickyPillVisible(facts: PillFacts): boolean {
  if (facts.sheetOpen) return true;
  return !facts.orderInView && !facts.consentShowing && !facts.pageHidden && facts.visualHeight >= PILL_MIN_VISUAL_HEIGHT;
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
