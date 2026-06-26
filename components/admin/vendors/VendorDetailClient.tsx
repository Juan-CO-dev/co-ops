"use client";

/**
 * VendorDetailClient — per-vendor edit surface (Vendor Directory v2, Slice A).
 *
 * Role-gated affordances (the API is the real gate; the UI hides/disables what
 * the viewer can't do):
 *   - Core card (name/category/payment terms/account number): editable MoO+ (≥8),
 *     read-only otherwise. Save → PATCH core (Tier B).
 *   - Notes card: editable GM+ (≥7). Save → PATCH notes (no step-up).
 *   - Contacts card: Add = AGM+ (≥6); Edit/Remove = GM+ (≥7). Remove is inline
 *     confirm; last_contact surfaced. (Tier A step-up.)
 *   - Ordering-details card: same shape; last_ordering_detail surfaced.
 *   - Deactivate / Reactivate: MoO+ (≥8). PATCH {active} (Tier B).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type {
  VendorView,
  CategoryView,
  OrderTypeView,
  VendorContact,
  VendorOrderingDetail,
} from "@/lib/admin/vendors";
import { VENDOR_COLOR_PALETTE } from "@/lib/admin/vendors";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey, ORDERING_METHODS } from "./shared";
import { MultiSelectChips } from "./MultiSelectChips";
import type { RegistryOption, SkuView } from "@/lib/admin/skus";
import type { SkuFormLocationOption } from "@/components/admin/skus/SkuForm";
import { VendorSkusCard } from "@/components/admin/skus/VendorSkusCard";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

type StepUp = (tier: "A" | "B") => Promise<"ok" | "cancelled">;

export function VendorDetailClient({
  vendor,
  categories,
  orderTypes,
  skus,
  skuLocations,
  skuPackFormats,
  skuMeasureUnits,
  actorLevel,
}: {
  vendor: VendorView;
  categories: CategoryView[];
  orderTypes: OrderTypeView[];
  skus: SkuView[];
  skuLocations: SkuFormLocationOption[];
  skuPackFormats: RegistryOption[];
  skuMeasureUnits: RegistryOption[];
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();

  const canEditCore = actorLevel >= 8; // MoO+
  const canEditClassification = actorLevel >= 7; // GM+
  const canEditSchedule = actorLevel >= 7; // GM+
  const canEditNotes = actorLevel >= 7; // GM+
  const canManage = actorLevel >= 7; // GM+ edit/remove
  const canAppend = actorLevel >= 6; // AGM+ append

  return (
    <div className="mt-5 flex flex-col gap-4">
      <CoreCard vendor={vendor} canEdit={canEditCore} requestStepUp={requestStepUp} />
      <ClassificationCard
        vendor={vendor}
        categories={categories}
        orderTypes={orderTypes}
        canEdit={canEditClassification}
        requestStepUp={requestStepUp}
      />
      <ScheduleCard vendor={vendor} canEdit={canEditSchedule} requestStepUp={requestStepUp} />
      <NotesCard vendor={vendor} canEdit={canEditNotes} />
      <ContactsCard
        vendorId={vendor.id}
        contacts={vendor.contacts}
        canAppend={canAppend}
        canManage={canManage}
        requestStepUp={requestStepUp}
      />
      <OrderingCard
        vendorId={vendor.id}
        details={vendor.orderingDetails}
        canAppend={canAppend}
        canManage={canManage}
        requestStepUp={requestStepUp}
      />
      <VendorSkusCard
        vendorId={vendor.id}
        skus={skus}
        locations={skuLocations}
        packFormats={skuPackFormats}
        measureUnits={skuMeasureUnits}
        actorLevel={actorLevel}
        canManage={canManage}
      />
      {actorLevel >= 8 ? <ActiveCard vendor={vendor} requestStepUp={requestStepUp} /> : null}
    </div>
  );
}

// ── Card chrome ───────────────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}

function PrimaryBtn({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function PlainBtn({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

// ── Core card (MoO+) ──────────────────────────────────────────────────────────
function CoreCard({
  vendor,
  canEdit,
  requestStepUp,
}: {
  vendor: VendorView;
  canEdit: boolean;
  requestStepUp: StepUp;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState(vendor.name);
  const [paymentTerms, setPaymentTerms] = useState(vendor.paymentTerms ?? "");
  const [accountNumber, setAccountNumber] = useState(vendor.accountNumber ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (submitting) return;
    setErrorMsg(null);
    setSaved(false);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/vendors/${vendor.id}`,
      {
        name: name.trim(),
        paymentTerms: paymentTerms.trim() || null,
        accountNumber: accountNumber.trim() || null,
      },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <Card title={t("admin.vendors.card.core")}>
      <div className="flex flex-col gap-3">
        <Labeled label={t("admin.vendors.field.name")}>
          <input className={fieldCls} value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.vendors.field.payment_terms")}>
          <input className={fieldCls} value={paymentTerms} disabled={!canEdit} onChange={(e) => setPaymentTerms(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.vendors.field.account_number")}>
          <input className={fieldCls} value={accountNumber} disabled={!canEdit} onChange={(e) => setAccountNumber(e.target.value)} />
        </Labeled>

        {!canEdit ? (
          <p className="text-xs italic text-co-text-muted">{t("admin.vendors.core.readonly_note")}</p>
        ) : null}
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        {saved ? <p className="text-sm text-co-gold-deep">{t("admin.vendors.saved")}</p> : null}

        {canEdit ? (
          <div className="flex justify-end">
            <PrimaryBtn label={t("admin.vendors.save")} disabled={submitting || !name.trim()} onClick={() => void save()} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ── Classification card (GM+): multi-select categories + order types ──────────
function ClassificationCard({
  vendor,
  categories,
  orderTypes,
  canEdit,
  requestStepUp,
}: {
  vendor: VendorView;
  categories: CategoryView[];
  orderTypes: OrderTypeView[];
  canEdit: boolean;
  requestStepUp: StepUp;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [categoryIds, setCategoryIds] = useState<Set<string>>(
    () => new Set(vendor.categories.map((c) => c.id)),
  );
  const [orderTypeIds, setOrderTypeIds] = useState<Set<string>>(
    () => new Set(vendor.orderTypes.map((o) => o.id)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (id: string) => {
    setSaved(false);
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Keep a vendor's currently-assigned options selectable even if they've since
  // been deactivated in the registry (union the registry list with current ids).
  const catOptions = [
    ...categories.map((c) => ({ id: c.id, label: c.label })),
    ...vendor.categories
      .filter((c) => !categories.some((x) => x.id === c.id))
      .map((c) => ({ id: c.id, label: c.label })),
  ];
  const otOptions = [
    ...orderTypes.map((o) => ({ id: o.id, label: o.label })),
    ...vendor.orderTypes
      .filter((o) => !orderTypes.some((x) => x.id === o.id))
      .map((o) => ({ id: o.id, label: o.label })),
  ];

  const canSave = canEdit && categoryIds.size >= 1 && orderTypeIds.size >= 1;

  const save = async () => {
    if (submitting || !canSave) return;
    setErrorMsg(null);
    setSaved(false);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    // Two endpoints (one per join). Send categories first, then order types;
    // surface the first failure.
    const catRes = await postJson(
      `/api/admin/vendors/${vendor.id}/categories`,
      { categoryIds: [...categoryIds] },
      "PUT",
    );
    if (!catRes.ok) {
      setSubmitting(false);
      setErrorMsg(t(resolveErrorKey(catRes.code)));
      return;
    }
    const otRes = await postJson(
      `/api/admin/vendors/${vendor.id}/order-types`,
      { orderTypeIds: [...orderTypeIds] },
      "PUT",
    );
    setSubmitting(false);
    if (otRes.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(otRes.code)));
    }
  };

  return (
    <Card title={t("admin.vendors.card.classification")}>
      <div className="flex flex-col gap-4">
        <div>
          <span className="text-sm font-bold text-co-text">{t("admin.vendors.field.categories")}</span>
          {canEdit ? (
            <p className="text-xs text-co-text-muted">{t("admin.vendors.field.categories_hint")}</p>
          ) : null}
          <MultiSelectChips
            options={catOptions}
            selectedIds={categoryIds}
            onToggle={toggle(setCategoryIds)}
            disabled={!canEdit}
            ariaLabel={t("admin.vendors.field.categories")}
          />
        </div>

        <div>
          <span className="text-sm font-bold text-co-text">{t("admin.vendors.field.order_types")}</span>
          {canEdit ? (
            <p className="text-xs text-co-text-muted">{t("admin.vendors.field.order_types_hint")}</p>
          ) : null}
          <MultiSelectChips
            options={otOptions}
            selectedIds={orderTypeIds}
            onToggle={toggle(setOrderTypeIds)}
            disabled={!canEdit}
            ariaLabel={t("admin.vendors.field.order_types")}
          />
        </div>

        {!canEdit ? (
          <p className="text-xs italic text-co-text-muted">{t("admin.vendors.classification.readonly_note")}</p>
        ) : null}
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        {saved ? <p className="text-sm text-co-gold-deep">{t("admin.vendors.saved")}</p> : null}

        {canEdit ? (
          <div className="flex justify-end">
            <PrimaryBtn label={t("admin.vendors.save")} disabled={submitting || !canSave} onClick={() => void save()} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ── Ordering-schedule card (GM+): order/delivery weekday strips + color ───────
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function DayStrip({
  label,
  selected,
  canEdit,
  onToggle,
  t,
}: {
  label: string;
  selected: Set<number>;
  canEdit: boolean;
  onToggle: (day: number) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div>
      <span className="text-sm font-bold text-co-text">{label}</span>
      <div className="mt-1 flex gap-1.5">
        {WEEKDAYS.map((d) => {
          const on = selected.has(d);
          const dayLabel = t(`admin.vendors.weekday.${d}` as TranslationKey);
          if (!canEdit) {
            // Read-only pip: filled when selected, empty otherwise.
            return (
              <span
                key={d}
                aria-label={dayLabel}
                className={
                  "inline-flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold " +
                  (on
                    ? "border-co-gold-deep bg-co-gold text-co-text"
                    : "border-co-border bg-co-surface text-co-text-muted")
                }
              >
                {dayLabel}
              </span>
            );
          }
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={dayLabel}
              onClick={() => onToggle(d)}
              className={
                "inline-flex h-11 w-11 items-center justify-center rounded-full border-2 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 " +
                (on
                  ? "border-co-gold-deep bg-co-gold text-co-text"
                  : "border-co-border bg-co-surface text-co-text-muted hover:border-co-text")
              }
            >
              {dayLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleCard({
  vendor,
  canEdit,
  requestStepUp,
}: {
  vendor: VendorView;
  canEdit: boolean;
  requestStepUp: StepUp;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [orderDays, setOrderDays] = useState<Set<number>>(() => new Set(vendor.orderDays));
  const [deliveryDays, setDeliveryDays] = useState<Set<number>>(() => new Set(vendor.deliveryDays));
  const [color, setColor] = useState<string | null>(vendor.color);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<number>>>) => (day: number) => {
    setSaved(false);
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const pickColor = (c: string | null) => {
    setSaved(false);
    setColor(c);
  };

  const save = async () => {
    if (submitting) return;
    setErrorMsg(null);
    setSaved(false);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/vendors/${vendor.id}/schedule`,
      {
        orderDays: [...orderDays].sort((a, b) => a - b),
        deliveryDays: [...deliveryDays].sort((a, b) => a - b),
        color,
      },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <Card title={t("admin.vendors.schedule.title")}>
      <div className="flex flex-col gap-4">
        <DayStrip
          label={t("admin.vendors.schedule.order_days")}
          selected={orderDays}
          canEdit={canEdit}
          onToggle={toggleIn(setOrderDays)}
          t={t}
        />
        <DayStrip
          label={t("admin.vendors.schedule.delivery_days")}
          selected={deliveryDays}
          canEdit={canEdit}
          onToggle={toggleIn(setDeliveryDays)}
          t={t}
        />

        <div>
          <span className="text-sm font-bold text-co-text">{t("admin.vendors.schedule.color")}</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {canEdit ? (
              <button
                type="button"
                aria-pressed={color === null}
                aria-label={t("admin.vendors.schedule.none")}
                onClick={() => pickColor(null)}
                className={
                  "inline-flex h-9 items-center rounded-full border-2 px-3 text-xs font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 " +
                  (color === null
                    ? "border-co-text bg-co-surface text-co-text"
                    : "border-co-border bg-co-surface text-co-text-muted hover:border-co-text")
                }
              >
                {t("admin.vendors.schedule.none")}
              </button>
            ) : color === null ? (
              <span className="text-sm text-co-text-muted">{t("admin.vendors.schedule.none")}</span>
            ) : null}

            {(canEdit ? VENDOR_COLOR_PALETTE : color ? [color] : []).map((c) => {
              const isSelected = color === c;
              if (!canEdit) {
                return (
                  <span
                    key={c}
                    aria-label={c}
                    className="inline-block h-9 w-9 rounded-full border-2 border-co-border"
                    style={{ backgroundColor: c }}
                  />
                );
              }
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={c}
                  onClick={() => pickColor(c)}
                  className={
                    "inline-block h-9 w-9 rounded-full border-2 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 " +
                    (isSelected ? "border-co-text ring-2 ring-co-text ring-offset-2 ring-offset-co-surface" : "border-co-border hover:border-co-text")
                  }
                  style={{ backgroundColor: c }}
                />
              );
            })}
          </div>
        </div>

        {!canEdit ? (
          <p className="text-xs italic text-co-text-muted">{t("admin.vendors.schedule.readonly_note")}</p>
        ) : null}
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        {saved ? <p className="text-sm text-co-gold-deep">{t("admin.vendors.saved")}</p> : null}

        {canEdit ? (
          <div className="flex justify-end">
            <PrimaryBtn label={t("admin.vendors.save")} disabled={submitting} onClick={() => void save()} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ── Notes card (GM+) ──────────────────────────────────────────────────────────
function NotesCard({ vendor, canEdit }: { vendor: VendorView; canEdit: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [notes, setNotes] = useState(vendor.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (submitting) return;
    setErrorMsg(null);
    setSaved(false);
    setSubmitting(true);
    const result = await postJson(`/api/admin/vendors/${vendor.id}`, { notes: notes.trim() || null }, "PATCH");
    setSubmitting(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <Card title={t("admin.vendors.card.notes")}>
      <div className="flex flex-col gap-3">
        <textarea
          className={fieldCls}
          rows={3}
          value={notes}
          disabled={!canEdit}
          onChange={(e) => setNotes(e.target.value)}
        />
        {!canEdit ? (
          <p className="text-xs italic text-co-text-muted">{t("admin.vendors.notes.readonly_note")}</p>
        ) : null}
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        {saved ? <p className="text-sm text-co-gold-deep">{t("admin.vendors.saved")}</p> : null}
        {canEdit ? (
          <div className="flex justify-end">
            <PrimaryBtn label={t("admin.vendors.save")} disabled={submitting} onClick={() => void save()} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ── Contacts card ─────────────────────────────────────────────────────────────
function ContactsCard({
  vendorId,
  contacts,
  canAppend,
  canManage,
  requestStepUp,
}: {
  vendorId: string;
  contacts: VendorContact[];
  canAppend: boolean;
  canManage: boolean;
  requestStepUp: StepUp;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Add-form fields.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Edit-form fields.
  const [eName, setEName] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [ePhone, setEPhone] = useState("");

  const resetAdd = () => {
    setName("");
    setEmail("");
    setPhone("");
    setAdding(false);
  };

  const beginEdit = (c: VendorContact) => {
    setEditingId(c.id);
    setEName(c.name);
    setEEmail(c.email ?? "");
    setEPhone(c.phone ?? "");
    setErrorMsg(null);
  };

  const add = async () => {
    if (busy || !name.trim()) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/vendors/${vendorId}/contacts`, {
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
    });
    setBusy(false);
    if (result.ok) {
      resetAdd();
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveEdit = async (id: string) => {
    if (busy || !eName.trim()) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/vendors/${vendorId}/contacts/${id}`,
      { name: eName.trim(), email: eEmail.trim() || null, phone: ePhone.trim() || null },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      setEditingId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const remove = async (id: string) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/vendors/${vendorId}/contacts/${id}`, {}, "DELETE");
    setBusy(false);
    if (result.ok) {
      setConfirmRemoveId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <Card title={t("admin.vendors.card.contacts")}>
      <ul className="flex flex-col gap-2">
        {contacts.map((c) => (
          <li key={c.id} className="rounded-lg border-2 border-co-border p-3">
            {editingId === c.id ? (
              <div className="flex flex-col gap-2">
                <input className={fieldCls} value={eName} onChange={(e) => setEName(e.target.value)} placeholder={t("admin.vendors.contact.name")} />
                <input className={fieldCls} type="email" value={eEmail} onChange={(e) => setEEmail(e.target.value)} placeholder={t("admin.vendors.contact.email")} />
                <input className={fieldCls} type="tel" value={ePhone} onChange={(e) => setEPhone(e.target.value)} placeholder={t("admin.vendors.contact.phone")} />
                <div className="flex justify-end gap-2">
                  <PlainBtn label={t("admin.vendors.cancel")} disabled={busy} onClick={() => setEditingId(null)} />
                  <PrimaryBtn label={t("admin.vendors.save")} disabled={busy || !eName.trim()} onClick={() => void saveEdit(c.id)} />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm text-co-text">
                  <div className="font-bold">{c.name}</div>
                  {c.email ? <div className="text-co-text-muted">{c.email}</div> : null}
                  {c.phone ? <div className="text-co-text-muted">{c.phone}</div> : null}
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    {confirmRemoveId === c.id ? (
                      <>
                        <PlainBtn label={t("admin.vendors.cancel")} disabled={busy} onClick={() => setConfirmRemoveId(null)} />
                        <PlainBtn label={t("admin.vendors.confirm_remove")} disabled={busy} onClick={() => void remove(c.id)} />
                      </>
                    ) : (
                      <>
                        <PlainBtn label={t("admin.vendors.edit")} onClick={() => beginEdit(c)} />
                        <PlainBtn label={t("admin.vendors.remove")} onClick={() => setConfirmRemoveId(c.id)} />
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>

      {errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null}

      {canAppend ? (
        adding ? (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border-2 border-dashed border-co-border p-3">
            <input className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("admin.vendors.contact.name")} />
            <input className={fieldCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("admin.vendors.contact.email")} />
            <input className={fieldCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("admin.vendors.contact.phone")} />
            <div className="flex justify-end gap-2">
              <PlainBtn label={t("admin.vendors.cancel")} disabled={busy} onClick={resetAdd} />
              <PrimaryBtn label={t("admin.vendors.add")} disabled={busy || !name.trim()} onClick={() => void add()} />
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <PlainBtn label={t("admin.vendors.add_contact")} onClick={() => setAdding(true)} />
          </div>
        )
      ) : null}
    </Card>
  );
}

// ── Ordering-details card ─────────────────────────────────────────────────────
function OrderingCard({
  vendorId,
  details,
  canAppend,
  canManage,
  requestStepUp,
}: {
  vendorId: string;
  details: VendorOrderingDetail[];
  canAppend: boolean;
  canManage: boolean;
  requestStepUp: StepUp;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [method, setMethod] = useState<string>("email");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [eMethod, setEMethod] = useState<string>("email");
  const [eValue, setEValue] = useState("");
  const [eLabel, setELabel] = useState("");

  const resetAdd = () => {
    setMethod("email");
    setValue("");
    setLabel("");
    setAdding(false);
  };

  const beginEdit = (d: VendorOrderingDetail) => {
    setEditingId(d.id);
    setEMethod(d.method);
    setEValue(d.value);
    setELabel(d.label ?? "");
    setErrorMsg(null);
  };

  const methodLabel = (m: string) => t(`admin.vendors.ordering.method.${m}` as TranslationKey);

  const add = async () => {
    if (busy || !value.trim()) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/vendors/${vendorId}/ordering-details`, {
      method,
      value: value.trim(),
      label: label.trim() || null,
    });
    setBusy(false);
    if (result.ok) {
      resetAdd();
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveEdit = async (id: string) => {
    if (busy || !eValue.trim()) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/vendors/${vendorId}/ordering-details/${id}`,
      { method: eMethod, value: eValue.trim(), label: eLabel.trim() || null },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      setEditingId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const remove = async (id: string) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/vendors/${vendorId}/ordering-details/${id}`, {}, "DELETE");
    setBusy(false);
    if (result.ok) {
      setConfirmRemoveId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const methodSelect = (val: string, onChange: (v: string) => void) => (
    <select className={fieldCls} value={val} onChange={(e) => onChange(e.target.value)}>
      {ORDERING_METHODS.map((m) => (
        <option key={m} value={m}>
          {methodLabel(m)}
        </option>
      ))}
    </select>
  );

  return (
    <Card title={t("admin.vendors.card.ordering")}>
      <ul className="flex flex-col gap-2">
        {details.map((d) => (
          <li key={d.id} className="rounded-lg border-2 border-co-border p-3">
            {editingId === d.id ? (
              <div className="flex flex-col gap-2">
                {methodSelect(eMethod, setEMethod)}
                <input className={fieldCls} value={eValue} onChange={(e) => setEValue(e.target.value)} placeholder={t("admin.vendors.ordering.value")} />
                <input className={fieldCls} value={eLabel} onChange={(e) => setELabel(e.target.value)} placeholder={t("admin.vendors.ordering.label")} />
                <div className="flex justify-end gap-2">
                  <PlainBtn label={t("admin.vendors.cancel")} disabled={busy} onClick={() => setEditingId(null)} />
                  <PrimaryBtn label={t("admin.vendors.save")} disabled={busy || !eValue.trim()} onClick={() => void saveEdit(d.id)} />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm text-co-text">
                  <div className="font-bold">
                    {methodLabel(d.method)}
                    {d.label ? <span className="font-normal text-co-text-muted"> · {d.label}</span> : null}
                  </div>
                  <div className="text-co-text-muted">{d.value}</div>
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    {confirmRemoveId === d.id ? (
                      <>
                        <PlainBtn label={t("admin.vendors.cancel")} disabled={busy} onClick={() => setConfirmRemoveId(null)} />
                        <PlainBtn label={t("admin.vendors.confirm_remove")} disabled={busy} onClick={() => void remove(d.id)} />
                      </>
                    ) : (
                      <>
                        <PlainBtn label={t("admin.vendors.edit")} onClick={() => beginEdit(d)} />
                        <PlainBtn label={t("admin.vendors.remove")} onClick={() => setConfirmRemoveId(d.id)} />
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>

      {errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null}

      {canAppend ? (
        adding ? (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border-2 border-dashed border-co-border p-3">
            {methodSelect(method, setMethod)}
            <input className={fieldCls} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("admin.vendors.ordering.value")} />
            <input className={fieldCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("admin.vendors.ordering.label")} />
            <div className="flex justify-end gap-2">
              <PlainBtn label={t("admin.vendors.cancel")} disabled={busy} onClick={resetAdd} />
              <PrimaryBtn label={t("admin.vendors.add")} disabled={busy || !value.trim()} onClick={() => void add()} />
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <PlainBtn label={t("admin.vendors.add_ordering")} onClick={() => setAdding(true)} />
          </div>
        )
      ) : null}
    </Card>
  );
}

// ── Active card (MoO+) ────────────────────────────────────────────────────────
function ActiveCard({ vendor, requestStepUp }: { vendor: VendorView; requestStepUp: StepUp }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/vendors/${vendor.id}`, { active: !vendor.active }, "PATCH");
    setBusy(false);
    if (result.ok) {
      setConfirming(false);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <Card title={t("admin.vendors.card.status")}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-co-text">
          {vendor.active ? t("admin.vendors.status.is_active") : t("admin.vendors.status.is_inactive")}
        </p>
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        {confirming ? (
          <div className="flex items-center justify-end gap-2">
            <PlainBtn label={t("admin.vendors.cancel")} disabled={busy} onClick={() => setConfirming(false)} />
            <PrimaryBtn
              label={vendor.active ? t("admin.vendors.deactivate") : t("admin.vendors.reactivate")}
              disabled={busy}
              onClick={() => void toggle()}
            />
          </div>
        ) : (
          <div className="flex justify-end">
            <PlainBtn
              label={vendor.active ? t("admin.vendors.deactivate") : t("admin.vendors.reactivate")}
              onClick={() => setConfirming(true)}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
