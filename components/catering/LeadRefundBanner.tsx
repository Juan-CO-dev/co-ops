"use client";

/**
 * The pipeline's refund prompt (catering refunds, Part B1 v2). DARK unless the page wrapped the board in
 * <RefundsSwitch on> (the server switch CATERING_REFUNDS): off = nothing renders and no request is made.
 *
 * On a LOST lead (or while "Lost" is being confirmed) it asks the server (GET /api/catering/pipeline/[id]/refunds,
 * stored state only) whether the order holds money taken through Stripe. An amount is shown ONLY when every eligible
 * payment of that order is known (`allKnown`, `refundableCents` a number); otherwise it says Stripe is being checked,
 * never 0. The refund itself is made on the quote, behind the confirm tap and the password.
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

/** One quote as the route answers it (`loadLeadRefundables`). */
interface LeadQuote {
  quoteId: string;
  refundableCents: number | null;
  capturedCents: number | null;
  allKnown: boolean;
  eligiblePayments: number;
}

function asQuotes(v: unknown): LeadQuote[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((q): q is Record<string, unknown> => !!q && typeof q === "object" && typeof (q as { quoteId?: unknown }).quoteId === "string")
    .map((q) => ({
      quoteId: q.quoteId as string,
      refundableCents: typeof q.refundableCents === "number" ? q.refundableCents : null,
      capturedCents: typeof q.capturedCents === "number" ? q.capturedCents : null,
      allKnown: q.allKnown === true,
      eligiblePayments: typeof q.eligiblePayments === "number" ? q.eligiblePayments : 0,
    }));
}

export function LeadRefundBanner({ leadId, phase }: { leadId: string; phase: "lost" | "confirming_lost" }) {
  const enabled = useRefundsEnabled();
  const { t, language } = useTranslation();
  const [rows, setRows] = useState<{ leadId: string; failed: boolean; quotes: LeadQuote[] } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetch(`/api/catering/pipeline/${leadId}/refunds`, { redirect: "manual" })
      .then((r) => (r.ok ? (r.json() as Promise<{ quotes?: unknown }>) : null))
      .then((d) => {
        const quotes = d ? asQuotes(d.quotes) : null;
        // A failed read is NOT "nothing to refund": it is said, with a way to try again.
        if (alive) setRows({ leadId, failed: quotes === null, quotes: quotes ?? [] });
      })
      .catch(() => {
        if (alive) setRows({ leadId, failed: true, quotes: [] });
      });
    return () => {
      alive = false;
    };
  }, [enabled, leadId, attempt]);

  if (!enabled || !rows || rows.leadId !== leadId) return null;
  const warning = rows.failed ? (
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
  ) : null;
  // Known with money left, or not known yet (no number). A known order with nothing left says nothing.
  const shown = rows.quotes.filter((q) => q.eligiblePayments > 0 && (!q.allKnown || q.refundableCents === null || q.refundableCents > 0));
  if (shown.length === 0) return warning;
  return (
    <>
      {warning}
      <div data-testid="lead-refund-banner" className="mt-2 rounded-md border border-co-warning bg-co-warning-surface p-3 text-sm">
        {shown.map((q) => {
          const known = q.allKnown && q.refundableCents !== null && q.capturedCents !== null;
          return (
            <div key={q.quoteId} className="flex flex-col gap-2" data-testid="lead-refund-quote" data-known={known ? "1" : "0"}>
              <p className="font-semibold text-co-warning-text">
                {known
                  ? t(phase === "lost" ? "catering.refunds.lead.lost" : "catering.refunds.lead.confirming", {
                      paid: formatCents(q.capturedCents as number, language),
                      refundable: formatCents(q.refundableCents as number, language),
                    })
                  : t("catering.refunds.lead.checking")}
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
          );
        })}
      </div>
    </>
  );
}
