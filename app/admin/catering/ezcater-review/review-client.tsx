"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useTranslation } from "@/lib/i18n/provider";
import type { MappingCandidate, MappingTarget } from "@/lib/admin/ezcater-review";

const button = "min-h-[44px] rounded-lg border border-co-gold-deep px-3 text-co-text disabled:opacity-50";
export function EzcaterReviewClient({ candidates, targets }: { candidates: MappingCandidate[]; targets: MappingTarget[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  async function decide(row: MappingCandidate, decision: "approve" | "ignore") {
    setBusy(true); setError(null);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const result = await fetch("/api/admin/catering/ezcater-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: row.reviewId, decision, targetId: decision === "ignore" ? null : selected[row.reviewId] ?? row.suggestedId }),
      });
      if (!result.ok) { setError(t("admin.ezcaterReview.failed")); return; }
      setCompleted((old) => new Set([...old, row.reviewId]));
      router.refresh();
    } catch { setError(t("admin.ezcaterReview.failed")); }
    finally { setBusy(false); }
  }
  const pending = candidates.filter((row) => !completed.has(row.reviewId));
  return <div className="space-y-3">
    {error && <p role="alert" className="text-co-cta-text">{error}</p>}
    <label className="block">{t("admin.ezcaterReview.search")}
      <input className="block min-h-[44px] w-full rounded-lg border p-2" value={search} onChange={(e) => setSearch(e.target.value)} />
    </label>
    <p>{t("admin.ezcaterReview.count", { n: pending.length })}</p>
    {pending.filter((row) => `${row.name} ${row.size} ${row.locationName}`.toLowerCase().includes(search.toLowerCase())).map((row) => {
      const targetId = selected[row.reviewId] ?? row.suggestedId;
      const options = targets.filter((target) => target.location_id === row.locationId);
      const suggestion = options.find((target) => target.id === targetId);
      return <article key={row.reviewId} className="co-card space-y-2 p-3">
        <p className="font-semibold">{row.name} · {row.locationName}</p>
        <p>{t("admin.ezcaterReview.size", { size: row.size })} · {t("admin.ezcaterReview.lines", { n: row.lineCount })}</p>
        <p>{t("admin.ezcaterReview.suggested", { name: suggestion?.toast_item_name ?? t("admin.ezcaterReview.none") })}</p>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || !targetId} onClick={() => decide(row, "approve")}>{t("admin.ezcaterReview.approve")}</button>
          <button className={button} disabled={busy} aria-expanded={editing === row.reviewId} aria-controls={`pick-${row.reviewId}`} onClick={() => setEditing(editing === row.reviewId ? null : row.reviewId)}>{t("admin.ezcaterReview.pick")}</button>
          <button className={button} disabled={busy} onClick={() => decide(row, "ignore")}>{t("admin.ezcaterReview.ignore")}</button>
        </div>
        {editing === row.reviewId && <label id={`pick-${row.reviewId}`} className="block">{t("admin.ezcaterReview.target")}
          <select className="block min-h-[44px] w-full rounded-lg border p-2" value={targetId ?? ""} onChange={(e) => setSelected({ ...selected, [row.reviewId]: e.target.value })}>
            <option value="">{t("admin.ezcaterReview.none")}</option>
            {options.map((target) => <option key={target.id} value={target.id}>{target.toast_item_name}</option>)}
          </select>
        </label>}
      </article>;
    })}
  </div>;
}
