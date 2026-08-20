import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { AlertPill } from "@/components/ui/AlertPill";
import {
  composeOrderingTile,
  type OrderingCutoffFacts,
  type OrderingOrderFacts,
} from "@/lib/dashboard-status-shared";

/**
 * Ordering status tile — cutoff-led (design §1).
 *
 * When a vendor cutoff is open today with no order started, THE CUTOFF TIME IS
 * THE HEADLINE (28px, co-cta-text red): it is the only fact on this dashboard
 * with a hard deadline. Multiple open cutoffs — the NEAREST leads, the rest are
 * red pills beside the handled ones. Nothing open: "All orders in".
 *
 * Gate is the caller's (level >= 4, matching the /ordering route's PAR_PASS_MIN
 * and the nav minLevel from PR #254). A null payload means the read failed.
 */
export function OrderingTile({
  language,
  locationId,
  openCutoffs,
  orders,
}: {
  language: Language;
  locationId: string;
  /** Open cutoffs earliest-first (loadOrderingAttention order), or null on read failure. */
  openCutoffs: OrderingCutoffFacts[] | null;
  /** Today's POs (loadTodaysOrders), or null on read failure. */
  orders: OrderingOrderFacts[] | null;
}) {
  const href = `/ordering?location=${locationId}`;

  if (openCutoffs === null || orders === null) {
    return (
      <section className="co-card p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, "dashboard.ordering.tile_label")}
        </p>
        <p className="mt-2 text-sm text-co-text-muted italic">
          {serverT(language, "dashboard.tile.unavailable")}
        </p>
      </section>
    );
  }

  const vm = composeOrderingTile({ openCutoffs, orders });
  const caption = serverT(language, vm.headline.key, vm.headline.params);

  return (
    <Link
      href={href}
      className="co-card block p-4 transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 sm:p-5"
      aria-label={serverT(language, "dashboard.ordering.aria", {
        summary: vm.headline.value ? `${vm.headline.value} ${caption}` : caption,
      })}
    >
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {serverT(language, "dashboard.ordering.tile_label")}
      </p>

      {vm.headline.form === "gauge" ? (
        <div className="mt-2">
          <p className="text-[28px] font-extrabold leading-none text-co-cta-text">
            {vm.headline.value}
          </p>
          <p className="mt-1 text-sm font-bold text-co-cta-text">{caption}</p>
        </div>
      ) : (
        <p
          className={`mt-2 text-base font-bold ${
            vm.headline.tone === "ok" ? "text-co-text" : "text-co-text-muted"
          }`}
        >
          {caption}
        </p>
      )}

      {vm.pills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {vm.pills.map((p) => (
            <AlertPill key={p.id} tone={p.tone} uppercase={false}>
              {serverT(language, p.key, p.params)}
            </AlertPill>
          ))}
        </div>
      ) : null}
    </Link>
  );
}
