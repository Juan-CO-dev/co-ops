import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import type { AnchorSource } from "@/lib/counts-shared";
import type { OnHandView, OnHandRow, OnHandWeightRow, OnHandCountRow } from "@/lib/counts";
import { AlertPill } from "@/components/ui/AlertPill";
import { EmptyState } from "@/components/EmptyState";

/**
 * On-hand panel (server-rendered). PER-SKU anchors (F1): each row's anchor timestamp
 * is that SKU's own latest count. PR-C: a row is either WEIGHT-anchored (raw — oz
 * drift + variance vs the PREVIOUS count, L8 shrinkage) or COUNT-anchored
 * (packaging/cleaning/misc — leaf-unit on-hand + "used or lost since last count",
 * ADVISORY, never "variance"/"loss" since these goods have no consumption artifact).
 * F5: a weight variance is LABELED short/over. F6: loose/partial line counts surfaced.
 * Anchor age + retro-edit staleness surfaced. Juan's model: receiving feeds, counts
 * verify, the difference is variance (weight) / "used or lost" (count).
 */
export function OnHandPanel({ view, lang }: { view: OnHandView; lang: Language }) {
  // Show the panel whenever there are rows — a location may have NO census event yet
  // and still surface inferred baselines (spec D6 cold-start). The `anchorAt` header
  // hint is census-only (the last physical count) and is omitted when null.
  if (view.rows.length === 0) {
    return <EmptyState message={serverT(lang, "counts.onhand.none")} />;
  }
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
        {view.rows.map((r) =>
          r.dimension === "count"
            ? <CountRow key={r.skuId} r={r} lang={lang} />
            : <WeightRow key={r.skuId} r={r} lang={lang} />,
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

/** Weight-anchored row (raw SKU) — oz drift + variance, unchanged voice. */
function WeightRow({ r, lang }: { r: OnHandWeightRow; lang: Language }) {
  const oz = (v: number | null): string => (v == null ? "—" : `${v.toFixed(1)} oz`);
  const signedOz = (v: number | null): string => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)} oz`);
  const varianceLabel = (v: number): string | null =>
    v < 0 ? serverT(lang, "counts.onhand.variance_short") : v > 0 ? serverT(lang, "counts.onhand.variance_over") : null;
  const vLabel = r.varianceOz != null ? varianceLabel(r.varianceOz) : null;
  return (
    <li className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-co-text">{r.skuName}</span>
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
        <p className="mt-1 text-[11px] font-bold text-co-cta">{serverT(lang, "counts.onhand.stale")}</p>
      ) : null}
    </li>
  );
}

/** Count-anchored row (packaging/cleaning/misc) — leaf-unit on-hand + "used or
 *  lost since last count" (advisory; NEVER "variance"/"loss"). */
function CountRow({ r, lang }: { r: OnHandCountRow; lang: Language }) {
  const units = (v: number | null): string =>
    v == null ? "—" : serverT(lang, "counts.onhand.units", { n: round(v), unit: r.unitLabel });
  return (
    <li className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-co-text">{r.skuName}</span>
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
        <p className="mt-1 text-[11px] font-bold text-co-cta">{serverT(lang, "counts.onhand.stale")}</p>
      ) : null}
    </li>
  );
}

/** Round to at most 1 decimal for unit display (leaf counts are usually integral). */
function round(v: number): number {
  return Math.round(v * 10) / 10;
}
