"use client";
/**
 * The MoO's per-shop card (plan Task 24; R1, R2): the scheduling switch for the shop, the wage estimates (BLANK by
 * default — money stays "—" until set; a blank stays blank, never $0) and the AGM's access (read only, or build and
 * edit). MoO+ only (the loader sends it to no one else); Tier E before the post; a cancelled prompt keeps the form.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { useTranslation } from "@/lib/i18n/provider";
import type { ScheduleShopSettings } from "@/lib/scheduling/inputs-shared";
import { dollarsToCents, shopBody } from "@/lib/scheduling/settings-view-shared";
import { runGuarded } from "./horizon-flow-shared";
import { scheduleErrorKey } from "./schedule-errors";
import { BUTTON, Check, Fields, SelectField } from "./settings-fields";

const toDollars = (c: number | null) => (c === null ? "" : String(Math.round(c) / 100));
const INPUT = "min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-2 text-sm text-co-text";

export function ShopSettingsCard({ locationId, shop }: { locationId: string; shop: ScheduleShopSettings }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const [enabled, setEnabled] = useState(shop.enabled);
  const [hourly, setHourly] = useState(toDollars(shop.estimatedHourlyCents));
  const [salaried, setSalaried] = useState(toDollars(shop.estimatedSalariedWeeklyCents));
  const [agm, setAgm] = useState(shop.agmAccess);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save() {
    setError(null); setSaved(false);
    const h = dollarsToCents(hourly);
    const s = dollarsToCents(salaried);
    if (h === "invalid" || s === "invalid") { setError("wage_estimate_invalid"); return; }
    setBusy(true);
    const out = await runGuarded({
      tier: "E", requestStepUp: () => requestStepUp("E"),
      post: async () => { const r = await post("/api/schedule/settings", shopBody(locationId, { enabled, estimatedHourlyCents: h, estimatedSalariedWeeklyCents: s, agmAccess: agm })); return r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code }; },
    });
    setBusy(false);
    if (out.kind === "cancelled") return;
    if (out.kind === "refused") { setError(out.code); return; }
    setSaved(true);
    router.refresh();
  }
  return (
    <div className="grid gap-3" data-section="shop-switch">
      <Check label={t("schedule.settings.shop.enabled")} checked={enabled} onChange={setEnabled} name="enabled" />
      <Fields>
        <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.shop.hourly_estimate")}
          <input name="estimatedHourly" inputMode="decimal" className={INPUT} value={hourly} placeholder={t("schedule.board.money.blank")} onChange={(e) => setHourly(e.target.value)} />
        </label>
        <label className="grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.shop.salaried_estimate")}
          <input name="estimatedSalaried" inputMode="decimal" className={INPUT} value={salaried} placeholder={t("schedule.board.money.blank")} onChange={(e) => setSalaried(e.target.value)} />
        </label>
        <SelectField name="agmAccess" label={t("schedule.settings.shop.agm_access")} value={agm} onChange={(v) => setAgm(v === "edit" ? "edit" : "read")}
          options={[{ value: "read", label: t("schedule.settings.shop.agm_read") }, { value: "edit", label: t("schedule.settings.shop.agm_edit") }]} />
      </Fields>
      <p className="text-xs text-co-text-muted">{t("schedule.settings.shop.estimates_note")}</p>
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(error))}</p> : null}
      {saved ? <p role="status" className="text-sm font-bold text-co-confirm-text">{t("schedule.settings.saved")}</p> : null}
      <button type="button" className={BUTTON} disabled={busy} onClick={save}>{t("schedule.settings.save")}</button>
    </div>
  );
}
