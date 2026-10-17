"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { RecipeLineEditor } from "@/components/admin/recipes/RecipeLineEditor";
import { ToastLinkSection } from "@/components/catalog/ToastLinkSection";
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import type { RecipeLineDraft } from "@/lib/recipe-line-shared";
import { parseNewSandwichRequest, type NewSandwichRequest } from "@/lib/catalog/new-sandwich-shared";
import { jobErrorKey, newSandwichJobHref, sandwichCostSummary, type NewSandwichJobView } from "@/lib/catalog/jobs-shared";
import { createSandwichAttempt, createSandwichCostController, postSandwichJson, sandwichRecoveryHref, sandwichUuid, type SandwichAttempt } from "@/lib/catalog/sandwich-job-shared";
import { menuItemPageHref } from "@/lib/catalog/recipe-item-shared";
import type { MenuCostRollup } from "@/lib/menu-costing-shared";

const field = "min-h-[44px] w-full min-w-0 rounded-lg border-2 border-co-border bg-co-surface px-3 text-base";
const button = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border px-3 font-bold disabled:opacity-50";
const base = "/api/admin/catalog/jobs/new-sandwich";
const costKeys: Record<MenuCostRollup["status"], TranslationKey> = {
  unpriced: "catalog.jobs.sandwich.unpriced", costed: "catalog.jobs.sandwich.costed", partial: "catalog.jobs.cost.partial", inconsistent: "catalog.jobs.sandwich.inconsistent",
  unweighed: "catalog.jobs.sandwich.unweighed", unresolved: "catalog.jobs.sandwich.unresolved", no_recipe: "catalog.jobs.sandwich.no_recipe",
};

/** The page keys this client by owner scope. Creation and Toast confirmation are independent. */
export function NewSandwichJob({ view }: { view: NewSandwichJobView }) {
  const { t } = useTranslation(); const router = useRouter(); const { requestStepUp, forgetStepUp } = useStepUp();
  const [draft, setDraft] = useState<NewSandwichRequest>({ locationId: view.scope, name: "", nameEs: null, menuPrice: 0, section: null, directions: null, directionsEs: null, inputs: [] });
  const [lines, setLines] = useState<RecipeLineDraft[]>([]);
  const [editor, setEditor] = useState<number | "new" | null>(null);
  const [shopId, setShopId] = useState(view.scope ?? view.shops[0]?.id ?? "");
  const [cost] = useState(() => createSandwichCostController<MenuCostRollup>());
  const [costState, setCostState] = useState(cost.getState());
  const [attempts] = useState(() => createSandwichAttempt());
  const [attempt, setAttempt] = useState<SandwichAttempt | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [created, setCreated] = useState<{ menuItemId: string; matched: boolean; shopId: string } | null>(null);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const pending = useRef(false), alive = useRef(true), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; cost.invalidate(); attempts.reset(); if (timer.current) clearTimeout(timer.current); }; }, [cost, attempts]);
  const options = buildIngredientOptions(view.catalog);
  function invalidate() {
    if (timer.current) clearTimeout(timer.current);
    cost.invalidate(); setCostState(cost.getState()); setConfirmed(false);
  }
  function schedule(next: NewSandwichRequest) {
    invalidate();
    timer.current = setTimeout(() => { void cost.run(async () => {
      const parsed = parseNewSandwichRequest(next);
      if (!parsed.ok) throw Error(parsed.code);
      const result = await postSandwichJson(`${base}/preview`, parsed.request);
      if (result.kind !== "response") throw Error("preview");
      const preview = result.data.preview as { cost?: MenuCostRollup } | undefined;
      if (!preview?.cost || !(preview.cost.status in costKeys)) throw Error("preview shape");
      return preview.cost;
    }).then(result => { if (alive.current && result !== null) setCostState(result); }); }, 250);
  }
  function change(patch: Partial<NewSandwichRequest>) { const next = { ...draft, ...patch }; setDraft(next); setError(null); schedule(next); }
  async function reconcile(a: SandwichAttempt) {
    setUncertain(true); setConflict(false);
    const result = await postSandwichJson(`${base}/reconcile`, { attemptKey: a.key, shopId: a.shopId, ownerLocationId: a.request.locationId, name: a.request.name });
    if (!alive.current || !attempts.isCurrent(a)) return;
    if (result.kind === "response" && result.data.matched === true && sandwichUuid(result.data.menuItemId)) {
      setCreated({ menuItemId: result.data.menuItemId, matched: true, shopId: a.shopId }); setUncertain(false); setError(null);
    } else if (result.kind === "refused" && result.code === "name_taken" || result.kind === "response" && result.data.matched === false) {
      setUncertain(false); setConflict(true); setError("catalog.error.name_taken");
    } else { setError("catalog.jobs.sandwich.read_error"); }
  }
  async function submit() {
    if (pending.current || !confirmed || editor !== null || created || uncertain || conflict) return;
    const parsed = parseNewSandwichRequest(draft);
    if (!parsed.ok) { setError(jobErrorKey(parsed.code)); return; }
    if (!shopId) { setError("catalog.error.location_required"); return; }
    pending.current = true; setBusy(true); setError(null);
    try {
      if (await requestStepUp("E") !== "ok" || !alive.current) return;
      const a = attempts.begin(parsed.request, shopId); setAttempt(a);
      const result = await postSandwichJson(base, { ...a.request, attemptKey: a.key });
      if (!alive.current || !attempts.isCurrent(a)) return;
      if (result.kind === "response" && sandwichUuid(result.data.recipeId) && sandwichUuid(result.data.menuItemId)) {
        setCreated({ menuItemId: result.data.menuItemId, matched: false, shopId: a.shopId });
      } else if (result.kind === "uncertain" || result.kind === "response" || result.code === "name_taken") {
        await reconcile(a);
      } else {
        if (result.code === "step_up_required" || result.code === "step_up_stale") forgetStepUp();
        setError(jobErrorKey(result.code)); attempts.reset(); setAttempt(null);
      }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function reread() {
    if (!attempt || pending.current) return;
    pending.current = true; setBusy(true);
    try { await reconcile(attempt); } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function startAgain() { attempts.reset(); setAttempt(null); setUncertain(false); setConflict(false); setError(null); setConfirmed(false); }
  function saveLine(line: RecipeLineDraft) {
    const next = editor === "new" ? [...lines, line] : lines.map((old, i) => i === editor ? line : old);
    setLines(next); setEditor(null); change({ inputs: next });
  }
  const summary = costState.status === "ready" ? sandwichCostSummary(costState.value, draft.menuPrice) : null;
  const frozen = busy || uncertain || conflict || created !== null;
  return <section className="min-w-0 space-y-4" aria-busy={busy}>
    <h1 className="text-2xl font-extrabold">{t("catalog.jobs.sandwich.title")}</h1>
    <p>{t("catalog.jobs.sandwich.intro")}</p>
    {error && <p role="alert">{t(error)}</p>}
    {uncertain && <p data-testid="uncertain" role="status">{t("catalog.jobs.sandwich.uncertain")}</p>}
    {conflict && attempt && <Link data-testid="recovery" className={button} href={sandwichRecoveryHref(attempt.request.name)}>{t("catalog.jobs.sandwich.recovery")}</Link>}
    {(uncertain || conflict) && <div className="flex flex-wrap gap-2"><button data-testid="reread" className={button} disabled={busy} onClick={() => void reread()}>{t("catalog.jobs.sandwich.reread")}</button><button className={button} disabled={busy} onClick={startAgain}>{t("catalog.jobs.sandwich.start_again")}</button></div>}
    {created ? <div className="space-y-4">
      <p data-testid="created-notice" role="status">{t(created.matched ? "catalog.jobs.sandwich.already_created" : "catalog.jobs.sandwich.created")}</p>
      <Link data-testid="open" href={menuItemPageHref(created.menuItemId, { shopId: created.shopId })} className={button}>{t("catalog.jobs.sandwich.open")}</Link>
      <ToastLinkSection menuItemId={created.menuItemId} shopId={created.shopId} />
    </div> : <>
      <fieldset disabled={frozen} className="min-w-0 space-y-3">
        <label className="block">{t("catalog.jobs.new_item.shop")}<select aria-label={t("catalog.jobs.new_item.shop")} className={field} value={view.scope ?? "global"} onChange={e => { invalidate(); attempts.reset(); router.push(newSandwichJobHref(e.target.value === "global" ? null : e.target.value)); }}>
          {view.allowGlobal && <option value="global">{t("catalog.jobs.sandwich.global")}</option>}{view.shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        {view.scope === null && <label className="block">{t("catalog.jobs.sandwich.link_shop")}<select className={field} aria-label={t("catalog.jobs.sandwich.link_shop")} value={shopId} onChange={e => { setShopId(e.target.value); setConfirmed(false); }}><option value="">{t("catalog.jobs.sandwich.choose_shop")}</option>{view.shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        <label className="block">{t("recipes.builder.name_en")}<input data-testid="name" aria-label={t("recipes.builder.name_en")} className={field} maxLength={120} value={draft.name} onChange={e => change({ name: e.target.value })}/></label>
        <label className="block">{t("recipes.builder.name_es")}<input aria-label={t("recipes.builder.name_es")} className={field} value={draft.nameEs ?? ""} onChange={e => change({ nameEs: e.target.value })}/></label>
        <label className="block">{t("catalog.jobs.sandwich.price")}<input data-testid="price" aria-label={t("catalog.jobs.sandwich.price")} type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" className={field} value={draft.menuPrice || ""} onChange={e => change({ menuPrice: Number(e.target.value) })}/></label>
        <button type="button" className={`${button} w-full`} aria-expanded={directionsOpen} aria-controls="sandwich-directions" onClick={() => setDirectionsOpen(true)}>{t("catalog.jobs.sandwich.directions", { n: Number(!!draft.directions) + Number(!!draft.directionsEs) })}</button>
        {directionsOpen && <div id="sandwich-directions" className="space-y-3">{(["directions", "directionsEs"] as const).map(key => <label key={key} className="block">{t(key === "directions" ? "recipes.builder.directions_en" : "recipes.builder.directions_es")}<textarea aria-label={t(key === "directions" ? "recipes.builder.directions_en" : "recipes.builder.directions_es")} className={field} value={draft[key] ?? ""} onChange={e => change({ [key]: e.target.value })}/></label>)}</div>}
        <h2 className="font-bold">{t("recipes.builder.consumes_title")} ({t("recipes.builder.consumes_count", { n: lines.length })})</h2>
        <ul className="space-y-2">{lines.map((line, i) => <li key={i} className="flex min-w-0 flex-wrap items-center gap-2"><span className="break-words">{line.componentName} · {line.quantity} {line.unit}</span><button className={button} disabled={editor !== null} aria-label={t("recipes.row.edit_aria", { name: line.componentName })} onClick={() => { setEditor(i); invalidate(); }}>{t("catalog.jobs.sandwich.edit")}</button><button className={button} disabled={editor !== null} aria-label={t("catalog.jobs.sandwich.remove_aria", { name: line.componentName })} onClick={() => { const next = lines.filter((_, index) => index !== i); setLines(next); change({ inputs: next }); }}>{t("catalog.jobs.sandwich.remove")}</button></li>)}</ul>
        {editor === null ? <button data-testid="add-line" className={button} onClick={() => { setEditor("new"); invalidate(); }}>{t("recipes.builder.add_ingredient")}</button> : <RecipeLineEditor key={editor} title={t("recipes.builder.add_ingredient_title")} submitLabel={t("recipes.builder.save")} options={options} skus={view.catalog.skus} products={view.catalog.products} measures={new Map(view.catalog.measures)} activeMeasureLabels={view.catalog.activeMeasureLabels} initial={editor === "new" ? null : lines[editor] ?? null} busy={busy} errorMsg={null} onSubmit={saveLine} onCancel={() => { setEditor(null); schedule(draft); }} onDraftChange={invalidate}/>}
      </fieldset>
      <div role="status" aria-live="polite">
        {summary ? <p>{t(costKeys[summary.status], { cost: (summary.cost ?? summary.pricedCost).toFixed(2) })}</p> : <p>{t(costState.status === "failed" ? "catalog.jobs.sandwich.cost_error" : "catalog.jobs.sandwich.cost_pending")}</p>}
        {summary?.foodCostPct !== null && summary?.foodCostPct !== undefined && <p>{t("catalog.jobs.sandwich.margin", { pct: summary.foodCostPct.toFixed(1), margin: summary.marginDollars!.toFixed(2) })}</p>}
      </div>
      <p className="break-words">{t("catalog.jobs.sandwich.summary", { name: draft.name, price: draft.menuPrice.toFixed(2), n: lines.length, shop: view.scope === null ? t("catalog.jobs.sandwich.global") : view.shops.find(s => s.id === view.scope)?.name ?? "" })}</p>
      <label className="flex min-h-[44px] items-center gap-2"><input data-testid="confirm" type="checkbox" aria-label={t("catalog.jobs.sandwich.confirm")} disabled={frozen || editor !== null} checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>{t("catalog.jobs.sandwich.confirm")}</label>
      <button data-testid="create" className={`${button} w-full`} disabled={frozen || !confirmed || editor !== null || !draft.name.trim() || !lines.length || !shopId || costState.status !== "ready"} onClick={() => void submit()}>{t("catalog.jobs.sandwich.create")}</button>
    </>}
  </section>;
}
