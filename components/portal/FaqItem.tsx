"use client";

/**
 * FaqItem — an expanding question. The FAQ "surfaces naturally" attached to a bit of info:
 * a short statement, then a tap-to-open answer. Lowkey grid-rows transition (no layout jank).
 */

export function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface/70 backdrop-blur-sm">
      <summary
        className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-left focus-visible:outline-2"
      >
        <span className="text-sm font-bold text-co-text sm:text-base">{q}</span>
        <span aria-hidden className="shrink-0 text-xl leading-none text-co-text-dim motion-safe:transition-transform motion-safe:duration-300 group-open:rotate-45">+</span>
      </summary>
      <p className="px-5 pb-4 text-sm leading-relaxed text-co-text-muted">{a}</p>
    </details>
  );
}
