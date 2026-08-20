import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import {
  composeReceivingTile,
  composeCountsTile,
  composeOrderingTile,
  type ReceivingDeliveryFacts,
  type OrderingCutoffFacts,
  type OrderingOrderFacts,
  type StatusHeadline,
} from "@/lib/dashboard-status-shared";

/**
 * The mid-shift operational strip (design §2): the three composed HEADLINE facts
 * in one-line form, from the SAME compose helpers the dashboard tiles render. A
 * manager reading the pulse and a manager reading the dashboard see the same
 * three sentences — that is the point of the shared module.
 *
 * Any payload may be null (its read failed or the actor is below its gate); a
 * null lane is simply omitted rather than claiming anything.
 */
function StripItem({
  headline,
  href,
  labelKey,
  language,
}: {
  headline: StatusHeadline;
  href: string;
  labelKey: TranslationKey;
  language: Language;
}) {
  const text = serverT(language, headline.key, headline.params);
  const loud = headline.tone === "danger";
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
      >
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {serverT(language, labelKey)}
        </span>
        <span
          className={`min-w-0 text-right text-sm font-bold ${loud ? "text-co-cta-text" : "text-co-text"}`}
        >
          {headline.value ? `${headline.value} · ` : ""}
          {text}
        </span>
      </Link>
    </li>
  );
}

export function OperationalStrip({
  language,
  locationId,
  today,
  deliveries,
  openCutoffs,
  orders,
  countsState,
}: {
  language: Language;
  locationId: string;
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
  deliveries: ReceivingDeliveryFacts[] | null;
  openCutoffs: OrderingCutoffFacts[] | null;
  orders: OrderingOrderFacts[] | null;
  countsState: { lastCountDate: string | null; anchoredSkuCount: number } | null;
}) {
  const receiving = deliveries ? composeReceivingTile({ deliveries, today }) : null;
  const ordering =
    openCutoffs && orders ? composeOrderingTile({ openCutoffs, orders }) : null;
  const counts = countsState
    ? composeCountsTile({
        lastCountDate: countsState.lastCountDate,
        today,
        anchoredSkuCount: countsState.anchoredSkuCount,
        varianceCount: null,
      })
    : null;

  if (!receiving && !ordering && !counts) return null;

  return (
    <section aria-label={serverT(language, "midshift.ops.heading")}>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-gold-text">
        {serverT(language, "midshift.ops.heading")}
      </h2>
      <ul className="flex flex-col gap-2 md:grid md:grid-cols-2 md:gap-2 xl:grid-cols-3">
        {ordering ? (
          <StripItem
            headline={ordering.headline}
            href={`/ordering?location=${locationId}`}
            labelKey="dashboard.ordering.tile_label"
            language={language}
          />
        ) : null}
        {receiving ? (
          <StripItem
            headline={receiving.headline}
            href={`/operations/receiving?location=${locationId}`}
            labelKey="dashboard.receiving.tile_label"
            language={language}
          />
        ) : null}
        {counts ? (
          <StripItem
            headline={counts.headline}
            href={`/operations/counts?location=${locationId}`}
            labelKey="dashboard.counts.tile_label"
            language={language}
          />
        ) : null}
      </ul>
    </section>
  );
}
