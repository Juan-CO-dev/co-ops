"use client";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatClockTime, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { Station } from "@/lib/assignments-shared";
import type { TranslationKey } from "@/lib/i18n/types";

export function StationsAdmin({ locationId, stations, translatedNames, canEdit, canEditTiming = canEdit }: {
  locationId: string; stations: Station[]; translatedNames: string[]; canEdit: boolean; canEditTiming?: boolean;
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
      if (payload.operation !== "timing" && await requestStepUp("B") !== "ok") return;
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
  return <div className="space-y-3" aria-busy={busy || refreshing}>
    {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
    {stations.filter((station) => station.active).map((station) =>
      <div key={station.id} className="co-card space-y-2 p-4">
        <h2 className="font-bold text-co-text">{language === "es" ? station.nameEs || station.name : station.name}</h2>
        {station.closedAt && <p className="font-bold text-co-text-muted">{t("assignments.lifecycle.closed", { time: formatTime(station.closedAt, language) })}</p>}
        {timingForm(station.id, station.usuallyClosesAt)}
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
