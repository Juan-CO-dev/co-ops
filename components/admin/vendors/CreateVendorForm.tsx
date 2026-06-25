"use client";

/**
 * CreateVendorForm — "Add vendor" modal. GM+ only (the parent only renders the
 * button for canManageFull); create is destructive → Tier B step-up.
 * Submit: requestStepUp("B") → POST /api/admin/vendors → close + router.refresh().
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, resolveErrorKey } from "./shared";

export function CreateVendorForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [orderingEmail, setOrderingEmail] = useState("");
  const [orderingUrl, setOrderingUrl] = useState("");
  const [orderingDays, setOrderingDays] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting || name.trim() === "") return;
    setErrorMsg(null);
    const stepUp = await requestStepUp("B");
    if (stepUp !== "ok") return;
    setSubmitting(true);
    const result = await postJson("/api/admin/vendors", {
      name: name.trim(),
      category: category.trim() || null,
      contact_person: contactPerson.trim() || null,
      contact_email: contactEmail.trim() || null,
      contact_phone: contactPhone.trim() || null,
      ordering_email: orderingEmail.trim() || null,
      ordering_url: orderingUrl.trim() || null,
      ordering_days: orderingDays.trim() || null,
      payment_terms: paymentTerms.trim() || null,
      account_number: accountNumber.trim() || null,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("admin.vendors.create.title")}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-co-text/40 p-4"
    >
      <div className="mt-8 w-full max-w-md rounded-xl border-2 border-co-border bg-co-surface p-5 shadow-lg">
        <h2 className="text-lg font-extrabold text-co-text">{t("admin.vendors.create.title")}</h2>

        <div className="mt-4 flex flex-col gap-4">
          <Field label={t("admin.vendors.field.name")} value={name} onChange={setName} />
          <Field label={t("admin.vendors.field.category")} value={category} onChange={setCategory} />
          <Field label={t("admin.vendors.field.contact_person")} value={contactPerson} onChange={setContactPerson} />
          <Field label={t("admin.vendors.field.contact_email")} value={contactEmail} onChange={setContactEmail} type="email" />
          <Field label={t("admin.vendors.field.contact_phone")} value={contactPhone} onChange={setContactPhone} type="tel" />
          <Field label={t("admin.vendors.field.ordering_email")} value={orderingEmail} onChange={setOrderingEmail} type="email" />
          <Field label={t("admin.vendors.field.ordering_url")} value={orderingUrl} onChange={setOrderingUrl} type="url" />
          <Field label={t("admin.vendors.field.ordering_days")} value={orderingDays} onChange={setOrderingDays} />
          <Field label={t("admin.vendors.field.payment_terms")} value={paymentTerms} onChange={setPaymentTerms} />
          <Field label={t("admin.vendors.field.account_number")} value={accountNumber} onChange={setAccountNumber} />
          <Field label={t("admin.vendors.field.notes")} value={notes} onChange={setNotes} multiline />

          {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("admin.vendors.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || name.trim() === ""}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("admin.vendors.create.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        />
      )}
    </label>
  );
}
