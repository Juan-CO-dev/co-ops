"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel, formatTime } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { PipelineToastOrder } from "@/lib/catering/not-in-toast";
import { notRungLabel, notRungSource, toastReadyAt } from "@/lib/catering/not-in-toast-shared";
import type { HouseSuggestions } from "@/lib/catering/catering-toast-shared";
import type { TranslationKey } from "@/lib/i18n/types";

export function NotInToastChip() {
  const { t } = useTranslation();
  return <span className="ml-1 inline-block rounded-md bg-co-warning-surface px-2 py-0.5 text-xs font-medium text-co-warning-text">
    {t("catering.toast_pending.title")}
  </span>;
}

export function NotInToast({ rows, locations }: {
  rows: PipelineToastOrder[] | null;
  locations: Array<{ id: string; name: string }>;
}) {
  const { t, language } = useTranslation();
  const [query, setQuery] = useState("");
  if (rows === null) return <p role="alert" className="text-sm text-co-cta-text">{t("catering.toast_pending.unavailable")}</p>;
  if (rows.length === 0) return null;
  const shop = (id: string) => locations.find((l) => l.id === id)?.name ?? t("catering.pipeline.shop_none");
  const overdue = rows.filter((r) => r.overdue).length;
  const visible = rows.filter((r) => `${r.order_number ?? ""} ${shop(r.location_id)} ${r.event_date}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <CollapsibleSection title={t("catering.toast_pending.title")} count={t("catering.toast_pending.count", { n: rows.length })}
    idBase="not-in-toast" badge={overdue > 0 ? <span className="text-xs font-bold text-co-cta-text">{t("catering.toast_pending.overdue_count", { n: overdue })}</span> : undefined}>
    {rows.length >= 10 && <label className="mb-3 flex min-h-[44px] items-center gap-2 text-sm">
      <span>{t("catering.toast_pending.search")}</span>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-co-border bg-co-surface px-3" />
    </label>}
    <ul className="divide-y divide-co-border">
      {visible.map((row) => {
        const ready = toastReadyAt(row);
        const house = row.source === "house";
        return <li key={`${row.source ?? "ezcater"}:${row.order_id}`} className="py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-co-text">
            <span>{(() => { const l = notRungLabel(notRungSource(row), row.order_number); return t(l.key as TranslationKey, l.params); })()}</span>
            <span>{shop(row.location_id)}</span>
            {row.overdue && <span className="text-co-cta-text">{t("catering.toast_pending.overdue")}</span>}
          </div>
          <p className="mt-1 text-co-text-muted">{[
            formatDateLabel(row.event_date, language),
            ready ? t("digest.catering.ready_by", { time: formatTime(ready, language) }) : t("catering.toast_pending.ready_missing"),
            row.headcount === null ? t("digest.catering.size_unknown") : t("catering.pipeline.headcount_short", { n: row.headcount }),
            row.total_cents === null ? t("catering.toast_pending.amount_unknown") : formatCents(row.total_cents, language),
          ].join(" · ")}</p>
          {house && <HouseSuggestionLine suggestion={row.suggestion} />}
        </li>;
      })}
    </ul>
    {visible.length === 0 && <p className="text-sm text-co-text-muted">{t("catering.toast_pending.no_results")}</p>}
  </CollapsibleSection>;
}

/** Read-only (item 21 PR 2): what the planner would offer. It never clears the row; linking ships in PR 3. */
function HouseSuggestionLine({ suggestion }: { suggestion: HouseSuggestions | null | undefined }) {
  const { t, language } = useTranslation();
  if (suggestion === undefined) return null;
  if (suggestion === null) return <p className="mt-1 text-xs text-co-text-muted">{t("catering.toast_pending.suggestion_unavailable")}</p>;
  const { best, count, conflicts } = suggestion;
  return <div className="mt-1 text-xs text-co-text-muted">
    {best ? <p>
      {t("catering.toast_pending.suggested", {
        amount: best.checkTotalCents === null ? t("catering.toast_pending.amount_unknown") : formatCents(best.checkTotalCents, language),
        date: formatDateLabel(best.businessDate, language),
        evidence: t(`catering.toast_pending.evidence.${best.evidence}` as TranslationKey),
      })}
      {best.amountMismatch && best.amountDiffCents !== null
        ? <span className="text-co-warning-text"> · {t("catering.toast_pending.amount_differs", { amount: formatCents(Math.abs(best.amountDiffCents), language) })}</span> : null}
      {count > 1 ? ` · ${t("catering.toast_pending.suggested_more", { n: count - 1 })}` : ""}
    </p> : <p>{t("catering.toast_pending.no_suggestion")}</p>}
    {conflicts > 0 && <p className="text-co-warning-text">{t("catering.toast_pending.conflicts", { n: conflicts })}</p>}
  </div>;
}
