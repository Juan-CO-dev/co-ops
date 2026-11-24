"use client";

/**
 * The pipeline's refund prompt (catering refunds, migration 0357). DARK unless the page wrapped the board in
 * <RefundsSwitch on> (the server switch CATERING_REFUNDS): off = nothing renders and no request is made.
 *
 * On a LOST lead (or while "Lost" is being confirmed) it asks the server whether the order holds money taken through
 * the app that can still be refunded, and if so names the amount and links to the quote's refund form
 * (/catering/quotes?quote=<id>&refund=lost). The refund itself is made there, behind the confirm tap and the password.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";

const RefundsOn = createContext(false);

export function RefundsSwitch({ on, children }: { on: boolean; children: ReactNode }) {
  return <RefundsOn.Provider value={on}>{children}</RefundsOn.Provider>;
}

export function useRefundsEnabled(): boolean {
  return useContext(RefundsOn);
}

export function LeadRefundBanner({ leadId, phase }: { leadId: string; phase: "lost" | "confirming_lost" }) {
  const enabled = useRefundsEnabled();
  const { t, language } = useTranslation();
  const [rows, setRows] = useState<{ leadId: string; failed: boolean; quotes: Array<{ quoteId: string; refundableCents: number; paidCents: number }> } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetch(`/api/catering/pipeline/${leadId}/refunds`, { redirect: "manual" })
      .then((r) => (r.ok ? (r.json() as Promise<{ quotes?: Array<{ quoteId: string; refundableCents: number; paidCents: number }> }>) : null))
      .then((d) => {
        // A failed read is NOT "nothing to refund" (review r4): it is said, with a way to try again.
        if (alive) setRows({ leadId, failed: d === null, quotes: d?.quotes ?? [] });
      })
      .catch(() => {
        if (alive) setRows({ leadId, failed: true, quotes: [] });
      });
    return () => {
      alive = false;
    };
  }, [enabled, leadId, attempt]);

  if (!enabled || !rows || rows.leadId !== leadId) return null;
  if (rows.failed) {
    return (
      <div data-testid="lead-refund-unavailable" role="status" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-co-warning bg-co-warning-surface p-3 text-sm">
        <span className="font-semibold text-co-warning-text">{t("catering.refunds.lead.unavailable")}</span>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="inline-flex min-h-[44px] items-center rounded-md border border-co-border-2 bg-co-surface px-4 text-sm font-semibold text-co-text"
        >
          {t("catering.refunds.try_again")}
        </button>
      </div>
    );
  }
  const open = rows.quotes.filter((q) => q.refundableCents > 0);
  if (open.length === 0) return null;
  return (
    <div data-testid="lead-refund-banner" className="mt-2 rounded-md border border-co-warning bg-co-warning-surface p-3 text-sm">
      {open.map((q) => (
        <div key={q.quoteId} className="flex flex-col gap-2">
          <p className="font-semibold text-co-warning-text">
            {t(phase === "lost" ? "catering.refunds.lead.lost" : "catering.refunds.lead.confirming", {
              paid: formatCents(q.paidCents, language),
              refundable: formatCents(q.refundableCents, language),
            })}
          </p>
          {phase === "lost" && (
            <a
              href={`/catering/quotes?quote=${q.quoteId}&refund=lost`}
              className="inline-flex min-h-[44px] w-fit items-center rounded-md border border-co-border-2 bg-co-surface px-4 text-sm font-semibold text-co-text"
            >
              {t("catering.refunds.lead.open")}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
