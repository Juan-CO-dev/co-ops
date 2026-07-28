import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { OnHandView, OnHandRow, OnHandWeightRow, OnHandCountRow } from "@/lib/counts";

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
  if (view.anchorAt == null || view.rows.length === 0) {
    return <p className="mt-2 text-[11px] italic text-co-text-muted">{serverT(lang, "counts.onhand.none")}</p>;
  }
  return (
    <div className="mt-2">
      <p className="text-[11px] text-co-text-dim">
        {serverT(lang, "counts.onhand.anchor_at", { date: view.anchorAt.slice(0, 10) })}
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
        <span className="text-xs text-co-text-muted">
          {r.onHandOz != null ? serverT(lang, "counts.onhand.on_hand", { oz: r.onHandOz.toFixed(1) }) : serverT(lang, "counts.onhand.advisory")}
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
        <span className="text-xs text-co-text-muted">
          {r.onHandUnits != null
            ? serverT(lang, "counts.onhand.on_hand_units", { n: round(r.onHandUnits), unit: r.unitLabel })
            : serverT(lang, "counts.onhand.advisory")}
        </span>
      </div>
      <div className="text-[11px] text-co-text-dim">
        {serverT(lang, "counts.onhand.anchor")}: {units(r.anchorUnits)}
        {r.anchorAgeDays != null ? ` · ${serverT(lang, "counts.onhand.age_days", { n: r.anchorAgeDays })}` : ""}
        {r.usedOrLostUnits != null
          ? ` · ${serverT(lang, "counts.onhand.used_or_lost", { n: round(r.usedOrLostUnits), unit: r.unitLabel })}`
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
