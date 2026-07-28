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
 * Uncontrolled by default (per-session useState, D9 — no localStorage, no URL).
 * Pass BOTH `open` and `onToggle` to lift state (controlled). `defaultOpen` seeds
 * the uncontrolled initial state and is ignored when controlled.
 */

import { useId, useState, type ReactNode } from "react";

export function CollapsibleSection({
  title,
  count,
  badge,
  defaultOpen = false,
  open,
  onToggle,
  children,
  idBase,
}: {
  /** Already-translated section title (caller runs t()). */
  title: string;
  /** Already-formatted count for the collapsed header (D5) — pass the result of
   *  t(key, { n }); null/undefined renders no count. */
  count?: number | null;
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
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  const handleToggle = () => {
    if (isControlled) onToggle?.();
    else setUncontrolledOpen((v) => !v);
  };

  // A locally-scoped id so multiple sections sharing an idBase (e.g. per-row)
  // never collide on the internal label association.
  const labelId = useId();

  return (
    <section className="co-card p-0">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls={idBase}
        id={labelId}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-co-text">{title}</span>
          {count != null && (
            <span className="text-xs text-co-text-muted">{count}</span>
          )}
          {badge}
        </span>
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
