"use client";

import type { EzcaterOrderDetail } from "@/lib/catering/ezcater-detail-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel, formatTime } from "@/lib/i18n/format";

export function EzcaterDetail({ detail }: { detail: EzcaterOrderDetail }) {
  const { t, language } = useTranslation();
  const totals = ["subtotal", "tax", "tip", "fees", "discounts", "total"] as const;
  return <section className="mt-3 space-y-2 border-t border-co-border pt-3">
    <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("catering.ezcater.title")} · {detail.order_number}</h4>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {detail.headcount != null && <><dt>{t("catering.pipeline.field.headcount")}</dt><dd>{detail.headcount}</dd></>}
      {detail.event_date && <><dt>{t("catering.ezcater.event")}</dt><dd>{formatDateLabel(detail.event_date, language)}{detail.event_timestamp ? ` · ${formatTime(detail.event_timestamp, language)}` : ""}</dd></>}
      {detail.handoff_time && <><dt>{t("catering.ezcater.handoff")}</dt><dd>{formatTime(detail.handoff_time, language)}</dd></>}
      {detail.fulfillment && <><dt>{t("catering.ezcater.fulfillment")}</dt><dd>{detail.fulfillment}</dd></>}
      {detail.payment_status && <><dt>{t("catering.ezcater.payment")}</dt><dd>{detail.payment_status}</dd></>}
      {totals.map((key) => detail[`${key}_cents`] == null ? null : <div className="contents" key={key}>
        <dt>{t(`catering.ezcater.${key}`)}</dt><dd>{formatCents(detail[`${key}_cents`]!, language)}</dd>
      </div>)}
    </dl>
    <h5 className="text-xs font-bold text-co-text-muted">{t("catering.ezcater.items")}</h5>
    <ul className="space-y-2 text-xs">
      {detail.items.map((item) => <li key={item.ordinal}>
        <p>{item.quantity} × {item.name}{item.unit_price_cents != null ? ` · ${formatCents(item.unit_price_cents, language)}` : ""}</p>
        {item.options.length > 0 && <ul className="ml-3">{item.options.map((option, index) => <li key={index}>{option.quantity != null ? `${option.quantity} × ` : ""}{option.name}</li>)}</ul>}
        {item.special_instructions && <p>{item.special_instructions}</p>}
        {item.note_to_caterer && <p>{item.note_to_caterer}</p>}
      </li>)}
    </ul>
    {detail.contact && <div className="space-y-1 text-xs">
      <h5 className="font-bold text-co-text-muted">{t("catering.ezcater.contact")}</h5>
      {Object.entries(detail.contact).map(([key, value]) => value ? <p key={key}>{value}</p> : null)}
    </div>}
  </section>;
}
