"use client";

import { useState, useTransition } from "react";
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
export function ParEditor({ row, view, edit, locationId }: { row: ParsRow; view: ParsView; edit: NonNullable<ParsRow["edit"]>; locationId: string }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
  const [refreshing, startRefresh] = useTransition();
  const [snapshot, setSnapshot] = useState(row);
  const [weekday, setWeekday] = useState(edit.weekdayPar?.toString() ?? "");
  const [weekend, setWeekend] = useState(edit.weekendPar?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [awaitingRead, setAwaitingRead] = useState(false);
  // A refresh preserves React state. Rebaseline even when a conflict returned the
  // same human values (e.g. the pack changed); never guess the stored row from a POST.
  if (snapshot !== row) {
    setSnapshot(row);
    setWeekday(edit.weekdayPar?.toString() ?? "");
    setWeekend(edit.weekendPar?.toString() ?? "");
    setAwaitingRead(false);
  }
  const disabled = busy || refreshing || awaitingRead;
  const number = (n: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(n);
  const refresh = () => { setAwaitingRead(true); startRefresh(() => router.refresh()); };
  const finish = (result: PostResult) => {
    setBusy(false);
    setFailed(!result.ok);
    if (result.ok) {
      setMessage(t("admin.pars.saved"));
      refresh();
    } else if (["overlay_changed", "suggestion_superseded", "suggestion_already_actioned", "nothing_to_revert"].includes(result.code)) {
      setMessage(t("admin.pars.changed"));
      refresh();
    } else setMessage(t(resolveErrorKey(result.code)));
  };
  const save = async () => {
    if (disabled) return;
    setBusy(true); setMessage(null);
    try {
      if ((await requestStepUp("E")) !== "ok") { setBusy(false); return; }
      const { activeOverride, weekdayPar, weekendPar, packEpoch } = edit;
      finish(await send(`/api/admin/skus/${row.skuId}/location-settings`, {
        locationId, activeOverride,
        weekdayPar: weekday.trim() === "" ? null : Number(weekday),
        weekendPar: weekend.trim() === "" ? null : Number(weekend),
        expected: { activeOverride, weekdayPar, weekendPar }, expectedPackEpoch: packEpoch,
      }, "PUT"));
    } catch { finish({ ok: false, code: "generic" }); }
  };
  const suggestion = row.suggestion?.slotCreation ? null : row.suggestion;
  const act = async (action: "accept" | "dismiss" | "revert") => {
    if (disabled || !suggestion?.canAct) return;
    setBusy(true); setMessage(null);
    finish(await postJson("/api/operations/ordering/suggestion", {
      locationId, skuId: row.skuId, dayClass: view.dayClass,
      generationId: suggestion.generationId, action,
    }));
  };
  return <div className="min-w-0 space-y-3 border-t border-co-border pt-3" aria-busy={disabled}>
    <form className="min-w-0 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
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
    </form>
    {suggestion?.canAct && <div className="flex flex-wrap gap-2">
      <button type="button" className={`${control} inline-flex`} disabled={disabled} onClick={() => void act("accept")}
        aria-label={t("ordering.suggestion.accept_aria", { sku: row.name, n: suggestion.suggestedPar })}>{t("ordering.suggestion.accept", { n: suggestion.suggestedPar })}</button>
      <button type="button" className={`${control} inline-flex`} disabled={disabled} onClick={() => void act("dismiss")}
        aria-label={t("ordering.suggestion.dismiss_aria", { sku: row.name, n: suggestion.currentPar })}>{t("ordering.suggestion.dismiss")}</button>
      {suggestion.tier === "auto" && <button type="button" className={`${control} inline-flex`}
        disabled={disabled || view.silence.shadowMode} onClick={() => void act("revert")}
        title={view.silence.shadowMode ? t("ordering.shadow.revert_disabled") : undefined}
        aria-label={t("ordering.auto.revert_aria", { sku: row.name, n: suggestion.currentPar })}>{t("ordering.auto.revert")}</button>}
    </div>}
    {disabled && <p role="status" className="text-sm">{t("ordering.suggestion.working")}</p>}
    {message && <p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-co-cta-text" : "text-co-confirm-text"}`}>{message}</p>}
    {awaitingRead && !refreshing && <button type="button" className={`${control} inline-flex`} onClick={refresh}>{t("admin.pars.refresh")}</button>}
  </div>;
}
