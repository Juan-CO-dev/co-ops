/** Pure, contact-free Toast ring reminders shared by morning and nightly digests. */
import { toastReadyAt, type NotInToastOrder } from "@/lib/catering/not-in-toast-shared";
import { serverT } from "@/lib/i18n/server";
import { formatCents, formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { DigestLine } from "@/lib/report-digests-compose";

export function toastRingLines(orders: readonly NotInToastOrder[], locationId: string | null, day: string, language: Language, baseUrl: string): DigestLine[] {
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
        label: order.order_number ?? t("digest.catering.to_ring.code_unknown"),
        text: [
          ready ? t("digest.catering.to_ring.ready", { time: formatTime(ready, language) }) : t("digest.catering.to_ring.ready_unknown"),
          order.headcount === null ? t("digest.catering.to_ring.guests_unknown") : t("digest.catering.to_ring.guests", { count: order.headcount }),
          order.total_cents === null ? t("digest.catering.to_ring.amount_unknown") : formatCents(order.total_cents, language),
        ].join(" · "),
        tone: "info",
        href: `${baseUrl}/catering/pipeline`,
      };
    });
}
