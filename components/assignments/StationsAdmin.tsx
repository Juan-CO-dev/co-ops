"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { Station } from "@/lib/assignments-shared";

export function StationsAdmin({ locationId, stations, translatedNames }: {
  locationId: string; stations: Station[]; translatedNames: string[];
}) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState(false);
  async function save(id: string, nameEs: string) {
    setBusy(true); setError(false);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const payload = { locationId, id, nameEs };
      const send = () => fetch("/api/admin/stations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let response = await send();
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { code?: string };
        if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") response = await send();
      }
      if (!response.ok || response.redirected) throw new Error("station_save_failed");
      startTransition(() => router.refresh());
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="space-y-3" aria-busy={busy || refreshing}>
    {error && <p role="alert" className="text-co-cta-text">{t("assignments.error")}</p>}
    {stations.filter((station) => station.active).map((station) =>
      <div key={station.id} className="co-card space-y-2 p-4">
        <h2 className="font-bold text-co-text">{station.name}</h2>
        {translatedNames.includes(station.name)
          ? <p className="text-sm text-co-text-muted">{station.nameEs}</p>
          : <form onSubmit={(event) => {
            event.preventDefault();
            void save(station.id, String(new FormData(event.currentTarget).get("nameEs") ?? ""));
          }} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("assignments.nameEs")}
              <input className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-base font-normal text-co-text" name="nameEs" maxLength={100} defaultValue={station.nameEs ?? ""} />
            </label>
            <button disabled={busy || refreshing} className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text" type="submit">{t("common.save")}</button>
          </form>}
      </div>)}
  </div>;
}
