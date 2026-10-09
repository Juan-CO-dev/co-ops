"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { TranslationKey } from "@/lib/i18n/types";
import { STEP_UP_CODES, postCustomerJson } from "./customer-post";

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text";
const dangerButton = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-4 font-bold text-co-cta-text";

/** Level 9+ only (the page renders this nowhere else): an audited reveal, and delete-on-request. */
export function CustomerContactPanel({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [contact, setContact] = useState<{ emails: string[]; phones: string[] } | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [erased, setErased] = useState(false);
  const disabled = busy || refreshing;

  async function reveal() {
    setBusy(true); setError(null);
    try {
      if (await requestStepUp("A") !== "ok") return;
      let r = await postCustomerJson("/api/admin/customers", { operation: "reveal", customerId });
      if (!r.ok && STEP_UP_CODES.has(r.code ?? "") && await requestStepUp("A") === "ok") r = await postCustomerJson("/api/admin/customers", { operation: "reveal", customerId });
      if (!r.ok) { setError("customers.error.generic"); return; }
      setContact(r.body.contact as { emails: string[]; phones: string[] });
    } catch { setError("customers.error.generic"); } finally { setBusy(false); }
  }
  async function erase() {
    setBusy(true); setError(null);
    try {
      if (await requestStepUp("B") !== "ok") return;
      let r = await postCustomerJson("/api/admin/customers/confirm", { operation: "erase", customerId });
      if (!r.ok && STEP_UP_CODES.has(r.code ?? "") && await requestStepUp("B") === "ok") r = await postCustomerJson("/api/admin/customers/confirm", { operation: "erase", customerId });
      if (!r.ok) { setError("customers.error.generic"); return; }
      setContact(null); setErased(true);
      startTransition(() => router.refresh());
    } catch { setError("customers.error.generic"); } finally { setBusy(false); }
  }

  return <section className="co-card min-w-0 space-y-3 p-4" aria-busy={disabled}>
    <h2 className="text-lg font-bold text-co-text">{t("customers.contact.title")}</h2>
    <p className="text-sm text-co-text-muted">{t("customers.contact.hint")}</p>
    {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
    {erased && <p role="status" className="font-bold text-co-confirm-text">{t("customers.contact.erased")}</p>}
    {contact ? <dl className="grid min-w-0 gap-1 text-co-text">
      <dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("customers.contact.emails")}</dt>
      <dd className="break-all">{contact.emails.length ? contact.emails.join(", ") : t("customers.contact.none")}</dd>
      <dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("customers.contact.phones")}</dt>
      <dd className="break-all">{contact.phones.length ? contact.phones.join(", ") : t("customers.contact.none")}</dd>
    </dl> : !erased && <button type="button" className={button} disabled={disabled} onClick={() => void reveal()}>{t("customers.contact.reveal")}</button>}
    {!erased && <div className="space-y-2 border-t border-co-border pt-3">
      <label className="flex min-h-[44px] items-center gap-3 text-co-text">
        <input type="checkbox" aria-label={t("customers.erase.confirm")} className="h-5 w-5" checked={confirmErase} onChange={(e) => setConfirmErase(e.target.checked)} disabled={disabled} />
        {t("customers.erase.confirm")}
      </label>
      <button type="button" className={dangerButton} disabled={disabled || !confirmErase} onClick={() => void erase()}>{t("customers.erase.button")}</button>
    </div>}
  </section>;
}
