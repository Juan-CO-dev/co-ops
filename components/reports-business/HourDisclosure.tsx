"use client";

/**
 * One HOUR of the business report's 15-minute list (polish, 2026-11-18): a summary row that opens its quarters.
 * A day used to list every active 15 minutes open (about 40 phone screens); now it lists its hours, closed.
 *
 * The SummaryRow pattern of docs/DISCLOSURE_DOCTRINE.md, lighter than CollapsibleSection so three levels of cards
 * do not nest at 375 px: a FULL-ROW button (44 px floor, `items-center`), aria-expanded + aria-controls, per-session
 * useState only, the quarters rendered only while open. It takes already-rendered nodes: it holds no figure.
 */
import { useState, type ReactNode } from "react";

export function HourDisclosure({ idBase, title, summary, children }: { idBase: string; title: string; summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <li className="border-b border-co-border/50">
    <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={idBase}
      className="flex min-h-[44px] w-full items-center justify-between gap-2 py-2 text-left text-sm">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="min-w-[4.5rem] font-bold text-co-text">{title}</span>
        {summary}
      </span>
      <span aria-hidden="true" className="text-xs text-co-text-dim">{open ? "▾" : "▸"}</span>
    </button>
    {open ? <ul id={idBase} className="mb-2 ml-2 border-l-2 border-co-border pl-3">{children}</ul> : null}
  </li>;
}
