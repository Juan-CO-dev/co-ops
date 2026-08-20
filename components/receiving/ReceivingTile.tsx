import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { AlertPill } from "@/components/ui/AlertPill";
import { ActionLink } from "@/components/ActionButton";
import { composeReceivingTile, type ReceivingDeliveryFacts } from "@/lib/dashboard-status-shared";

/**
 * Receiving status tile — a per-truck mini-list of TODAY's deliveries (design §1).
 *
 * Leads with per-truck PROBLEMS; everything handled shrinks to badges. Caps at 3
 * rows with an "and N more" line, and keeps a quiet "Log another delivery" action
 * underneath. When nothing landed today it falls back to the original action tile,
 * unchanged, because "log a delivery" is genuinely the right thing to offer.
 *
 * `deliveries === null` means the loader FAILED — we say so rather than rendering
 * an empty state that would falsely claim no trucks came.
 */
export function ReceivingTile({
  language,
  locationId,
  deliveries,
  today,
}: {
  language: Language;
  locationId: string;
  /** Today-inclusive delivery facts, or null when the read failed. */
  deliveries: ReceivingDeliveryFacts[] | null;
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
}) {
  const href = `/operations/receiving?location=${locationId}`;

  if (deliveries === null) {
    return (
      <section className="co-card p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.receiving.tile_label")}
        </p>
        <p className="mt-2 text-sm text-co-text-muted italic">
          {serverT(language, "dashboard.tile.unavailable")}
        </p>
      </section>
    );
  }

  const vm = composeReceivingTile({ deliveries, today });

  // Empty state — today's original action tile, unchanged in intent. NOT a
  // tap-through card: the ActionLink is the affordance, and wrapping it in an
  // outer <Link> would nest anchors (invalid HTML + an a11y trap).
  if (vm.empty) {
    return (
      <section
        className="co-card p-4 sm:p-5"
        aria-label={serverT(language, "dashboard.receiving.aria", {
          summary: serverT(language, "dashboard.receiving.headline_none"),
        })}
      >
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.receiving.tile_label")}
        </p>
        <p className="mt-2 text-[11px] italic text-co-text-muted">
          {serverT(language, "dashboard.receiving.hint")}
        </p>
        <div className="mt-3">
          <ActionLink href={href} variant="primary" className="w-full sm:w-auto">
            {serverT(language, "dashboard.receiving.cta")}
          </ActionLink>
        </div>
      </section>
    );
  }

  // `vm.totalCount` is today's delivery count as the COMPOSE counted it — the
  // render must not re-apply the today-filter, or the label and the rows could
  // disagree if that rule ever changes in one place only.
  const summary = serverT(language, vm.headline.key, vm.headline.params);

  return (
    <section
      className="co-card p-4 sm:p-5"
      aria-label={serverT(language, "dashboard.receiving.aria", { summary })}
    >
      {/* Whole tile taps through to receiving; the quiet action below is a sibling
          link, so it is never a nested-interactive. */}
      <Link
        href={href}
        className="block rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
      >
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.receiving.tile_label")} ·{" "}
          {serverT(language, "dashboard.receiving.label_count", { count: vm.totalCount })}
        </p>

        <p
          className={`mt-2 text-base font-bold ${
            vm.headline.tone === "danger" ? "text-co-cta-text" : "text-co-text"
          }`}
        >
          {summary}
        </p>

        <ul className="mt-3 flex flex-col gap-2">
          {vm.rows.map((row) => (
            <li key={row.id} className="rounded-lg bg-co-surface-inset px-2.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-bold text-co-text">{row.title}</span>
                {row.meta ? (
                  <span className="shrink-0 text-[11px] text-co-text-dim">{row.meta}</span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {row.pills.map((p) => (
                  <AlertPill key={p.id} tone={p.tone} uppercase={false}>
                    {serverT(language, p.key, p.params)}
                  </AlertPill>
                ))}
              </div>
            </li>
          ))}
        </ul>

        {vm.overflowCount > 0 ? (
          <p className="mt-2 text-[11px] text-co-text-dim">
            {serverT(language, "dashboard.receiving.more", { count: vm.overflowCount })}
          </p>
        ) : null}
      </Link>

      {/* Quiet action — small-control label grammar (0.08em), not a primary CTA. */}
      <div className="mt-3">
        <Link
          href={href}
          className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted transition hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        >
          {serverT(language, "dashboard.receiving.log_another")}
        </Link>
      </div>
    </section>
  );
}
