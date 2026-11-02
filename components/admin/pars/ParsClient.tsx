"use client";

import { useState } from "react";
import { filterPars, type ParsSlot, type ParsView } from "@/lib/admin/pars-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ParSilencePanel } from "@/components/ordering/ParSilencePanel";

export function ParsClient({ view }: { view: ParsView }) {
  const { t, language } = useTranslation();
  const [vendor, setVendor] = useState("");
  const [section, setSection] = useState("");
  const vendors = [...new Map(view.rows.map((r) => [r.vendorId, r.vendorName])).entries()];
  const sections = [...new Set(view.rows.filter((r) => !vendor || r.vendorId === vendor)
    .flatMap((r) => r.section ? [r.section] : []))];
  const rows = filterPars(view.rows, vendor, section);
  const number = (n: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(n);
  return (
    <div className="min-w-0 space-y-4 break-words [overflow-wrap:anywhere] [&_button_span]:min-w-0">
      <ParSilencePanel silence={view.silence} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-bold">{t("admin.pars.vendor")}
          <select className="mt-1 min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3" value={vendor}
            onChange={(e) => { setVendor(e.target.value); setSection(""); }}>
            <option value="">{t("admin.pars.all_vendors")}</option>
            {vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm font-bold">{t("admin.pars.section")}
          <select className="mt-1 min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">{t("admin.pars.all_sections")}</option>
            {sections.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <p role="status" className="text-sm text-co-text-muted">{t("admin.pars.count", { n: rows.length })}</p>
      {rows.length === 0 && <p className="text-sm text-co-text-muted">{t("admin.pars.empty")}</p>}
      <ul className="space-y-3">
        {rows.map((row) => {
          const suggestion = row.suggestion?.slotCreation ? null : row.suggestion;
          return <li key={row.skuId} className="co-card min-w-0 space-y-3 p-4">
            <div><h2 className="font-bold text-co-text">{row.name}</h2>
              <p className="text-xs text-co-text-muted">{row.vendorName}{row.section ? ` · ${row.section}` : ""}</p></div>
            <dl className="grid min-w-0 grid-cols-2 gap-3">
              <Slot title={t("admin.pars.weekday")} slot={row.weekday} unit={row.unit} />
              <Slot title={t("admin.pars.weekend")} slot={row.weekend} unit={row.unit} />
            </dl>
            {row.weekendFallback && <p className="text-xs text-co-text-muted">{t("admin.pars.weekend_fallback")}</p>}
            {row.reroutedFromName && <p className="text-sm text-co-text-dim">{t("admin.pars.rerouted", { name: row.reroutedFromName })}</p>}
            {suggestion && <p className="text-sm font-bold">{t(suggestion.tier === "auto" ? (view.silence.shadowMode ? "ordering.shadow.would_tune" : "ordering.auto.tuned") : "ordering.suggestion.pair", {
              current: number(suggestion.currentPar), suggested: number(suggestion.suggestedPar),
            })}</p>}
            <CollapsibleSection idBase={`pars-details-${row.skuId}`} title={t("admin.pars.details", { name: row.name })}>
              <div className="space-y-2 text-sm text-co-text-dim">
                <p>{row.section ? t("admin.pars.guide_section", { section: row.section }) : t("admin.pars.no_section")}</p>
                {suggestion ? <div className="space-y-1">
                  <p>{t("ordering.suggestion.reason_coverage", { suggested: number(suggestion.suggestedPar),
                    day: formatDateLabel(suggestion.coverThroughDate, language), pct: Math.round(suggestion.cushionPct * 100) })}</p>
                  {suggestion.velocityApplied && <p>{t("ordering.suggestion.reason_velocity")}</p>}
                  {suggestion.flooredByPeak && <p>{t("ordering.suggestion.reason_peak_floor")}</p>}
                  {suggestion.reasonCode === "below_band_resolution" && <p>{t("ordering.suggestion.manual_only")}</p>}
                </div> : <p>{t("admin.pars.no_suggestion")}</p>}
              </div>
            </CollapsibleSection>
          </li>;
        })}
      </ul>
    </div>
  );
}

function Slot({ title, slot, unit }: { title: string; slot: ParsSlot; unit: string | null }) {
  const { t, language } = useTranslation();
  const number = (n: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(n);
  return <div className="min-w-0 space-y-1">
    <dt className="text-xs font-bold text-co-text-muted">{title}</dt>
    <dd className="font-bold">{slot.value == null ? t("admin.pars.not_set") :
      t("admin.pars.quantity", { n: number(slot.value), unit: unit ?? t("admin.pars.order_units") })}</dd>
    {slot.value != null && <dd className="text-xs text-co-text-muted">{slot.pounds == null ? t("admin.pars.weight_unknown") : t("admin.pars.weight", { n: number(slot.pounds) })}</dd>}
    <dd className="text-xs text-co-text-muted">{t(`admin.pars.lane.${slot.lane}`)}</dd>
  </div>;
}
