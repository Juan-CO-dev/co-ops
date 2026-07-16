"use client";

/**
 * ZoneForm — reusable add/edit form for a catering delivery zone.
 * initial present = edit; undefined = add. Money inputs (fee, min order) are
 * held as dollar strings and parsed to integer cents on submit via
 * Math.round(Number(x) * 100). label_en / label_es are paired bilingual
 * inputs saved together (slug derives server-side from label_en).
 *
 * Pure presentational + local form state. The parent owns the POST/PATCH +
 * step-up + router.refresh; this component calls back with the assembled
 * payload via onSubmit. Authority is gated by the parent (GM+ ≥7 only).
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ZoneView } from "@/lib/admin/catering/zones";

/** Payload shape handed to the parent — matches the route contracts. */
export interface ZoneFormValues {
  labelEn: string;
  labelEs: string | null;
  feeCents: number;
  minOrderCents: number | null;
}

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}

export function ZoneForm({
  initial,
  busy,
  errorMsg,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** Existing zone when editing; undefined when adding. */
  initial?: ZoneView;
  busy: boolean;
  errorMsg: string | null;
  submitLabel: string;
  onSubmit: (values: ZoneFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  const [labelEn, setLabelEn] = useState(initial?.labelEn ?? "");
  const [labelEs, setLabelEs] = useState(initial?.labelEs ?? "");
  // Money held as dollar strings; parsed to cents on submit.
  const [fee, setFee] = useState(
    initial ? (initial.feeCents / 100).toFixed(2) : "",
  );
  const [minOrder, setMinOrder] = useState(
    initial?.minOrderCents != null ? (initial.minOrderCents / 100).toFixed(2) : "",
  );

  const canSubmit = labelEn.trim() !== "" && fee.trim() !== "" && !busy;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      labelEn: labelEn.trim(),
      labelEs: labelEs.trim() || null,
      feeCents: Math.round(Number(fee) * 100),
      minOrderCents: minOrder.trim() === "" ? null : Math.round(Number(minOrder) * 100),
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-co-border p-3">
      <Labeled label={t("admin.catering.zones.field.label_en" as TranslationKey)}>
        <input className={fieldCls} value={labelEn} disabled={busy} onChange={(e) => setLabelEn(e.target.value)} />
      </Labeled>

      <Labeled label={t("admin.catering.zones.field.label_es" as TranslationKey)}>
        <input className={fieldCls} value={labelEs} disabled={busy} onChange={(e) => setLabelEs(e.target.value)} />
      </Labeled>

      <div className="grid grid-cols-2 gap-2">
        <Labeled label={t("admin.catering.zones.field.fee" as TranslationKey)}>
          <input
            className={fieldCls}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={fee}
            disabled={busy}
            onChange={(e) => setFee(e.target.value)}
          />
        </Labeled>
        <Labeled label={t("admin.catering.zones.field.min_order" as TranslationKey)}>
          <input
            className={fieldCls}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={minOrder}
            disabled={busy}
            onChange={(e) => setMinOrder(e.target.value)}
          />
        </Labeled>
      </div>

      {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.catering.zones.cancel" as TranslationKey)}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
