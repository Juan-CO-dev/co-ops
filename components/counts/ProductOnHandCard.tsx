"use client";

/**
 * The PRODUCT row on the on-hand panel (spec 2026-08-20, "On-hand"; plan Task 5.7).
 *
 * THE DASHBOARD GRAMMAR, applied: "the most urgent fact is the headline; handled
 * shrinks to pills." The headline is the product's number — the one thing an operator
 * asked for when they asked how much ham is in the building. The per-vendor split and
 * the delivery lots behind it are DETAIL, and detail lives in a drawer (Disclosure
 * Doctrine D3/D6/D9: full-row toggle, useState only, aria-expanded + aria-controls).
 *
 * THE NULL RULE IS LOAD-BEARING. `totalOz === null` means at least one member could
 * not be resolved, and it renders an em-dash plus a pill naming how many — NEVER
 * `knownOz` dressed up as the total. The lower bound is said out loud, separately, as
 * a lower bound. That is the "partial results presented as totals" bug class, and the
 * whole point of the two-grain read is that it does not commit it.
 *
 * VARIANCE stays census-only and keeps the existing F5 short/over voice: the product's
 * variance is the members' variances SUMMED, and it is null unless every member is
 * census-anchored (lib/products-shared.ts buildProductOnHandRow). This is where the
 * audit's mirrored false SHORT/OVER pair dies — +140 on one twin and −40 on the other
 * net to the +100 that is real, instead of shouting twice.
 */

import { useId, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import { AlertPill } from "@/components/ui/AlertPill";
import type { ProductOnHandRow } from "@/lib/counts-shared";

export function ProductOnHandCard({ row }: { row: ProductOnHandRow }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const drawerId = `product-onhand-${useId()}`;

  const oz1 = (v: number): number => Math.round(v * 10) / 10;
  const signedOz = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(1)} oz`;
  const varianceLabel =
    row.varianceOz == null || row.varianceOz === 0
      ? null
      : row.varianceOz < 0
        ? t("counts.onhand.variance_short")
        : t("counts.onhand.variance_over");

  return (
    <li className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-co-text">{row.productName}</span>
        <span className="flex flex-wrap items-center gap-2">
          {row.totalOz != null ? (
            <span className="text-xs text-co-text-muted">
              {t("counts.onhand.on_hand", { oz: row.totalOz.toFixed(1) })}
            </span>
          ) : (
            <>
              <span aria-hidden className="text-xs text-co-text-muted">—</span>
              <AlertPill tone="info" uppercase={false} className="shrink-0">
                {t("counts.onhand.members_unresolved", { n: row.unknownSkuIds.length })}
              </AlertPill>
            </>
          )}
          {varianceLabel != null && row.varianceOz != null ? (
            <AlertPill tone={row.varianceOz < 0 ? "danger" : "warn"} uppercase={false} className="shrink-0">
              {`${signedOz(row.varianceOz)} ${varianceLabel}`}
            </AlertPill>
          ) : null}
        </span>
      </div>

      {row.totalOz == null && row.knownOz > 0 ? (
        // The lower bound, said as a lower bound. Never in the headline's slot.
        <p className="text-[11px] text-co-text-dim">{t("counts.onhand.known_lower_bound", { oz: oz1(row.knownOz) })}</p>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={drawerId}
        aria-label={t("counts.onhand.product_toggle_aria", { name: row.productName })}
        className="mt-1 flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim hover:text-co-text"
      >
        <span>{t(open ? "counts.onhand.product_hide" : "counts.onhand.product_show")} · {row.members.length}</span>
        <span aria-hidden className="flex h-6 w-6 items-center justify-center text-xs">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div id={drawerId} className="mt-1 border-t-2 border-co-border-2 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("counts.onhand.vendor_split")}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {row.members.map((m) => (
              <li key={m.skuId} className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-co-text">
                <span>
                  {m.skuName}
                  {m.vendorName ? <span className="text-co-text-dim"> — {m.vendorName}</span> : null}
                </span>
                <span className="text-co-text-muted">
                  {m.onHandOz != null ? `${m.onHandOz.toFixed(1)} oz` : t("counts.onhand.advisory")}
                </span>
              </li>
            ))}
          </ul>

          {/* The shelf, oldest first (remainingByLot's own order). A lot slice carries
              no timestamp of its own — LotShare is a SLICE, and inventing a date the
              FIFO functions never returned would be worse than omitting one — so the
              section header carries the ordering and each line names its vendor. */}
          <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("counts.onhand.lot_remaining")}</p>
          {row.remaining.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-1">
              {row.remaining.map((l) => (
                <li key={l.lotId} className="text-[12px] text-co-text-dim">
                  {t("counts.onhand.lot_line", {
                    vendor: row.members.find((x) => x.skuId === l.skuId)?.vendorName ?? t("counts.onhand.no_vendor"),
                    oz: oz1(l.oz),
                  })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12px] text-co-text-dim">{t("counts.onhand.lot_none")}</p>
          )}
        </div>
      ) : null}
    </li>
  );
}
