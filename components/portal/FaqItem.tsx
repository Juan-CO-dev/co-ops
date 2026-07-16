"use client";

/**
 * FaqItem — an expanding question. The FAQ "surfaces naturally" attached to a bit of info:
 * a short statement, then a tap-to-open answer. Lowkey grid-rows transition (no layout jank).
 */

import { useState } from "react";

export function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface/70 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-sm font-bold text-co-text sm:text-base">{q}</span>
        <span aria-hidden className={`shrink-0 text-xl leading-none text-co-text-dim transition-transform duration-300 ${open ? "rotate-45" : ""}`}>+</span>
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <p className="px-5 pb-4 text-sm leading-relaxed text-co-text-muted">{a}</p>
        </div>
      </div>
    </div>
  );
}
