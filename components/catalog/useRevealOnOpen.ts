"use client";

import { useEffect, useRef } from "react";

/**
 * A preview panel that appears in response to a tap must be SEEN (sim walk 2026-10-15): on a phone, "Go back to
 * the default" opened its preview ~530 px above the viewport and nothing moved, so the tap looked dead. On mount
 * the panel scrolls itself to the NEAREST edge (a preview already on screen, e.g. beside an edited line, does not
 * jump) and focus moves to its heading so a screen reader announces it. Instant scroll: no motion to reduce.
 */
export function useRevealOnOpen<T extends HTMLElement, H extends HTMLElement>() {
  const panelRef = useRef<T>(null);
  const headingRef = useRef<H>(null);
  useEffect(() => {
    panelRef.current?.scrollIntoView?.({ block: "nearest" });
    const heading = headingRef.current;
    if (!heading) return;
    // A panel taller than the viewport can be aligned by its BOTTOM, leaving the heading above the fold
    // (Astra review): bring the heading itself to the top in that case, then focus it without moving again.
    const r = heading.getBoundingClientRect?.();
    if (r && typeof window !== "undefined" && (r.top < 0 || r.bottom > window.innerHeight)) heading.scrollIntoView?.({ block: "start" });
    heading.focus?.({ preventScroll: true });
  }, []);
  return { panelRef, headingRef };
}
