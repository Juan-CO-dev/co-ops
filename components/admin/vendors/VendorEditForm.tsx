"use client";

/**
 * VendorEditForm — per-vendor edit surface (/admin/vendors/[id]).
 *
 * GM+ (canManageFull) may edit every field + (de)activate. AGM+ may edit only
 * the trivial fields; full-only fields render disabled/read-only. Trivial-only
 * saves are Tier A; any full-field save or the active toggle is Tier B (the
 * route decides the tier from the payload, the lib enforces the GM+ split).
 *
 * Save semantics: PATCH only the dirty fields. The active toggle is its own
 * PATCH ({active}) so it maps to the vendor.activate/deactivate audit action.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { VendorView } from "@/lib/admin/vendors";
import { postJson, resolveErrorKey } from "./shared";

interface Editable {
  name: string;
  category: string;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
  ordering_email: string;
  ordering_url: string;
  ordering_days: string;
  payment_terms: string;
  account_number: string;
  notes: string;
}

const FULL_ONLY_FIELDS = new Set<keyof Editable>([
  "name",
  "category",
  "ordering_days",
  "payment_terms",
  "account_number",
]);

function toEditable(v: VendorView): Editable {
  return {
    name: v.name,
    category: v.category ?? "",
    contact_person: v.contactPerson ?? "",
    contact_email: v.contactEmail ?? "",
    contact_phone: v.contactPhone ?? "",
    ordering_email: v.orderingEmail ?? "",
    ordering_url: v.orderingUrl ?? "",
    ordering_days: v.orderingDays ?? "",
    payment_terms: v.paymentTerms ?? "",
    account_number: v.accountNumber ?? "",
    notes: v.notes ?? "",
  };
}

export function VendorEditForm({
  vendor,
  canManageFull,
}: {
  vendor: VendorView;
  canManageFull: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const original = toEditable(vendor);
  const [form, setForm] = useState<Editable>(original);
  const [active, setActive] = useState(vendor.active);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const set = (key: keyof Editable, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedMsg(null);
  };

  // Dirty fields the actor is allowed to write (AGM can't dirty full-only).
  const dirtyKeys = (Object.keys(form) as (keyof Editable)[]).filter(
    (k) => form[k].trim() !== original[k].trim(),
  );

  const handleSave = async () => {
    if (submitting || dirtyKeys.length === 0) return;
    setErrorMsg(null);
    setSavedMsg(null);
    const touchesFull = dirtyKeys.some((k) => FULL_ONLY_FIELDS.has(k));
    const stepUp = await requestStepUp(touchesFull ? "B" : "A");
    if (stepUp !== "ok") return;

    const changes: Record<string, string | null> = {};
    for (const k of dirtyKeys) {
      changes[k] = form[k].trim() === "" ? null : form[k].trim();
    }
    setSubmitting(true);
    const result = await postJson(`/api/admin/vendors/${vendor.id}`, changes, "PATCH");
    setSubmitting(false);
    if (result.ok) {
      setSavedMsg(t("admin.vendors.saved"));
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const handleToggleActive = async () => {
    if (submitting) return;
    setErrorMsg(null);
    setSavedMsg(null);
    const next = !active;
    const stepUp = await requestStepUp("B");
    if (stepUp !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`/api/admin/vendors/${vendor.id}`, { active: next }, "PATCH");
    setSubmitting(false);
    if (result.ok) {
      setActive(next);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const fieldDisabled = (key: keyof Editable) => FULL_ONLY_FIELDS.has(key) && !canManageFull;

  return (
    <div className="mt-5">
      <div className="flex flex-col gap-4">
        <EditField label={t("admin.vendors.field.name")} value={form.name} onChange={(v) => set("name", v)} disabled={fieldDisabled("name")} />
        <EditField label={t("admin.vendors.field.category")} value={form.category} onChange={(v) => set("category", v)} disabled={fieldDisabled("category")} />
        <EditField label={t("admin.vendors.field.contact_person")} value={form.contact_person} onChange={(v) => set("contact_person", v)} disabled={fieldDisabled("contact_person")} />
        <EditField label={t("admin.vendors.field.contact_email")} value={form.contact_email} onChange={(v) => set("contact_email", v)} type="email" disabled={fieldDisabled("contact_email")} />
        <EditField label={t("admin.vendors.field.contact_phone")} value={form.contact_phone} onChange={(v) => set("contact_phone", v)} type="tel" disabled={fieldDisabled("contact_phone")} />
        <EditField label={t("admin.vendors.field.ordering_email")} value={form.ordering_email} onChange={(v) => set("ordering_email", v)} type="email" disabled={fieldDisabled("ordering_email")} />
        <EditField label={t("admin.vendors.field.ordering_url")} value={form.ordering_url} onChange={(v) => set("ordering_url", v)} type="url" disabled={fieldDisabled("ordering_url")} />
        <EditField label={t("admin.vendors.field.ordering_days")} value={form.ordering_days} onChange={(v) => set("ordering_days", v)} disabled={fieldDisabled("ordering_days")} />
        <EditField label={t("admin.vendors.field.payment_terms")} value={form.payment_terms} onChange={(v) => set("payment_terms", v)} disabled={fieldDisabled("payment_terms")} />
        <EditField label={t("admin.vendors.field.account_number")} value={form.account_number} onChange={(v) => set("account_number", v)} disabled={fieldDisabled("account_number")} />
        <EditField label={t("admin.vendors.field.notes")} value={form.notes} onChange={(v) => set("notes", v)} multiline disabled={fieldDisabled("notes")} />
      </div>

      {!canManageFull ? (
        <p className="mt-3 text-[11px] italic text-co-text-muted">{t("admin.vendors.agm_note")}</p>
      ) : null}

      {errorMsg ? <p className="mt-3 text-sm text-co-cta">{errorMsg}</p> : null}
      {savedMsg ? <p className="mt-3 text-sm text-co-success">{savedMsg}</p> : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={submitting || dirtyKeys.length === 0}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.vendors.save")}
        </button>

        {canManageFull ? (
          <button
            type="button"
            onClick={() => void handleToggleActive()}
            disabled={submitting}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {active ? t("admin.vendors.deactivate") : t("admin.vendors.reactivate")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = "text",
  multiline = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  multiline?: boolean;
  disabled?: boolean;
}) {
  const cls =
    "mt-1 w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
          className={`${cls} py-2`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${cls} min-h-[44px]`}
        />
      )}
    </label>
  );
}
