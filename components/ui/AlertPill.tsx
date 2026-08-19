import type { ReactNode } from "react";

/**
 * AlertPill — the house status/alert pill, on co- tokens.
 *
 * Collapses the ~8 hand-rolled amber/red/green pills that drifted across the
 * catering + readiness surfaces (StatusBadge, PrepDemand ×4, Lto ×2, the hub
 * readiness count). Each had picked its own raw Tailwind palette
 * (`bg-amber-100 text-amber-800`, `bg-co-cta/15 text-co-cta`,
 * `bg-emerald-100 text-emerald-800`, …) — this maps every alert to the
 * design-token status colors so a palette change lands in one place.
 *
 * TONE MAPPING (semantic → tokens):
 *   warn   → warning-surface bg + warning  text  (over-par, order-more, choice-needs-pick, perishable)
 *   danger → danger-surface  bg + cta-text text  (not-ready, cancelled, cash-short)
 *   ok     → success-surface bg + success  text  (active, ready)
 *   info   → surface-2       bg + text-dim       (neutral/expired/informational)
 *
 * AA NOTE (token floor, 2026-08-19): `danger` reads --co-cta-text #B3252C, not
 * --co-danger #FF3A44. The brand red on danger-surface measures 2.94:1 — the same
 * failure as the hand-rolled `bg-co-cta/15 + text-co-cta` pills this primitive was
 * meant to replace. #B3252C on danger-surface is 5.43:1.
 *
 * STILL FAILING, deliberately left for the restyle sweep (each needs a new text
 * token this PR was not scoped to add): `warn` is #F59E0B on #FFF4D0 = 1.95:1 and
 * `ok` is #28B25C on #E8F7EE = 2.49:1. `info` passes at 4.64:1.
 *
 * The raw ambers (`amber-100/800`) map to `warn`; `co-cta/15 + co-cta` and
 * `red-100/700` map to `danger`; `emerald-100/800` maps to `ok`; `gray-100/600`
 * maps to `info`. Visual intent is preserved; the palette is now token-backed.
 *
 * DISPLAY-STRING contract: caller passes already-translated children. Presentational,
 * server-safe (no hooks, no "use client").
 *
 * `uppercase` (default true) matches the dominant catering pill idiom
 * (`uppercase tracking-[0.08em]`); pass false for the readiness-count idiom.
 */
export type AlertPillTone = "warn" | "danger" | "ok" | "info";

const TONE_CLASSES: Record<AlertPillTone, string> = {
  warn: "bg-co-warning-surface text-co-warning",
  danger: "bg-co-danger-surface text-co-cta-text",
  ok: "bg-co-success-surface text-co-success",
  info: "bg-co-surface-2 text-co-text-dim",
};

export function AlertPill({
  tone,
  children,
  uppercase = true,
  className,
}: {
  tone: AlertPillTone;
  /** Already-translated label/count. */
  children: ReactNode;
  /** Uppercase + wide tracking (the dominant catering idiom). Default true. */
  uppercase?: boolean;
  /** Extra classes merged after the base (e.g. layout `ml-2`, `shrink-0`). */
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold${
        uppercase ? " uppercase tracking-[0.08em]" : ""
      } ${TONE_CLASSES[tone]}${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}
