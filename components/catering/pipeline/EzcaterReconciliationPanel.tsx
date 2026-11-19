"use client";

import { useEffect, useId, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { EzcaterReconciliationDetail } from "@/lib/catering/ezcater-reconciliation-shared";

export function EzcaterReconciliationPanel({ leadId }: { leadId: string }) {
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
  return <EzcaterReconciliationView data={current.data} panelId={panelId} open={open} onToggle={() => setOpen(!open)} />;
}

/** The panel as rendered for one answer (null = the request failed). Exported for the render tests. */
export function EzcaterReconciliationView({ data, panelId, open, onToggle }: {
  data: EzcaterReconciliationDetail | null; panelId: string; open: boolean; onToggle: () => void;
}) {
  const { t } = useTranslation();
  if (!data?.available) return <div role="status" className="mt-3 text-xs text-co-warning-text">
    {data?.manualLocation && <p className="text-co-text-muted">{t("catering.pipeline.transfer.manual_info", data.manualLocation)}</p>}
    {data?.locationConflict && <p>{t("catering.pipeline.transfer.conflict")}</p>}
    <p>{t("catering.reconciliation.unavailable" as TranslationKey)}</p>
  </div>;
  // Fix round 2 (review PORTAL3-r2 P2 #2): a failed conflict read is UNKNOWN, never zero. It is said, and it keeps the
  // panel on screen; only a missing 0347 (not_installed) or no ezCater order shows nothing.
  const house = data.houseConflicts;
  const houseCount = house?.state === "known" ? house.count : 0;
  const houseUnknown = house?.state === "unavailable";
  if (!data.reviews.length && !data.linkCount && !data.shadowRows && !data.locationConflict && !data.manualLocation && !houseCount && !houseUnknown) return null;
  return <section className="mt-3 border-t border-co-border pt-2">
    {data.manualLocation && <p className="text-xs text-co-text-muted">{t("catering.pipeline.transfer.manual_info", data.manualLocation)}</p>}
    {data.locationConflict && <p role="alert" className="text-xs text-co-warning-text">{t("catering.pipeline.transfer.conflict")}</p>}
    {houseCount > 0 && <p role="status" className="text-xs text-co-warning-text">{t("catering.reconciliation.house_conflicts", { n: houseCount })}</p>}
    {houseUnknown && <p role="status" className="text-xs text-co-warning-text">{t("catering.reconciliation.house_conflicts_unavailable")}</p>}
    {data.reviews.length > 0 && <p role="status" className="text-xs text-co-warning-text">{t("catering.reconciliation.needs_review" as TranslationKey, { n: data.reviews.length })}</p>}
    <button type="button" className="min-h-[44px] w-full text-left text-sm font-bold text-co-text"
      aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
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
