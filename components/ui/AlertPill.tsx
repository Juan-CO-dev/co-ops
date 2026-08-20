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
 *   warn   → warning-surface bg + warning-text text (over-par, order-more, choice-needs-pick, perishable)
 *   danger → danger-surface  bg + cta-text     text (not-ready, cancelled, cash-short)
 *   ok     → success-surface bg + confirm-text text (active, ready)
 *   info   → surface-2       bg + text-dim          (neutral/expired/informational)
 *
 * AA NOTE (token floor, 2026-08-19): every tone reads a TEXT-role token, never the
 * matching brand fill color. The brand values are fills and fail badly as text on
 * their own pale surfaces — --co-danger 2.94:1, --co-warning 1.95:1, --co-success
 * 2.49:1 — which is exactly the failure of the hand-rolled `bg-co-cta/15 +
 * text-co-cta` / `amber-100/800` pills this primitive replaced. Measured on each
 * tone's own surface: danger #B3252C = 5.43:1 · warn #8A5700 = 5.55:1 ·
 * ok #14532D = 8.23:1 · info 4.64:1. All clear the 4.5:1 AA text floor.
 *
 * `ok` reads --co-confirm-text and NOT a --co-success-text: #14532D already IS the
 * dark-green-text-on-light role, and minting a second name for one role is the
 * drift the token floor exists to prevent (see app/globals.css).
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
  warn: "bg-co-warning-surface text-co-warning-text",
  danger: "bg-co-danger-surface text-co-cta-text",
  ok: "bg-co-success-surface text-co-confirm-text",
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
