"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ParsRow, ParsView } from "@/lib/admin/pars-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson, type PostResult } from "@/components/admin/vendors/shared";
import { resolveErrorKey } from "@/components/admin/skus/shared";

const control = "min-h-[44px] min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 disabled:opacity-50";

/** Mounted only for writers inside the row's disclosure. Reads always come back via
 * router.refresh -> the page's loadPars -> the walk's pack/suggestion loaders. */
export function ParEditor({ row, view, edit, locationId, onActivationSaved }: { row: ParsRow; view: ParsView; edit: NonNullable<ParsRow["edit"]>; locationId: string; onActivationSaved: (off: boolean) => void }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const [refreshing, startRefresh] = useTransition();
  const [snapshot, setSnapshot] = useState(row);
  const [baseline, setBaseline] = useState(edit);
  const inFlight = useRef(false);
  const [weekday, setWeekday] = useState(edit.weekdayPar?.toString() ?? "");
  const [weekend, setWeekend] = useState(edit.weekendPar?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [awaitingRead, setAwaitingRead] = useState(false);
  // A refreshed object acknowledges the read, but only changed edit values
  // invalidate a draft. Saving another row must not erase this row's typing.
  if (snapshot !== row) {
    setSnapshot(row);
    setAwaitingRead(false);
  }
  if (baseline.activeOverride !== edit.activeOverride || baseline.weekdayPar !== edit.weekdayPar ||
      baseline.weekendPar !== edit.weekendPar || baseline.packEpoch !== edit.packEpoch) {
    setBaseline(edit);
    setWeekday(edit.weekdayPar?.toString() ?? "");
    setWeekend(edit.weekendPar?.toString() ?? "");
  }
  const disabled = busy || refreshing || awaitingRead;
  const number = (n: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(n);
  const refresh = () => { setAwaitingRead(true); startRefresh(() => router.refresh()); };
  const finish = (result: PostResult, action?: "accept" | "dismiss") => {
    setBusy(false);
    setFailed(!result.ok);
    if (result.ok) {
      setMessage(action === "dismiss"
        ? t("ordering.suggestion.dismissed", { n: suggestion!.currentPar })
        : action === "accept"
          ? t("ordering.suggestion.accepted", { n: typeof result.data.par === "number" ? result.data.par : suggestion!.suggestedPar })
          : t("admin.pars.saved"));
      refresh();
    } else if (result.code === "nothing_to_revert") {
      setMessage(t("ordering.error.nothing_to_revert"));
    } else if (["overlay_changed", "suggestion_superseded", "suggestion_already_actioned"].includes(result.code)) {
      setMessage(t("admin.pars.changed"));
      refresh();
    } else setMessage(t(resolveErrorKey(result.code)));
  };
  const save = async (activation?: boolean | null) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage(null);
    try {
      if ((await requestStepUp("E")) !== "ok") { setBusy(false); return; }
      const { activeOverride, weekdayPar, weekendPar, packEpoch } = edit;
      const result = await send(`/api/admin/skus/${row.skuId}/location-settings`, {
        locationId, activeOverride: activation === undefined ? activeOverride : activation,
        weekdayPar: activation !== undefined ? weekdayPar : weekday.trim() === "" ? null : Number(weekday),
        weekendPar: activation !== undefined ? weekendPar : weekend.trim() === "" ? null : Number(weekend),
        expected: { activeOverride, weekdayPar, weekendPar }, expectedPackEpoch: packEpoch,
      }, "PUT");
      if (result.ok && activation !== undefined && (activation === false || activeOverride === false)) onActivationSaved(activation === false);
      finish(result);
    } catch { finish({ ok: false, code: "generic" }); }
    finally { inFlight.current = false; }
  };
  const suggestion = row.suggestion?.slotCreation ? null : row.suggestion;
  const act = async (action: "accept" | "dismiss") => {
    if (disabled || inFlight.current || !suggestion?.canAct) return;
    inFlight.current = true;
    setBusy(true); setMessage(null);
    try {
      finish(await postJson("/api/operations/ordering/suggestion", {
        locationId, skuId: row.skuId, dayClass: view.dayClass,
        generationId: suggestion.generationId, action,
      }), action);
    } finally { inFlight.current = false; }
  };
  return <div className="min-w-0 space-y-3 border-t border-co-border pt-3" aria-busy={disabled}>
    {edit.activeOverride !== true ? <button type="button" role="switch" aria-checked={edit.activeOverride === false}
      className={`${control} flex w-full justify-between gap-3`} disabled={disabled}
      onClick={() => void save(edit.activeOverride === false ? (edit.globalActive ? null : true) : false)}>
      {t("admin.pars.off_here")}
      <span>{t(`admin.skus.location_overlay.active.${edit.activeOverride === false ? "off" : "inherit"}`)}</span>
    </button> :
    <label className="block text-sm">{t("admin.skus.location_overlay.activation")}
      <select className={`${control} mt-1 w-full`} disabled={disabled}
        value={edit.activeOverride === null ? "inherit" : edit.activeOverride ? "on" : "off"}
        onChange={(e) => void save(e.target.value === "inherit" ? null : e.target.value === "on")}>
        {(["inherit", "on", "off"] as const).map((value) => <option key={value} value={value}>{t(`admin.skus.location_overlay.active.${value}`)}</option>)}
      </select>
    </label>}
    {!row.offHere && <form className="min-w-0 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="text-sm">{t("admin.pars.edit_hint", { unit: row.unit ?? t("admin.pars.order_units") })}</p>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        {(["weekday", "weekend"] as const).map((day) => {
          const value = day === "weekday" ? weekday : weekend;
          const pounds = value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && edit.poundsPerUnit != null
            ? Number(value) * edit.poundsPerUnit : null;
          return <label key={day} className="min-w-0 text-sm font-bold">{t(`admin.pars.${day}`)}
            <input className={`${control} mt-1 w-full`} type="number" min="0" step="any" inputMode="decimal"
              aria-label={t(`admin.pars.${day}`)}
              disabled={disabled} value={value} placeholder={t("admin.skus.location_overlay.inherit_ph")}
              onChange={(e) => { setMessage(null); (day === "weekday" ? setWeekday : setWeekend)(e.target.value); }} />
            <span className="block text-xs font-normal text-co-text-muted">{pounds == null ? t("admin.pars.weight_unknown") : t("admin.pars.weight", { n: number(pounds) })}</span>
          </label>;
        })}
      </div>
      <button className={`${control} inline-flex border-co-gold-deep bg-co-gold font-bold`} disabled={disabled} type="submit">{t("admin.skus.save")}</button>
    </form>}
    {!row.offHere && suggestion?.canAct && <div className="flex flex-wrap gap-2">
      <button type="button" className={`${control} inline-flex`} disabled={disabled} onClick={() => void act("accept")}
        aria-label={t("ordering.suggestion.accept_aria", { sku: row.name, n: suggestion.suggestedPar })}>{t("ordering.suggestion.accept", { n: suggestion.suggestedPar })}</button>
      <button type="button" className={`${control} inline-flex`} disabled={disabled} onClick={() => void act("dismiss")}
        aria-label={t("ordering.suggestion.dismiss_aria", { sku: row.name, n: suggestion.currentPar })}>{t("ordering.suggestion.dismiss")}</button>
      {suggestion.tier === "auto" && <button type="button" className={`${control} inline-flex`}
        disabled
        title={view.silence.shadowMode ? t("ordering.shadow.revert_disabled") : t("ordering.error.nothing_to_revert")}
        aria-label={t("ordering.auto.revert_aria", { sku: row.name, n: suggestion.currentPar })}>{t("ordering.auto.revert")}</button>}
    </div>}
    {disabled && <p role="status" className="text-sm">{t("ordering.suggestion.working")}</p>}
    {message && <p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-co-cta-text" : "text-co-confirm-text"}`}>{message}</p>}
    {awaitingRead && !refreshing && <button type="button" className={`${control} inline-flex`} onClick={refresh}>{t("admin.pars.refresh")}</button>}
  </div>;
}
