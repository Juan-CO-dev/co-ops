import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { OnHandView } from "@/lib/counts";

/**
 * On-hand panel (server-rendered): the latest active count is the ANCHOR; drift =
 * received − consumed IN OZ (advisory-null → "—"); variance vs the previous count
 * (L8 shrinkage). Anchor age + retro-edit staleness surfaced. Juan's model:
 * receiving feeds, counts verify, the difference is variance.
 */
export function OnHandPanel({ view, lang }: { view: OnHandView; lang: Language }) {
  if (view.anchorAt == null || view.rows.length === 0) {
    return <p className="mt-2 text-[11px] italic text-co-text-muted">{serverT(lang, "counts.onhand.none")}</p>;
  }
  const oz = (v: number | null): string => (v == null ? "—" : `${v.toFixed(1)} oz`);
  const signedOz = (v: number | null): string => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)} oz`);
  return (
    <div className="mt-2">
      <p className="text-[11px] text-co-text-dim">
        {serverT(lang, "counts.onhand.anchor_at", { date: view.anchorAt.slice(0, 10) })}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {view.rows.map((r) => (
          <li key={r.skuId} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
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
              {r.varianceOz != null ? ` · ${serverT(lang, "counts.onhand.variance")}: ${signedOz(r.varianceOz)}` : ""}
            </div>
            {r.anchorStale ? (
              <p className="mt-1 text-[11px] font-bold text-co-cta">{serverT(lang, "counts.onhand.stale")}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
