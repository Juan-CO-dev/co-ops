"use client";

/**
 * PackageForm — reusable add/edit form for a catering package.
 *
 * `initial` present = edit; undefined = add. Money is held as a dollar STRING in
 * local state and parsed to integer cents on submit via Math.round(x * 100);
 * headcount / lead-time are integer strings parsed on submit. EN and ES paired
 * inputs (label + description) are exposed together and saved atomically.
 *
 * Pure presentational + local form state. The parent owns POST/PATCH + step-up +
 * router.refresh and gates the whole form on actorLevel >= MIN. slug is the
 * system key — it is NOT an input here (derived from the English label on create;
 * immutable on edit).
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PackageView, PricingMode, PackageLocationOption } from "@/lib/admin/catering/packages";

/** Payload shape handed to the parent — matches the route contract (cents). */
export interface PackageFormValues {
  locationId: string | null;
  labelEn: string;
  labelEs: string | null;
  descriptionEn: string | null;
  descriptionEs: string | null;
  pricingMode: PricingMode;
  priceCents: number;
  minHeadcount: number | null;
  leadTimeHours: number | null;
  serves: number | null;
}

const PRICING_MODES: PricingMode[] = ["per_head", "per_platter", "fixed"];

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

export function PackageForm({
  initial,
  locations,
  busy,
  errorMsg,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** Existing package when editing; undefined when adding. */
  initial?: PackageView;
  /** Active locations for the optional per-location select (Global = null option). */
  locations: PackageLocationOption[];
  busy: boolean;
  errorMsg: string | null;
  submitLabel: string;
  onSubmit: (values: PackageFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  // Location select is create-only (identity field). On edit it is fixed/hidden.
  const isEdit = initial !== undefined;
  // "" sentinel = Global → null.
  const [locationId, setLocationId] = useState<string>(initial?.locationId ?? "");
  const [labelEn, setLabelEn] = useState(initial?.labelEn ?? "");
  const [labelEs, setLabelEs] = useState(initial?.labelEs ?? "");
  const [descriptionEn, setDescriptionEn] = useState(initial?.descriptionEn ?? "");
  const [descriptionEs, setDescriptionEs] = useState(initial?.descriptionEs ?? "");
  const [pricingMode, setPricingMode] = useState<PricingMode>(initial?.pricingMode ?? "fixed");
  // Money held as a dollar string; parsed to cents on submit.
  const [priceDollars, setPriceDollars] = useState(
    initial?.priceCents != null ? (initial.priceCents / 100).toFixed(2) : "",
  );
  const [minHeadcount, setMinHeadcount] = useState(
    initial?.minHeadcount != null ? String(initial.minHeadcount) : "",
  );
  const [leadTimeHours, setLeadTimeHours] = useState(
    initial?.leadTimeHours != null ? String(initial.leadTimeHours) : "",
  );
  const [serves, setServes] = useState(initial?.serves != null ? String(initial.serves) : "");

  const canSubmit = labelEn.trim() !== "" && priceDollars.trim() !== "" && !busy;

  /** empty → null, else Number(...) (the lib validates positivity/integers). */
  const parseIntOrNull = (s: string): number | null => {
    const trimmed = s.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  const submit = () => {
    if (!canSubmit) return;
    const dollars = Number(priceDollars.trim());
    onSubmit({
      locationId: locationId || null,
      labelEn: labelEn.trim(),
      labelEs: labelEs.trim() || null,
      descriptionEn: descriptionEn.trim() || null,
      descriptionEs: descriptionEs.trim() || null,
      pricingMode,
      priceCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0,
      minHeadcount: parseIntOrNull(minHeadcount),
      leadTimeHours: parseIntOrNull(leadTimeHours),
      serves: serves.trim() === "" ? null : Number(serves.trim()),
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-co-border p-3">
      {!isEdit ? (
        <Labeled label={t("admin.catering.packages.field.location" as TranslationKey)}>
          <select
            className={fieldCls}
            value={locationId}
            disabled={busy}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">{t("admin.catering.packages.global" as TranslationKey)}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Labeled>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labeled label={t("admin.catering.packages.field.label_en" as TranslationKey)}>
          <input className={fieldCls} value={labelEn} disabled={busy} onChange={(e) => setLabelEn(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.catering.packages.field.label_es" as TranslationKey)}>
          <input className={fieldCls} value={labelEs} disabled={busy} onChange={(e) => setLabelEs(e.target.value)} />
        </Labeled>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labeled label={t("admin.catering.packages.field.description_en" as TranslationKey)}>
          <textarea className={fieldCls} rows={2} value={descriptionEn} disabled={busy} onChange={(e) => setDescriptionEn(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.catering.packages.field.description_es" as TranslationKey)}>
          <textarea className={fieldCls} rows={2} value={descriptionEs} disabled={busy} onChange={(e) => setDescriptionEs(e.target.value)} />
        </Labeled>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Labeled label={t("admin.catering.packages.field.pricing_mode" as TranslationKey)}>
          <select
            className={fieldCls}
            value={pricingMode}
            disabled={busy}
            onChange={(e) => setPricingMode(e.target.value as PricingMode)}
          >
            {PRICING_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`admin.catering.packages.mode.${m}` as TranslationKey)}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label={t("admin.catering.packages.field.price" as TranslationKey)}>
          <input
            className={fieldCls}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={priceDollars}
            disabled={busy}
            onChange={(e) => setPriceDollars(e.target.value)}
          />
        </Labeled>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Labeled label={t("admin.catering.packages.field.min_headcount" as TranslationKey)}>
          <input
            className={fieldCls}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={minHeadcount}
            disabled={busy}
            onChange={(e) => setMinHeadcount(e.target.value)}
          />
        </Labeled>
        <Labeled label={t("admin.catering.packages.field.lead_time_hours" as TranslationKey)}>
          <input
            className={fieldCls}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={leadTimeHours}
            disabled={busy}
            onChange={(e) => setLeadTimeHours(e.target.value)}
          />
        </Labeled>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Labeled label={t("admin.catering.packages.field.serves" as TranslationKey)}>
          <input
            className={fieldCls}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={serves}
            disabled={busy}
            onChange={(e) => setServes(e.target.value)}
          />
        </Labeled>
      </div>

      {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.catering.packages.cancel" as TranslationKey)}
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
