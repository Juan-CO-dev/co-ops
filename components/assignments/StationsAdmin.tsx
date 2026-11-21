"use client";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatClockTime, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { isFloorStation, type Station, type StationDayFlagsView } from "@/lib/assignments-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import { StationScheduleEditor } from "./StationScheduleEditor";

/** Nav PR 6 (0353): the 409s a station flag save can answer; each shows the conflict line, then the page refreshes. */
const FLAG_CONFLICTS = new Set(["mid_day_trigger_conflict", "station_not_phase", "station_not_floor"]);

export function StationsAdmin({ locationId, stations, translatedNames, canEdit, canEditTiming = canEdit, flags }: {
  locationId: string; stations: Station[]; translatedNames: string[]; canEdit: boolean; canEditTiming?: boolean;
  /** Nav PR 6: the two station day flags (0353). Absent = this page shows neither toggle. */
  flags?: StationDayFlagsView;
}) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  async function savePayload(payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const send = () => fetch("/api/admin/stations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId, ...payload }) });
      let response = await send();
      let body: { code?: string } = {};
      if (!response.ok) {
        body = await response.json().catch(() => ({})) as { code?: string };
        if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") {
          response = await send();
          if (!response.ok) body = await response.json().catch(() => ({})) as { code?: string };
        }
      }
      if (!response.ok || response.redirected) {
        if (body.code === "position_name_taken") { setError("assignments.positionNameTaken"); return; }
        if (body.code && FLAG_CONFLICTS.has(body.code)) { setError("assignments.midDayTrigger.conflict"); startTransition(() => router.refresh()); return; }
        throw new Error("station_save_failed");
      }
      startTransition(() => router.refresh());
    } catch { setError("assignments.error"); } finally { setBusy(false); }
  }
  const timingForm = (stationId: string, value: string | null | undefined, positionId?: string) => canEditTiming
    ? <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      const time = String(new FormData(event.currentTarget).get("time") ?? "") || null;
      void savePayload({ operation: "timing", stationId, ...(positionId ? { positionId, usuallyTrimsAt: time } : { usuallyClosesAt: time }) });
    }}>
      <label className="grid min-w-0 max-w-full flex-1 gap-1 text-sm font-bold">{t(positionId ? "assignments.lifecycle.usuallyTrimsLabel" : "assignments.lifecycle.usuallyClosesLabel")}
        <input name="time" type="time" defaultValue={value?.slice(0, 5) ?? ""} disabled={busy || refreshing} className="min-h-[44px] min-w-0 max-w-full rounded-lg border-2 border-co-border px-3 font-normal" />
      </label>
      <button type="submit" disabled={busy || refreshing} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold">{t("common.save")}</button>
    </form>
    : value ? <p className="text-sm text-co-text-muted">{t(positionId ? "assignments.lifecycle.usuallyTrims" : "assignments.lifecycle.usuallyCloses", { time: formatClockTime(value, language) })}</p> : null;
  const save = (id: string, nameEs: string) => savePayload({ id, nameEs });
  // Nav PR 6 (0353): both toggles, on FLOOR stations only (ruling 6 / 1a), directly under the schedule editor.
  const firstFloorId = stations.find((station) => isFloorStation(station) && !(flags?.installed && flags.notPhaseIds.includes(station.id)))?.id ?? null;
  const flagControls = (station: Station) => {
    if (!flags || !flags.installed || !isFloorStation(station)) return null;
    const notPhase = flags.notPhaseIds.includes(station.id);
    const midDay = flags.midDayStationId === station.id;
    if (!canEdit) {
      return <>
        {midDay && <p className="text-sm text-co-text-muted">{t("assignments.midDayTrigger.marked")}</p>}
        {notPhase && <p className="text-sm text-co-text-muted">{t("assignments.notPhaseStation.marked")}</p>}
      </>;
    }
    return <div className="space-y-1">
      {!notPhase && <label className="flex min-h-[44px] items-center gap-2 font-bold text-co-text">
        <input type="checkbox" checked={midDay} disabled={busy || refreshing} data-flag="mid_day_trigger"
          onChange={(e) => void savePayload({ operation: "mid_day_trigger", stationId: station.id, on: e.target.checked })} />
        {t("assignments.midDayTrigger.label")}
      </label>}
      {!notPhase && station.id === firstFloorId && <p className="text-sm text-co-text-muted">{t("assignments.midDayTrigger.hint")}</p>}
      <label className="flex min-h-[44px] items-center gap-2 font-bold text-co-text">
        <input type="checkbox" checked={notPhase} disabled={busy || refreshing} data-flag="not_phase_station"
          onChange={(e) => void savePayload({ operation: "not_phase_station", stationId: station.id, on: e.target.checked })} />
        {t("assignments.notPhaseStation.label")}
      </label>
      <p className="text-sm text-co-text-muted">{t("assignments.notPhaseStation.hint")}</p>
    </div>;
  };
  return <div className="space-y-3" aria-busy={busy || refreshing}>
    {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
    {canEdit && flags && !flags.installed && <p className="text-sm text-co-text-muted">{t("assignments.stationFlags.unavailable")}</p>}
    {stations.filter((station) => station.active).map((station) =>
      <div key={station.id} className="co-card space-y-2 p-4">
        <h2 className="font-bold text-co-text">{language === "es" ? station.nameEs || station.name : station.name}</h2>
        {station.closedAt && <p className="font-bold text-co-text-muted">{t("assignments.lifecycle.closed", { time: formatTime(station.closedAt, language) })}</p>}
        <StationScheduleEditor station={station} canEdit={canEditTiming} disabled={busy || refreshing} save={savePayload} />
        {flagControls(station)}
        {canEditTiming && <p className="text-sm text-co-text-muted">{t("assignments.lifecycle.timingHint")}</p>}
        {canEdit ? <label className="flex min-h-[44px] items-center gap-2 font-bold text-co-text">
          <input type="checkbox" checked={station.staffed} disabled={busy || refreshing}
            onChange={(e) => void savePayload({ operation: "staffed", stationId: station.id, staffed: e.target.checked })} />
          {t("assignments.staffed")}
        </label> : <p className="text-sm text-co-text-muted">{t(station.staffed ? "assignments.staffed" : "assignments.unstaffed")}</p>}
        <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t("assignments.positions")}</h3>
        {station.positions.map((position) => <Fragment key={position.id}>{canEdit ? <form className="grid gap-2 border-t border-co-border pt-3" onSubmit={(e) => {
          e.preventDefault(); const data = new FormData(e.currentTarget);
          void savePayload({ operation: "position_update", stationId: station.id, positionId: position.id,
            name: data.get("name"), nameEs: data.get("nameEs"), duty: data.get("duty"), dutyEs: data.get("dutyEs"),
            sort: Number(data.get("sort")), active: data.get("active") === "on" });
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["name", "nameEs", "duty", "dutyEs"] as const).map((field) => <label key={field} className="grid gap-1 text-sm font-bold">
              {t(`assignments.position.${field}`)}
              <input name={field} defaultValue={position[field] ?? ""} maxLength={field.startsWith("duty") ? 500 : 100} className="min-h-[44px] rounded-lg border-2 border-co-border px-3 font-normal" />
            </label>)}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm font-bold">{t("assignments.sort")}<input name="sort" type="number" min="1" max="100" defaultValue={position.sort} className="min-h-[44px] w-20 rounded-lg border-2 border-co-border px-2" /></label>
            <label className="flex min-h-[44px] items-center gap-2"><input name="active" type="checkbox" defaultChecked={position.active} />{t("assignments.active")}</label>
            <button disabled={busy || refreshing} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold" type="submit">{t("common.save")}</button>
          </div>
        </form> : <div key={position.id} className="border-t border-co-border pt-3">
          <p className="font-bold">{language === "es" ? position.nameEs || position.name : position.name}{!position.active ? ` · ${t("assignments.inactive")}` : ""}</p>
          {(language === "es" ? position.dutyEs || position.duty : position.duty) && <p className="text-sm">{language === "es" ? position.dutyEs || position.duty : position.duty}</p>}
        </div>}{position.sort > 1 && timingForm(station.id, position.usuallyTrimsAt, position.id)}</Fragment>)}
        {canEdit && <form className="grid gap-2 border-t border-co-border pt-3" onSubmit={(e) => {
          e.preventDefault(); const data = new FormData(e.currentTarget);
          void savePayload({ operation: "position_create", stationId: station.id,
            name: data.get("name"), nameEs: data.get("nameEs"), duty: data.get("duty"), dutyEs: data.get("dutyEs"),
            sort: Number(data.get("sort")), active: true });
        }}>
          <div className="grid gap-2 sm:grid-cols-2">{(["name", "nameEs", "duty", "dutyEs"] as const).map((field) =>
            <label key={field} className="grid gap-1 text-sm font-bold">{t(`assignments.position.${field}`)}
              <input name={field} required={field === "name"} maxLength={field.startsWith("duty") ? 500 : 100} className="min-h-[44px] rounded-lg border-2 border-co-border px-3 font-normal" />
            </label>)}</div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm font-bold">{t("assignments.sort")}<input name="sort" type="number" min="1" max="100" defaultValue={station.positions.length + 1} className="min-h-[44px] w-20 rounded-lg border-2 border-co-border px-2" /></label>
            <button disabled={busy || refreshing} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold" type="submit">{t("assignments.addPosition")}</button>
          </div>
        </form>}
        {canEdit && (translatedNames.includes(station.name)
          ? <p className="text-sm text-co-text-muted">{station.nameEs}</p>
          : canEdit ? <form onSubmit={(event) => {
            event.preventDefault();
            void save(station.id, String(new FormData(event.currentTarget).get("nameEs") ?? ""));
          }} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.nameEs")}
              <input className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-base font-normal text-co-text" name="nameEs" maxLength={100} defaultValue={station.nameEs ?? ""} />
            </label>
            <button disabled={busy || refreshing} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text" type="submit">{t("common.save")}</button>
          </form> : <p className="text-sm text-co-text-muted">{station.nameEs}</p>)}
      </div>)}
  </div>;
}
