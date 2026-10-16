"use client";
/**
 * The per-shop PM v2 SWITCH card (Scheduling Phase 1, CC's chunk G ruling 2). Lives on the PM settings page
 * (/admin/pm-criteria — the admin surface whose StepUpProvider opens the Tier E window) and is rendered there for
 * MoO+ only (`canManagePmV2Switch`: moo / owner / cgs; the social media manager never).
 *
 * One row per shop: its name, On / Off, and a 44 px switch. A tap asks for the Tier E window FIRST, then posts the
 * existing route (POST /api/people/settings, action "shop", `pmV2SwitchBody` — the prep position travels
 * unchanged). Turning OFF is never gated. A shop whose data is not ready shows the `pm_v2_not_ready` refusal and
 * names what is missing (the BOH positions, an active shared criterion); its switch stays disabled while it is
 * off. A server refusal shows on that shop's row. A canceled password prompt changes nothing. en + es (tú);
 * flex-wrap rows for a 375 px phone; useState only; no email, no notification.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { pmV2SwitchBody, pmV2SwitchState, type PmV2SwitchShop } from "@/lib/people/pm-v2-switch-shared";

const OWN_ERRORS = ["forbidden", "step_up_required", "step_up_stale"];
const PEOPLE_ERRORS = ["pm_v2_not_ready", "pm_v2_unavailable", "invalid_payload", "location_access_denied", "position_not_at_shop", "position_retired"];
export function pmV2SwitchErrorKey(code: unknown): TranslationKey {
  if (typeof code === "string" && OWN_ERRORS.includes(code)) return `pmV2Switch.error.${code}` as TranslationKey;
  if (typeof code === "string" && PEOPLE_ERRORS.includes(code)) return `people.skills.error.${code}` as TranslationKey;
  return "pmV2Switch.error.generic";
}

export function PmV2SwitchCard({ shops, initialRefusal = null }: {
  shops: readonly PmV2SwitchShop[];
  /** SSR tests only: a refusal already on a row. */
  initialRefusal?: { locationId: string; code: string } | null;
}) {
  const { t } = useTranslation();
  return (
    <section className="co-card grid gap-3 p-4" aria-labelledby="pm-v2-switch-title">
      <h2 id="pm-v2-switch-title" className="text-base font-bold text-co-text">{t("pmV2Switch.title")}</h2>
      <p className="text-sm text-co-text-muted">{t("pmV2Switch.intro")}</p>
      <ul className="grid gap-3">
        {shops.map((s) => (
          <ShopRow key={s.locationId} shop={s} initialError={initialRefusal?.locationId === s.locationId ? pmV2SwitchErrorKey(initialRefusal.code) : null} />
        ))}
      </ul>
    </section>
  );
}

function ShopRow({ shop, initialError }: { shop: PmV2SwitchShop; initialError: TranslationKey | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(initialError);
  const state = pmV2SwitchState(shop);
  const notReady = state.missing.length > 0;

  async function toggle() {
    setBusy(true); setError(null);
    const stepUp = await requestStepUp("E");
    if (stepUp !== "ok") { setBusy(false); return; }
    const r = await post("/api/people/settings", pmV2SwitchBody(shop, !state.on));
    setBusy(false);
    if (!r.ok) { setError(pmV2SwitchErrorKey(r.code)); return; }
    router.refresh();
  }

  return (
    <li className="grid gap-2 rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 basis-[8rem] font-bold text-co-text">{shop.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${state.on ? "bg-co-gold/20 text-co-text" : "bg-co-surface-inset text-co-text-muted"}`}>
          {t(state.on ? "pmV2Switch.state.on" : "pmV2Switch.state.off")}
        </span>
        <button type="button" role="switch" aria-checked={state.on} aria-label={t("pmV2Switch.toggle", { shop: shop.name })}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60"
          disabled={busy || !state.canToggle} onClick={toggle}>
          {t(state.on ? "pmV2Switch.turnOff" : "pmV2Switch.turnOn")}
        </button>
      </div>
      {notReady && (
        <div className="grid gap-1 text-sm text-co-text">
          <p className="font-bold text-co-warning-text">{t("people.skills.error.pm_v2_not_ready")}</p>
          <p className="text-co-text-muted">{t("pmV2Switch.missing.title")}</p>
          <ul className="list-disc pl-5">
            {state.missing.map((m) => <li key={m}>{t(m === "boh" ? "pmV2Switch.missing.boh" : "pmV2Switch.missing.criteria")}</li>)}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
    </li>
  );
}
