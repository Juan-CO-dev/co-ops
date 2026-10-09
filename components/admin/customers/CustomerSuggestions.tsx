"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { SuggestionDto } from "@/lib/customers/customers";
import { STEP_UP_CODES, postCustomerJson } from "./customer-post";

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text";
const quiet = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 font-bold text-co-text";

const ERRORS: Record<string, TranslationKey> = {
  suggestion_already_decided: "customers.error.decided",
  location_forbidden: "customers.error.role",
  role_insufficient: "customers.error.role",
  merge_erased: "customers.error.erased",
};

/** "Likely same person" — a manager confirms (keeps one profile) or says they are different. Never automatic. */
export function CustomerSuggestions({ suggestions }: { suggestions: SuggestionDto[] }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const disabled = busy || refreshing;

  async function merge(suggestionId: string, keep: string) {
    setBusy(true); setError(null);
    try {
      if (await requestStepUp("B") !== "ok") return;
      let r = await postCustomerJson("/api/admin/customers/confirm", { operation: "merge", suggestionId, keep });
      if (!r.ok && STEP_UP_CODES.has(r.code ?? "") && await requestStepUp("B") === "ok") r = await postCustomerJson("/api/admin/customers/confirm", { operation: "merge", suggestionId, keep });
      if (!r.ok) { setError(ERRORS[r.code ?? ""] ?? "customers.error.generic"); return; }
      startTransition(() => router.refresh());
    } catch { setError("customers.error.generic"); } finally { setBusy(false); }
  }
  async function dismiss(suggestionId: string) {
    setBusy(true); setError(null);
    try {
      if (await requestStepUp("A") !== "ok") return;
      let r = await postCustomerJson("/api/admin/customers", { operation: "dismiss", suggestionId });
      if (!r.ok && STEP_UP_CODES.has(r.code ?? "") && await requestStepUp("A") === "ok") r = await postCustomerJson("/api/admin/customers", { operation: "dismiss", suggestionId });
      if (!r.ok) { setError(ERRORS[r.code ?? ""] ?? "customers.error.generic"); return; }
      startTransition(() => router.refresh());
    } catch { setError("customers.error.generic"); } finally { setBusy(false); }
  }

  const reason = (r: string) => {
    const key = `customers.reason.${r}` as TranslationKey;
    return ["same_full_name", "similar_name", "shared_card", "same_shop", "email_phone_split"].includes(r) ? t(key) : r;
  };

  return <section className="co-card min-w-0 space-y-3 p-4" aria-busy={disabled}>
    <h2 className="text-lg font-bold text-co-text">{t("customers.suggestions.title", { count: suggestions.length })}</h2>
    <p className="text-sm text-co-text-muted">{t("customers.suggestions.hint")}</p>
    {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
    {suggestions.length === 0 && <p className="text-sm text-co-text-muted">{t("customers.suggestions.none")}</p>}
    <ul className="space-y-3">{suggestions.map((s) => <li key={s.id} className="min-w-0 space-y-2 rounded-xl border border-co-border p-3">
      <p className="font-bold text-co-text">{t("customers.suggestions.pair", { a: s.a.name ?? t("customers.unnamed"), b: s.b.name ?? t("customers.unnamed") })}</p>
      <p className="text-sm text-co-text-muted">{t("customers.suggestions.confidence", { pct: Math.round(s.confidence * 100) })} · {s.reasons.map(reason).join(" · ")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={disabled} onClick={() => void merge(s.id, s.a.id)}>{t("customers.suggestions.keep", { name: s.a.name ?? t("customers.unnamed") })}</button>
        <button type="button" className={button} disabled={disabled} onClick={() => void merge(s.id, s.b.id)}>{t("customers.suggestions.keep", { name: s.b.name ?? t("customers.unnamed") })}</button>
        <button type="button" className={quiet} disabled={disabled} onClick={() => void dismiss(s.id)}>{t("customers.suggestions.different")}</button>
      </div>
    </li>)}</ul>
  </section>;
}
