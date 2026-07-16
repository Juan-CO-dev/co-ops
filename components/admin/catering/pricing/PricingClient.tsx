"use client";

/**
 * PricingClient — per-location catering pricing editor (Catering KB, DOMAIN=pricing).
 *
 * Renders one card per location the actor manages. Each card shows the active
 * rule's rates (percent) + the two tax toggles, and (MoO+ / >=8) an Edit form.
 * A location with no active rule yet (id=null) offers Configure (create). A
 * configured location also offers Deactivate.
 *
 * FINANCIAL: every mutation is Tier B — create/edit/deactivate all call
 * requestStepUp("B") first and bail if not "ok". Rates are entered as percent
 * and parsed to bps in PricingForm; the server re-validates + recomputes.
 *
 * Authority mirrors the routes: MIN = 8 (catering.kb.pricing.write). Add/edit/
 * deactivate affordances are gated on actorLevel >= MIN.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { PricingRuleView } from "@/lib/admin/catering/pricing";
import { postJson, resolveErrorKey } from "@/components/admin/catering/shared";
import { PricingForm, type PricingFormValues } from "./PricingForm";

// Route/lib floor for catering.kb.pricing.write.
const PRICING_MIN = 8;

/** bps → "6.5%" for read display. */
function bpsToPercentLabel(bps: number): string {
  return `${bps / 100}%`;
}

export function PricingClient({
  rules,
  actorLevel,
}: {
  rules: PricingRuleView[];
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const canManage = actorLevel >= PRICING_MIN;
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const save = async (rule: PricingRuleView, values: PricingFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = rule.id
      ? await postJson(
          `/api/admin/catering/pricing/${rule.id}`,
          { locationId: rule.locationId, ...values },
          "PATCH",
        )
      : await postJson("/api/admin/catering/pricing", {
          locationId: rule.locationId,
          ...values,
        });
    setBusy(false);
    if (result.ok) {
      setEditingLocationId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const deactivate = async (rule: PricingRuleView) => {
    if (busy || !rule.id) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/pricing/${rule.id}`,
      { locationId: rule.locationId, active: false },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      setConfirmDeactivateId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  if (rules.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t("admin.catering.pricing.empty" as TranslationKey)}
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      {rules.map((rule) => {
        const editing = editingLocationId === rule.locationId;
        const confirming = confirmDeactivateId === rule.locationId;
        const configured = rule.id !== null;
        return (
          <div key={rule.locationId} className="co-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="text-sm text-co-text">
                <div className="flex items-center gap-2 font-bold">
                  {rule.locationName}
                  {!configured ? (
                    <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted">
                      {t("admin.catering.pricing.status.unconfigured" as TranslationKey)}
                    </span>
                  ) : null}
                </div>
                {!editing ? (
                  <div className="mt-1 text-co-text-muted">
                    {[
                      `${t("admin.catering.pricing.field.tax_rate" as TranslationKey)}: ${bpsToPercentLabel(rule.taxRateBps)}`,
                      `${t("admin.catering.pricing.field.gratuity" as TranslationKey)}: ${bpsToPercentLabel(rule.gratuityBps)}`,
                      `${t("admin.catering.pricing.field.service_charge" as TranslationKey)}: ${bpsToPercentLabel(rule.serviceChargeBps)}`,
                      `${t("admin.catering.pricing.field.deposit_pct" as TranslationKey)}: ${bpsToPercentLabel(rule.depositPctBps)}`,
                    ].join(" · ")}
                  </div>
                ) : null}
              </div>

              {canManage && !editing ? (
                <div className="flex gap-2">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmDeactivateId(null)}
                        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
                      >
                        {t("admin.catering.pricing.cancel" as TranslationKey)}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deactivate(rule)}
                        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
                      >
                        {t("admin.catering.pricing.deactivate" as TranslationKey)}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingLocationId(rule.locationId);
                          setErrorMsg(null);
                        }}
                        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                      >
                        {configured
                          ? t("admin.catering.pricing.edit" as TranslationKey)
                          : t("admin.catering.pricing.configure" as TranslationKey)}
                      </button>
                      {configured ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDeactivateId(rule.locationId)}
                          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                        >
                          {t("admin.catering.pricing.deactivate" as TranslationKey)}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {canManage && editing ? (
              <PricingForm
                initial={rule}
                busy={busy}
                errorMsg={errorMsg}
                submitLabel={
                  configured
                    ? t("admin.catering.pricing.save" as TranslationKey)
                    : t("admin.catering.pricing.create" as TranslationKey)
                }
                onSubmit={(values) => void save(rule, values)}
                onCancel={() => {
                  setEditingLocationId(null);
                  setErrorMsg(null);
                }}
              />
            ) : null}
          </div>
        );
      })}

      {errorMsg && editingLocationId === null ? (
        <p className="text-sm text-co-cta">{errorMsg}</p>
      ) : null}
    </div>
  );
}
