"use client";

/**
 * VendorListClient — list of vendors (name + category badge + active badge,
 * linking to the detail page) plus an "Add vendor" affordance for GM+ (≥7).
 *
 * Create requires BOTH a first contact and a first ordering detail (the lib
 * seeds them in the same call to satisfy min-1 each), so the add form collects
 * core fields + first contact + first ordering detail. Create is Tier B
 * step-up. On success → navigate to the new vendor.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { VendorView, CategoryView, OrderTypeView } from "@/lib/admin/vendors";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey, ORDERING_METHODS } from "./shared";
import { MultiSelectChips } from "./MultiSelectChips";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

export function VendorListClient({
  vendors,
  categories,
  orderTypes,
  actorLevel,
}: {
  vendors: VendorView[];
  categories: CategoryView[];
  orderTypes: OrderTypeView[];
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [creating, setCreating] = useState(false);

  const canAdd = actorLevel >= 7; // GM+

  return (
    <div className="mt-5">
      <div className="flex items-center justify-end">
        {canAdd ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {t("admin.vendors.create")}
          </button>
        ) : null}
      </div>

      {vendors.length === 0 ? (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {t("admin.vendors.empty")}
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map((v) => (
            <VendorCard key={v.id} vendor={v} t={t} />
          ))}
        </div>
      )}

      {creating ? (
        <AddVendorForm
          categories={categories}
          orderTypes={orderTypes}
          requestStepUp={requestStepUp}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            router.push(`/admin/vendors/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

/** A clickable vendor card — whole card links to the detail/edit page. Shows
 *  classification chips, contacts/ordering counts, and a compact weekly
 *  schedule. Inactive vendors render muted but stay clickable. */
function VendorCard({
  vendor: v,
  t,
}: {
  vendor: VendorView;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const firstContact = v.contacts[0];
  const hasSchedule = v.orderDays.length > 0 || v.deliveryDays.length > 0;

  return (
    <a
      href={`/admin/vendors/${v.id}`}
      className={
        "flex flex-col gap-3 rounded-2xl border-2 border-co-border bg-co-surface p-4 transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 " +
        (v.active ? "" : "opacity-60")
      }
    >
      {/* Header: color dot + name + active/inactive badge */}
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-base font-bold leading-tight text-co-text">
          {v.color ? (
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: v.color }}
            />
          ) : null}
          {v.name}
        </span>
        <span
          className={
            "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] " +
            (v.active ? "bg-co-gold/20 text-co-gold-deep" : "bg-co-text/10 text-co-text-muted")
          }
        >
          {v.active ? t("admin.vendors.status.active") : t("admin.vendors.status.inactive")}
        </span>
      </div>

      {/* Classification chips: order types (gold) + categories (outline) */}
      {v.orderTypes.length > 0 || v.categories.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {v.orderTypes.map((o) => (
            <span
              key={`o-${o.id}`}
              className="inline-flex items-center rounded-full bg-co-gold/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-gold-deep"
            >
              {o.label}
            </span>
          ))}
          {v.categories.map((c) => (
            <span
              key={`c-${c.id}`}
              className="inline-flex items-center rounded-full border-2 border-co-border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted"
            >
              {c.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* Contacts + ordering counts */}
      <div className="flex flex-col gap-1 text-sm">
        {v.contacts.length > 0 ? (
          <span className="text-co-text-muted">
            <span className="font-bold text-co-text">
              {t("admin.vendors.card.contacts_count", { count: v.contacts.length })}
            </span>
            {firstContact ? <> · {firstContact.name}</> : null}
          </span>
        ) : (
          <span className="font-bold text-co-cta">{t("admin.vendors.card.no_contacts")}</span>
        )}
        {v.orderingDetails.length > 0 ? (
          <span className="font-bold text-co-text">
            {t("admin.vendors.card.ordering_count", { count: v.orderingDetails.length })}
          </span>
        ) : (
          <span className="font-bold text-co-cta">{t("admin.vendors.card.no_ordering")}</span>
        )}
      </div>

      {/* Compact weekly schedule */}
      {hasSchedule ? (
        <div className="flex flex-col gap-1.5">
          <ScheduleStrip
            label={t("admin.vendors.card.order")}
            days={v.orderDays}
            t={t}
            tone="order"
          />
          <ScheduleStrip
            label={t("admin.vendors.card.delivery")}
            days={v.deliveryDays}
            t={t}
            tone="delivery"
          />
        </div>
      ) : (
        <span className="text-xs text-co-text-muted">{t("admin.vendors.card.no_schedule")}</span>
      )}
    </a>
  );
}

/** A single weekly row of S M T W T F S pips, filled for the selected days. */
function ScheduleStrip({
  label,
  days,
  t,
  tone,
}: {
  label: string;
  days: number[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  tone: "order" | "delivery";
}) {
  const selected = new Set(days);
  const fill = tone === "order" ? "bg-co-gold text-co-text" : "bg-co-text text-co-surface";
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-[11px] font-bold uppercase tracking-[0.06em] text-co-text-muted">
        {label}
      </span>
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4, 5, 6].map((d) => {
          const on = selected.has(d);
          return (
            <span
              key={d}
              className={
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold " +
                (on ? fill : "bg-co-text/10 text-co-text-muted")
              }
            >
              {t(`admin.vendors.weekday.${d}` as TranslationKey)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function AddVendorForm({
  categories,
  orderTypes,
  requestStepUp,
  onClose,
  onCreated,
}: {
  categories: CategoryView[];
  orderTypes: OrderTypeView[];
  requestStepUp: (tier: "A" | "B") => Promise<"ok" | "cancelled">;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set());
  const [orderTypeIds, setOrderTypeIds] = useState<Set<string>>(new Set());
  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [paymentTerms, setPaymentTerms] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [method, setMethod] = useState<string>("email");
  const [orderingValue, setOrderingValue] = useState("");
  const [orderingLabel, setOrderingLabel] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canSubmit =
    name.trim() !== "" &&
    categoryIds.size >= 1 &&
    orderTypeIds.size >= 1 &&
    contactName.trim() !== "" &&
    orderingValue.trim() !== "";

  const submit = async () => {
    if (submitting || !canSubmit) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson("/api/admin/vendors", {
      name: name.trim(),
      categoryIds: [...categoryIds],
      orderTypeIds: [...orderTypeIds],
      paymentTerms: paymentTerms.trim() || null,
      accountNumber: accountNumber.trim() || null,
      notes: notes.trim() || null,
      firstContact: {
        name: contactName.trim(),
        email: contactEmail.trim() || null,
        phone: contactPhone.trim() || null,
      },
      firstOrdering: {
        method,
        value: orderingValue.trim(),
        label: orderingLabel.trim() || null,
      },
    });
    setSubmitting(false);
    if (result.ok) {
      const id = typeof result.data.id === "string" ? result.data.id : null;
      if (id) onCreated(id);
      else onClose();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-co-text/40 p-4"
    >
      <div className="mt-8 mb-8 w-full max-w-md rounded-xl border-2 border-co-border bg-co-surface p-5 shadow-lg">
        <h2 className="text-base font-extrabold text-co-text">{t("admin.vendors.create.title")}</h2>

        <div className="mt-4 flex flex-col gap-3">
          <Labeled label={t("admin.vendors.field.name")}>
            <input className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Labeled>

          <div>
            <span className="text-sm font-bold text-co-text">{t("admin.vendors.field.categories")}</span>
            <p className="text-xs text-co-text-muted">{t("admin.vendors.field.categories_hint")}</p>
            <MultiSelectChips
              options={categories.map((c) => ({ id: c.id, label: c.label }))}
              selectedIds={categoryIds}
              onToggle={toggleIn(setCategoryIds)}
              ariaLabel={t("admin.vendors.field.categories")}
            />
          </div>

          <div>
            <span className="text-sm font-bold text-co-text">{t("admin.vendors.field.order_types")}</span>
            <p className="text-xs text-co-text-muted">{t("admin.vendors.field.order_types_hint")}</p>
            <MultiSelectChips
              options={orderTypes.map((o) => ({ id: o.id, label: o.label }))}
              selectedIds={orderTypeIds}
              onToggle={toggleIn(setOrderTypeIds)}
              ariaLabel={t("admin.vendors.field.order_types")}
            />
          </div>

          <Labeled label={t("admin.vendors.field.payment_terms")}>
            <input className={fieldCls} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
          </Labeled>

          <Labeled label={t("admin.vendors.field.account_number")}>
            <input className={fieldCls} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
          </Labeled>

          <Labeled label={t("admin.vendors.field.notes")}>
            <textarea className={fieldCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Labeled>

          <Fieldset legend={t("admin.vendors.create.first_contact")}>
            <Labeled label={t("admin.vendors.contact.name")}>
              <input className={fieldCls} value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Labeled>
            <Labeled label={t("admin.vendors.contact.email")}>
              <input type="email" className={fieldCls} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </Labeled>
            <Labeled label={t("admin.vendors.contact.phone")}>
              <input type="tel" className={fieldCls} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </Labeled>
          </Fieldset>

          <Fieldset legend={t("admin.vendors.create.first_ordering")}>
            <Labeled label={t("admin.vendors.ordering.method")}>
              <select className={fieldCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                {ORDERING_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`admin.vendors.ordering.method.${m}` as TranslationKey)}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label={t("admin.vendors.ordering.value")}>
              <input className={fieldCls} value={orderingValue} onChange={(e) => setOrderingValue(e.target.value)} />
            </Labeled>
            <Labeled label={t("admin.vendors.ordering.label")}>
              <input className={fieldCls} value={orderingLabel} onChange={(e) => setOrderingLabel(e.target.value)} />
            </Labeled>
          </Fieldset>

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
            disabled={submitting || !canSubmit}
            onClick={() => void submit()}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("admin.vendors.create.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border-2 border-co-border p-3">
      <legend className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted">
        {legend}
      </legend>
      <div className="flex flex-col gap-3">{children}</div>
    </fieldset>
  );
}
