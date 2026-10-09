"use client";
import { useId, useState } from "react";
import type { Station } from "@/lib/assignments-shared";
import { validStationTrims } from "@/lib/station-schedule-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { formatClockTime } from "@/lib/i18n/format";

const control = "min-h-[44px] min-w-0 rounded-lg border-2 border-co-border px-3";
export function StationScheduleEditor({ station, canEdit, disabled, save }: {
  station: Station; canEdit: boolean; disabled: boolean; save: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const { t, language } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [close, setClose] = useState(station.usuallyClosesAt?.slice(0, 5) ?? "");
  const [trims, setTrims] = useState(station.trims ?? []);
  const [invalid, setInvalid] = useState(false);
  return <div className="space-y-2">
    {station.usuallyClosesAt && <p className="text-sm text-co-text-muted">{t("assignments.schedule.closes", { time: formatClockTime(station.usuallyClosesAt, language) })}</p>}
    {(station.trims ?? []).map(trim => <p key={trim.at} className="text-sm text-co-text-muted">{t("assignments.schedule.trimLabel", { count: trim.to_count, time: formatClockTime(trim.at, language) })}</p>)}
    {canEdit && <button type="button" className={`${control} w-full text-left font-bold`} aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => {
      if (!open) { setClose(station.usuallyClosesAt?.slice(0, 5) ?? ""); setTrims(station.trims ?? []); setInvalid(false); }
      setOpen(!open);
    }}>{t("assignments.schedule.edit", { count: station.trims?.length ?? 0 })}</button>}
    {canEdit && open && <form id={id} className="space-y-3" onSubmit={event => {
      event.preventDefault();
      const sorted = [...trims].sort((a, b) => a.at.localeCompare(b.at));
      if (!validStationTrims(sorted)) { setInvalid(true); return; }
      setInvalid(false);
      void save({ operation: "timing", stationId: station.id, usuallyClosesAt: close || null, trims: sorted });
    }}>
      <label className="grid gap-1 text-sm font-bold">{t("assignments.lifecycle.usuallyClosesLabel")}<input type="time" value={close} disabled={disabled} onChange={event => setClose(event.target.value)} className={control} /></label>
      {trims.map((trim, index) => <div key={index} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-bold">{t("assignments.schedule.at")}<input type="time" required value={trim.at} disabled={disabled} onChange={event => setTrims(trims.map((entry, i) => i === index ? { ...entry, at: event.target.value } : entry))} className={control} /></label>
        <label className="grid gap-1 text-sm font-bold">{t("assignments.schedule.toCount")}<input type="number" required min={0} max={100} value={trim.to_count} disabled={disabled} onChange={event => setTrims(trims.map((entry, i) => i === index ? { ...entry, to_count: Number(event.target.value) } : entry))} className={`${control} w-24`} /></label>
        <button type="button" className={control} disabled={disabled} onClick={() => setTrims(trims.filter((_, i) => i !== index))}>{t("assignments.schedule.remove")}</button>
      </div>)}
      {invalid && <p role="alert" className="text-co-cta-text">{t("assignments.schedule.invalid")}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || trims.length >= 24} className={control} onClick={() => setTrims([...trims, { at: "", to_count: 1 }])}>{t("assignments.schedule.add")}</button>
        <button type="submit" disabled={disabled} className={`${control} border-co-gold-deep bg-co-gold font-bold`}>{t("common.save")}</button>
      </div>
    </form>}
  </div>;
}
