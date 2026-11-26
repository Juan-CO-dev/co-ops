/** Pure, contact-free Toast ring reminders shared by morning and nightly digests. */
import { notRungLabel, notRungSource, toastReadyAt, type NotInToastOrder } from "@/lib/catering/not-in-toast-shared";
import { serverT } from "@/lib/i18n/server";
import { formatCents, formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { DigestLine } from "@/lib/report-digests-compose";
import { digestLink, type LinkViewer } from "@/lib/report-digests-links";

export function toastRingLines(orders: readonly NotInToastOrder[], locationId: string | null, day: string, language: Language, baseUrl: string, viewer?: LinkViewer | null): DigestLine[] {
  const ctx = { baseUrl, viewer };
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(language, key, params);
  const readyMillis = (order: NotInToastOrder) => {
    const ready = toastReadyAt(order);
    return ready ? Date.parse(ready) : Infinity;
  };
  return orders.filter((o) => o.location_id === locationId && o.event_date === day)
    .sort((a, b) => readyMillis(a) - readyMillis(b) || a.order_id.localeCompare(b.order_id))
    .map((order) => {
      const ready = toastReadyAt(order);
      return {
        label: (() => { const l = notRungLabel(notRungSource(order), order.order_number); return t(l.key as TranslationKey, l.params); })(),
        text: [
          ready ? t("digest.catering.to_ring.ready", { time: formatTime(ready, language) }) : t("digest.catering.to_ring.ready_unknown"),
          order.headcount === null ? t("digest.catering.to_ring.guests_unknown") : t("digest.catering.to_ring.guests", { count: order.headcount }),
          order.total_cents === null ? t("digest.catering.to_ring.amount_unknown") : formatCents(order.total_cents, language),
        ].join(" · "),
        // Each order still to ring into Toast is a TO-DO: it counts toward "N to do", never "All good".
        tone: "attention",
        // The order's own lead card when it has one, else the board's "to ring in Toast" list.
        href: order.lead_id
          ? digestLink(ctx, { to: "pipeline", lead: order.lead_id, leadShop: order.location_id }, { to: "pipeline", anchor: "to_ring" })
          : digestLink(ctx, { to: "pipeline", anchor: "to_ring" }),
      };
    });
}
