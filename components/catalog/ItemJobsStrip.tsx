"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { postJson } from "@/components/admin/vendors/shared";
import { jobErrorKey, swapVendorJobHref, type ItemJobsStripView, type LiveJobSwap } from "@/lib/catalog/jobs-shared";
import type { PublicBackToNormalPreview } from "@/lib/catalog/job-preview-shared";
import { backOutcomeKey, readBackResult, type BackResult } from "@/lib/catalog/share-back-shared";
import { ShareWithEveryShop } from "@/components/catalog/ShareWithEveryShop";
const control = "inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50";
export function ItemJobsStrip({ view }: { view: ItemJobsStripView }) {
  return <StripBody key={`${view.skuId}:${view.scope ?? "global"}:${view.owner.ownerLocationId ?? "global"}`} view={view} />;
}
function StripBody({ view }: { view: ItemJobsStripView }) {
  const { t } = useTranslation(); const { requestStepUp } = useStepUp(); const post = useStepUpPost();
  const [swaps, setSwaps] = useState(view.liveSwaps);
  const [preview, setPreview] = useState<PublicBackToNormalPreview | null>(null);
  const [completed, setCompleted] = useState<{ preview: PublicBackToNormalPreview; result: BackResult } | null>(null);
  const [busy, setBusy] = useState(false), [reloadRequired, setReloadRequired] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const alive = useRef(true), pending = useRef(false), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const canBack = view.canSwap || view.owner.canEdit;
  async function reloadJournal() {
    if (view.scope === null) return;
    try {
      const response = await fetch(`/api/admin/catalog/sku/${encodeURIComponent(view.skuId)}/swap?shopId=${encodeURIComponent(view.scope)}`, { cache: "no-store", redirect: "manual" });
      const data = response.ok ? await response.json() as { swaps?: LiveJobSwap[] } : null;
      if (!data || !Array.isArray(data.swaps) || data.swaps.some(row => typeof row.swapId !== "string" || typeof row.oldSkuId !== "string" || typeof row.newSkuId !== "string" || typeof row.startedAt !== "string")) throw new Error("journal");
      if (alive.current) { setSwaps(data.swaps); setReloadRequired(false); }
    } catch { if (alive.current) { setReloadRequired(true); setError("catalog.jobs.back.load_error"); } }
  }
  async function reload() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null); setPreview(null); generation.current++;
    try { await reloadJournal(); } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function review(swapId: string) {
    if (!canBack || pending.current || reloadRequired) return;
    pending.current = true; setBusy(true); setError(null); setPreview(null);
    const ticket = ++generation.current;
    try {
      const result = await postJson(`/api/admin/catalog/swaps/${encodeURIComponent(swapId)}/back-to-normal/preview`, {});
      if (!alive.current || ticket !== generation.current) return;
      if (!result.ok) { setError(jobErrorKey(result.code)); return; }
      const p = result.data.preview as PublicBackToNormalPreview | undefined;
      if (!p || p.swapId !== swapId || p.shopId !== view.scope || typeof p.token !== "string" || !Array.isArray(p.goingBack) || !Array.isArray(p.kept)) { setError(jobErrorKey("generic")); return; }
      setPreview(p);
    } finally { pending.current = false; if (alive.current && ticket === generation.current) setBusy(false); }
  }
  async function restore() {
    if (!canBack || !preview || pending.current || reloadRequired) return;
    const reviewed = preview, ticket = generation.current;
    pending.current = true; setBusy(true); setError(null);
    try {
      if (await requestStepUp("E") !== "ok" || !alive.current || ticket !== generation.current) return;
      const response = await post(`/api/admin/catalog/swaps/${encodeURIComponent(reviewed.swapId)}/back-to-normal`, { previewToken: reviewed.token });
      if (!alive.current || ticket !== generation.current) return;
      setPreview(null);
      if (!response.ok) { if (response.code === "generic") setReloadRequired(true); setError(jobErrorKey(response.code)); return; }
      const result = readBackResult(response.data);
      if (!result) { setReloadRequired(true); setError("catalog.jobs.back.outcome_unknown"); return; }
      // The locked writer can retain edits made after the preview. Its outcomes win.
      setCompleted({ preview: reviewed, result });
      await reloadJournal();
    } catch { if (alive.current) { setPreview(null); setReloadRequired(true); setError("catalog.jobs.back.outcome_unknown"); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="min-w-0 space-y-4" aria-busy={busy}>
    {view.owner.ownerLocationId !== null && <p>{t("catalog.only_at_shop", { shop: view.owner.ownerShopName ?? "—" })}</p>}
    {view.canSwap && <Link className={control} href={swapVendorJobHref(view.skuId, view.scope)}>{t("catalog.jobs.swap.title")}</Link>}
    <ShareWithEveryShop kind="sku" id={view.skuId} canShare={view.owner.canShare} />
    {error && <p role="alert">{t(error)}</p>}
    {swaps.map(swap => <div key={swap.swapId} className="min-w-0 space-y-2 rounded-lg border p-3">
      <h2 className="font-bold">{t("catalog.jobs.back.title")}</h2>
      {canBack && <button type="button" className={control} disabled={busy || reloadRequired} onClick={() => void review(swap.swapId)}>{t("catalog.jobs.back.preview")}</button>}
    </div>)}
    {preview && <div className="min-w-0 space-y-3"><BackPreviewPanel preview={preview} />
      <button type="button" className={control} disabled={busy || reloadRequired} onClick={() => void restore()}>{t("catalog.jobs.back.confirm")}</button>
    </div>}
    {completed && <BackResultPanel preview={completed.preview} result={completed.result} />}
    {view.scope !== null && (swaps.length > 0 || reloadRequired) && <button type="button" className={control} disabled={busy} onClick={() => void reload()}>{t("catalog.jobs.back.reload")}</button>}
  </section>;
}
export function BackPreviewPanel({ preview }: { preview: PublicBackToNormalPreview }) {
  const { t } = useTranslation();
  return <div className="min-w-0 space-y-2 break-words"><p>{preview.newSku.name} → {preview.oldSku.name}</p>
    <h3>{t("catalog.jobs.back.going_back")}</h3><ul>{preview.goingBack.map(row => <li key={row.recipeId}>{row.recipeName}</li>)}</ul>
    <h3>{t("catalog.jobs.back.kept")}</h3><ul>{preview.kept.map(row => <li key={row.recipeId}>{row.recipeName}</li>)}</ul>
    <p>{t(preview.primary === "restore" ? "catalog.jobs.back.primary_restore" : "catalog.jobs.back.primary_kept")}</p>
  </div>;
}
export function BackResultPanel({ preview, result }: { preview: PublicBackToNormalPreview; result: BackResult }) {
  const { t } = useTranslation();
  const names = new Map([...preview.goingBack, ...preview.kept].map(row => [row.recipeId, row.recipeName]));
  return <div role="status" className="min-w-0 space-y-2 break-words"><p>{t("catalog.jobs.back.saved")}</p>
    <h3>{t("catalog.jobs.back.restored")}</h3><ul>{result.back.map(id => <li key={id}>{names.get(id) ?? t("catalog.jobs.back.outcome_unknown")}</li>)}</ul>
    <h3>{t("catalog.jobs.back.kept")}</h3><ul>{result.kept.map(id => <li key={id}>{names.get(id) ?? t("catalog.jobs.back.outcome_unknown")}</li>)}</ul>
    <p>{t("catalog.jobs.back.primary_result", { outcome: t(backOutcomeKey(result.primary)) })}</p>
    <p>{t("catalog.jobs.back.grouping_result", { outcome: t(backOutcomeKey(result.grouping)) })}</p>
  </div>;
}
