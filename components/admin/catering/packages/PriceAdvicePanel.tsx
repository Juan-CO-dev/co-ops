"use client";

/**
 * PriceAdvicePanel — per-package live price-advice panel (W1b).
 *
 * Fetches GET /api/admin/catering/packages/[id]/recommend and shows:
 *   - recommended à-la-carte catering value
 *   - implied discount (green) or premium (amber)
 *   - a "use recommended" button that sets the flat price via a parent callback
 *   - notes when lines can't be priced or no location basis is set
 *
 * For GLOBAL packages (locationId null), renders a preview-location selector
 * from the `locations` prop before fetching.
 *
 * Re-fetches whenever `refreshKey` changes (caller increments on mutations).
 * Reads need no step-up; "use recommended" does (Tier A, handled by parent).
 */

import { useState, useEffect, useCallback } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatCents } from "@/lib/i18n/format";
import type { PackageLocationOption } from "@/lib/admin/catering/packages";
import type { PackagePriceRecommendation } from "@/lib/admin/catering/package-pricing";

interface PriceAdvicePanelProps {
  packageId: string;
  /** The package's own locationId. null = global. */
  packageLocationId: string | null;
  /** Active locations for the global-package preview selector. */
  locations: PackageLocationOption[];
  /** Incremented by parent on any mutation; triggers recommendation re-fetch. */
  refreshKey: number;
  /** Whether the panel is busy (parent mutation in progress). */
  busy: boolean;
  /** Parent calls this to PATCH the package price to the recommended value. */
  onUseRecommended: (priceCents: number) => void;
}

export function PriceAdvicePanel({
  packageId,
  packageLocationId,
  locations,
  refreshKey,
  busy,
  onUseRecommended,
}: PriceAdvicePanelProps) {
  const { t, language } = useTranslation();

  const [open, setOpen] = useState(false);
  const [previewLocationId, setPreviewLocationId] = useState<string>("");
  const [rec, setRec] = useState<PackagePriceRecommendation | null>(null);

  // The effective basis location for the recommend call.
  const basisLocation =
    packageLocationId ?? (previewLocationId || null);

  // Advisory fetch — the only setState (setRec) runs AFTER the await, so nothing sets
  // state synchronously inside the effect (avoids react-hooks/set-state-in-effect).
  // "Calculating…" is shown while rec is still null (first load); refetches update in place.
  const fetchRec = useCallback(async () => {
    if (!open) return;
    try {
      const params = basisLocation
        ? `?location=${encodeURIComponent(basisLocation)}`
        : "";
      const res = await fetch(
        `/api/admin/catering/packages/${packageId}/recommend${params}`,
        { method: "GET", credentials: "same-origin" },
      );
      if (res.ok) {
        const json = (await res.json()) as PackagePriceRecommendation;
        setRec(json);
      }
    } catch {
      // Silent: advisory only — failures leave the panel in its prior state.
    }
  }, [open, packageId, basisLocation]);

  // Re-fetch when the panel opens, when refreshKey changes (parent mutation), or when
  // the preview location changes. This is a legitimate data-fetch effect reacting to a
  // prop (refreshKey) — fetchRec's only setState (setRec) runs after the await — but the
  // rule can't see through the async boundary, so disable it here explicitly.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRec();
  }, [fetchRec, refreshKey]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex min-h-[36px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text-muted transition hover:border-co-text hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
      >
        {t("admin.catering.packages.price_advice.show" as TranslationKey)}
      </button>
    );
  }

  const discountPct =
    rec != null ? (rec.impliedDiscountBps / 100).toFixed(1) : null;
  const isDiscount = rec != null && rec.impliedDiscountBps > 0;

  return (
    <div className="mt-2 rounded-lg border-2 border-dashed border-co-border bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
          {t("admin.catering.packages.price_advice.heading" as TranslationKey)}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-[36px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        >
          {t("admin.catering.packages.price_advice.hide" as TranslationKey)}
        </button>
      </div>

      {/* Preview-location selector — only for global packages */}
      {packageLocationId === null ? (
        <div className="mt-2">
          <label className="block">
            <span className="text-xs font-bold text-co-text">
              {t("admin.catering.packages.price_advice.preview_location" as TranslationKey)}
            </span>
            <select
              className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              value={previewLocationId}
              onChange={(e) => setPreviewLocationId(e.target.value)}
            >
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {rec == null ? (
        <p className="mt-2 text-sm text-co-text-muted">
          {t("admin.catering.packages.price_advice.loading" as TranslationKey)}
        </p>
      ) : !rec.hasBasis ? (
        <p className="mt-2 text-sm text-co-text-muted">
          {t("admin.catering.packages.price_advice.no_basis" as TranslationKey)}
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {/* À-la-carte row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-co-text-muted">
              {t("admin.catering.packages.price_advice.ala_carte" as TranslationKey)}
            </span>
            <span className="font-bold text-co-text">
              {formatCents(rec.alaCarteCents, language)}
            </span>
          </div>

          {/* Discount / premium row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-co-text-muted">
              {t(
                (isDiscount
                  ? "admin.catering.packages.price_advice.discount"
                  : "admin.catering.packages.price_advice.premium") as TranslationKey,
              )}
            </span>
            <span
              className={`font-bold ${isDiscount ? "text-co-success" : "text-co-warning"}`}
            >
              {discountPct != null ? `${discountPct}%` : "—"}
            </span>
          </div>

          {/* Unpriceable note */}
          {rec.unpriceableLines > 0 ? (
            <p className="text-xs text-co-text-muted">
              {t("admin.catering.packages.price_advice.unpriceable" as TranslationKey, {
                count: rec.unpriceableLines,
              })}
            </p>
          ) : null}

          {/* Use recommended */}
          <button
            type="button"
            disabled={busy}
            aria-label={t(
              "admin.catering.packages.price_advice.use_recommended_aria" as TranslationKey,
              { price: formatCents(rec.alaCarteCents, language) },
            )}
            onClick={() => onUseRecommended(rec.alaCarteCents)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("admin.catering.packages.price_advice.use_recommended" as TranslationKey)}
          </button>
        </div>
      )}
    </div>
  );
}
