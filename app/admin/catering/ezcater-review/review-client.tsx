"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useTranslation } from "@/lib/i18n/provider";
import type { DirectMappingTarget, MappingCandidate, MappingTarget, ToastReview } from "@/lib/admin/ezcater-review";

const button = "min-h-[44px] rounded-lg border border-co-gold-deep px-3 text-co-text disabled:opacity-50";
const field = "block min-h-[44px] w-full rounded-lg border p-2";
const reasons = ["not_ezcater", "duplicate", "test", "other"] as const;
type DismissReason = typeof reasons[number];
export function EzcaterReviewClient({ candidates, targets, directTargets, toastReviews }: {
  candidates: MappingCandidate[]; targets: MappingTarget[]; directTargets: DirectMappingTarget[]; toastReviews: ToastReview[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [directEditing, setDirectEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [directSelected, setDirectSelected] = useState<Record<string, string>>({});
  const [dismissReasons, setDismissReasons] = useState<Record<string, DismissReason | "">>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedToast, setExpandedToast] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  async function submit(reviewId: string, payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const result = await fetch("/api/admin/catering/ezcater-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, ...payload }),
      });
      if (!result.ok) { setError(t("admin.ezcaterReview.failed")); return; }
      setCompleted((old) => new Set([...old, reviewId]));
      router.refresh();
    } catch { setError(t("admin.ezcaterReview.failed")); }
    finally { setBusy(false); }
  }
  const pending = candidates.filter((row) => !completed.has(row.reviewId));
  const pendingToast = toastReviews.filter((row) => !completed.has(row.reviewId));
  const matches = (value: string) => value.toLowerCase().includes(search.toLowerCase());
  return <div className="space-y-3">
    {error && <p role="alert" className="text-co-cta-text">{error}</p>}
    <label className="block">{t("admin.ezcaterReview.search")}
      <input className={field} value={search} onChange={(e) => setSearch(e.target.value)} />
    </label>
    <section aria-labelledby="ezcater-mapping-heading" className="space-y-3">
      <h2 id="ezcater-mapping-heading" className="font-semibold">{t("admin.ezcaterReview.mappingSection")}</h2>
      <p>{t("admin.ezcaterReview.count", { n: pending.length })}</p>
      {pending.filter((row) => matches(`${row.name} ${row.size} ${row.locationName}`)).map((row) => {
        const targetId = selected[row.reviewId] ?? row.suggestedId;
        const options = targets.filter((target) => target.location_id === row.locationId);
        const suggestion = options.find((target) => target.id === targetId);
        const directOptions = directTargets.filter((target) => target.kind !== "package" || target.location_id === null || target.location_id === row.locationId);
        const directTarget = directOptions.find((target) => `${target.kind}:${target.id}` === directSelected[row.reviewId]);
        return <article key={row.reviewId} className="co-card space-y-2 p-3">
          <p className="font-semibold">{row.name} · {row.locationName}</p>
          <p>{t("admin.ezcaterReview.size", { size: row.size })} · {t("admin.ezcaterReview.lines", { n: row.lineCount })}</p>
          <p>{t("admin.ezcaterReview.suggested", { name: suggestion?.toast_item_name ?? t("admin.ezcaterReview.none") })}</p>
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={busy || !suggestion} onClick={() => submit(row.reviewId, { decision: "approve", targetId })}>{t("admin.ezcaterReview.approve")}</button>
            <button className={button} disabled={busy} aria-expanded={editing === row.reviewId} aria-controls={`pick-${row.reviewId}`} onClick={() => setEditing(editing === row.reviewId ? null : row.reviewId)}>{t("admin.ezcaterReview.pick")}</button>
            <button className={button} disabled={busy} aria-expanded={directEditing === row.reviewId} aria-controls={`direct-${row.reviewId}`} onClick={() => setDirectEditing(directEditing === row.reviewId ? null : row.reviewId)}>{t("admin.ezcaterReview.mapDirect")}</button>
            <button className={button} disabled={busy} onClick={() => submit(row.reviewId, { decision: "ignore", targetId: null })}>{t("admin.ezcaterReview.ignore")}</button>
          </div>
          {editing === row.reviewId && <label id={`pick-${row.reviewId}`} className="block">{t("admin.ezcaterReview.target")}
            <select className={field} disabled={busy} value={targetId ?? ""} onChange={(e) => setSelected({ ...selected, [row.reviewId]: e.target.value })}>
              <option value="">{t("admin.ezcaterReview.none")}</option>
              {options.map((target) => <option key={target.id} value={target.id}>{target.toast_item_name}</option>)}
            </select>
          </label>}
          {directEditing === row.reviewId && <div id={`direct-${row.reviewId}`} className="space-y-2">
            <label className="block">{t("admin.ezcaterReview.directTarget")}
              <select className={field} disabled={busy} value={directSelected[row.reviewId] ?? ""} onChange={(e) => setDirectSelected({ ...directSelected, [row.reviewId]: e.target.value })}>
                <option value="">{t("admin.ezcaterReview.none")}</option>
                {directOptions.map((target) => <option key={`${target.kind}:${target.id}`} value={`${target.kind}:${target.id}`}>{t(`admin.ezcaterReview.kind.${target.kind}`)}: {target.name}</option>)}
              </select>
            </label>
            <button className={button} disabled={busy || !directTarget} onClick={() => directTarget && submit(row.reviewId, { decision: "approve_direct", entityKind: directTarget.kind, entityId: directTarget.id })}>{t("admin.ezcaterReview.approveDirect")}</button>
          </div>}
        </article>;
      })}
    </section>
    <section aria-labelledby="toast-review-heading" className="space-y-3">
      <h2 id="toast-review-heading" className="font-semibold">{t("admin.ezcaterReview.toastSection")}</h2>
      <p>{t("admin.ezcaterReview.toastCount", { n: pendingToast.length })}</p>
      {pendingToast.filter((row) => matches(`${row.identity} ${row.locationName} ${row.orderNumber ?? ""}`)).map((row) => {
        const reason = dismissReasons[row.reviewId] ?? "";
        const note = notes[row.reviewId] ?? "";
        const expanded = expandedToast.has(row.reviewId);
        return <article key={row.reviewId} className="co-card space-y-2 p-3">
          <button className="flex min-h-[48px] w-full flex-wrap items-center gap-2 text-left" aria-expanded={expanded} aria-controls={`toast-details-${row.reviewId}`}
            disabled={busy || (expanded && (!!reason || !!note))}
            onClick={() => setExpandedToast((old) => {
              const next = new Set(old);
              if (next.has(row.reviewId)) next.delete(row.reviewId); else next.add(row.reviewId);
              return next;
            })}>
            <span className="font-semibold">{row.orderNumber ? t("admin.ezcaterReview.order", { number: row.orderNumber }) : row.identity} · {row.locationName}</span>
            <span className="rounded-lg border px-2 text-sm">{t("admin.ezcaterReview.unmatched")}</span>
            <span>{t("admin.ezcaterReview.toastCount", { n: 1 })}</span>
            <span aria-hidden="true">{expanded ? "−" : "+"}</span>
          </button>
          {expanded && <div id={`toast-details-${row.reviewId}`} className="space-y-2">
            <p>{t("admin.ezcaterReview.toastIdentity", { identity: row.identity })}</p>
            <label className="block">{t("admin.ezcaterReview.dismissReason")}
              <select className={field} disabled={busy} value={reason} onChange={(e) => setDismissReasons({ ...dismissReasons, [row.reviewId]: e.target.value as DismissReason | "" })}>
                <option value="">{t("admin.ezcaterReview.chooseReason")}</option>
                {reasons.map((value) => <option key={value} value={value}>{t(`admin.ezcaterReview.reason.${value}`)}</option>)}
              </select>
            </label>
            {reason === "other" && <label className="block">{t("admin.ezcaterReview.noteRequired")}
              <textarea className={field} disabled={busy} required maxLength={500} value={note} onChange={(e) => setNotes({ ...notes, [row.reviewId]: e.target.value })} />
            </label>}
            <button className={button} disabled={busy || !reason || (reason === "other" && !note.trim())} onClick={() => submit(row.reviewId, { decision: "dismiss", reason, note: reason === "other" ? note.trim() : null })}>{t("admin.ezcaterReview.dismiss")}</button>
          </div>}
        </article>;
      })}
    </section>
  </div>;
}
