"use client";

/**
 * CapacityPolicyForm — reusable add/edit form for ONE location's active
 * capacity policy (Catering KB, DOMAIN=capacity). `initial` carries the
 * location's current view: id present = edit the existing active row; id=null
 * = create (unconfigured). The parent renders one form per location card.
 *
 * The three caps are nullable non-negative integers (null = no cap). Each is
 * held as string state and parsed on submit — empty → null, else Number(...);
 * the server re-validates integer >= 0.
 *
 * Pure presentational + local form state. The parent owns POST/PATCH + step-up
 * (Tier B) + router.refresh; this calls back the assembled payload via
 * onSubmit. Authority is gated by the parent (renders only for GM+ / >=7).
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { CapacityPolicyView } from "@/lib/admin/catering/capacity";

/** Payload shape handed to the parent — matches the route contract (null = no cap). */
export interface CapacityPolicyFormValues {
  maxCoversPerDay: number | null;
  maxEventsPerDay: number | null;
  minLeadTimeHours: number | null;
}

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

function IntField({
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
      <input
        className={fieldCls}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function CapacityPolicyForm({
  initial,
  busy,
  errorMsg,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** The location's current active policy (all-null caps when unconfigured, id=null). */
  initial: CapacityPolicyView;
  busy: boolean;
  errorMsg: string | null;
  submitLabel: string;
  onSubmit: (values: CapacityPolicyFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  const [maxCovers, setMaxCovers] = useState(
    initial.maxCoversPerDay != null ? String(initial.maxCoversPerDay) : "",
  );
  const [maxEvents, setMaxEvents] = useState(
    initial.maxEventsPerDay != null ? String(initial.maxEventsPerDay) : "",
  );
  const [minLeadTime, setMinLeadTime] = useState(
    initial.minLeadTimeHours != null ? String(initial.minLeadTimeHours) : "",
  );

  /** empty → null (no cap), else Number(...) (the lib validates integer >= 0). */
  const parseCap = (s: string): number | null => {
    const trimmed = s.trim();
    return trimmed === "" ? null : Number(trimmed);
  };

  const submit = () => {
    if (busy) return;
    onSubmit({
      maxCoversPerDay: parseCap(maxCovers),
      maxEventsPerDay: parseCap(maxEvents),
      minLeadTimeHours: parseCap(minLeadTime),
    });
  };

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border-2 border-dashed border-co-border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <IntField
          label={t("admin.catering.capacity.field.max_covers" as TranslationKey)}
          value={maxCovers}
          onChange={setMaxCovers}
          disabled={busy}
        />
        <IntField
          label={t("admin.catering.capacity.field.max_events" as TranslationKey)}
          value={maxEvents}
          onChange={setMaxEvents}
          disabled={busy}
        />
        <IntField
          label={t("admin.catering.capacity.field.min_lead_time" as TranslationKey)}
          value={minLeadTime}
          onChange={setMinLeadTime}
          disabled={busy}
        />
      </div>

      <p className="text-xs text-co-text-muted">
        {t("admin.catering.capacity.caps_hint" as TranslationKey)}
      </p>

      {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.catering.capacity.cancel" as TranslationKey)}
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
