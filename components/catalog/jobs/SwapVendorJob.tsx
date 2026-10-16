"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { jobErrorKey, swapVendorJobHref, type SwapVendorJobView } from "@/lib/catalog/jobs-shared";
import type { PublicSwapPreview } from "@/lib/catalog/job-preview-shared";
import { parseSwapRequest, type SwapRequest } from "@/lib/catalog/swap-shared";
import { createSwapReview, confirmSwapReview } from "@/lib/catalog/swap-job-shared";
import { postSandwichJson as postSwapJson } from "@/lib/catalog/sandwich-job-shared";

const field = "min-h-[44px] w-full min-w-0 rounded-lg border-2 border-co-border bg-co-surface px-3 text-base";
const button = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border px-3 font-bold disabled:opacity-50";

/** Consequences are read exclusively from the exact server preview being confirmed. */
export function SwapConsequences({ preview }: { preview: PublicSwapPreview }) {
  const { t, language } = useTranslation();
  const money = (value: number | null) => value === null ? t("catalog.jobs.swap.unknown_cost") : `$${value.toFixed(2)}`;
  return <section className="min-w-0 space-y-3 break-words" aria-label={t("catalog.jobs.swap.summary")}>
    <h2 className="font-bold">{t("catalog.jobs.swap.summary")}</h2>
    <p>{preview.oldSku.name} → {preview.newSku.name} · {preview.scopeName ?? t("catalog.jobs.sandwich.global")} · {t(preview.request.mode === "for_now" ? "catalog.jobs.swap.for_now" : "catalog.jobs.swap.for_good")}</p>
    <p>{t("catalog.jobs.swap.product")}: {preview.product.name}</p>
    <h3 className="font-bold">{t("catalog.jobs.swap.recipe_lines")}</h3>
    {preview.recipes.length ? <ul>{preview.recipes.flatMap(recipe => recipe.changes.map(line => <li key={`${recipe.recipeId}:${line.position}`}>
      {recipe.recipeName} · {t("catalog.jobs.swap.line", { position: line.position })}: {`${line.before.quantity} ${line.before.unit ?? ""}`} → {`${line.after.quantity} ${line.after.unit ?? ""}`} {line.converted && `(${t("catalog.jobs.swap.converted")})`}
    </li>))}</ul> : <p>{t("catalog.jobs.swap.no_changes")}</p>}
    {preview.refused.length > 0 && <div role="alert"><h3 className="font-bold">{t("catalog.jobs.swap.refused")}</h3><ul>{preview.refused.map(line => <li key={`${line.recipeId}:${line.position}`}>{line.recipeName} · {t("catalog.jobs.swap.line", { position: line.position })}: {t(jobErrorKey(line.reason))}</li>)}</ul></div>}
    <h3 className="font-bold">{t("catalog.jobs.swap.follows_primary")}</h3>
    <ul>{preview.followsPrimary.map(row => <li key={row.id}>{row.name}</li>)}</ul>{!preview.followsPrimary.length && <p>{t("catalog.jobs.swap.no_changes")}</p>}
    <h3 className="font-bold">{t("catalog.jobs.swap.untouched")}</h3>
    <ul>{preview.untouchedShops.map(row => <li key={row.id}>{row.name}</li>)}</ul>{!preview.untouchedShops.length && <p>{t("catalog.jobs.swap.no_changes")}</p>}
    <h3 className="font-bold">{t("catalog.jobs.swap.costs")}</h3>
    <ul>{preview.costs.map(row => <li key={row.menuItemId}>{language === "es" ? row.nameEs ?? row.name : row.name}: {money(row.before)} → {money(row.after)}</li>)}</ul>{!preview.costs.length && <p>{t("catalog.jobs.swap.no_changes")}</p>}
    <p>{t(preview.ordering.messageKey)}</p>
  </section>;
}

export function SwapVendorJob({ view, replacementId }: { view: SwapVendorJobView; replacementId?: string }) {
  const { t } = useTranslation(); const router = useRouter(); const { requestStepUp, forgetStepUp } = useStepUp();
  const [review] = useState(createSwapReview);
  const [draft, setDraft] = useState<SwapRequest>({ oldSkuId: view.jobs.skuId, newSkuId: view.replacements.some(row => row.id === replacementId) ? replacementId! : "", scope: view.scope, mode: view.scope === null ? "for_good" : "for_now", productName: null, productNameEs: null, note: null });
  const [preview, setPreview] = useState<PublicSwapPreview | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false), [navigating, setNavigating] = useState(false);
  const [outcome, setOutcome] = useState<"saved" | "uncertain" | null>(null);
  const pending = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; review.invalidate(); }; }, [review]);
  const base = `/api/admin/catalog/sku/${view.jobs.skuId}/swap`;
  const scope = encodeURIComponent(view.scope ?? "global");
  const sourceOwner = view.jobs.owner.ownerLocationId;
  const scopeShops = sourceOwner === null ? view.shops : view.shops.filter(shop => shop.id === sourceOwner);
  const itemHref = `/admin/catalog/sku/${encodeURIComponent(view.jobs.skuId)}?location=${scope}`;
  function invalidate() { review.invalidate(); setPreview(null); setError(null); }
  function change(patch: Partial<SwapRequest>) { invalidate(); setDraft({ ...draft, ...patch }); }
  async function loadPreview() {
    if (pending.current || navigating || outcome) return;
    const parsed = parseSwapRequest(draft, view.jobs.skuId);
    if (!parsed.ok || !view.replacements.some(row => row.id === draft.newSkuId)) { setError("catalog.error.invalid_payload"); return; }
    const ticket = review.begin(); setPreview(null); setError(null); pending.current = true; setBusy(true);
    try {
      const result = await postSwapJson(`${base}/preview`, parsed.request);
      if (!alive.current || !review.isCurrentTicket(ticket)) return;
      if (result.kind !== "response") { setError(jobErrorKey(result.kind === "refused" ? result.code : "generic")); return; }
      const next = result.data.preview as PublicSwapPreview | undefined;
      if (!next || typeof next.token !== "string" || !next.request || !Array.isArray(next.recipes) || !Array.isArray(next.refused) || !Array.isArray(next.costs) || !Array.isArray(next.followsPrimary) || !Array.isArray(next.untouchedShops) || !next.oldSku || !next.newSku || !next.product || !next.ordering || next.request.oldSkuId !== parsed.request.oldSkuId || next.request.newSkuId !== parsed.request.newSkuId || next.request.scope !== parsed.request.scope || next.request.mode !== parsed.request.mode) {
        setError("catalog.error.generic"); return;
      }
      if (review.accept(ticket, next)) setPreview(next);
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function confirm() {
    if (pending.current || navigating || outcome || !view.jobs.canSwap) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await confirmSwapReview(review, () => requestStepUp("E"), body => postSwapJson(base, body));
      if (!alive.current) return;
      setPreview(review.current());
      if (result.kind === "refused") {
        if (result.code === "step_up_required" || result.code === "step_up_stale") forgetStepUp();
        setError(jobErrorKey(result.code));
      } else if (result.kind !== "cancelled") setOutcome(result.kind);
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const frozen = busy || navigating || outcome !== null;
  return <section className="flex min-w-0 flex-col gap-4" aria-busy={busy || navigating}>
    <h1 className="text-2xl font-extrabold">{t("catalog.jobs.swap.title")}: {view.jobs.name}</h1>
    {error && <p role="alert">{t(error)}</p>}
    {outcome ? <><p role="status">{t(outcome === "saved" ? "catalog.jobs.swap.saved" : "catalog.jobs.swap.uncertain")}</p><Link className={button} href={itemHref}>{t("catalog.jobs.swap.item")}</Link></> : <>
      <fieldset disabled={frozen} className="min-w-0 space-y-3">
        <label className="block">{t("catalog.jobs.new_item.shop")}<select aria-label={t("catalog.jobs.new_item.shop")} data-testid="scope" className={field} value={view.scope ?? "global"} onChange={event => { invalidate(); setNavigating(true); router.push(swapVendorJobHref(view.jobs.skuId, event.target.value === "global" ? null : event.target.value)); }}>
          {view.allowGlobal && sourceOwner === null && <option value="global">{t("catalog.jobs.sandwich.global")}</option>}{scopeShops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
        </select></label>
        <label className="block">{t("catalog.jobs.swap.replacement")}<select aria-label={t("catalog.jobs.swap.replacement")} data-testid="replacement" className={field} value={draft.newSkuId} onChange={event => change({ newSkuId: event.target.value })}><option value="">—</option>{view.replacements.map(row => <option key={row.id} value={row.id}>{row.name}{row.vendorName ? ` · ${row.vendorName}` : ""}</option>)}</select></label>
        <label className="block">{t("catalog.jobs.swap.title")}<select aria-label={t("catalog.jobs.swap.title")} data-testid="mode" className={field} value={draft.mode} onChange={event => change({ mode: event.target.value === "for_now" ? "for_now" : "for_good" })}>{view.scope !== null && <option value="for_now">{t("catalog.jobs.swap.for_now")}</option>}<option value="for_good">{t("catalog.jobs.swap.for_good")}</option></select></label>
        <label className="block">{t("catalog.jobs.swap.note")}<input aria-label={t("catalog.jobs.swap.note")} className={field} maxLength={200} value={draft.note ?? ""} onChange={event => change({ note: event.target.value })}/></label>
      </fieldset>
      {!frozen && <Link className={button} href={`/admin/catalog/new/item?location=${scope}&swapFrom=${encodeURIComponent(view.jobs.skuId)}`}>{t("catalog.jobs.swap.add")}</Link>}
      {preview ? <><SwapConsequences preview={preview}/><button data-testid="confirm" className={button} disabled={frozen || preview.refused.length > 0 || !view.jobs.canSwap} onClick={() => void confirm()}>{t("catalog.jobs.swap.confirm")}</button><button className={button} disabled={frozen} onClick={invalidate}>{t("catalog.jobs.swap.cancel")}</button></> : <button data-testid="preview" className={button} disabled={frozen || !draft.newSkuId || !view.jobs.canSwap} onClick={() => void loadPreview()}>{t("catalog.jobs.swap.preview")}</button>}
    </>}
  </section>;
}
