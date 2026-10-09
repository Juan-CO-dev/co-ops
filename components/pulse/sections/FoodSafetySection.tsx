"use client";

/** Food safety: fridge checks today (counts for crew, per-fridge rows at KH+), excursions, the "not checked yet" reminder. */
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/provider";
import type { FoodSafetyData } from "@/lib/pulse/types";
import { Sparkline } from "@/components/pulse/charts/Sparkline";
import { tapLink } from "@/components/pulse/shared";

export function FoodSafetySection({ data, mode, locationId }: { data: FoodSafetyData; mode: "card" | "detail"; locationId: string }) {
  const { t } = useTranslation();
  const alert = data.counts.outOfRange > 0 || data.reminder;
  return (
    <div className="flex flex-col gap-2">
      {data.counts.total === 0 ? <p className="text-sm text-co-text-muted">{t("pulse.food_safety.none")}</p> : (
        <p {...(alert ? { role: "alert" as const } : {})} className={`text-sm font-bold ${alert ? "text-co-cta-text" : "text-co-confirm-text"}`}>
          {data.reminder ? t("pulse.food_safety.reminder") : data.counts.outOfRange === 0 && data.counts.unchecked === 0 ? t("pulse.food_safety.all_good") : t("pulse.food_safety.summary", { ...data.counts })}
        </p>
      )}
      {data.counts.total > 0 && <p className="text-xs text-co-text-muted">{t("pulse.food_safety.summary", { ...data.counts })}</p>}
      {data.fridges.length > 0 && (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {data.fridges.map((f) => (
            <li key={f.id} className={`flex min-h-[44px] items-center justify-between gap-2 rounded-md px-2 py-1 text-xs font-bold ${f.status === "out_of_range" ? "bg-co-danger-surface text-co-cta-text" : f.status === "no_reading_today" ? "bg-co-surface-2 text-co-text-dim" : "bg-co-success-surface text-co-confirm-text"}`}>
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="flex shrink-0 items-center gap-1 tabular-nums">
                {mode === "detail" && <Sparkline values={f.spark} />}
                {f.status === "no_reading_today" || f.latestF == null ? t("pulse.food_safety.unread") : t("pulse.food_safety.degrees", { temp: f.latestF })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {mode === "detail" && <Link href={`/maintenance?location=${encodeURIComponent(locationId)}`} className={tapLink}>{t("pulse.food_safety.maintenance_link")}</Link>}
    </div>
  );
}
