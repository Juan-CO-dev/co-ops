"use client";
import { formatDateLabel } from "@/lib/i18n/format";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useTranslation } from "@/lib/i18n/provider";
import type { CustomizationCandidate, DirectMappingTarget, MappingCandidate, MappingTarget, ToastReview, ReconciliationReview } from "@/lib/admin/ezcater-review";
import type { ModifierEffect } from "@/lib/toast/modifiers-shared";
import { isBaseMappingTarget, parseCustomizationDecision } from "@/lib/ezcater/customization-validation-shared";

const button = "min-h-[44px] rounded-lg border border-co-gold-deep px-3 text-co-text disabled:opacity-50";
const field = "block min-h-[44px] w-full rounded-lg border p-2";
const reasons = ["not_ezcater", "duplicate", "test", "other"] as const;
type DismissReason = typeof reasons[number];
export function EzcaterReviewClient({ candidates, customizationCandidates, targets, directTargets, toastReviews, reconciliationReviews }: {
  candidates: MappingCandidate[]; customizationCandidates: CustomizationCandidate[]; targets: MappingTarget[]; directTargets: DirectMappingTarget[]; toastReviews: ToastReview[]; reconciliationReviews: ReconciliationReview[];
}) {
  const { t, language } = useTranslation();
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
  const pendingCustomizations = customizationCandidates.filter((row) => !completed.has(row.reviewId));
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
        const directOptions = directTargets.filter((target) => isBaseMappingTarget(target, row.locationId));
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
    <section aria-labelledby="ezcater-customization-heading" className="space-y-3">
      <h2 id="ezcater-customization-heading" className="font-semibold">{t("admin.ezcaterReview.customizationSection")}</h2>
      <p>{t("admin.ezcaterReview.customizationCount", { n: pendingCustomizations.length })}</p>
      {pendingCustomizations.filter((row) => matches(`${row.name} ${row.customizationId} ${row.locationName}`)).map((row) =>
        <CustomizationEditor key={row.reviewId} row={row} targets={directTargets} busy={busy} submit={submit} />)}
    </section>
    <section aria-labelledby="toast-cross-check-heading" className="space-y-3">
      <h2 id="toast-cross-check-heading" className="font-semibold">{t("admin.ezcaterReview.reconciliation")}</h2>
      {reconciliationReviews.filter((row) => matches(`${row.order_number ?? ""} ${row.locationName}`)).map((row) => <article key={row.order_id} className="co-card space-y-2 p-3">
        <p className="font-semibold">{row.order_number ? t("admin.ezcaterReview.order", { number: row.order_number }) : t("admin.ezcaterReview.noCode")} · {row.locationName}</p>
        <p>{formatDateLabel(row.event_date, language)} · {t(`admin.ezcaterReview.status.${row.status}`)}</p>
        {row.rule && <p>{t(`admin.ezcaterReview.rule.${row.rule}`)}</p>}
      </article>)}
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

const blankEffect = (): ModifierEffect => ({ targetKind: "item", targetId: "", disposition: "deplete",
  portionQty: 1, portionUnit: "each", parentOnly: false });

function CustomizationEditor({ row, targets, busy, submit }: {
  row: CustomizationCandidate; targets: DirectMappingTarget[]; busy: boolean;
  submit: (reviewId: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [effects, setEffects] = useState<ModifierEffect[]>([blankEffect()]);
  const [pickMenuItemId, setPickMenuItemId] = useState("");
  const parsed = parseCustomizationDecision({ decision: "approve", effects, pickMenuItemId: pickMenuItemId || null });
  const update = (index: number, change: Partial<ModifierEffect>) => setEffects((old) => old.map((effect, i) => i === index ? { ...effect, ...change } : effect));
  return <article className="co-card space-y-2 p-3">
    <button type="button" className="flex min-h-[48px] w-full items-center justify-between gap-2 text-left"
      aria-expanded={open} aria-controls={`customization-${row.reviewId}`} disabled={busy} onClick={() => setOpen((value) => !value)}>
      <span><span className="font-semibold">{row.typeName ? `${row.typeName}: ${row.name}` : row.name}</span> · {row.locationName}<br />
        <span className="text-sm">{t("admin.ezcaterReview.customizationLines", { n: row.lineCount })}</span></span>
      <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div id={`customization-${row.reviewId}`} className="space-y-3">
      <p className="break-all text-sm">{t("admin.ezcaterReview.customizationIdentity", { id: row.customizationId })}</p>
      {effects.map((effect, index) => {
        const options = targets.filter((target) => target.kind === effect.targetKind);
        return <fieldset key={index} className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 font-semibold">{t("admin.ezcaterReview.effect", { n: index + 1 })}</legend>
          <label className="block">{t("admin.ezcaterReview.effectKind")}
            <select className={field} disabled={busy} value={effect.targetKind} onChange={(e) => {
              const targetKind = e.target.value as ModifierEffect["targetKind"];
              update(index, { targetKind, targetId: "", portionUnit: targetKind === "menu_item" ? "whole_sub" : "each" });
            }}>
              {(["item", "sku", "menu_item"] as const).map((kind) => <option key={kind} value={kind}>{t(`admin.ezcaterReview.kind.${kind}`)}</option>)}
            </select>
          </label>
          <label className="block">{t("admin.ezcaterReview.effectTarget")}
            <select className={field} disabled={busy} value={effect.targetId} onChange={(e) => update(index, { targetId: e.target.value })}>
              <option value="">{t("admin.ezcaterReview.none")}</option>
              {options.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
            </select>
          </label>
          <label className="block">{t("admin.ezcaterReview.effectDisposition")}
            <select className={field} disabled={busy} value={effect.disposition} onChange={(e) => update(index, { disposition: e.target.value as "deplete" | "remove" })}>
              <option value="deplete">{t("admin.ezcaterReview.disposition.deplete")}</option>
              <option value="remove">{t("admin.ezcaterReview.disposition.remove")}</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>{t("admin.ezcaterReview.portionQty")}<input className={field} disabled={busy} type="number" min="0.001" step="any" value={effect.portionQty ?? ""}
              onChange={(e) => update(index, { portionQty: e.target.value ? Number(e.target.value) : null })} /></label>
            <label>{t("admin.ezcaterReview.portionUnit")}<input className={field} disabled={busy} maxLength={32} value={effect.portionUnit ?? ""}
              onChange={(e) => update(index, { portionUnit: e.target.value || null })} /></label>
          </div>
          <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" disabled={busy} checked={effect.parentOnly}
            onChange={(e) => update(index, { parentOnly: e.target.checked })} />{t("admin.ezcaterReview.parentOnly")}</label>
          <button type="button" className={button} disabled={busy} onClick={() => setEffects((old) => old.filter((_, i) => i !== index))}>{t("admin.ezcaterReview.removeEffect")}</button>
        </fieldset>;
      })}
      <button type="button" className={button} disabled={busy || effects.length >= 8} onClick={() => { setPickMenuItemId(""); setEffects((old) => [...old, blankEffect()]); }}>{t("admin.ezcaterReview.addEffect")}</button>
      <label className="block">{t("admin.ezcaterReview.pickBinding")}
        <select className={field} disabled={busy} value={pickMenuItemId} onChange={(e) => { setPickMenuItemId(e.target.value); if (e.target.value) setEffects([]); }}>
          <option value="">{t("admin.ezcaterReview.noPickBinding")}</option>
          {targets.filter((target) => target.kind === "menu_item").map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || !parsed} onClick={() => parsed && submit(row.reviewId, {
          kind: "customization", decision: parsed.decision, effects: parsed.effects, pickMenuItemId: parsed.pickMenuItemId,
        })}>{t("admin.ezcaterReview.approveCustomization")}</button>
        <button type="button" className={button} disabled={busy} onClick={() => submit(row.reviewId, {
          kind: "customization", decision: "ignore", effects: [], pickMenuItemId: null,
        })}>{t("admin.ezcaterReview.ignore")}</button>
      </div>
    </div>}
  </article>;
}
