"use client";

import { useState } from "react";
import { filterPars, parSectionKey, type ParsSlot, type ParsView } from "@/lib/admin/pars-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ParSilencePanel } from "@/components/ordering/ParSilencePanel";
import { ParEditor } from "./ParEditor";

export function ParsClient({ view }: { view: ParsView }) {
  const { t, language } = useTranslation();
  const [offOpen, setOffOpen] = useState(false);
  const [activationNotice, setActivationNotice] = useState<"off" | "on" | null>(null);
  const [vendor, setVendor] = useState("");
  const [section, setSection] = useState("");
  const vendors = [...new Map(view.rows.map((r) => [r.vendorId, r.vendorName])).entries()];
  const sections = [...new Map(view.rows.filter((r) => !vendor || r.vendorId === vendor)
    .flatMap((r) => r.section ? [[parSectionKey(r), vendor ? r.section : `${r.vendorName} · ${r.section}`] as const] : [])).entries()];
  const rows = filterPars(view.rows, vendor, section);
  const number = (n: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(n);
  return (
    <div className="min-w-0 space-y-4 break-words [overflow-wrap:anywhere] [&_button_span]:min-w-0">
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-co-confirm-text">
        {activationNotice && t(activationNotice === "off" ? "admin.pars.moved_off" : "admin.pars.back_on")}
      </p>
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
            {sections.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <p role="status" className="text-sm text-co-text-muted">{t(rows.length === 1 ? "admin.pars.count_one" : "admin.pars.count_other", { n: rows.length })}</p>
      {rows.length === 0 && <p className="text-sm text-co-text-muted">{t("admin.pars.empty")}</p>}
      {[false, true].map((off) => {
        const group = rows.filter((row) => Boolean(row.offHere) === off);
        const list = <ul className="space-y-3">
        {group.map((row) => {
          const suggestion = row.offHere || row.suggestion?.slotCreation ? null : row.suggestion;
          const suggestionText = suggestion ? t(`admin.pars.today.${view.dayClass}`, {
            pair: t(suggestion.tier === "auto" ? (view.silence.shadowMode ? "ordering.shadow.would_tune" : "ordering.auto.tuned") : "ordering.suggestion.pair", {
              current: number(suggestion.currentPar), suggested: number(suggestion.suggestedPar),
            }),
          }) : null;
          return <li key={row.skuId} className="co-card min-w-0 space-y-3 p-4">
            <div><h2 className="font-bold text-co-text">{row.name}</h2>
              <p className="text-xs text-co-text-muted">{row.vendorName}{row.section ? ` · ${row.section}` : ""}</p></div>
            <dl className="grid min-w-0 grid-cols-2 gap-3">
              <Slot title={t("admin.pars.weekday")} slot={row.weekday} unit={row.unit} suggestion={view.dayClass === "weekday" ? suggestionText : null} />
              <Slot title={t("admin.pars.weekend")} slot={row.weekend} unit={row.unit} suggestion={view.dayClass === "weekend" ? suggestionText : null} />
            </dl>
            {row.weekendFallback && <p className="text-xs text-co-text-muted">{t("admin.pars.weekend_fallback")}</p>}
            {row.reroutedFromName && <p className="text-sm text-co-text-dim">{t("admin.pars.rerouted", { name: row.reroutedFromName })}</p>}
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
              {row.edit && view.locationId && <ParEditor row={row} view={view} edit={row.edit} locationId={view.locationId} onActivationSaved={(off) => { setActivationNotice(off ? "off" : "on"); if (off) setOffOpen(true); }} />}
            </CollapsibleSection>
          </li>;
        })}
      </ul>;
        return off ? group.length > 0 && <CollapsibleSection key="off" idBase="pars-off" open={offOpen} onToggle={() => setOffOpen((value) => !value)} title={t("admin.pars.off_group", { n: group.length })}>{list}</CollapsibleSection> : <div key="on">{list}</div>;
      })}
    </div>
  );
}

function Slot({ title, slot, unit, suggestion }: { title: string; slot: ParsSlot; unit: string | null; suggestion: string | null }) {
  const { t, language } = useTranslation();
  const number = (n: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(n);
  return <div className="min-w-0 space-y-1">
    <dt className="text-xs font-bold text-co-text-muted">{title}</dt>
    <dd className="font-bold">{slot.value == null ? t("admin.pars.not_set") :
      t("admin.pars.quantity", { n: number(slot.value), unit: unit ?? t("admin.pars.order_units") })}</dd>
    {slot.value != null && <dd className="text-xs text-co-text-muted">{slot.pounds == null ? t("admin.pars.weight_unknown") : t("admin.pars.weight", { n: number(slot.pounds) })}</dd>}
    <dd className="text-xs text-co-text-muted">{t(`admin.pars.lane.${slot.lane}`)}</dd>
    {suggestion && <dd className="text-sm font-bold">{suggestion}</dd>}
  </div>;
}
