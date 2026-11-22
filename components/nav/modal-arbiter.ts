"use client";

/**
 * Modal arbitration for the top bar's sheets (nav PR 9, plan r2 5.6; lead ruling r1 F2).
 *
 * A FOREIGN modal is any element that already marks itself modal, by the house pattern: `aria-modal="true"` or an open
 * native `<dialog>`, except the bar's own sheets (`data-co-nav-sheet`). That covers the PIN dialog, the password modal,
 * the idle-logout warning, the sign-out cover and every page dialog that marks itself modal, with no change to any of
 * them (no prop, no registration call). While one is open, Go to and the bell panel neither open nor stay active: an open
 * sheet SUSPENDS (hidden, inert, its key handlers detached) and resumes when the last foreign modal goes. The PIN dialog
 * sits at z-50, BELOW the sheet, and keeps consuming digits on `window`; arbitration, not stacking, is what protects it.
 */
import { useSyncExternalStore } from "react";

export const FOREIGN_MODAL_SELECTOR = '[aria-modal="true"]:not([data-co-nav-sheet]), dialog[open]:not([data-co-nav-sheet])';

/** Is any foreign modal in the document now? */
export function foreignModalOpen(doc: Document = document): boolean {
  return doc.querySelector(FOREIGN_MODAL_SELECTOR) !== null;
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-modal", "open"] });
  return () => observer.disconnect();
}
const snapshot = () => foreignModalOpen();
const serverSnapshot = () => false;

/** True while a foreign modal is open; re-read whenever the body's tree or an `aria-modal` / `open` attribute changes. */
export function useForeignModal(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
