"use client";

import { useEffect, useId, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { EzcaterReconciliationDetail } from "@/lib/catering/ezcater-reconciliation-shared";

export function EzcaterReconciliationPanel({ leadId }: { leadId: string }) {
  const { t } = useTranslation();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ leadId: string; data: EzcaterReconciliationDetail | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/catering/pipeline/${leadId}/reconciliation`, { signal: controller.signal, redirect: "error" })
      .then(async (r) => {
        if (!r.ok) throw new Error("unavailable");
        return r.json() as Promise<{ reconciliation: EzcaterReconciliationDetail }>;
      })
      .then((r) => setState({ leadId, data: r.reconciliation }))
      .catch(() => { if (!controller.signal.aborted) setState({ leadId, data: null }); });
    return () => controller.abort();
  }, [leadId]);
  const current = state?.leadId === leadId ? state : null;
  if (!current) return null;
  const data = current.data;
  if (!data?.available) return <div role="status" className="mt-3 text-xs text-co-warning-text">
    {data?.locationConflict && <p>{t("catering.pipeline.transfer.conflict")}</p>}
    <p>{t("catering.reconciliation.unavailable" as TranslationKey)}</p>
  </div>;
  if (!data.reviews.length && !data.linkCount && !data.shadowRows && !data.locationConflict) return null;
  return <section className="mt-3 border-t border-co-border pt-2">
    {data.locationConflict && <p role="alert" className="text-xs text-co-warning-text">{t("catering.pipeline.transfer.conflict")}</p>}
    {data.reviews.length > 0 && <p role="status" className="text-xs text-co-warning-text">{t("catering.reconciliation.needs_review" as TranslationKey, { n: data.reviews.length })}</p>}
    <button type="button" className="min-h-[44px] w-full text-left text-sm font-bold text-co-text"
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      {t("catering.reconciliation.title" as TranslationKey, { n: data.reviews.length })}
    </button>
    {open && <div id={panelId} className="space-y-2 text-xs text-co-text-muted">
      <p>{t("catering.reconciliation.shadow_only" as TranslationKey)}</p>
      <p>{t("catering.reconciliation.counts" as TranslationKey, { links: data.linkCount, rows: data.shadowRows })}</p>
      <ul className="space-y-2">{data.reviews.map((review) => <li key={review.id}>
        <span className="font-bold">{review.source === "toast" ? "Toast" : "ezCater"}</span>{" · "}
        {t(reviewLabel(review.code))}{" · "}{t("catering.reconciliation.candidates" as TranslationKey, { n: review.candidateCount })}
      </li>)}</ul>
      {data.truncated && <p>{t("catering.reconciliation.truncated" as TranslationKey)}</p>}
    </div>}
  </section>;
}

function reviewLabel(code: string): TranslationKey {
  // Unknown server codes get an honest generic label, never raw provider text.
  const labels: Record<string, string> = {
    ambiguous_code: "normalized_code_ambiguous", unmatched_code: "normalized_code_unmatched",
    unmapped_item: "item_unmapped", name_candidate: "item_name_candidates",
    duplicate_lead: "duplicate_lead", recipe_unresolved: "recipe_unresolved",
    capture_missing: "capture_missing", missing_item_identity: "missing_item_identity",
    ambiguous_pos_guid: "ambiguous_pos_guid", options_unmapped: "options_unmapped",
  };
  return `catering.reconciliation.${labels[code] ?? "review_required"}` as TranslationKey;
}
