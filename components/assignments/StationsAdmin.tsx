"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { Station } from "@/lib/assignments-shared";

const input = "flex min-h-[44px] w-full items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base font-normal tracking-normal text-co-text";
export function StationsAdmin({ locationId, stations }: { locationId: string; stations: Station[] }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState(false);
  async function save(form: HTMLFormElement, id?: string) {
    setBusy(true); setError(false);
    try {
      const data = new FormData(form);
      if (await requestStepUp("B") !== "ok") return;
      const payload = { locationId, id, name: data.get("name"), nameEs: data.get("nameEs"), sort: Number(data.get("sort")), active: data.get("active") === "on" };
      const send = () => fetch("/api/admin/stations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let response = await send();
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { code?: string };
        if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") response = await send();
      }
      if (!response.ok || response.redirected) throw new Error("station_save_failed");
      if (!id) form.reset();
      startTransition(() => router.refresh());
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="space-y-4" aria-busy={busy || refreshing}>
    {error && <p role="alert" className="text-co-cta-text">{t("assignments.error")}</p>}
    {[...stations, null].map((station) => <form key={station ? `${station.id}/${station.name}/${station.nameEs}/${station.sort}/${station.active}` : "new"} className="co-card space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget, station?.id); }}>
      <h2 className="font-bold text-co-text">{station?.name ?? t("assignments.addStation")}</h2>
      <fieldset disabled={busy || refreshing} className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.nameEn")}<input className={input} aria-label={t("assignments.nameEn")} name="name" required maxLength={100} defaultValue={station?.name ?? ""} /></label>
        <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.nameEs")}<input className={input} aria-label={t("assignments.nameEs")} name="nameEs" required maxLength={100} defaultValue={station?.nameEs ?? ""} /></label>
        <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.sort")}<input className={input} aria-label={t("assignments.sort")} name="sort" type="number" min={0} max={10000} step={1} defaultValue={station?.sort ?? 0} required /></label>
        <label className="flex min-h-[44px] items-center gap-2 font-bold text-co-text"><input className="h-5 w-5" aria-label={t("assignments.active")} name="active" type="checkbox" defaultChecked={station?.active ?? true} />{t("assignments.active")}</label>
        <button className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold tracking-[0.1em] text-co-text" type="submit">{t("common.save")}</button>
      </fieldset>
    </form>)}
  </div>;
}
