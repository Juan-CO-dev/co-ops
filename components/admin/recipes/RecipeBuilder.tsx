"use client";

/**
 * RecipeBuilder — adaptive form for /admin/recipes/[id] (LIVE mode) and
 * /admin/recipes/new (DRAFT mode).
 *
 * DRAFT mode  (recipe == null):
 *   Header fields (name/nameEs/batchYield/directions/directionsEs) + recipe_type
 *   are local state. Inputs + outputs are draft arrays. A single Save button
 *   POSTs the entire draft to /api/admin/recipes/full after requestStepUp("E"),
 *   then navigates to /admin/recipes/{id}.
 *
 * LIVE mode (recipe != null):
 *   Header fields PATCH on blur. Inputs/outputs add immediately via POST.
 *   recipe_type is shown read-only.
 *
 * SKU unit picker: after choosing a SKU the unit <select> offers
 *   [packFormat, eachContainerLabel, eachMeasure] (nulls/dupes filtered).
 * Output container: locked <select> over unitOptions (units registry).
 * Live oz readout: calls ozForRecipeInput per SKU input row (shows "≈ N oz").
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import { beginLineEdit, recipeLineKind, type LineEditStart, type RecipeLineDraft } from "@/lib/recipe-line-shared";
import { RecipeLineEditor } from "./RecipeLineEditor";
import { StatusBadge, ReadinessReasons } from "@/components/admin/StatusBadge";
import type { Readiness } from "@/lib/readiness";
import { RegistrySelect } from "@/components/admin/skus/RegistrySelect";
import type { RecipeView, RecipeInputView, RecipeOutputView, RecipeType } from "@/lib/recipes-shared";
import { RECIPE_WRITE_MIN, RECIPE_DELETE_MIN } from "@/lib/recipes-shared";
import type { RegistryOption } from "@/lib/admin/skus";
import type { TranslationKey } from "@/lib/i18n/types";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import { ozForRecipeInput } from "@/lib/recipe-math";
import { productInputBasis } from "@/lib/products-shared";
import { resolveErrorKey } from "./shared";

const rk = (k: string): TranslationKey => k as TranslationKey;
import { RecipeInputRow } from "./RecipeInputRow";
import { RecipeOutputRow } from "./RecipeOutputRow";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

const textareaCls =
  "mt-1 min-h-[88px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60 resize-y";

// ── Richer SKU shape (includes pack fields for unit derivation + oz math) ────
export interface RecipeBuilderSku extends RecipeInputSku {
  id: string;
  name: string;
  /** The SKU's vendor, for the picker's "name · vendor · kind" label; null = no vendor. */
  vendorName: string | null;
}

/** A PRODUCT the recipe can pin instead of one vendor's SKU (0179). */
export interface RecipeBuilderProduct {
  id: string;
  name: string;
  /** products.unit_oz — what ONE unit weighs. null = a count-denominated line refuses. */
  unitOz: number | null;
}

// ── Draft input/output shapes ────────────────────────────────────────────────
interface DraftInput {
  _key: number;
  kind: "sku" | "item" | "product";
  componentSkuId: string | null;
  componentItemId: string | null;
  componentProductId: string | null;
  componentName: string;
  quantity: number;
  unit: string | null;
  eachContainerLabel: string | null;
  portioned: boolean;
}
interface DraftOutput {
  _key: number;
  kind: "item" | "menuItem";
  outputItemId: string | null;
  outputMenuItemId: string | null;
  outputName: string;
  yield: number;
  outputContainerLabel: string | null;
}

// ── RecipeBuilder ────────────────────────────────────────────────────────────
export function RecipeBuilder({
  recipe,
  skus,
  items,
  products = [],
  unitOptions,
  measures,
  activeMeasureLabels,
  level,
  defaultType = "production",
  readiness = null,
}: {
  recipe: RecipeView | null;
  skus: RecipeBuilderSku[];
  items: Array<{ id: string; name: string }>;
  /** Active products (0179). Empty → the product affordance never renders. */
  products?: RecipeBuilderProduct[];
  unitOptions: Array<{ id: string; label: string }>;
  measures: Map<string, MeasureUnitFactor>;
  /** ACTIVE measure labels for the line editor's unit list (Astra full-branch #4). */
  activeMeasureLabels?: string[];
  level: number;
  defaultType?: RecipeType;
  readiness?: Readiness | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp, requestStepUpGrant } = useStepUp();
  const send = useStepUpPost();
  const canEdit = level >= RECIPE_WRITE_MIN;
  const canDelete = level >= RECIPE_DELETE_MIN;

  // ── LIVE mode: header patch state ──
  const [patchError, setPatchError] = useState<string | null>(null);
  const [patchBusy, setPatchBusy] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);

  // ── LIVE mode: delete (deactivate) state ──
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteRecipe = async () => {
    if (!recipe || deleteBusy) return;
    setDeleteError(null);
    // Deleting a recipe is destructive: a one-shot password for THIS recipe, every time.
    if ((await requestStepUpGrant({ action: "recipe.delete", targetId: recipe.id })) !== "ok") return;
    setDeleteBusy(true);
    const result = await send(`/api/admin/recipes/${recipe.id}`, {}, "DELETE");
    setDeleteBusy(false);
    if (result.ok) {
      router.push("/admin/recipes");
    } else {
      setConfirmDelete(false);
      setDeleteError(t(resolveErrorKey(result.code)));
    }
  };

  // ── Header local state (used by both modes; LIVE patches on blur, DRAFT collects) ──
  const [nameVal, setNameVal] = useState(recipe?.name ?? "");
  const [nameEsVal, setNameEsVal] = useState(recipe?.nameEs ?? "");
  const [batchYieldVal, setBatchYieldVal] = useState(String(recipe?.batchYield ?? "1"));
  // 0215 batch vs bottle: shelf life (whole days) and the batch_mode flag. LIVE patches on
  // blur/change like every other header field; DRAFT rides the full POST.
  const [shelfLifeVal, setShelfLifeVal] = useState(String(recipe?.shelfLifeDays ?? "5"));
  const [batchModeVal, setBatchModeVal] = useState<boolean>(recipe?.batchMode ?? false);
  const [directionsVal, setDirectionsVal] = useState(recipe?.directions ?? "");
  const [directionsEsVal, setDirectionsEsVal] = useState(recipe?.directionsEs ?? "");

  // ── DRAFT mode: recipe type (LIVE: read-only from recipe) ──
  const [draftType, setDraftType] = useState<RecipeType>(defaultType);
  const effectiveType = recipe ? recipe.recipeType : draftType;

  // ── DRAFT mode: local input/output arrays ──
  const [draftInputs, setDraftInputs] = useState<DraftInput[]>([]);
  const [draftOutputs, setDraftOutputs] = useState<DraftOutput[]>([]);
  const [draftKeySeq, setDraftKeySeq] = useState(0);
  const nextKey = () => { const k = draftKeySeq; setDraftKeySeq((n) => n + 1); return k; };

  // ── DRAFT mode: save state ──
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── LIVE mode: PATCH helpers ──
  const patchField = async (field: string, value: string | number | null) => {
    if (!canEdit || !recipe) return;
    // TIER PARITY (the CreateUserForm class). PATCH /api/admin/recipes/[id] asserts
    // Tier E (the catalog edit window; Tier B before catalog Phase 1), and this lane once
    // asked for nothing at all — so a header edit only succeeded when the actor happened
    // to be unlocked already, and otherwise came back as an opaque error on blur. Every
    // write in this file requests "E" (recipe delete takes a one-shot grant).
    if ((await requestStepUp("E")) !== "ok") return;
    setPatchError(null);
    setPatchBusy(true);
    const result = await send(
      `/api/admin/recipes/${recipe.id}`,
      { [field]: value },
      "PATCH",
    );
    setPatchBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setPatchError(t(resolveErrorKey(result.code)));
    }
  };

  const handleNameBlur = () => {
    const trimmed = nameVal.trim();
    if (recipe && trimmed && trimmed !== recipe.name) void patchField("name", trimmed);
  };
  const handleNameEsBlur = () => {
    const trimmed = nameEsVal.trim() || null;
    if (recipe && trimmed !== (recipe.nameEs ?? null)) void patchField("nameEs", trimmed);
  };
  const handleBatchYieldBlur = () => {
    const n = Number(batchYieldVal);
    if (recipe && Number.isFinite(n) && n > 0 && n !== recipe.batchYield) void patchField("batchYield", n);
  };
  const handleShelfLifeBlur = () => {
    const n = Number(shelfLifeVal);
    if (!recipe) return;
    if (!Number.isInteger(n) || n <= 0) { setPatchError(t(rk("recipes.error.invalid_shelf_life_days"))); setShelfLifeVal(String(recipe.shelfLifeDays)); return; }
    if (n !== recipe.shelfLifeDays) void patchField("shelfLifeDays", n);
  };
  const handleBatchModeChange = async (on: boolean) => {
    if (!recipe) { setBatchModeVal(on); return; }
    // Optimistic flip, reverted on refusal: the server (set_recipe_batch_mode) is the
    // authority on the one-output rule and the error text says what to fix.
    const prev = batchModeVal;
    setBatchModeVal(on);
    if (!canEdit) return;
    if ((await requestStepUp("E")) !== "ok") { setBatchModeVal(prev); return; }
    setPatchError(null);
    setPatchBusy(true);
    const result = await send(`/api/admin/recipes/${recipe.id}`, { batchMode: on }, "PATCH");
    setPatchBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setBatchModeVal(prev);
      setPatchError(t(resolveErrorKey(result.code)));
    }
  };
  const handleDirectionsBlur = () => {
    const v = directionsVal.trim() || null;
    if (recipe && v !== (recipe.directions ?? null)) void patchField("directions", v);
  };
  const handleDirectionsEsBlur = () => {
    const v = directionsEsVal.trim() || null;
    if (recipe && v !== (recipe.directionsEs ?? null)) void patchField("directionsEs", v);
  };

  // ── LIVE mode: remove edge ──
  const removeEdge = async (table: "recipe_inputs" | "recipe_outputs", edgeId: string) => {
    if (!canEdit) return;
    // Same tier-parity fix as patchField: DELETE /api/admin/recipes/edges asserts Tier E.
    if ((await requestStepUp("E")) !== "ok") return;
    setPatchError(null);
    const result = await send("/api/admin/recipes/edges", { table, id: edgeId }, "DELETE");
    if (result.ok) {
      router.refresh();
    } else {
      // The failure was swallowed entirely — no refresh, no message, a row that simply
      // stayed on screen. A removal that does not happen must say so.
      setPatchError(t(resolveErrorKey(result.code)));
    }
  };

  // ── DRAFT mode: save entire draft ──
  const saveDraft = async () => {
    if (saveBusy || !canEdit) return;
    setSaveError(null);
    const name = nameVal.trim();
    const batchYield = Number(batchYieldVal);
    if (!name) { setSaveError(t(rk("recipes.error.invalid_name"))); return; }
    if (!Number.isFinite(batchYield) || batchYield <= 0) { setSaveError(t(rk("recipes.error.invalid_batch_yield"))); return; }
    const shelfLifeDays = Number(shelfLifeVal);
    if (!Number.isInteger(shelfLifeDays) || shelfLifeDays <= 0) { setSaveError(t(rk("recipes.error.invalid_shelf_life_days"))); return; }
    if (draftInputs.length === 0) { setSaveError(t(rk("recipes.draft.error_no_inputs"))); return; }
    if (draftOutputs.length === 0) { setSaveError(t(rk("recipes.draft.error_no_outputs"))); return; }
    // 0215: a batch recipe is ONE item's whole recipe — the server refuses anything else; say
    // it here first so the author fixes the outputs instead of reading a 422.
    if (batchModeVal && (draftOutputs.length !== 1 || draftOutputs[0]?.kind !== "item" || !(draftOutputs[0]?.yield > 0))) {
      setSaveError(t(rk("recipes.error.batch_mode_single_output")));
      return;
    }
    if ((await requestStepUp("E")) !== "ok") return;
    setSaveBusy(true);
    const result = await send("/api/admin/recipes/full", {
      name,
      nameEs: nameEsVal.trim() || null,
      recipeType: effectiveType,
      batchYield,
      directions: directionsVal.trim() || null,
      directionsEs: directionsEsVal.trim() || null,
      batchMode: batchModeVal,
      shelfLifeDays,
      inputs: draftInputs.map((inp) => ({
        componentSkuId: inp.componentSkuId ?? undefined,
        componentItemId: inp.componentItemId ?? undefined,
        // The THIRD target must ride the wire too (SIM-PI-8, 2026-08-21). Omitted, a
        // product-pinned draft line arrived at createRecipeFull with all three targets
        // null, failed `exactly one component` and 400'd the WHOLE recipe with a
        // generic invalid_component that named no line — so the product picker this
        // arc added to the builder was a dead end from the day it shipped.
        // `RecipeDraftInput.componentProductId` is optional, which is why the omission
        // type-checked; the route already forwards the field.
        componentProductId: inp.componentProductId ?? undefined,
        quantity: inp.quantity,
        unit: inp.unit ?? undefined,
        eachContainerLabel: inp.eachContainerLabel ?? undefined,
        portioned: inp.portioned,
      })),
      outputs: draftOutputs.map((out) => ({
        outputItemId: out.outputItemId ?? undefined,
        outputMenuItemId: out.outputMenuItemId ?? undefined,
        yield: out.yield,
        outputContainerLabel: out.outputContainerLabel ?? undefined,
      })),
    });
    setSaveBusy(false);
    if (result.ok) {
      const id = result.data["id"] as string | undefined;
      if (id) {
        router.push(`/admin/recipes/${id}`);
      } else {
        router.push("/admin/recipes");
      }
    } else {
      setSaveError(t(resolveErrorKey(result.code)));
    }
  };

  // ── Callbacks for sub-sections ──
  const onAddDraftInput = (di: DraftInput) => setDraftInputs((prev) => [...prev, di]);
  const onAddDraftOutput = (dout: DraftOutput) => setDraftOutputs((prev) => [...prev, dout]);

  const removeDraftInput = (key: number) =>
    setDraftInputs((prev) => prev.filter((x) => x._key !== key));
  /** Catalog Phase 1 (P2-7): a draft line is edited in place, keeping its key and position. */
  const updateDraftInput = (key: number, di: Omit<DraftInput, "_key">) =>
    setDraftInputs((prev) => prev.map((x) => (x._key === key ? { ...di, _key: key } : x)));
  const removeDraftOutput = (key: number) =>
    setDraftOutputs((prev) => prev.filter((x) => x._key !== key));

  const unitRegistryOptions: RegistryOption[] = unitOptions.map((u) => ({
    id: u.id,
    label: u.label,
  }));

  // ── Draft save enabled? ──
  const draftSaveEnabled =
    nameVal.trim().length > 0 &&
    Number(batchYieldVal) > 0 &&
    draftInputs.length >= 1 &&
    draftOutputs.length >= 1;

  // ── Effective inputs/outputs for rendering ──
  const liveInputs: RecipeInputView[] = recipe ? recipe.inputs : [];
  const liveOutputs: RecipeOutputView[] = recipe ? recipe.outputs : [];

  return (
    // Focused width: the recipe editor is a form — keep it comfortable and
    // centered inside the wide admin container instead of stretching to full width.
    <div className="mt-2 mx-auto w-full max-w-3xl">
      {/* ── LIVE mode: what's-missing banner ── */}
      {recipe !== null && readiness && readiness.status !== "ready" ? (
        <div className="mt-3 rounded-lg border-2 border-co-border bg-co-surface p-3">
          <div className="flex items-center gap-2">
            <StatusBadge status={readiness.status as "incomplete" | "upstream_gaps"} />
          </div>
          <ReadinessReasons reasons={readiness.reasons} />
        </div>
      ) : null}

      {/* ── Header ── */}
      <div className="rounded-lg border-2 border-co-border bg-co-surface p-4">
        {/* Recipe type badge / selector */}
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          {recipe ? (
            <span className="rounded bg-co-gold/20 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-co-text">
              {recipe.recipeType === "production"
                ? t(rk("recipes.type.production"))
                : t(rk("recipes.type.consumer"))}
            </span>
          ) : (
            <label className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
                {t(rk("recipes.create.type_label"))}
              </span>
              <select
                className="min-h-[44px] rounded border-2 border-co-border bg-co-surface px-2 py-1 text-xs font-bold text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                value={draftType}
                onChange={(e) => setDraftType(e.target.value as RecipeType)}
              >
                <option value="production">{t(rk("recipes.type.production"))}</option>
                <option value="consumer">{t(rk("recipes.type.consumer"))}</option>
              </select>
            </label>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {/* Name EN */}
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t(rk("recipes.builder.name_en"))}</span>
            <input
              className={fieldCls}
              type="text"
              value={nameVal}
              disabled={(!canEdit) || patchBusy}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={recipe ? handleNameBlur : undefined}
            />
          </label>

          {/* Name ES */}
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t(rk("recipes.builder.name_es"))}</span>
            <input
              className={fieldCls}
              type="text"
              value={nameEsVal}
              disabled={(!canEdit) || patchBusy}
              onChange={(e) => setNameEsVal(e.target.value)}
              onBlur={recipe ? handleNameEsBlur : undefined}
            />
          </label>

          {/* Batch yield */}
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t(rk("recipes.builder.batch_yield"))}</span>
            <input
              className={fieldCls}
              type="number"
              min={0.001}
              step="any"
              inputMode="decimal"
              value={batchYieldVal}
              disabled={(!canEdit) || patchBusy}
              onChange={(e) => setBatchYieldVal(e.target.value)}
              onBlur={recipe ? handleBatchYieldBlur : undefined}
            />
          </label>

          {/* Shelf life (0215 batch vs bottle) */}
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t(rk("recipes.builder.shelf_life_days"))}</span>
            <input
              className={fieldCls}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              aria-label={t(rk("recipes.builder.shelf_life_days"))}
              value={shelfLifeVal}
              disabled={(!canEdit) || patchBusy}
              onChange={(e) => setShelfLifeVal(e.target.value)}
              onBlur={recipe ? handleShelfLifeBlur : undefined}
            />
            <span className="mt-1 block text-xs text-co-text-muted">{t(rk("recipes.builder.shelf_life_hint"))}</span>
          </label>

          {/* Batch mode (0215 batch vs bottle) */}
          <label className="flex min-h-[44px] items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-co-gold"
              aria-label={t(rk("recipes.builder.batch_mode"))}
              checked={batchModeVal}
              disabled={(!canEdit) || patchBusy}
              onChange={(e) => void handleBatchModeChange(e.target.checked)}
            />
            <span className="flex flex-col">
              <span className="text-sm font-bold text-co-text">{t(rk("recipes.builder.batch_mode"))}</span>
              <span className="text-xs text-co-text-muted">{t(rk("recipes.builder.batch_mode_hint"))}</span>
            </span>
          </label>

          {/* Directions (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setDirectionsOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-bold text-co-text-muted hover:text-co-text"
            >
              <span aria-hidden>{directionsOpen ? "▾" : "▸"}</span>
              {t(rk("recipes.builder.directions_toggle"))}
            </button>
            {directionsOpen ? (
              <div className="mt-2 flex flex-col gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.builder.directions_en"))}</span>
                  <textarea
                    className={textareaCls}
                    value={directionsVal}
                    disabled={(!canEdit) || patchBusy}
                    onChange={(e) => setDirectionsVal(e.target.value)}
                    onBlur={recipe ? handleDirectionsBlur : undefined}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.builder.directions_es"))}</span>
                  <textarea
                    className={textareaCls}
                    value={directionsEsVal}
                    disabled={(!canEdit) || patchBusy}
                    onChange={(e) => setDirectionsEsVal(e.target.value)}
                    onBlur={recipe ? handleDirectionsEsBlur : undefined}
                  />
                </label>
              </div>
            ) : null}
          </div>

          {patchError ? <p className="text-sm text-co-cta-text">{patchError}</p> : null}
        </div>
      </div>

      {/* ── CONSUMES ── */}
      <ConsumesSection
        recipeId={recipe?.id ?? null}
        liveInputs={liveInputs}
        draftInputs={draftInputs}
        skus={skus}
        items={items}
        products={products}
        measures={measures}
        activeMeasureLabels={activeMeasureLabels}
        unitRegistryOptions={unitRegistryOptions}
        canEdit={canEdit}
        level={level}
        isDraft={recipe === null}
        onAddDraftInput={(di) => onAddDraftInput({ ...di, _key: nextKey() })}
        onRemoveDraftInput={removeDraftInput}
        onUpdateDraftInput={updateDraftInput}
        onRemoveLive={(id) => void removeEdge("recipe_inputs", id)}
      />

      {/* ── PRODUCES ── */}
      <ProducesSection
        recipeId={recipe?.id ?? null}
        recipeType={effectiveType}
        batchYield={recipe ? recipe.batchYield : (Number(batchYieldVal) || 1)}
        liveOutputs={liveOutputs}
        liveInputs={liveInputs}
        draftOutputs={draftOutputs}
        items={items}
        unitRegistryOptions={unitRegistryOptions}
        canEdit={canEdit}
        level={level}
        isDraft={recipe === null}
        onAddDraftOutput={(dout) => onAddDraftOutput({ ...dout, _key: nextKey() })}
        onRemoveDraftOutput={removeDraftOutput}
        onRemoveLive={(id) => void removeEdge("recipe_outputs", id)}
      />

      {/* ── DRAFT save bar ── */}
      {recipe === null && canEdit ? (
        <div className="mt-4 rounded-lg border-2 border-co-gold-deep bg-co-surface p-4">
          {saveError ? <p className="mb-3 text-sm text-co-cta-text">{saveError}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={saveBusy || !draftSaveEnabled}
              onClick={() => void saveDraft()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-6 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
            >
              {saveBusy ? t(rk("recipes.draft.saving")) : t(rk("recipes.draft.save"))}
            </button>
          </div>
          <p className="mt-2 text-xs text-co-text-muted">
            {t(rk("recipes.draft.save_hint"))}
          </p>
        </div>
      ) : null}

      {/* ── LIVE READOUT ── */}
      {recipe !== null ? (
        <LiveReadout
          inputs={liveInputs}
          outputs={liveOutputs}
          batchYield={recipe.batchYield}
          skus={skus}
          measures={measures}
        />
      ) : (
        <DraftReadout
          draftInputs={draftInputs}
          draftOutputs={draftOutputs}
          batchYield={Number(batchYieldVal) || 1}
          skus={skus}
          measures={measures}
        />
      )}

      {/* ── LIVE mode: delete (deactivate) ── */}
      {recipe !== null && canDelete ? (
        <div className="mt-6">
        <CollapsibleSection
          idBase="recipe-danger"
          title={t(rk("recipes.delete.danger_title"))}
          // D2 strict: a persisted delete error stays visible even if the section is
          // re-collapsed after the failure (badge slot renders in both states).
          badge={deleteError ? <span className="text-xs font-semibold text-co-cta-text">{deleteError}</span> : undefined}
        >
          {confirmDelete ? (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setConfirmDelete(false)}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
              >
                {t(rk("recipes.delete.cancel"))}
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => void deleteRecipe()}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
              >
                {t(rk("recipes.delete.confirm"))}
              </button>
            </div>
          ) : (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { setDeleteError(null); setConfirmDelete(true); }}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-4 text-sm font-bold text-co-cta-text hover:border-co-cta-text"
              >
                {t(rk("recipes.delete.button"))}
              </button>
            </div>
          )}
        </CollapsibleSection>
        </div>
      ) : null}
    </div>
  );
}

// ── CONSUMES section ─────────────────────────────────────────────────────────
// ONE add/edit form for all three kinds (catalog redesign Phase 1, 2026-10-15): the searchable
// IngredientPicker replaced the per-kind forms and their unsearchable selects. A SAVED line is
// edited in place through PATCH …/inputs/[inputId] with the line the client saw (compare-and-set);
// a DRAFT line is edited in place locally — it is not on the server until the recipe saves.
// A live edit captures its starting line AND the compare-and-set snapshot ONCE, when Edit is
// tapped (beginLineEdit): a router.refresh() mid-edit must not quietly move "what I saw" (r2 #1).
type LineEditing = ({ kind: "live" } & LineEditStart) | { kind: "draft"; key: number } | null;

function ConsumesSection({
  recipeId,
  liveInputs,
  draftInputs,
  skus,
  items,
  products,
  measures,
  activeMeasureLabels,
  canEdit,
  isDraft,
  onAddDraftInput,
  onRemoveDraftInput,
  onUpdateDraftInput,
  onRemoveLive,
}: {
  recipeId: string | null;
  liveInputs: RecipeInputView[];
  draftInputs: DraftInput[];
  skus: RecipeBuilderSku[];
  items: Array<{ id: string; name: string }>;
  products: RecipeBuilderProduct[];
  measures: Map<string, MeasureUnitFactor>;
  activeMeasureLabels?: string[];
  /** Kept so the call site is unchanged; the line editor needs neither. */
  unitRegistryOptions: RegistryOption[];
  level: number;
  canEdit: boolean;
  isDraft: boolean;
  onAddDraftInput: (di: Omit<DraftInput, "_key">) => void;
  onRemoveDraftInput: (key: number) => void;
  onUpdateDraftInput: (key: number, di: Omit<DraftInput, "_key">) => void;
  onRemoveLive: (id: string) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LineEditing>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Disclosure (D3: PRIMARY work section → default-open; D10: locked open while a form is in
  // progress so the dirty line stays mounted).
  const [sectionOpen, setSectionOpen] = useState(true);
  const formInProgress = adding || editing !== null;
  const isOpen = sectionOpen || formInProgress;
  const live = editing?.kind === "live" ? editing : null;
  // Chunk-3 review (c): the row being edited vanished after a refresh (removed elsewhere) — drop
  // the editor during render (the prev-compare idiom, never an effect).
  if (live && !liveInputs.some((i) => i.id === live.id)) setEditing(null);

  const options = useMemo(() => buildIngredientOptions({ skus, items, products }), [skus, items, products]);

  const lineBody = (line: RecipeLineDraft) => ({
    componentSkuId: line.componentSkuId,
    componentItemId: line.componentItemId,
    componentProductId: line.componentProductId,
    quantity: line.quantity,
    unit: line.unit,
    eachContainerLabel: line.eachContainerLabel,
    portioned: line.portioned,
  });
  const toDraftInput = (line: RecipeLineDraft): Omit<DraftInput, "_key"> =>
    ({ kind: recipeLineKind(line), ...lineBody(line), componentName: line.componentName });
  const draftLine = (di: DraftInput): RecipeLineDraft => ({
    componentSkuId: di.componentSkuId,
    componentItemId: di.componentItemId,
    componentProductId: di.componentProductId,
    quantity: di.quantity,
    unit: di.unit,
    eachContainerLabel: di.eachContainerLabel,
    portioned: di.portioned,
    componentName: di.componentName,
  });

  const closeForms = () => {
    setAdding(false);
    setEditing(null);
    setErrorMsg(null);
  };

  const submitAdd = async (line: RecipeLineDraft) => {
    if (busy) return;
    setErrorMsg(null);
    if (isDraft) {
      // A draft line is local until the whole recipe saves — that save asks for the window.
      onAddDraftInput(toDraftInput(line));
      closeForms();
      return;
    }
    if (!recipeId) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const result = await send(`/api/admin/recipes/${recipeId}/inputs`, lineBody(line));
    setBusy(false);
    if (result.ok) { closeForms(); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const submitLiveEdit = async (start: LineEditStart, line: RecipeLineDraft) => {
    if (busy || !recipeId) return;
    setErrorMsg(null);
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const result = await send(
      `/api/admin/recipes/${recipeId}/inputs/${start.id}`,
      { line: lineBody(line), expected: start.expected },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) { closeForms(); router.refresh(); }
    else {
      setErrorMsg(t(resolveErrorKey(result.code)));
      // Someone else changed the line first: refresh so the next Edit captures the fresh row.
      if (result.code === "line_changed") router.refresh();
    }
  };

  const submitDraftEdit = (key: number, line: RecipeLineDraft) => {
    onUpdateDraftInput(key, toDraftInput(line));
    closeForms();
  };

  return (
    <div className="mt-4">
    <CollapsibleSection
      idBase="recipe-consumes"
      title={t(rk("recipes.builder.consumes_title"))}
      count={t(rk("recipes.builder.consumes_count"), { n: liveInputs.length + draftInputs.length })}
      open={isOpen}
      onToggle={() => { if (!formInProgress) setSectionOpen((v) => !v); }}
    >
      <p className="mt-1 text-xs text-co-text-muted">{t(rk("recipes.builder.consumes_subtitle"))}</p>

      {/* Saved rows — each one edits in place */}
      {liveInputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {liveInputs.map((inp) =>
            live && live.id === inp.id ? (
              <RecipeLineEditor
                key={inp.id}
                title={t(rk("recipes.row.edit_title"))}
                submitLabel={t(rk("recipes.row.save_changes"))}
                options={options}
                skus={skus}
                products={products}
                measures={measures}
                activeMeasureLabels={activeMeasureLabels}
                initial={live.initial}
                busy={busy}
                errorMsg={errorMsg}
                onSubmit={(line) => void submitLiveEdit(live, line)}
                onCancel={closeForms}
              />
            ) : (
              <RecipeInputRow
                key={inp.id}
                input={inp}
                canEdit={canEdit && !formInProgress}
                onEdit={() => { setAdding(false); setErrorMsg(null); setEditing({ kind: "live", ...beginLineEdit(inp) }); }}
                onRemove={onRemoveLive}
              />
            ),
          )}
        </div>
      ) : null}

      {/* Draft rows — edit in place too (P2-7) */}
      {draftInputs.length > 0 ? (
        <div className={`${liveInputs.length > 0 ? "mt-2" : "mt-3"} flex flex-col gap-2`}>
          {draftInputs.map((di) =>
            editing?.kind === "draft" && editing.key === di._key ? (
              <RecipeLineEditor
                key={di._key}
                title={t(rk("recipes.row.edit_title"))}
                submitLabel={t(rk("recipes.row.save_changes"))}
                options={options}
                skus={skus}
                products={products}
                measures={measures}
                activeMeasureLabels={activeMeasureLabels}
                initial={draftLine(di)}
                busy={busy}
                errorMsg={errorMsg}
                onSubmit={(line) => submitDraftEdit(di._key, line)}
                onCancel={closeForms}
              />
            ) : (
              <DraftInputRow
                key={di._key}
                di={di}
                skus={skus}
                products={products}
                measures={measures}
                onEdit={formInProgress ? undefined : () => { setAdding(false); setErrorMsg(null); setEditing({ kind: "draft", key: di._key }); }}
                onRemove={() => onRemoveDraftInput(di._key)}
              />
            ),
          )}
        </div>
      ) : null}

      {liveInputs.length === 0 && draftInputs.length === 0 ? (
        <p className="mt-3 text-xs text-co-text-muted">{t(rk("recipes.builder.consumes_empty"))}</p>
      ) : null}

      {canEdit ? (
        <div className="mt-4">
          {adding ? (
            <RecipeLineEditor
              title={t(rk("recipes.builder.add_ingredient_title"))}
              submitLabel={t(rk("recipes.builder.save"))}
              options={options}
              skus={skus}
              products={products}
              measures={measures}
              activeMeasureLabels={activeMeasureLabels}
              initial={null}
              busy={busy}
              errorMsg={errorMsg}
              onSubmit={(line) => void submitAdd(line)}
              onCancel={closeForms}
            />
          ) : editing === null ? (
            <button
              type="button"
              onClick={() => { setErrorMsg(null); setAdding(true); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
            >
              {t(rk("recipes.builder.add_ingredient"))}
            </button>
          ) : null}
        </div>
      ) : null}
    </CollapsibleSection>
    </div>
  );
}

// ── DraftInputRow — a pending draft input with Edit and Remove ───────────────
function DraftInputRow({
  di,
  skus,
  products,
  measures,
  onEdit,
  onRemove,
}: {
  di: DraftInput;
  skus: RecipeBuilderSku[];
  products: RecipeBuilderProduct[];
  measures: Map<string, MeasureUnitFactor>;
  /** Open the in-place editor; absent while another line form is open. */
  onEdit?: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const label = [
    di.quantity > 0 ? String(di.quantity) : null,
    di.unit ?? null,
    di.componentName,
  ].filter(Boolean).join(" ");

  // oz readout for draft SKU input
  let ozNote: string | null = null;
  if (di.kind === "sku" && di.componentSkuId && di.unit) {
    const sku = skus.find((s) => s.id === di.componentSkuId);
    if (sku) {
      const oz = ozForRecipeInput(di.quantity, di.unit, sku, measures);
      if (oz != null) ozNote = `≈ ${oz.toFixed(1)} oz`;
    }
  }
  // …and for a draft PRODUCT input, through the SAME measure-only basis the flatten
  // uses (productInputBasis), never through whichever member happens to be primary.
  if (di.kind === "product" && di.componentProductId && di.unit) {
    const p = products.find((x) => x.id === di.componentProductId);
    if (p) {
      const oz = ozForRecipeInput(di.quantity, di.unit, productInputBasis({ productId: p.id, unitOz: p.unitOz }, null), measures);
      if (oz != null) ozNote = `≈ ${oz.toFixed(1)} oz`;
    }
  }

  const metaParts: string[] = [];
  if (di.eachContainerLabel) metaParts.push(t(rk("recipes.input.container_label")) + ": " + di.eachContainerLabel);
  if (di.portioned) metaParts.push(t(rk("recipes.input.portioned_tag")));
  metaParts.push(
    di.kind === "product" ? t(rk("recipes.input.product_tag"))
      : di.kind === "sku" ? t(rk("recipes.input.sku_tag"))
        : t(rk("recipes.input.item_tag")),
  );
  if (ozNote) metaParts.push(ozNote);
  const meta = metaParts.join(" · ");

  return (
    <div className="rounded-lg border-2 border-co-gold-deep/50 bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-co-text">{label}</p>
          {meta ? <p className="text-xs text-co-text-muted">{meta}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              aria-label={t(rk("recipes.row.edit_aria"), { name: di.componentName })}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
            >
              {t(rk("recipes.row.edit"))}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta-text hover:border-co-cta-text"
          >
            {t(rk("recipes.row.remove"))}
          </button>
        </div>
      </div>
      {confirming ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta-text bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">{t(rk("recipes.row.confirm_remove"))}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text">
              {t(rk("recipes.row.cancel"))}
            </button>
            <button type="button" onClick={() => { setConfirming(false); onRemove(); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text">
              {t(rk("recipes.row.remove"))}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── PRODUCES section ─────────────────────────────────────────────────────────
function ProducesSection({
  recipeId,
  recipeType,
  batchYield,
  liveOutputs,
  liveInputs,
  draftOutputs,
  items,
  unitRegistryOptions,
  canEdit,
  level,
  isDraft,
  onAddDraftOutput,
  onRemoveDraftOutput,
  onRemoveLive,
}: {
  recipeId: string | null;
  recipeType: "production" | "consumer";
  batchYield: number;
  liveOutputs: RecipeOutputView[];
  liveInputs: RecipeInputView[];
  draftOutputs: DraftOutput[];
  items: Array<{ id: string; name: string }>;
  unitRegistryOptions: RegistryOption[];
  canEdit: boolean;
  level: number;
  isDraft: boolean;
  onAddDraftOutput: (dout: Omit<DraftOutput, "_key">) => void;
  onRemoveDraftOutput: (key: number) => void;
  onRemoveLive: (id: string) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();

  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Disclosure (D3: PRIMARY work section → default-open; D10: locked open while
  // the add-form is in progress so the dirty draft stays mounted). Uncontrolled-
  // style toggle otherwise (lift open state + force true while form open).
  const [sectionOpen, setSectionOpen] = useState(true);
  const formInProgress = addOpen === true;
  const isOpen = sectionOpen || formInProgress;

  // Production output state
  const [outputItemId, setOutputItemId] = useState("");
  const [outputYield, setOutputYield] = useState("1");
  const [outputContainerLabel, setOutputContainerLabel] = useState("");

  // Consumer menu-item output state
  const [menuItemName, setMenuItemName] = useState("");
  const [menuItemPrice, setMenuItemPrice] = useState("");
  const [menuItemYield, setMenuItemYield] = useState("1");

  const resetForms = () => {
    setOutputItemId(""); setOutputYield("1"); setOutputContainerLabel("");
    setMenuItemName(""); setMenuItemPrice(""); setMenuItemYield("1");
    setErrorMsg(null);
  };

  const submitProductionOutput = async () => {
    if (busy) return;
    setErrorMsg(null);
    const yld = Number(outputYield);
    if (!outputItemId) { setErrorMsg(t(rk("recipes.error.invalid_output_item"))); return; }
    if (!Number.isFinite(yld) || yld <= 0) { setErrorMsg(t(rk("recipes.error.invalid_yield"))); return; }
    if ((await requestStepUp("E")) !== "ok") return;

    const itemObj = items.find((i) => i.id === outputItemId);

    if (isDraft) {
      onAddDraftOutput({
        kind: "item",
        outputItemId,
        outputMenuItemId: null,
        outputName: itemObj?.name ?? outputItemId,
        yield: yld,
        outputContainerLabel: outputContainerLabel || null,
      });
      resetForms(); setAddOpen(false);
    } else {
      if (!recipeId) return;
      setBusy(true);
      const result = await send(`/api/admin/recipes/${recipeId}/outputs`, {
        outputItemId,
        yield: yld,
        outputContainerLabel: outputContainerLabel || null,
      });
      setBusy(false);
      if (result.ok) { resetForms(); setAddOpen(false); router.refresh(); }
      else setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const submitConsumerOutput = async () => {
    if (busy) return;
    setErrorMsg(null);
    const yld = Number(menuItemYield);
    if (!Number.isFinite(yld) || yld <= 0) { setErrorMsg(t(rk("recipes.error.invalid_yield"))); return; }
    const name = menuItemName.trim();
    if (!name) { setErrorMsg(t(rk("recipes.error.invalid_name"))); return; }
    if ((await requestStepUp("E")) !== "ok") return;

    if (isDraft) {
      onAddDraftOutput({
        kind: "menuItem",
        outputItemId: null,
        outputMenuItemId: null, // will be resolved on save
        outputName: name,
        yield: yld,
        outputContainerLabel: null,
      });
      resetForms(); setAddOpen(false);
    } else {
      if (!recipeId) return;
      setBusy(true);
      const price = menuItemPrice.trim() ? Number(menuItemPrice) : null;
      const miResult = await send("/api/admin/menu-items", {
        name,
        menuPrice: price,
      });
      if (!miResult.ok) { setBusy(false); setErrorMsg(t(resolveErrorKey(miResult.code))); return; }
      const menuId = miResult.data["id"] as string | null;
      if (!menuId) { setBusy(false); setErrorMsg(t(rk("recipes.error.invalid_output_menu_item"))); return; }
      const result = await send(`/api/admin/recipes/${recipeId}/outputs`, {
        outputMenuItemId: menuId,
        yield: yld,
      });
      setBusy(false);
      if (result.ok) { resetForms(); setAddOpen(false); router.refresh(); }
      else setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div className="mt-4">
    <CollapsibleSection
      idBase="recipe-produces"
      title={t(rk("recipes.builder.produces_title"))}
      count={t(rk("recipes.builder.produces_count"), { n: liveOutputs.length + draftOutputs.length })}
      open={isOpen}
      onToggle={() => { if (!formInProgress) setSectionOpen((v) => !v); }}
    >
      <p className="mt-1 text-xs text-co-text-muted">
        {recipeType === "production"
          ? t(rk("recipes.builder.produces_subtitle_production"))
          : t(rk("recipes.builder.produces_subtitle_consumer"))}
      </p>

      {/* Live rows */}
      {liveOutputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {liveOutputs.map((out) => (
            <RecipeOutputRow key={out.id} output={out} canEdit={canEdit} onRemove={onRemoveLive} />
          ))}
        </div>
      ) : null}

      {/* Draft rows */}
      {draftOutputs.length > 0 ? (
        <div className={`${liveOutputs.length > 0 ? "mt-2" : "mt-3"} flex flex-col gap-2`}>
          {draftOutputs.map((dout) => (
            <DraftOutputRow
              key={dout._key}
              dout={dout}
              onRemove={() => onRemoveDraftOutput(dout._key)}
            />
          ))}
        </div>
      ) : null}

      {liveOutputs.length === 0 && draftOutputs.length === 0 ? (
        <p className="mt-3 text-xs text-co-text-muted">{t(rk("recipes.builder.produces_empty"))}</p>
      ) : null}

      {canEdit ? (
        <div className="mt-4">
          {!addOpen ? (
            <button
              type="button"
              onClick={() => { resetForms(); setAddOpen(true); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
            >
              {recipeType === "production"
                ? t(rk("recipes.builder.add_output_item"))
                : t(rk("recipes.builder.add_output_menu_item"))}
            </button>
          ) : recipeType === "production" ? (
            <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
              <h3 className="text-sm font-extrabold text-co-text">{t(rk("recipes.builder.add_output_item"))}</h3>
              <div className="mt-3 flex flex-col gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.output.pick_item"))}</span>
                  <select className={fieldCls} value={outputItemId} disabled={busy} onChange={(e) => setOutputItemId(e.target.value)}>
                    <option value="">{t(rk("recipes.output.pick_item"))}</option>
                    {items.map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.output.yield"))}</span>
                  <input className={fieldCls} type="number" min={0.001} step="any" inputMode="decimal"
                    value={outputYield} disabled={busy} onChange={(e) => setOutputYield(e.target.value)} />
                </label>
                {/* Locked output container dropdown */}
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.output.container_label"))}</span>
                  <select className={fieldCls} value={outputContainerLabel} disabled={busy}
                    onChange={(e) => setOutputContainerLabel(e.target.value)}>
                    <option value="">{t(rk("recipes.output.container_placeholder"))}</option>
                    {unitRegistryOptions.map((u) => (<option key={u.id} value={u.label}>{u.label}</option>))}
                  </select>
                </label>
                {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={() => { resetForms(); setAddOpen(false); }}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">
                    {t(rk("recipes.builder.cancel"))}
                  </button>
                  <button type="button" disabled={busy || !outputItemId} onClick={() => void submitProductionOutput()}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">
                    {t(rk("recipes.builder.save"))}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* consumer recipe: create menu-item inline */
            <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
              <h3 className="text-sm font-extrabold text-co-text">{t(rk("recipes.consumer.output_title"))}</h3>
              <p className="mt-1 text-xs text-co-text-muted">{t(rk("recipes.consumer.output_hint"))}</p>
              <div className="mt-3 flex flex-col gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.consumer.menu_item_name"))}</span>
                  <input className={fieldCls} type="text" value={menuItemName} disabled={busy}
                    onChange={(e) => setMenuItemName(e.target.value)} placeholder={t(rk("recipes.consumer.menu_item_name_placeholder"))} />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.consumer.menu_price"))}</span>
                  <input className={fieldCls} type="number" min={0} step="0.01" inputMode="decimal"
                    value={menuItemPrice} disabled={busy} onChange={(e) => setMenuItemPrice(e.target.value)}
                    placeholder={t(rk("recipes.consumer.menu_price_optional"))} />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.output.yield"))}</span>
                  <input className={fieldCls} type="number" min={0.001} step="any" inputMode="decimal"
                    value={menuItemYield} disabled={busy} onChange={(e) => setMenuItemYield(e.target.value)} />
                </label>
                {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={() => { resetForms(); setAddOpen(false); }}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">
                    {t(rk("recipes.builder.cancel"))}
                  </button>
                  <button type="button" disabled={busy || !menuItemName.trim()} onClick={() => void submitConsumerOutput()}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">
                    {t(rk("recipes.builder.save"))}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </CollapsibleSection>
    </div>
  );
}

// ── DraftOutputRow — display a pending draft output with remove ───────────────
function DraftOutputRow({
  dout,
  onRemove,
}: {
  dout: DraftOutput;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const label = `${dout.yield} × ${dout.outputName}`;
  const meta = [
    dout.outputContainerLabel ? t(rk("recipes.output.container_label")) + ": " + dout.outputContainerLabel : null,
    dout.kind === "item" ? t(rk("recipes.output.item_tag")) : t(rk("recipes.output.menu_item_tag")),
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-lg border-2 border-co-gold-deep/50 bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-co-text">{label}</p>
          {meta ? <p className="text-xs text-co-text-muted">{meta}</p> : null}
        </div>
        <button type="button" onClick={() => setConfirming((v) => !v)}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta-text hover:border-co-cta-text">
          {t(rk("recipes.row.remove"))}
        </button>
      </div>
      {confirming ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta-text bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">{t(rk("recipes.row.confirm_remove"))}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text">
              {t(rk("recipes.row.cancel"))}
            </button>
            <button type="button" onClick={() => { setConfirming(false); onRemove(); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text">
              {t(rk("recipes.row.remove"))}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── LIVE READOUT ─────────────────────────────────────────────────────────────
function LiveReadout({
  inputs,
  outputs,
  batchYield,
  skus,
  measures,
}: {
  inputs: RecipeInputView[];
  outputs: RecipeOutputView[];
  batchYield: number;
  skus: RecipeBuilderSku[];
  measures: Map<string, MeasureUnitFactor>;
}) {
  const { t } = useTranslation();
  if (inputs.length === 0 && outputs.length === 0) return null;

  // Per-batch oz total for the collapsed summary (D5): sum of the same
  // per-input oz values the expanded body renders. When NO input resolves to
  // oz, count stays null (no "≈ 0 oz").
  let perBatchOz = 0;
  let anyOz = false;
  for (const inp of inputs) {
    if (inp.componentSkuId && inp.unit) {
      const sku = skus.find((s) => s.id === inp.componentSkuId);
      if (sku) {
        const oz = ozForRecipeInput(inp.quantity, inp.unit, sku, measures);
        if (oz != null) { perBatchOz += oz; anyOz = true; }
      }
    }
  }
  const perBatchSummary = anyOz
    ? t(rk("recipes.readout.per_batch_summary"), { n: perBatchOz.toFixed(1) })
    : null;

  return (
    <div className="mt-4">
    <CollapsibleSection
      idBase="recipe-readout-live"
      title={t(rk("recipes.readout.title"))}
      count={perBatchSummary}
    >
      <p className="mt-1 text-xs text-co-text-muted">{t(rk("recipes.readout.oz_note"))}</p>
      {inputs.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1">
          {inputs.map((inp) => {
            const qtyLabel = `${inp.quantity}${inp.unit ? " " + inp.unit : ""}`;
            let ozLabel = "";
            if (inp.componentSkuId && inp.unit) {
              const sku = skus.find((s) => s.id === inp.componentSkuId);
              if (sku) {
                const oz = ozForRecipeInput(inp.quantity, inp.unit, sku, measures);
                if (oz != null) ozLabel = ` ≈ ${oz.toFixed(1)} oz`;
              }
            }
            return (
              <p key={inp.id} className="text-xs text-co-text">
                <span className="font-bold">{inp.componentName}</span>
                {" "}{qtyLabel}{ozLabel}
              </p>
            );
          })}
        </div>
      ) : null}
      {outputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {outputs.map((out) => {
            const firstInput = inputs[0];
            const inputLabel = firstInput
              ? `${firstInput.quantity}${firstInput.unit ? " " + firstInput.unit : ""}`
              : t(rk("recipes.readout.batch_fallback"));
            const outputLabel = `${out.yield}${out.outputContainerLabel ? " " + out.outputContainerLabel : ""}`;
            return (
              <p key={out.id} className="text-sm text-co-text">
                {t(rk("recipes.readout.line"), {
                  input: `1 ${inputLabel}`,
                  output: `${outputLabel} ${out.outputName}`,
                })}
              </p>
            );
          })}
          <p className="mt-1 text-xs text-co-text-muted">
            {t(rk("recipes.readout.batch_yield_note"), { n: String(batchYield) })}
          </p>
        </div>
      ) : null}
    </CollapsibleSection>
    </div>
  );
}

// ── DRAFT READOUT ─────────────────────────────────────────────────────────────
function DraftReadout({
  draftInputs,
  draftOutputs,
  batchYield,
  skus,
  measures,
}: {
  draftInputs: DraftInput[];
  draftOutputs: DraftOutput[];
  batchYield: number;
  skus: RecipeBuilderSku[];
  measures: Map<string, MeasureUnitFactor>;
}) {
  const { t } = useTranslation();
  if (draftInputs.length === 0 && draftOutputs.length === 0) return null;

  // Per-batch oz total for the collapsed summary (D5): sum of the same
  // per-input oz values the expanded body renders. When NO input resolves to
  // oz, count stays null (no "≈ 0 oz").
  let perBatchOz = 0;
  let anyOz = false;
  for (const di of draftInputs) {
    if (di.kind === "sku" && di.componentSkuId && di.unit) {
      const sku = skus.find((s) => s.id === di.componentSkuId);
      if (sku) {
        const oz = ozForRecipeInput(di.quantity, di.unit, sku, measures);
        if (oz != null) { perBatchOz += oz; anyOz = true; }
      }
    }
  }
  const perBatchSummary = anyOz
    ? t(rk("recipes.readout.per_batch_summary"), { n: perBatchOz.toFixed(1) })
    : null;

  return (
    <div className="mt-4">
    <CollapsibleSection
      idBase="recipe-readout-draft"
      title={t(rk("recipes.readout.title"))}
      count={perBatchSummary}
    >
      {draftInputs.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1">
          {draftInputs.map((di) => {
            const qtyLabel = `${di.quantity}${di.unit ? " " + di.unit : ""}`;
            let ozLabel = "";
            if (di.kind === "sku" && di.componentSkuId && di.unit) {
              const sku = skus.find((s) => s.id === di.componentSkuId);
              if (sku) {
                const oz = ozForRecipeInput(di.quantity, di.unit, sku, measures);
                if (oz != null) ozLabel = ` ≈ ${oz.toFixed(1)} oz`;
              }
            }
            return (
              <p key={di._key} className="text-xs text-co-text">
                <span className="font-bold">{di.componentName}</span>
                {" "}{qtyLabel}{ozLabel}
              </p>
            );
          })}
        </div>
      ) : null}
      {draftOutputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1">
          {draftOutputs.map((dout) => {
            const outputLabel = `${dout.yield}${dout.outputContainerLabel ? " " + dout.outputContainerLabel : ""}`;
            return (
              <p key={dout._key} className="text-sm text-co-text">
                {outputLabel} {dout.outputName}
              </p>
            );
          })}
          <p className="mt-1 text-xs text-co-text-muted">
            {t(rk("recipes.readout.batch_yield_note"), { n: String(batchYield) })}
          </p>
        </div>
      ) : null}
    </CollapsibleSection>
    </div>
  );
}
