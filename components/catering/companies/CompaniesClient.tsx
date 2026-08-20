"use client";

/**
 * CompaniesClient — catering company accounts (the identity model).
 *
 * List + create + a detail panel that manages corporate auto-attribution domains and shows
 * the contacts that roll up to the account (with a hand-attach-by-email affordance for
 * personal-email contacts that can't auto-attribute). Mirrors the customers/quotes surfaces.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { CateringCompany, CompanyDomain, CompanyContact } from "@/lib/catering/companies";
import { postJson, resolveErrorKey } from "./shared";

const WRITE_MIN = 6;

export interface CompaniesClientProps {
  companies: CateringCompany[];
  actorLevel: number;
}

export function CompaniesClient({ companies, actorLevel }: CompaniesClientProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const canWrite = actorLevel >= WRITE_MIN;
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="mt-4 flex flex-col gap-3">
      {canWrite && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start inline-flex min-h-[44px] items-center justify-center rounded-xl bg-co-text px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-co-cta shadow-sm transition hover:bg-co-text/90"
        >
          {t("catering.companies.new")}
        </button>
      )}
      {adding && <AddCompanyForm onDone={() => { setAdding(false); router.refresh(); }} onCancel={() => setAdding(false)} />}

      {companies.length === 0 && !adding ? (
        <p className="co-card p-6 text-sm text-co-text-muted">{t("catering.companies.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {companies.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(openId === c.id ? null : c.id)}
                className="co-card-interactive flex w-full items-center justify-between gap-3 p-4 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-co-text">{c.name}</span>
                  {!c.active && <span className="text-xs text-co-text-dim">{t("catering.companies.inactive")}</span>}
                </span>
                {c.claimedByCustomerId && (
                  <span className="shrink-0 rounded-full border-2 border-co-success/40 bg-co-success/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-co-confirm-text">
                    {t("catering.companies.claimed")}
                  </span>
                )}
              </button>
              {openId === c.id && <CompanyDetailPanel id={c.id} canWrite={canWrite} onChange={() => router.refresh()} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddCompanyForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const submit = async () => {
    if (!name.trim()) { setErrorKey("catering.companies.error.invalid_payload"); return; }
    setBusy(true);
    setErrorKey(null);
    const domains = domain.trim() ? [domain.trim()] : [];
    const res = await postJson("/api/catering/companies", { name: name.trim(), domains }, "POST");
    setBusy(false);
    if (res.ok) onDone();
    else setErrorKey(resolveErrorKey(res.code));
  };

  return (
    <div className="co-card flex flex-col gap-3 p-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.companies.field.name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.companies.field.domain")}</span>
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text" />
        <span className="text-xs text-co-text-dim">{t("catering.companies.domain_hint")}</span>
      </label>
      {errorKey && <p className="text-sm font-semibold text-co-cta-text">{t(errorKey)}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-co-text px-5 py-2 text-sm font-bold uppercase tracking-[0.12em] text-co-cta disabled:opacity-50">
          {busy ? t("catering.companies.saving") : t("catering.companies.create")}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border-2 border-co-border-2 bg-co-surface px-5 py-2 text-sm font-semibold text-co-text-muted">
          {t("catering.companies.cancel")}
        </button>
      </div>
    </div>
  );
}

interface Detail {
  company: CateringCompany;
  domains: CompanyDomain[];
  contacts: CompanyContact[];
}

function CompanyDetailPanel({ id, canWrite, onChange }: { id: string; canWrite: boolean; onChange: () => void }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState("");
  const [attachEmail, setAttachEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/catering/companies/${id}`, { redirect: "manual" });
      if (r.ok) setDetail((await r.json()) as Detail);
      else setErrorKey("catering.companies.error.generic");
    } catch {
      setErrorKey("catering.companies.error.generic");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const mutate = async (body: unknown) => {
    setBusy(true);
    setErrorKey(null);
    const res = await postJson(`/api/catering/companies/${id}`, body, "PATCH");
    setBusy(false);
    if (res.ok) {
      await load();
      onChange();
      return true;
    }
    setErrorKey(resolveErrorKey(res.code));
    return false;
  };

  if (loading) return <p className="px-4 py-3 text-sm text-co-text-muted">{t("catering.companies.loading")}</p>;
  if (!detail) return <p className="px-4 py-3 text-sm font-semibold text-co-cta-text">{t(errorKey ?? "catering.companies.error.generic")}</p>;

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl border-2 border-co-border-2 bg-co-surface p-4">
      {/* Domains */}
      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.companies.domains")}</h3>
        {detail.domains.length === 0 ? (
          <p className="text-sm text-co-text-muted">{t("catering.companies.no_domains")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {detail.domains.map((d) => (
              <li key={d.id} className="inline-flex items-center gap-2 rounded-full border-2 border-co-border-2 bg-co-bg px-3 py-1 text-sm text-co-text">
                {d.domain}
                {canWrite && (
                  <button type="button" onClick={() => void mutate({ removeDomainId: d.id })} disabled={busy} aria-label={t("catering.companies.remove_domain")} className="text-co-text-dim hover:text-co-cta-text">×</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <div className="mt-2 flex gap-2">
            <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="acme.com" className="min-h-[40px] flex-1 rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text" />
            <button type="button" disabled={busy || !newDomain.trim()} onClick={async () => { if (await mutate({ addDomain: newDomain.trim() })) setNewDomain(""); }} className="inline-flex min-h-[40px] items-center rounded-lg bg-co-text px-4 text-xs font-bold uppercase tracking-wide text-co-cta disabled:opacity-50">
              {t("catering.companies.add_domain")}
            </button>
          </div>
        )}
      </div>

      {/* Contacts */}
      <div className="border-t-2 border-co-border pt-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.companies.contacts")}</h3>
        {detail.contacts.length === 0 ? (
          <p className="text-sm text-co-text-muted">{t("catering.companies.no_contacts")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-co-text">{c.name}</span>
                <span className="text-xs text-co-text-dim">{c.email}</span>
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <div className="mt-2 flex gap-2">
            <input type="email" value={attachEmail} onChange={(e) => setAttachEmail(e.target.value)} placeholder={t("catering.companies.attach_placeholder")} className="min-h-[40px] flex-1 rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text" />
            <button type="button" disabled={busy || !attachEmail.trim()} onClick={async () => { if (await mutate({ attachContactEmail: attachEmail.trim() })) setAttachEmail(""); }} className="inline-flex min-h-[40px] items-center rounded-lg border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold uppercase tracking-wide text-co-text disabled:opacity-50">
              {t("catering.companies.attach")}
            </button>
          </div>
        )}
        <p className="mt-1 text-xs text-co-text-dim">{t("catering.companies.attach_hint")}</p>
      </div>

      {errorKey && <p className="text-sm font-semibold text-co-cta-text">{t(errorKey)}</p>}
    </div>
  );
}
