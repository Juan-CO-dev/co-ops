"use client";

/**
 * SkuForm — reusable add/edit form for a SKU, used by BOTH the vendor-detail
 * SKUs card (fixed vendor, no vendor dropdown) and the global catalog page
 * (vendor dropdown incl. "Manual / none", so a SKU can be created vendor-less
 * or reassigned between vendors).
 *
 * Pure presentational + local form state. The parent owns the POST/PATCH +
 * step-up + router.refresh; this component calls back with the assembled
 * payload via onSubmit. Authority is gated by the parent (it only renders the
 * form for GM+).
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { SkuView } from "@/lib/admin/skus";

export interface SkuFormVendorOption {
  id: string;
  name: string;
}
export interface SkuFormLocationOption {
  id: string;
  name: string;
}

/** Payload shape handed to the parent — matches the route contracts. */
export interface SkuFormValues {
  vendorId: string | null;
  locationId: string | null;
  name: string;
  unit: string;
  unitSize: string | null;
  itemNumber: string | null;
  sourceUrl: string | null;
  leadTimeDays: number | null;
  notes: string | null;
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

export function SkuForm({
  initial,
  fixedVendorId,
  vendors,
  locations,
  busy,
  errorMsg,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** Existing SKU when editing; undefined when adding. */
  initial?: SkuView;
  /** When set, the vendor is fixed (vendor-detail card) → no vendor dropdown. */
  fixedVendorId?: string | null;
  /** Active vendors for the dropdown (global page). Omit to hide the dropdown. */
  vendors?: SkuFormVendorOption[];
  /** Active locations (Global = null option + each location). */
  locations: SkuFormLocationOption[];
  busy: boolean;
  errorMsg: string | null;
  submitLabel: string;
  onSubmit: (values: SkuFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  // Vendor: "" sentinel = Manual / none → null.
  const initialVendor =
    initial?.vendorId ?? (fixedVendorId !== undefined ? fixedVendorId : null);
  const [vendorId, setVendorId] = useState<string>(initialVendor ?? "");
  // Location: "" sentinel = Global → null.
  const [locationId, setLocationId] = useState<string>(initial?.locationId ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [unitSize, setUnitSize] = useState(initial?.unitSize ?? "");
  const [itemNumber, setItemNumber] = useState(initial?.itemNumber ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [leadTime, setLeadTime] = useState(
    initial?.leadTimeDays != null ? String(initial.leadTimeDays) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const showVendorDropdown = vendors !== undefined;
  const canSubmit = name.trim() !== "" && unit.trim() !== "" && !busy;

  const submit = () => {
    if (!canSubmit) return;
    const trimmedLead = leadTime.trim();
    const parsedLead = trimmedLead === "" ? null : Number(trimmedLead);
    onSubmit({
      vendorId: showVendorDropdown ? (vendorId || null) : (fixedVendorId ?? null),
      locationId: locationId || null,
      name: name.trim(),
      unit: unit.trim(),
      unitSize: unitSize.trim() || null,
      itemNumber: itemNumber.trim() || null,
      sourceUrl: sourceUrl.trim() || null,
      leadTimeDays: parsedLead,
      notes: notes.trim() || null,
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-co-border p-3">
      {showVendorDropdown ? (
        <Labeled label={t("admin.skus.field.vendor")}>
          <select
            className={fieldCls}
            value={vendorId}
            disabled={busy}
            onChange={(e) => setVendorId(e.target.value)}
          >
            <option value="">{t("admin.skus.manual")}</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Labeled>
      ) : null}

      <Labeled label={t("admin.skus.field.name")}>
        <input className={fieldCls} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
      </Labeled>

      <div className="grid grid-cols-2 gap-2">
        <Labeled label={t("admin.skus.field.unit")}>
          <input className={fieldCls} value={unit} disabled={busy} onChange={(e) => setUnit(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.skus.field.unit_size")}>
          <input className={fieldCls} value={unitSize} disabled={busy} onChange={(e) => setUnitSize(e.target.value)} />
        </Labeled>
      </div>

      <Labeled label={t("admin.skus.field.location")}>
        <select
          className={fieldCls}
          value={locationId}
          disabled={busy}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">{t("admin.skus.global")}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Labeled>

      <Labeled label={t("admin.skus.field.item_number")}>
        <input className={fieldCls} value={itemNumber} disabled={busy} onChange={(e) => setItemNumber(e.target.value)} />
      </Labeled>

      <Labeled label={t("admin.skus.field.source_url")}>
        <input className={fieldCls} type="url" value={sourceUrl} disabled={busy} onChange={(e) => setSourceUrl(e.target.value)} />
      </Labeled>

      <Labeled label={t("admin.skus.field.lead_time")}>
        <input
          className={fieldCls}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={leadTime}
          disabled={busy}
          onChange={(e) => setLeadTime(e.target.value)}
        />
      </Labeled>

      <Labeled label={t("admin.skus.field.notes")}>
        <textarea className={fieldCls} rows={2} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} />
      </Labeled>

      {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.skus.cancel")}
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
