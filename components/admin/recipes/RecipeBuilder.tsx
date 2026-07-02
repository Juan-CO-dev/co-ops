"use client";

/**
 * RecipeBuilder — adaptive form for /admin/recipes/[id] (LIVE mode) and
 * /admin/recipes/new (DRAFT mode).
 *
 * DRAFT mode  (recipe == null):
 *   Header fields (name/nameEs/batchYield/directions/directionsEs) + recipe_type
 *   are local state. Inputs + outputs are draft arrays. A single Save button
 *   POSTs the entire draft to /api/admin/recipes/full after requestStepUp("B"),
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

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { RegistrySelect } from "@/components/admin/skus/RegistrySelect";
import type { RecipeView, RecipeInputView, RecipeOutputView, RecipeType } from "@/lib/recipes";
import { RECIPE_WRITE_MIN } from "@/lib/recipes";
import type { RegistryOption } from "@/lib/admin/skus";
import type { TranslationKey } from "@/lib/i18n/types";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import { ozForRecipeInput } from "@/lib/recipe-math";
import { postJson, resolveErrorKey } from "./shared";

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
}

// ── Draft input/output shapes ────────────────────────────────────────────────
interface DraftInput {
  _key: number;
  kind: "sku" | "item";
  componentSkuId: string | null;
  componentItemId: string | null;
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

type InputKind = "sku" | "item";

// ── RecipeBuilder ────────────────────────────────────────────────────────────
export function RecipeBuilder({
  recipe,
  skus,
  items,
  unitOptions,
  measures,
  level,
  defaultType = "production",
}: {
  recipe: RecipeView | null;
  skus: RecipeBuilderSku[];
  items: Array<{ id: string; name: string }>;
  unitOptions: Array<{ id: string; label: string }>;
  measures: Map<string, MeasureUnitFactor>;
  level: number;
  defaultType?: RecipeType;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canEdit = level >= RECIPE_WRITE_MIN;

  // ── LIVE mode: header patch state ──
  const [patchError, setPatchError] = useState<string | null>(null);
  const [patchBusy, setPatchBusy] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);

  // ── Header local state (used by both modes; LIVE patches on blur, DRAFT collects) ──
  const [nameVal, setNameVal] = useState(recipe?.name ?? "");
  const [nameEsVal, setNameEsVal] = useState(recipe?.nameEs ?? "");
  const [batchYieldVal, setBatchYieldVal] = useState(String(recipe?.batchYield ?? "1"));
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
    setPatchError(null);
    setPatchBusy(true);
    const result = await postJson(
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
    const result = await postJson("/api/admin/recipes/edges", { table, id: edgeId }, "DELETE");
    if (result.ok) {
      router.refresh();
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
    if (draftInputs.length === 0) { setSaveError(t(rk("recipes.draft.error_no_inputs"))); return; }
    if (draftOutputs.length === 0) { setSaveError(t(rk("recipes.draft.error_no_outputs"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSaveBusy(true);
    const result = await postJson("/api/admin/recipes/full", {
      name,
      nameEs: nameEsVal.trim() || null,
      recipeType: effectiveType,
      batchYield,
      directions: directionsVal.trim() || null,
      directionsEs: directionsEsVal.trim() || null,
      inputs: draftInputs.map((inp) => ({
        componentSkuId: inp.componentSkuId ?? undefined,
        componentItemId: inp.componentItemId ?? undefined,
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
    <div className="mt-2">
      {/* ── Header ── */}
      <div className="rounded-lg border-2 border-co-border bg-co-surface p-4">
        {/* Recipe type badge / selector */}
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          {recipe ? (
            <span className="rounded bg-co-gold/30 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-co-text">
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
                className="rounded border-2 border-co-border bg-co-surface px-2 py-1 text-xs font-bold text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                value={draftType}
                onChange={(e) => setDraftType(e.target.value as RecipeType)}
              >
                <option value="production">{t(rk("recipes.type.production"))}</option>
                <option value="consumer">{t(rk("recipes.type.consumer"))}</option>
              </select>
            </label>
          )}
          {recipe && (!recipe.inputs.length || !recipe.outputs.length) ? (
            <span className="rounded bg-co-cta/15 px-2 py-0.5 text-xs font-bold text-co-cta">
              {t(rk("recipes.badge.incomplete"))}
            </span>
          ) : null}
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

          {patchError ? <p className="text-sm text-co-cta">{patchError}</p> : null}
        </div>
      </div>

      {/* ── CONSUMES ── */}
      <ConsumesSection
        recipeId={recipe?.id ?? null}
        liveInputs={liveInputs}
        draftInputs={draftInputs}
        skus={skus}
        items={items}
        measures={measures}
        unitRegistryOptions={unitRegistryOptions}
        canEdit={canEdit}
        level={level}
        isDraft={recipe === null}
        onAddDraftInput={(di) => onAddDraftInput({ ...di, _key: nextKey() })}
        onRemoveDraftInput={removeDraftInput}
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
          {saveError ? <p className="mb-3 text-sm text-co-cta">{saveError}</p> : null}
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
    </div>
  );
}

// ── CONSUMES section ─────────────────────────────────────────────────────────
function ConsumesSection({
  recipeId,
  liveInputs,
  draftInputs,
  skus,
  items,
  measures,
  unitRegistryOptions,
  canEdit,
  level,
  isDraft,
  onAddDraftInput,
  onRemoveDraftInput,
  onRemoveLive,
}: {
  recipeId: string | null;
  liveInputs: RecipeInputView[];
  draftInputs: DraftInput[];
  skus: RecipeBuilderSku[];
  items: Array<{ id: string; name: string }>;
  measures: Map<string, MeasureUnitFactor>;
  unitRegistryOptions: RegistryOption[];
  canEdit: boolean;
  level: number;
  isDraft: boolean;
  onAddDraftInput: (di: Omit<DraftInput, "_key">) => void;
  onRemoveDraftInput: (key: number) => void;
  onRemoveLive: (id: string) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [addKind, setAddKind] = useState<InputKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // SKU form state
  const [skuId, setSkuId] = useState("");
  const [skuQty, setSkuQty] = useState("");
  const [skuUnit, setSkuUnit] = useState("");
  const [skuPortioned, setSkuPortioned] = useState(false);

  // Item form state
  const [itemId, setItemId] = useState("");
  const [itemQty, setItemQty] = useState("");
  const [itemUnit, setItemUnit] = useState("");

  const resetForms = () => {
    setSkuId(""); setSkuQty(""); setSkuUnit(""); setSkuPortioned(false);
    setItemId(""); setItemQty(""); setItemUnit("");
    setErrorMsg(null);
  };

  // Derive unit options for the selected SKU
  const selectedSku = skus.find((s) => s.id === skuId) ?? null;
  const skuUnitOptions: string[] = selectedSku
    ? [...new Set([
        selectedSku.packFormat,
        selectedSku.eachContainerLabel,
        selectedSku.eachMeasure,
      ].filter((v): v is string => v != null && v.length > 0))]
    : [];

  // Reset skuUnit when SKU changes
  const handleSkuChange = (newId: string) => {
    setSkuId(newId);
    setSkuUnit(""); // reset unit when SKU changes
  };

  // oz readout for current SKU form
  const skuOzReadout: string | null = (() => {
    if (!selectedSku || !skuUnit || !skuQty) return null;
    const qty = Number(skuQty);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    const oz = ozForRecipeInput(qty, skuUnit, selectedSku, measures);
    if (oz == null) return null;
    return `≈ ${oz.toFixed(1)} oz`;
  })();

  const submitSkuInput = async () => {
    if (busy) return;
    setErrorMsg(null);
    const qty = Number(skuQty);
    if (!skuId) { setErrorMsg(t(rk("recipes.error.invalid_sku"))); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setErrorMsg(t(rk("recipes.error.invalid_quantity"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;

    const skuObj = skus.find((s) => s.id === skuId);
    const resolvedEachContainerLabel = skuObj?.eachContainerLabel ?? null;

    if (isDraft) {
      onAddDraftInput({
        kind: "sku",
        componentSkuId: skuId,
        componentItemId: null,
        componentName: skuObj?.name ?? skuId,
        quantity: qty,
        unit: skuUnit || null,
        eachContainerLabel: resolvedEachContainerLabel,
        portioned: skuPortioned,
      });
      resetForms(); setAddKind(null);
    } else {
      if (!recipeId) return;
      setBusy(true);
      const result = await postJson(`/api/admin/recipes/${recipeId}/inputs`, {
        componentSkuId: skuId,
        quantity: qty,
        unit: skuUnit.trim() || null,
        eachContainerLabel: resolvedEachContainerLabel,
        portioned: skuPortioned,
      });
      setBusy(false);
      if (result.ok) { resetForms(); setAddKind(null); router.refresh(); }
      else setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const submitItemInput = async () => {
    if (busy) return;
    setErrorMsg(null);
    const qty = Number(itemQty);
    if (!itemId) { setErrorMsg(t(rk("recipes.error.invalid_component_item"))); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setErrorMsg(t(rk("recipes.error.invalid_quantity"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;

    const itemObj = items.find((i) => i.id === itemId);

    if (isDraft) {
      onAddDraftInput({
        kind: "item",
        componentSkuId: null,
        componentItemId: itemId,
        componentName: itemObj?.name ?? itemId,
        quantity: qty,
        unit: itemUnit.trim() || null,
        eachContainerLabel: null,
        portioned: false,
      });
      resetForms(); setAddKind(null);
    } else {
      if (!recipeId) return;
      setBusy(true);
      const result = await postJson(`/api/admin/recipes/${recipeId}/inputs`, {
        componentItemId: itemId,
        quantity: qty,
        unit: itemUnit.trim() || null,
      });
      setBusy(false);
      if (result.ok) { resetForms(); setAddKind(null); router.refresh(); }
      else setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div className="mt-4 rounded-lg border-2 border-co-border p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t(rk("recipes.builder.consumes_title"))}
      </h2>
      <p className="mt-1 text-xs text-co-text-muted">{t(rk("recipes.builder.consumes_subtitle"))}</p>

      {/* Live rows */}
      {liveInputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {liveInputs.map((inp) => (
            <RecipeInputRow key={inp.id} input={inp} canEdit={canEdit} onRemove={onRemoveLive} />
          ))}
        </div>
      ) : null}

      {/* Draft rows */}
      {draftInputs.length > 0 ? (
        <div className={`${liveInputs.length > 0 ? "mt-2" : "mt-3"} flex flex-col gap-2`}>
          {draftInputs.map((di) => (
            <DraftInputRow
              key={di._key}
              di={di}
              skus={skus}
              measures={measures}
              onRemove={() => onRemoveDraftInput(di._key)}
            />
          ))}
        </div>
      ) : null}

      {liveInputs.length === 0 && draftInputs.length === 0 ? (
        <p className="mt-3 text-xs text-co-text-muted">{t(rk("recipes.builder.consumes_empty"))}</p>
      ) : null}

      {canEdit ? (
        <div className="mt-4">
          {addKind === null ? (
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => { resetForms(); setAddKind("sku"); }}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
              >
                {t(rk("recipes.builder.add_sku_input"))}
              </button>
              <button
                type="button"
                onClick={() => { resetForms(); setAddKind("item"); }}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
              >
                {t(rk("recipes.builder.add_item_input"))}
              </button>
            </div>
          ) : addKind === "sku" ? (
            <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
              <h3 className="text-sm font-extrabold text-co-text">{t(rk("recipes.builder.add_sku_input"))}</h3>
              <div className="mt-3 flex flex-col gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.pick_sku"))}</span>
                  <select className={fieldCls} value={skuId} disabled={busy} onChange={(e) => handleSkuChange(e.target.value)}>
                    <option value="">{t(rk("recipes.input.pick_sku"))}</option>
                    {skus.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.quantity"))}</span>
                  <input className={fieldCls} type="number" min={0.001} step="any" inputMode="decimal"
                    value={skuQty} disabled={busy} onChange={(e) => setSkuQty(e.target.value)} />
                </label>
                {/* SKU-derived unit picker */}
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.unit"))}</span>
                  {skuUnitOptions.length > 0 ? (
                    <select className={fieldCls} value={skuUnit} disabled={busy || !skuId}
                      onChange={(e) => setSkuUnit(e.target.value)}>
                      <option value="">{t(rk("recipes.input.unit_placeholder"))}</option>
                      {skuUnitOptions.map((u) => (<option key={u} value={u}>{u}</option>))}
                    </select>
                  ) : (
                    <input className={fieldCls} type="text" value={skuUnit} disabled={busy}
                      onChange={(e) => setSkuUnit(e.target.value)}
                      placeholder={t(rk("recipes.input.unit_placeholder"))} />
                  )}
                </label>
                {/* Live oz readout for form */}
                {skuOzReadout ? (
                  <p className="text-xs text-co-text-muted">
                    {skuQty} {skuUnit} {skuOzReadout}
                  </p>
                ) : null}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={skuPortioned}
                    disabled={busy}
                    onChange={(e) => setSkuPortioned(e.target.checked)}
                    className="h-5 w-5 rounded border-2 border-co-border"
                  />
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.portioned"))}</span>
                </label>
                {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={() => { resetForms(); setAddKind(null); }}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">
                    {t(rk("recipes.builder.cancel"))}
                  </button>
                  <button type="button" disabled={busy || !skuId || !skuQty} onClick={() => void submitSkuInput()}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">
                    {t(rk("recipes.builder.save"))}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
              <h3 className="text-sm font-extrabold text-co-text">{t(rk("recipes.builder.add_item_input"))}</h3>
              <div className="mt-3 flex flex-col gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.pick_item"))}</span>
                  <select className={fieldCls} value={itemId} disabled={busy} onChange={(e) => setItemId(e.target.value)}>
                    <option value="">{t(rk("recipes.input.pick_item"))}</option>
                    {items.map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.quantity"))}</span>
                  <input className={fieldCls} type="number" min={0.001} step="any" inputMode="decimal"
                    value={itemQty} disabled={busy} onChange={(e) => setItemQty(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.unit"))}</span>
                  <input className={fieldCls} type="text" value={itemUnit} disabled={busy}
                    onChange={(e) => setItemUnit(e.target.value)}
                    placeholder={t(rk("recipes.input.unit_placeholder"))} />
                </label>
                {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={() => { resetForms(); setAddKind(null); }}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">
                    {t(rk("recipes.builder.cancel"))}
                  </button>
                  <button type="button" disabled={busy || !itemId || !itemQty} onClick={() => void submitItemInput()}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">
                    {t(rk("recipes.builder.save"))}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── DraftInputRow — display a pending draft input with remove ────────────────
function DraftInputRow({
  di,
  skus,
  measures,
  onRemove,
}: {
  di: DraftInput;
  skus: RecipeBuilderSku[];
  measures: Map<string, MeasureUnitFactor>;
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

  const metaParts: string[] = [];
  if (di.eachContainerLabel) metaParts.push(t(rk("recipes.input.container_label")) + ": " + di.eachContainerLabel);
  if (di.portioned) metaParts.push(t(rk("recipes.input.portioned_tag")));
  metaParts.push(di.kind === "sku" ? t(rk("recipes.input.sku_tag")) : t(rk("recipes.input.item_tag")));
  if (ozNote) metaParts.push(ozNote);
  const meta = metaParts.join(" · ");

  return (
    <div className="rounded-lg border-2 border-co-gold-deep/50 bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-co-text">{label}</p>
          {meta ? <p className="text-xs text-co-text-muted">{meta}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setConfirming((v) => !v)}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta hover:border-co-cta"
        >
          {t(rk("recipes.row.remove"))}
        </button>
      </div>
      {confirming ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">{t(rk("recipes.row.confirm_remove"))}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text">
              {t(rk("recipes.row.cancel"))}
            </button>
            <button type="button" onClick={() => { setConfirming(false); onRemove(); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-surface">
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

  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
    if ((await requestStepUp("B")) !== "ok") return;

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
      const result = await postJson(`/api/admin/recipes/${recipeId}/outputs`, {
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
    if ((await requestStepUp("B")) !== "ok") return;

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
      const miResult = await postJson("/api/admin/menu-items", {
        name,
        menuPrice: price,
      });
      if (!miResult.ok) { setBusy(false); setErrorMsg(t(resolveErrorKey(miResult.code))); return; }
      const menuId = miResult.data["id"] as string | null;
      if (!menuId) { setBusy(false); setErrorMsg(t(rk("recipes.error.invalid_output_menu_item"))); return; }
      const result = await postJson(`/api/admin/recipes/${recipeId}/outputs`, {
        outputMenuItemId: menuId,
        yield: yld,
      });
      setBusy(false);
      if (result.ok) { resetForms(); setAddOpen(false); router.refresh(); }
      else setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div className="mt-4 rounded-lg border-2 border-co-border p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t(rk("recipes.builder.produces_title"))}
      </h2>
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
                {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
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
                {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
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
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta hover:border-co-cta">
          {t(rk("recipes.row.remove"))}
        </button>
      </div>
      {confirming ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">{t(rk("recipes.row.confirm_remove"))}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text">
              {t(rk("recipes.row.cancel"))}
            </button>
            <button type="button" onClick={() => { setConfirming(false); onRemove(); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-surface">
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

  return (
    <div className="mt-4 rounded-lg border-2 border-co-border bg-co-surface/50 p-4">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t(rk("recipes.readout.title"))}
      </h2>
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

  return (
    <div className="mt-4 rounded-lg border-2 border-co-border bg-co-surface/50 p-4">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t(rk("recipes.readout.title"))}
      </h2>
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
    </div>
  );
}
