"use client";

/**
 * The one dialog shell of the top bar (nav PR 9, plan r2 3.1, 5.2-5.6): Go to and the bell panel both render inside it,
 * so they share one focus trap, Escape, scroll lock, z-index and modal arbitration.
 *
 * - Portaled to `document.body`; `role="dialog" aria-modal="true" aria-labelledby`, marked `data-co-nav-sheet` so the
 *   arbiter never counts it as foreign. Full height on a phone; a right-hand drawer over a backdrop from `sm`.
 * - `z-[1000]` (plan 5.5): above every page bar and page modal (<= z-[60]), below the idle warning (z-[1050]), the
 *   password modal (z-[1100]) and the sign-out cover (z-[2000], top layer). Never a native top-layer <dialog>.
 * - Body scroll lock while open. Tab / Shift+Tab cycle inside (recomputed on each keypress, so a growing result list is
 *   included; the IdleTimeoutWarning pattern). Escape closes, ignoring an event already `defaultPrevented` or aimed
 *   outside the sheet. Backdrop click closes. Focus goes to `initialFocus` on open and back to `returnFocus` on close.
 * - SUSPENDS while a foreign modal is open (`useForeignModal`): `hidden` + `inert`, its key listener detached; the
 *   scroll lock stays. It resumes, focus back on the element that had it, when the foreign modal goes.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useForeignModal } from "./modal-arbiter";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  id: string;
  open: boolean;
  onClose: () => void;
  /** Id of the element that names the dialog (a heading inside it). */
  labelledBy: string;
  /** Focused when the sheet opens (the search box, or the bell panel's close button); else the first focusable. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Focus goes back here when the sheet closes (the trigger, or what had focus before Ctrl+K). */
  returnFocus?: HTMLElement | null;
  children: ReactNode;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[hidden]"));
}

export function Sheet({ id, open, onClose, labelledBy, initialFocus, returnFocus, children }: SheetProps) {
  const suspended = useForeignModal();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Body scroll lock while open (kept while suspended: the foreign modal expects the page not to scroll).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  // Focus in on open; back to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const target = initialFocus?.current ?? (panelRef.current ? focusables(panelRef.current)[0] : undefined);
    target?.focus();
    const back = returnFocus ?? null;
    return () => {
      if (back && back.isConnected) back.focus();
    };
    // returnFocus / initialFocus are read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Remember what had focus inside while active; restore it on resume.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    if (suspended) return;
    const el = lastFocused.current;
    if (el && el.isConnected && root.contains(el)) el.focus();
    const now = document.activeElement;
    if (now instanceof HTMLElement && root.contains(now)) lastFocused.current = now;
    const track = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && root.contains(e.target)) lastFocused.current = e.target;
    };
    document.addEventListener("focusin", track);
    return () => document.removeEventListener("focusin", track);
  }, [open, suspended]);

  // Escape and the Tab trap: attached only while open AND not suspended.
  useEffect(() => {
    if (!open || suspended) return;
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      const panel = panelRef.current;
      if (!root || !panel || e.defaultPrevented) return;
      const inside = e.target instanceof Node && root.contains(e.target);
      if (e.key === "Escape") {
        if (!inside) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(panel);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const within = active instanceof Node && panel.contains(active);
      if (e.shiftKey) {
        if (!within || active === first) { e.preventDefault(); last.focus(); }
      } else if (!within || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, suspended]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      id={id}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      data-co-nav-sheet=""
      data-suspended={suspended ? "" : undefined}
      hidden={suspended}
      inert={suspended}
      className="fixed inset-0 z-[1000]"
    >
      <div aria-hidden onClick={() => onCloseRef.current()} data-co-nav-backdrop="" className="absolute inset-0 bg-co-text/60 motion-safe:transition-opacity" />
      <div
        ref={panelRef}
        className="
          absolute inset-0 flex flex-col overflow-y-auto bg-co-surface
          sm:inset-y-0 sm:left-auto sm:right-0 sm:w-full sm:max-w-md sm:border-l-2 sm:border-co-border sm:shadow-2xl
          motion-safe:transition-transform
        "
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
