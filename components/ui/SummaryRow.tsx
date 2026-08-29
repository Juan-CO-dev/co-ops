"use client";

/**
 * SummaryRow — Disclosure Doctrine primitive #2 (W0; docs/DISCLOSURE_DOCTRINE.md).
 *
 * The extracted CatalogClient row+drawer pattern (the proven house shape): an
 * always-visible summary line (identity + never-collapse badges per D1/D2) with a
 * toggle that reveals a lazy drawer. CatalogClient is consumer #1 and the parity
 * proof — this primitive reproduces its exact aria contract and lazy-render
 * behavior so the refit is byte-for-byte behavior-neutral.
 *
 * DISPLAY-STRING contract (like CollapsibleSection): the caller runs t(); this
 * primitive takes already-translated strings (`toggleLabel`) and pre-rendered
 * nodes (`summary`, `badges`, drawer `children`).
 *
 * CONTROL FLOOR: the toggle is a real tap target on seven phone surfaces, so it takes
 * the 44px floor paired with `items-center` (AGENTS.md § UI design system). It shipped
 * at `min-h-[32px]`: the 2026-08-19 phase-2 sweep hunted exactly that class — the
 * violation ledger lists the `min-h-[32px]` button pills by file and every one of them
 * was raised — but the ledger enumerated CONSUMERS and never named this primitive, so
 * the one control that seven surfaces inherit was the single site left under the floor.
 *
 * a11y (D10): the toggle is a <button> + aria-expanded + aria-controls={drawerId};
 * the drawer carries id={drawerId}. Drawer content is lazy — only rendered when
 * `expanded` (D10 perf; callers whose drawer holds unsaved edits should keep it
 * mounted by rendering their own locked variant, not via this browse primitive).
 *
 * State is caller-owned (`expanded` + `onToggle`) so browse surfaces can drive a
 * Set-based multi-expand (D7) exactly as CatalogClient does today.
 */

import type { ReactNode } from "react";

export function SummaryRow({
  summary,
  badges,
  expanded,
  onToggle,
  toggleLabel,
  drawerId,
  children,
}: {
  /** Always-visible identity line (D1) — already-rendered node. */
  summary: ReactNode;
  /** Never-collapse alert/status badges (D2) — rendered on the summary line. */
  badges?: ReactNode;
  /** Caller-owned expanded state (Set-based multi-expand lives in the caller, D7). */
  expanded: boolean;
  onToggle: () => void;
  /** Already-translated toggle label (caller runs t(); e.g. Show/Hide details). */
  toggleLabel: string;
  /** Stable id linking the toggle (aria-controls) to the drawer. */
  drawerId: string;
  /** Drawer content — lazy; only rendered when expanded (D10). */
  children: ReactNode;
}) {
  return (
    <div className="co-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {summary}
          {badges}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={drawerId}
          className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim hover:text-co-text"
        >
          {toggleLabel}
        </button>
      </div>

      {expanded && (
        <div id={drawerId} className="mt-3 flex flex-col gap-3 border-t border-co-border/50 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}
