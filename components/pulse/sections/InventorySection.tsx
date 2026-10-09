"use client";

/** Inventory (KH+): low vs par from the LAST par walk (stated as of its time), 86 risk, recent receiving, order cutoffs today. */
import Link from "next/link";
import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { InventoryData } from "@/lib/pulse/types";
import { Bars } from "@/components/pulse/charts/Bars";
import { subHeading, tapLink } from "@/components/pulse/shared";

export function InventorySection({ data, mode, locationId }: { data: InventoryData; mode: "card" | "detail"; locationId: string }) {
  const { t, language } = useTranslation();
  const low = mode === "card" ? data.low.slice(0, 5) : data.low;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-co-text-muted">{data.lastWalk ? t("pulse.inventory.last_walk", { time: formatTime(data.lastWalk.at, language), name: data.lastWalk.byName ?? "—" }) : t("pulse.inventory.no_walk")}</p>
      {data.risk86 > 0 && <p className="text-sm font-bold text-co-cta-text">{data.risk86 === 1 ? t("pulse.inventory.risk86_one") : t("pulse.inventory.risk86_other", { count: data.risk86 })}</p>}
      <div>
        <h3 className={subHeading}>{t("pulse.inventory.low")}</h3>
        {data.lastWalk && data.low.length === 0 ? <p className="text-sm text-co-confirm-text">{t("pulse.inventory.low_none")}</p> : (
          <Bars ariaLabel={t("pulse.inventory.low")} noData={t("pulse.chart.no_data")}
            rows={low.map((l) => ({
              key: l.skuName, label: `${l.risk86 ? "⚠ " : ""}${l.skuName}`,
              value: l.pctOfPar == null ? 0 : Math.round(l.pctOfPar * 100),
              display: l.pctOfPar == null ? t("pulse.inventory.order_line", { qty: l.orderQty, unit: l.unitLabel ?? "" }) : `${t("pulse.inventory.pct_of_par", { pct: Math.round(l.pctOfPar * 100) })} · ${t("pulse.inventory.order_line", { qty: l.orderQty, unit: l.unitLabel ?? "" })}`,
            }))} />
        )}
        {data.low.length > 0 && <p className="mt-1 text-[11px] text-co-text-dim">{t("pulse.inventory.estimate_note")}</p>}
      </div>
      {(mode === "detail" || data.cutoffs.length > 0) && (
        <div>
          <h3 className={subHeading}>{t("pulse.inventory.cutoffs")}</h3>
          {data.cutoffs.length === 0 ? <p className="text-sm text-co-text-muted">{t("pulse.card.empty")}</p> : (
            <ul className="text-sm text-co-text">{data.cutoffs.map((c) => <li key={c.vendorName} className="min-h-[28px]"><span className="font-semibold">{c.vendorName}</span> · {c.time} · <span className="text-co-text-muted">{t(c.hasDraft ? "pulse.inventory.cutoff_draft" : "pulse.inventory.cutoff_nodraft")}</span></li>)}</ul>
          )}
        </div>
      )}
      {mode === "detail" && (
        <>
          <div>
            <h3 className={subHeading}>{t("pulse.inventory.receiving")}</h3>
            {data.receiving.length === 0 ? <p className="text-sm text-co-text-muted">{t("pulse.inventory.receiving_none")}</p> : (
              <ul className="text-sm text-co-text">{data.receiving.map((r) => <li key={r.id} className="min-h-[28px]"><span className="font-semibold">{r.vendorName}</span> · {formatTime(r.at, language)} · <span className="text-co-text-muted">{t(`pulse.inventory.match.${r.matchState}` as TranslationKey)} · {t(`pulse.inventory.delivery.${r.status}` as TranslationKey)}</span></li>)}</ul>
            )}
          </div>
          <Link href={`/ordering?location=${encodeURIComponent(locationId)}`} className={tapLink}>{t("pulse.inventory.ordering_link")}</Link>
        </>
      )}
    </div>
  );
}
