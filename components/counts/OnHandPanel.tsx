import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import type { AnchorSource } from "@/lib/counts-shared";
import type { OnHandView, OnHandRow, OnHandWeightRow, OnHandCountRow } from "@/lib/counts";
import { AlertPill } from "@/components/ui/AlertPill";
import { EmptyState } from "@/components/EmptyState";
import { ProductOnHandCard } from "@/components/counts/ProductOnHandCard";

/**
 * On-hand panel (server-rendered). PER-SKU anchors (F1): each row's anchor timestamp
 * is that SKU's own latest count. PR-C: a row is either WEIGHT-anchored (raw — oz
 * drift + variance vs the PREVIOUS count, L8 shrinkage) or COUNT-anchored
 * (packaging/cleaning/misc — leaf-unit on-hand + "used or lost since last count",
 * ADVISORY, never "variance"/"loss" since these goods have no consumption artifact).
 * F5: a weight variance is LABELED short/over. F6: loose/partial line counts surfaced.
 * Anchor age + retro-edit staleness surfaced. Juan's model: receiving feeds, counts
 * verify, the difference is variance (weight) / "used or lost" (count).
 *
 * TWO GRAINS (Phase 5). `view.products` rolls member SKUs up to the product they are
 * members of and renders ONE headline row each, with the per-vendor split and the lot
 * shelf in a drawer. Those members' own SKU rows are then folded INTO that row rather
 * than repeated beside it — rendering both grains at once is how twins produced the
 * mirrored false SHORT/OVER pair in the first place. Everything else — singletons,
 * packaging, an inactive twin still carrying an anchor — renders exactly as it always
 * has, and `view.products` is empty before migration 0180 applies, so this whole
 * branch is dormant until the lead opens the gate.
 */
export function OnHandPanel({ view, lang, twinVendorBySkuId }: {
  view: OnHandView;
  lang: Language;
  /**
   * P8 (multi-vendor audit) — skuId → vendor label, ONLY for names that exist under 2+
   * vendors. Derived once by the page from the count form's option set and shared here so
   * both halves of the page disambiguate twins identically. A row absent from the map (an
   * inactive SKU, or an unambiguous name) simply renders no vendor — the ~95% case.
   */
  twinVendorBySkuId: Map<string, string>;
}) {
  // Show the panel whenever there are rows — a location may have NO census event yet
  // and still surface inferred baselines (spec D6 cold-start). The `anchorAt` header
  // hint is census-only (the last physical count) and is omitted when null.
  if (view.rows.length === 0) {
    return <EmptyState message={serverT(lang, "counts.onhand.none")} />;
  }
  // Members covered by a product row are rendered INSIDE it, never twice.
  const coveredSkuIds = new Set(view.products.flatMap((p) => p.members.map((m) => m.skuId)));
  const looseRows = view.rows.filter((r) => !coveredSkuIds.has(r.skuId));
  return (
    <div className="mt-2">
      <p className="text-[11px] text-co-text-dim">
        {view.anchorAt != null
          ? serverT(lang, "counts.onhand.anchor_at", { date: formatDateLabel(view.anchorAt.slice(0, 10), lang) })
          : serverT(lang, "counts.onhand.inferred_header")}
        {view.salesThrough != null
          ? ` · ${serverT(lang, "counts.onhand.sales_through", { date: formatDateLabel(view.salesThrough, lang) })}`
          : ""}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {view.products.map((p) => <ProductOnHandCard key={p.productId} row={p} />)}
        {looseRows.map((r) =>
          r.dimension === "count"
            ? <CountRow key={r.skuId} r={r} lang={lang} vendorName={twinVendorBySkuId.get(r.skuId) ?? null} />
            : <WeightRow key={r.skuId} r={r} lang={lang} vendorName={twinVendorBySkuId.get(r.skuId) ?? null} />,
        )}
      </ul>
    </div>
  );
}

function disjointAnnotations(r: OnHandRow, lang: Language) {
  if (r.looseLineCount <= 0 && r.partialLineCount <= 0) return null;
  return (
    <div className="text-[11px] text-co-text-muted">
      {r.looseLineCount > 0 ? serverT(lang, "counts.onhand.loose_lines", { n: r.looseLineCount }) : ""}
      {r.looseLineCount > 0 && r.partialLineCount > 0 ? " · " : ""}
      {r.partialLineCount > 0 ? serverT(lang, "counts.onhand.partial_lines", { n: r.partialLineCount }) : ""}
    </div>
  );
}

/**
 * Per-row anchor-provenance chip (spec D6 — the truth tiers census > par_estimate >
 * inferred). A census anchor shows "Audited {date}" (the house date formatter); a
 * par_estimate anchor shows "Par-pass {date}" (the shelf-walk snapshot as of that
 * walk); an inferred baseline shows "Inferred" in the info tone (neutral — a
 * cold-start estimate, not a fault). Count rows are always census (packaging has no
 * consumption ledger to infer from) → treated as census here.
 */
function SourceChip({ source, anchorAt, lang }: { source: AnchorSource; anchorAt: string | null; lang: Language }) {
  if (source === "inferred") {
    return (
      <AlertPill tone="info" uppercase={false} className="shrink-0">
        {serverT(lang, "counts.onhand.source_inferred")}
      </AlertPill>
    );
  }
  if (source === "par_estimate") {
    // A soft on-hand as of the last par-pass shelf-walk (firmer than inferred, softer
    // than a count). Same muted date-chip shape as census — a light provenance note.
    return (
      <span className="shrink-0 text-[11px] font-medium text-co-text-muted">
        {serverT(lang, "counts.onhand.source_par_estimate", { date: anchorAt != null ? formatDateLabel(anchorAt.slice(0, 10), lang) : "—" })}
      </span>
    );
  }
  // Census (explicit or the count-row default) — an audited on-hand as of the anchor.
  return (
    <span className="shrink-0 text-[11px] font-medium text-co-text-muted">
      {serverT(lang, "counts.onhand.source_audited", { date: anchorAt != null ? formatDateLabel(anchorAt.slice(0, 10), lang) : "—" })}
    </span>
  );
}

/**
 * SKU name, with the vendor appended ONLY when this name is ambiguous across vendors
 * (P8). Two identical "Ham" rows gave the counter nothing to choose between, so the count
 * landed on whichever twin they happened to hit — silently corrupting the anchor the whole
 * drift/variance model rests on.
 */
function SkuNameLabel({ name, vendorName }: { name: string; vendorName: string | null }) {
  return (
    <span className="font-semibold text-co-text">
      {name}
      {vendorName ? <span className="font-normal text-co-text-dim"> — {vendorName}</span> : null}
    </span>
  );
}

/** Weight-anchored row (raw SKU) — oz drift + variance, unchanged voice. */
function WeightRow({ r, lang, vendorName }: { r: OnHandWeightRow; lang: Language; vendorName: string | null }) {
  const oz = (v: number | null): string => (v == null ? "—" : `${v.toFixed(1)} oz`);
  const signedOz = (v: number | null): string => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)} oz`);
  const varianceLabel = (v: number): string | null =>
    v < 0 ? serverT(lang, "counts.onhand.variance_short") : v > 0 ? serverT(lang, "counts.onhand.variance_over") : null;
  const vLabel = r.varianceOz != null ? varianceLabel(r.varianceOz) : null;
  return (
    <li className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <SkuNameLabel name={r.skuName} vendorName={vendorName} />
        <span className="flex items-center gap-2">
          <SourceChip source={r.anchorSource} anchorAt={r.anchorAt} lang={lang} />
          <span className="text-xs text-co-text-muted">
            {r.onHandOz != null ? serverT(lang, "counts.onhand.on_hand", { oz: r.onHandOz.toFixed(1) }) : serverT(lang, "counts.onhand.advisory")}
          </span>
        </span>
      </div>
      <div className="text-[11px] text-co-text-dim">
        {serverT(lang, "counts.onhand.anchor")}: {oz(r.anchorOz)}
        {" · "}{serverT(lang, "counts.onhand.drift")}: {signedOz(r.driftOz)}
        {r.anchorAgeDays != null ? ` · ${serverT(lang, "counts.onhand.age_days", { n: r.anchorAgeDays })}` : ""}
        {r.varianceOz != null
          ? ` · ${serverT(lang, "counts.onhand.variance")}: ${signedOz(r.varianceOz)}${vLabel ? ` (${vLabel})` : ""}`
          : ""}
      </div>
      {disjointAnnotations(r, lang)}
      {r.anchorStale ? (
        <p className="mt-1 text-[11px] font-bold text-co-cta-text">{serverT(lang, "counts.onhand.stale")}</p>
      ) : null}
    </li>
  );
}

/** Count-anchored row (packaging/cleaning/misc) — leaf-unit on-hand + "used or
 *  lost since last count" (advisory; NEVER "variance"/"loss"). */
function CountRow({ r, lang, vendorName }: { r: OnHandCountRow; lang: Language; vendorName: string | null }) {
  const units = (v: number | null): string =>
    v == null ? "—" : serverT(lang, "counts.onhand.units", { n: round(v), unit: r.unitLabel });
  return (
    <li className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <SkuNameLabel name={r.skuName} vendorName={vendorName} />
        <span className="flex items-center gap-2">
          {/* Count rows are always census — packaging has no consumption ledger to infer from. */}
          <SourceChip source="census" anchorAt={r.anchorAt} lang={lang} />
          <span className="text-xs text-co-text-muted">
            {r.onHandUnits != null
              ? serverT(lang, "counts.onhand.on_hand_units", { n: round(r.onHandUnits), unit: r.unitLabel })
              : serverT(lang, "counts.onhand.advisory")}
          </span>
        </span>
      </div>
      <div className="text-[11px] text-co-text-dim">
        {serverT(lang, "counts.onhand.anchor")}: {units(r.anchorUnits)}
        {r.anchorAgeDays != null ? ` · ${serverT(lang, "counts.onhand.age_days", { n: r.anchorAgeDays })}` : ""}
        {r.usedOrLostUnits != null
          ? // Sign voice (review LOW): positive = fewer than expected → "used or
            // lost" (advisory, no fault implied); negative = counted MORE than
            // expected → say "counted over by N", never a bare signed number
            // (whose sign convention is inverted vs the weight variance rows).
            ` · ${
              r.usedOrLostUnits >= 0
                ? serverT(lang, "counts.onhand.used_or_lost", { n: round(r.usedOrLostUnits), unit: r.unitLabel })
                : serverT(lang, "counts.onhand.counted_over", { n: round(Math.abs(r.usedOrLostUnits)), unit: r.unitLabel })
            }`
          : ""}
      </div>
      {disjointAnnotations(r, lang)}
      {r.anchorStale ? (
        <p className="mt-1 text-[11px] font-bold text-co-cta-text">{serverT(lang, "counts.onhand.stale")}</p>
      ) : null}
    </li>
  );
}

/** Round to at most 1 decimal for unit display (leaf counts are usually integral). */
function round(v: number): number {
  return Math.round(v * 10) / 10;
}
