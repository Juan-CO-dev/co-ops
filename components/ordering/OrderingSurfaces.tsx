"use client";

/**
 * OrderingSurfaces — the /ordering PO surfaces client island (Vendor Ordering V1, spec §5).
 *
 * Sits ABOVE the walk affordance on /ordering. Renders three things over the server-loaded
 * payload (the page is a pure server component; this island owns all interaction):
 *
 *   1. "Today's orders" — per-vendor rows (displayCode, vendor, status chip, line count).
 *      Tap → opens the PoPanel overlay for that PO. Empty state renders the house
 *      EmptyState watermark (council C2 adoption sweep — was silent/nothing-rendered).
 *   2. Cutoff vendors WITHOUT a draft — a "Generate draft" affordance per vendor (POST
 *      generate_draft → opens the freshly-created draft in the panel). Only shows for
 *      attention vendors whose hasDraft is false (a draft already exists → they appear in
 *      Today's orders instead).
 *   3. History — a default-collapsed CollapsibleSection (D5 count header) of recent POs;
 *      tap a row → the PoPanel read view.
 *
 * router.refresh() re-pulls the server payload after a mutation (new draft, confirm, place,
 * reconcile) so the chips reflect the new server-authoritative status — but it does NOT reset
 * this island's useState, so the open-panel / generating state is reset explicitly (house law).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { AlertPill, type AlertPillTone } from "@/components/ui/AlertPill";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { EmptyState } from "@/components/EmptyState";
import { PoPanel } from "@/components/ordering/PoPanel";
import type { TodaysOrderVendor, PoHistoryRow } from "@/lib/purchase-orders";
import type { OrderingCutoffAttention } from "@/lib/ordering";
import type { TranslationKey } from "@/lib/i18n/types";

/** PO status → pill tone (D2 status always visible; matches PoPanel's mapping). */
const STATUS_TONE: Record<string, AlertPillTone> = {
  draft: "info",
  confirmed: "warn",
  placed: "ok",
  received: "ok",
  reconciled: "ok",
  invoiced: "info",
};

export function OrderingSurfaces({
  todaysOrders,
  history,
  cutoffAttention,
  locationId,
  actorLevel,
  language,
  shopLabel,
  dateLabel,
  initialPoId,
}: {
  todaysOrders: TodaysOrderVendor[];
  history: PoHistoryRow[];
  /** Today's cutoff vendors (from loadOrderingAttention) — those without a draft get a
   *  "Generate draft" affordance. */
  cutoffAttention: OrderingCutoffAttention[];
  locationId: string;
  actorLevel: number;
  language: "en" | "es";
  shopLabel: string;
  dateLabel: string;
  /**
   * Deep-link target (?po=<id>) — the panel this page should open on load, so a delivery
   * detail can link back to the exact PO. Seeds the panel state ONCE (initial useState);
   * closing it is a normal state change and must not be re-forced by a re-render.
   * UNTRUSTED: the id is only a fetch key — PoPanel's GET re-runs the PO_MIN level gate
   * and lockLocationContext server-side, so a crafted id renders the load error, never
   * another store's order.
   */
  initialPoId?: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  const [openPoId, setOpenPoId] = useState<string | null>(initialPoId ?? null);
  const [generating, setGenerating] = useState<string | null>(null); // vendorId being drafted
  const [genErr, setGenErr] = useState<string | null>(null);

  // Cutoff vendors that have NO draft yet (hasDraft false) → the Generate-draft affordance.
  // A vendor with a draft/confirmed PO is already surfaced in Today's orders.
  const draftless = cutoffAttention.filter((c) => !c.hasDraft);

  const refresh = () => router.refresh();

  const closePanel = () => {
    setOpenPoId(null);
    // Re-pull the server payload so the chip statuses reflect any mutation done in the panel.
    router.refresh();
  };

  const generateDraft = async (vendorId: string) => {
    if (generating) return;
    setGenerating(vendorId);
    setGenErr(null);
    try {
      const res = await fetch("/api/operations/ordering/po", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate_draft", locationId, vendorId }),
      });
      const j = (await res.json().catch(() => ({}))) as { poId?: string; code?: string };
      if (!res.ok || !j.poId) {
        setGenErr(t(("ordering.po.error." + (j.code ?? "generic")) as TranslationKey));
        setGenerating(null);
        return;
      }
      // Open the new draft immediately + refresh the chips.
      setGenerating(null);
      setOpenPoId(j.poId);
      router.refresh();
    } catch {
      setGenErr(t("ordering.po.error.generic"));
      setGenerating(null);
    }
  };

  const hasTodays = todaysOrders.length > 0;
  const hasDraftless = draftless.length > 0;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {/* Today's orders — a visible EmptyState when nothing's been drafted yet today
          (council C2 adoption sweep; was previously a silent no-render). */}
      <section className="co-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">
          {t("ordering.po.todays_title")}
        </h2>
        {hasTodays ? (
          <ul className="mt-2 flex flex-col gap-2">
            {todaysOrders.map((o) => (
              <li key={o.poId}>
                <button
                  type="button"
                  onClick={() => setOpenPoId(o.poId)}
                  className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-left hover:border-co-text"
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] font-bold text-co-text">{o.vendorName}</span>
                    <span className="block font-mono text-[11px] tracking-wide text-co-text-dim">{o.displayCode}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-[12px] text-co-text-muted">
                      {t("ordering.po.line_count", { n: o.lineCount })}
                    </span>
                    <AlertPill tone={STATUS_TONE[o.status] ?? "info"} uppercase={false}>
                      {t(("ordering.po.status." + o.status) as TranslationKey)}
                    </AlertPill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message={t("ordering.po.todays_empty")} markSize={40} className="py-6" />
        )}
      </section>

      {/* Cutoff vendors with no draft yet → Generate draft. */}
      {hasDraftless && (
        <section className="co-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">
              {t("ordering.po.cutoff_title")}
            </h2>
            <AlertPill tone="warn" uppercase={false}>
              {t("ordering.po.cutoff_count", { n: draftless.length })}
            </AlertPill>
          </div>
          {genErr && (
            <div role="alert" className="mt-2 rounded-lg border-2 border-co-danger bg-co-danger-surface px-3 py-2 text-[13px] text-co-text">
              {genErr}
            </div>
          )}
          <ul className="mt-2 flex flex-col gap-2">
            {draftless.map((c) => (
              <li
                key={c.vendorId}
                className="flex min-h-[48px] items-center justify-between gap-3 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold text-co-text">{c.vendorName}</span>
                  <span className="block text-[12px] text-co-text-dim">
                    {t("ordering.po.cutoff_at", { time: c.cutoffTime })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void generateDraft(c.vendorId)}
                  disabled={generating != null}
                  className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-[13px] font-bold text-co-text disabled:opacity-50"
                >
                  {generating === c.vendorId ? t("ordering.po.generating") : t("ordering.po.generate_draft")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* History — default-collapsed, D5 count header. */}
      {history.length > 0 && (
        <CollapsibleSection
          idBase="ordering-po-history"
          title={t("ordering.po.history_title")}
          count={t("ordering.po.history_count", { n: history.length })}
          defaultOpen={false}
        >
          <ul className="flex flex-col gap-2">
            {history.map((h) => (
              <li key={h.poId}>
                <button
                  type="button"
                  onClick={() => setOpenPoId(h.poId)}
                  className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-left hover:border-co-text"
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] font-bold text-co-text">{h.vendorName}</span>
                    <span className="block font-mono text-[11px] tracking-wide text-co-text-dim">{h.displayCode}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-[12px] text-co-text-muted">{formatDate(h.createdAt, language)}</span>
                    <AlertPill tone={STATUS_TONE[h.status] ?? "info"} uppercase={false}>
                      {t(("ordering.po.status." + h.status) as TranslationKey)}
                    </AlertPill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* The PO panel overlay. */}
      {openPoId && (
        <PoPanel
          poId={openPoId}
          actorLevel={actorLevel}
          language={language}
          shopLabel={shopLabel}
          dateLabel={dateLabel}
          onClose={closePanel}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

/** Locale-aware short date for a history row's created_at (never toLocale*(undefined)). */
function formatDate(iso: string, language: "en" | "es"): string {
  return new Intl.DateTimeFormat(language === "es" ? "es" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}
