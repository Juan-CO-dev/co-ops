"use client";

/**
 * PricingForm — reusable add/edit form for ONE location's active pricing rule
 * (Catering KB, DOMAIN=pricing). `initial` present = edit an existing active
 * rule; the parent renders one form per location card.
 *
 * Rates are FINANCIAL basis points (bps) at rest; the operator enters PERCENT
 * here (e.g. 6.5). Each percent input is held as string state and parsed to bps
 * on submit via Math.round(Number(percent) * 100). Two boolean toggles
 * (tax_on_delivery, tax_on_gratuity). The server re-validates + recomputes;
 * this component's parse is convenience only.
 *
 * Pure presentational + local form state. The parent owns POST/PATCH + step-up
 * (Tier B) + router.refresh; this calls back the assembled bps payload via
 * onSubmit. Authority is gated by the parent (renders only for MoO+ / >=8).
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PricingRuleView } from "@/lib/admin/catering/pricing";

/** Payload shape handed to the parent — bps values, matching the route contract. */
export interface PricingFormValues {
  taxRateBps: number;
  gratuityBps: number;
  serviceChargeBps: number;
  depositPctBps: number;
  taxOnDelivery: boolean;
  taxOnGratuity: boolean;
}

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

/** bps → percent string for display in the input (e.g. 650 → "6.5"). */
function bpsToPercentStr(bps: number): string {
  return String(bps / 100);
}

/** percent string → bps. Empty → 0. Non-finite left as NaN so the server rejects it. */
function percentStrToBps(s: string): number {
  const trimmed = s.trim();
  if (trimmed === "") return 0;
  return Math.round(Number(trimmed) * 100);
}

function PercentField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      <div className="relative">
        <input
          className={fieldCls + " pr-8"}
          type="number"
          min={0}
          max={100}
          step="any"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-co-text-muted">
          %
        </span>
      </div>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-3">
      <span className="text-sm font-bold text-co-text">{label}</span>
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-6 w-6 rounded border-2 border-co-border text-co-gold focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

export function PricingForm({
  initial,
  busy,
  errorMsg,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** The location's current active rule (defaults when unconfigured, id=null). */
  initial: PricingRuleView;
  busy: boolean;
  errorMsg: string | null;
  submitLabel: string;
  onSubmit: (values: PricingFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  const [taxRate, setTaxRate] = useState(bpsToPercentStr(initial.taxRateBps));
  const [gratuity, setGratuity] = useState(bpsToPercentStr(initial.gratuityBps));
  const [serviceCharge, setServiceCharge] = useState(bpsToPercentStr(initial.serviceChargeBps));
  const [depositPct, setDepositPct] = useState(bpsToPercentStr(initial.depositPctBps));
  const [taxOnDelivery, setTaxOnDelivery] = useState(initial.taxOnDelivery);
  const [taxOnGratuity, setTaxOnGratuity] = useState(initial.taxOnGratuity);

  const submit = () => {
    if (busy) return;
    onSubmit({
      taxRateBps: percentStrToBps(taxRate),
      gratuityBps: percentStrToBps(gratuity),
      serviceChargeBps: percentStrToBps(serviceCharge),
      depositPctBps: percentStrToBps(depositPct),
      taxOnDelivery,
      taxOnGratuity,
    });
  };

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border-2 border-dashed border-co-border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PercentField
          label={t("admin.catering.pricing.field.tax_rate" as TranslationKey)}
          value={taxRate}
          onChange={setTaxRate}
          disabled={busy}
        />
        <PercentField
          label={t("admin.catering.pricing.field.gratuity" as TranslationKey)}
          value={gratuity}
          onChange={setGratuity}
          disabled={busy}
        />
        <PercentField
          label={t("admin.catering.pricing.field.service_charge" as TranslationKey)}
          value={serviceCharge}
          onChange={setServiceCharge}
          disabled={busy}
        />
        <PercentField
          label={t("admin.catering.pricing.field.deposit_pct" as TranslationKey)}
          value={depositPct}
          onChange={setDepositPct}
          disabled={busy}
        />
      </div>

      <div className="flex flex-col gap-1 rounded-lg border-2 border-co-border p-3">
        <Toggle
          label={t("admin.catering.pricing.field.tax_on_delivery" as TranslationKey)}
          ariaLabel={t("admin.catering.pricing.field.tax_on_delivery" as TranslationKey)}
          checked={taxOnDelivery}
          onChange={setTaxOnDelivery}
          disabled={busy}
        />
        <Toggle
          label={t("admin.catering.pricing.field.tax_on_gratuity" as TranslationKey)}
          ariaLabel={t("admin.catering.pricing.field.tax_on_gratuity" as TranslationKey)}
          checked={taxOnGratuity}
          onChange={setTaxOnGratuity}
          disabled={busy}
        />
      </div>

      {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.catering.pricing.cancel" as TranslationKey)}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
