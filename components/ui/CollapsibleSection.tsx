"use client";

/**
 * CollapsibleSection — Disclosure Doctrine primitive #1 (W0; docs/DISCLOSURE_DOCTRINE.md).
 *
 * A default-collapsed (or default-open) section whose header is a FULL-ROW
 * <button> tap target (D8: min-h 44px, full width, title + i18n'd count + a
 * badge slot for never-collapse alerts per D2 + a chevron). Children conditional-
 * render when closed (D10 perf) — EXCEPT callers with dirty editors, who drive the
 * controlled mode (`open` + `onToggle`) and keep the section locked open so unsaved
 * edits stay mounted.
 *
 * DISPLAY-STRING contract: this component takes already-translated strings (the
 * caller runs t()); it never calls the i18n resolver itself. That keeps the
 * primitive tenant/i18n-agnostic and lets each surface own its own keys.
 *
 * a11y (D10): <button> + aria-expanded + aria-controls={idBase}; the panel it
 * controls carries id={idBase}. The whole header row is the toggle — never icon-only.
 *
 * `description` (nav PR 4): an optional one-line explanation under the title, inside the header button, so it stays
 * readable while the section is closed (a Back office group's line). Without it the header renders exactly as before.
 *
 * Uncontrolled by default (per-session useState, D9 — no localStorage, no URL).
 * Pass BOTH `open` and `onToggle` to lift state (controlled). `defaultOpen` seeds
 * the uncontrolled initial state and is ignored when controlled.
 *
 * DEEP LINKS (digests round 3, PR 1b): a section with an `anchorId` REVEALS itself when the page's hash
 * is `#<anchorId>` — once after mount and again on every `hashchange` to it (the lead card's pattern,
 * components/catering/pipeline/PipelineClient.tsx). It only ever OPENS: a closed section opens (in
 * controlled mode it calls `onToggle` once, and only while closed, so the reveal never closes a section),
 * an open one stays open; then the section is scrolled into view AFTER the open has rendered. It reads the
 * fragment and writes nothing (D9). A hash that names another section, or no hash, changes nothing.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function CollapsibleSection({
  title,
  description,
  count,
  badge,
  defaultOpen = false,
  open,
  onToggle,
  children,
  idBase,
  anchorId,
}: {
  /** Already-translated section title (caller runs t()). */
  title: string;
  /** Already-translated one line under the title, inside the header (wraps); omit for none. */
  description?: string;
  /** Already-formatted count for the collapsed header (D5) — pass the result of
   *  t(key, { n }); null/undefined renders no count. */
  count?: ReactNode;
  /** Never-collapse alert slot (D2): over-par / issue / unsaved badges render here,
   *  visible in both states. */
  badge?: ReactNode;
  /** Uncontrolled initial state (ignored when controlled). */
  defaultOpen?: boolean;
  /** Controlled open state — pass with onToggle to lift state (D10 dirty-editor lock). */
  open?: boolean;
  /** Controlled toggle handler — required when `open` is set. */
  onToggle?: () => void;
  children: ReactNode;
  /** Stable id for the controlled panel (aria-controls target). */
  idBase: string;
  /** Optional page anchor on the section itself (a deep link scrolls here, e.g. from a digest email). */
  anchorId?: string;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  // The reveal reads the CURRENT open state and toggle handler through a ref, so it runs only on mount and
  // on hashchange (never again because the person closed the section while the hash still names it).
  const sectionRef = useRef<HTMLElement>(null);
  const latest = useRef({ isOpen, isControlled, onToggle });
  useEffect(() => { latest.current = { isOpen, isControlled, onToggle }; });
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (!anchorId) return;
    const fromHash = () => {
      if (window.location.hash !== `#${anchorId}`) return;
      const now = latest.current;
      if (!now.isOpen) {
        if (now.isControlled) now.onToggle?.();
        else setUncontrolledOpen(true);
      }
      setReveal((n) => n + 1);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [anchorId]);
  // Scroll AFTER the open has committed: this runs after the render that carries the new `reveal` (and the
  // open state set in the same batch). A controlled parent that keeps it closed still gets its header shown.
  useEffect(() => {
    if (reveal === 0) return;
    sectionRef.current?.scrollIntoView?.({ block: "start" });
  }, [reveal]);

  const handleToggle = () => {
    if (isControlled) onToggle?.();
    else setUncontrolledOpen((v) => !v);
  };

  // A locally-scoped id so multiple sections sharing an idBase (e.g. per-row)
  // never collide on the internal label association.
  const labelId = useId();

  return (
    <section ref={sectionRef} id={anchorId} className="co-card p-0">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls={idBase}
        id={labelId}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        {description === undefined ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-co-text">{title}</span>
            {count != null && (
              <span className="text-xs text-co-text-muted">{count}</span>
            )}
            {badge}
          </span>
        ) : (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-co-text">{title}</span>
              {count != null && (
                <span className="text-xs text-co-text-muted">{count}</span>
              )}
              {badge}
            </span>
            <span className="text-xs text-co-text-muted">{description}</span>
          </span>
        )}
        <span aria-hidden className="text-xs text-co-text-dim">{isOpen ? "▾" : "▸"}</span>
      </button>

      {isOpen && (
        <div id={idBase} className="border-t border-co-border/50 px-4 pb-4 pt-3">
          {children}
        </div>
      )}
    </section>
  );
}
