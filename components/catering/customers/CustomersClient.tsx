"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import type { CateringCustomer, CustomerDetail } from "@/lib/catering/customers";
import { postJson, resolveErrorKey } from "./shared";

interface LocationOpt {
  id: string;
  name: string;
}
interface Props {
  customers: CateringCustomer[];
  locations: LocationOpt[];
  actorLevel: number;
}

export function CustomersClient({ customers, locations, actorLevel }: Props) {
  const { t } = useTranslation();
  const canWrite = actorLevel >= 6;

  // Group by company (text rollup); customers with no company go last under a header.
  const groups = new Map<string, CateringCustomer[]>();
  for (const c of customers) {
    const key = c.company?.trim() || "";
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }
  const companyKeys = [...groups.keys()].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="mt-4 space-y-5">
      {canWrite && <AddCustomerRow locations={locations} />}

      {customers.length === 0 ? (
        <p className="text-sm text-co-text-muted">{t("catering.customers.empty")}</p>
      ) : (
        companyKeys.map((company) => (
          <section key={company || "__none__"} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">
              {company || t("catering.customers.no_company")}
            </h2>
            <div className="space-y-2">
              {(groups.get(company) ?? []).map((c) => (
                <CustomerRow key={c.id} customer={c} canWrite={canWrite} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function CustomerRow({ customer, canWrite }: { customer: CateringCustomer; canWrite: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="co-card p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left" aria-expanded={open}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-co-text">{customer.name}</span>
          {!customer.active && <span className="text-xs text-co-text-muted">({t("catering.customers.status.inactive")})</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-co-text-muted">
          {customer.contactPerson && <span>{customer.contactPerson}</span>}
          {customer.email && <span>{customer.email}</span>}
          {customer.phone && <span>{customer.phone}</span>}
        </div>
      </button>
      {open && <CustomerDetailPanel customer={customer} canWrite={canWrite} />}
    </div>
  );
}

function CustomerDetailPanel({ customer, canWrite }: { customer: CateringCustomer; canWrite: boolean }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/catering/customers/${customer.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CustomerDetail | null) => {
        if (alive && d) setDetail(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [customer.id]);

  const toggleActive = useCallback(async () => {
    setBusy(true);
    setErrorMsg(null);
    const res = await postJson(`/api/catering/customers/${customer.id}`, { active: !customer.active }, "PATCH");
    setBusy(false);
    if (res.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(res.code)));
  }, [customer.id, customer.active, router, t]);

  const saveEdit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const val = (k: string) => {
        const v = (fd.get(k) as string | null)?.trim();
        return v && v.length > 0 ? v : null;
      };
      const name = val("name");
      if (!name) {
        setErrorMsg(t("catering.customers.error.invalid_payload"));
        return;
      }
      setBusy(true);
      setErrorMsg(null);
      const res = await postJson(
        `/api/catering/customers/${customer.id}`,
        { name, company: val("company"), contactPerson: val("contactPerson"), email: val("email"), phone: val("phone"), notes: val("notes") },
        "PATCH",
      );
      setBusy(false);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else setErrorMsg(t(resolveErrorKey(res.code)));
    },
    [customer.id, router, t],
  );

  return (
    <div className="mt-3 border-t border-co-border pt-3 text-sm">
      {editing ? (
        <form onSubmit={saveEdit} className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={t("catering.customers.field.name")} name="name" defaultValue={customer.name} required />
            <Field label={t("catering.customers.field.company")} name="company" defaultValue={customer.company ?? ""} />
            <Field label={t("catering.customers.field.contact_person")} name="contactPerson" defaultValue={customer.contactPerson ?? ""} />
            <Field label={t("catering.customers.field.email")} name="email" defaultValue={customer.email ?? ""} />
            <Field label={t("catering.customers.field.phone")} name="phone" defaultValue={customer.phone ?? ""} />
          </div>
          <label className="block text-sm">
            <span className="text-co-text-muted">{t("catering.customers.field.notes")}</span>
            <textarea name="notes" rows={2} defaultValue={customer.notes ?? ""} className="mt-1 w-full rounded-md border border-co-border bg-co-surface p-2 text-co-text" />
          </label>
          {errorMsg && <p className="text-xs text-co-cta-text">{errorMsg}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-md bg-co-text px-3 py-1.5 text-xs font-semibold text-co-bg disabled:opacity-50">
              {t("catering.customers.save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md px-3 py-1.5 text-xs text-co-text-muted">
              {t("catering.customers.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          {customer.notes && <p className="text-xs text-co-text">{customer.notes}</p>}
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-co-text-muted">{t("catering.customers.history.leads")}</div>
              {detail && detail.leads.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-co-text">
                  {detail.leads.map((l) => (
                    <li key={l.id}>
                      {l.contactName} · {t(`catering.pipeline.stage.${l.stage}` as TranslationKey)}
                      {l.eventDate ? ` · ${l.eventDate}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-co-text-muted">{t("catering.customers.history.none")}</p>
              )}
            </div>
            <div>
              <div className="text-xs font-semibold text-co-text-muted">{t("catering.customers.history.orders")}</div>
              {detail && detail.orders.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-co-text">
                  {detail.orders.map((o) => (
                    <li key={o.id}>
                      {o.orderDate}
                      {o.amountCents != null ? ` · ${formatCents(o.amountCents, language)}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-co-text-muted">{t("catering.customers.history.none")}</p>
              )}
            </div>
          </div>
          {errorMsg && <p className="mt-2 text-xs text-co-cta-text">{errorMsg}</p>}
          {canWrite && (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setEditing(true)} className="rounded-md border border-co-border px-3 py-1 text-xs text-co-text">
                {t("catering.customers.edit")}
              </button>
              <button type="button" disabled={busy} onClick={() => void toggleActive()} className="rounded-md border border-co-border px-3 py-1 text-xs text-co-text disabled:opacity-50">
                {customer.active ? t("catering.customers.deactivate") : t("catering.customers.reactivate")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AddCustomerRow({ locations }: { locations: LocationOpt[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const val = (k: string) => {
        const v = (fd.get(k) as string | null)?.trim();
        return v && v.length > 0 ? v : null;
      };
      const name = val("name");
      if (!name) {
        setErrorMsg(t("catering.customers.error.invalid_payload"));
        return;
      }
      setBusy(true);
      setErrorMsg(null);
      const res = await postJson("/api/catering/customers", {
        name,
        company: val("company"),
        contactPerson: val("contactPerson"),
        email: val("email"),
        phone: val("phone"),
        primaryLocationId: val("primaryLocationId"),
        notes: val("notes"),
      });
      setBusy(false);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else setErrorMsg(t(resolveErrorKey(res.code)));
    },
    [router, t],
  );

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="co-card co-card-interactive px-4 py-2 text-sm font-semibold text-co-text">
        + {t("catering.customers.add_customer")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="co-card space-y-3 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("catering.customers.field.name")} name="name" required />
        <Field label={t("catering.customers.field.company")} name="company" />
        <Field label={t("catering.customers.field.contact_person")} name="contactPerson" />
        <Field label={t("catering.customers.field.email")} name="email" type="email" />
        <Field label={t("catering.customers.field.phone")} name="phone" />
        <label className="block text-sm">
          <span className="text-co-text-muted">{t("catering.customers.field.location")}</span>
          <select name="primaryLocationId" className="mt-1 w-full rounded-md border border-co-border bg-co-surface p-2 text-co-text">
            <option value="">{t("catering.customers.global")}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-co-text-muted">{t("catering.customers.field.notes")}</span>
          <textarea name="notes" rows={2} className="mt-1 w-full rounded-md border border-co-border bg-co-surface p-2 text-co-text" />
        </label>
      </div>
      {errorMsg && <p className="text-xs text-co-cta-text">{errorMsg}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-co-text px-4 py-2 text-sm font-semibold text-co-bg disabled:opacity-50">
          {t("catering.customers.add")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-4 py-2 text-sm text-co-text-muted">
          {t("catering.customers.cancel")}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-co-text-muted">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-co-border bg-co-surface p-2 text-co-text"
      />
    </label>
  );
}
