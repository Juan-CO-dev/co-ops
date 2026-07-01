"use client";

/**
 * RecipeBuilder — adaptive form for /admin/recipes/[id].
 *
 * HEADER: name + nameEs, batchYield, collapsible Directions. PATCHes on blur.
 * CONSUMES: input rows + add-SKU / add-item forms.
 * PRODUCES: for 'production' — item output rows + add form;
 *           for 'consumer' — single menu-item output (pick existing menu item
 *           OR create one inline first).
 * LIVE READOUT: simple human echo of entered quantities + labels.
 *   (precise oz shown on the SKU/cost panels; we do NOT fabricate oz here)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { RegistrySelect } from "@/components/admin/skus/RegistrySelect";
import type { RecipeView, RecipeInputView, RecipeOutputView } from "@/lib/recipes";
import { RECIPE_WRITE_MIN } from "@/lib/recipes";
import type { RegistryOption } from "@/lib/admin/skus";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey } from "./shared";

const rk = (k: string): TranslationKey => k as TranslationKey;
import { RecipeInputRow } from "./RecipeInputRow";
import { RecipeOutputRow } from "./RecipeOutputRow";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

const textareaCls =
  "mt-1 min-h-[88px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60 resize-y";

// ── Types for add-form inputs ────────────────────────────────────────────────
type InputKind = "sku" | "item";

// ── RecipeBuilder ────────────────────────────────────────────────────────────
export function RecipeBuilder({
  recipe,
  skus,
  items,
  unitOptions,
  level,
}: {
  recipe: RecipeView;
  skus: Array<{ id: string; name: string }>;
  items: Array<{ id: string; name: string }>;
  unitOptions: Array<{ id: string; label: string }>;
  level: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canEdit = level >= RECIPE_WRITE_MIN;

  // ── Header patch state ──
  const [patchError, setPatchError] = useState<string | null>(null);
  const [patchBusy, setPatchBusy] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);

  // Local editable state — kept in sync with server via router.refresh() on blur
  const [nameVal, setNameVal] = useState(recipe.name);
  const [nameEsVal, setNameEsVal] = useState(recipe.nameEs ?? "");
  const [batchYieldVal, setBatchYieldVal] = useState(String(recipe.batchYield));
  const [directionsVal, setDirectionsVal] = useState(recipe.directions ?? "");
  const [directionsEsVal, setDirectionsEsVal] = useState(recipe.directionsEs ?? "");

  // Track if a field is "dirty" so we only PATCH when it changed
  const patchField = async (field: string, value: string | number | null) => {
    if (!canEdit) return;
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
    if (trimmed && trimmed !== recipe.name) void patchField("name", trimmed);
  };
  const handleNameEsBlur = () => {
    const trimmed = nameEsVal.trim() || null;
    if (trimmed !== (recipe.nameEs ?? null)) void patchField("nameEs", trimmed);
  };
  const handleBatchYieldBlur = () => {
    const n = Number(batchYieldVal);
    if (Number.isFinite(n) && n > 0 && n !== recipe.batchYield) void patchField("batchYield", n);
  };
  const handleDirectionsBlur = () => {
    const v = directionsVal.trim() || null;
    if (v !== (recipe.directions ?? null)) void patchField("directions", v);
  };
  const handleDirectionsEsBlur = () => {
    const v = directionsEsVal.trim() || null;
    if (v !== (recipe.directionsEs ?? null)) void patchField("directionsEs", v);
  };

  // ── Remove edge ──
  const removeEdge = async (table: "recipe_inputs" | "recipe_outputs", edgeId: string) => {
    if (!canEdit) return;
    const result = await postJson("/api/admin/recipes/edges", { table, id: edgeId }, "DELETE");
    if (result.ok) {
      router.refresh();
    }
  };

  // Convert unitOptions to RegistryOption shape for RegistrySelect
  const unitRegistryOptions: RegistryOption[] = unitOptions.map((u) => ({
    id: u.id,
    label: u.label,
  }));

  return (
    <div className="mt-2">
      {/* ── Header ── */}
      <div className="rounded-lg border-2 border-co-border bg-co-surface p-4">
        {/* Recipe type badge (read-only) */}
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="rounded bg-co-gold/30 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-co-text">
            {recipe.recipeType === "production"
              ? t(rk("recipes.type.production"))
              : t(rk("recipes.type.consumer"))}
          </span>
          {(!recipe.inputs.length || !recipe.outputs.length) ? (
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
              disabled={!canEdit || patchBusy}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={handleNameBlur}
            />
          </label>

          {/* Name ES */}
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t(rk("recipes.builder.name_es"))}</span>
            <input
              className={fieldCls}
              type="text"
              value={nameEsVal}
              disabled={!canEdit || patchBusy}
              onChange={(e) => setNameEsVal(e.target.value)}
              onBlur={handleNameEsBlur}
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
              disabled={!canEdit || patchBusy}
              onChange={(e) => setBatchYieldVal(e.target.value)}
              onBlur={handleBatchYieldBlur}
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
                    disabled={!canEdit || patchBusy}
                    onChange={(e) => setDirectionsVal(e.target.value)}
                    onBlur={handleDirectionsBlur}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.builder.directions_es"))}</span>
                  <textarea
                    className={textareaCls}
                    value={directionsEsVal}
                    disabled={!canEdit || patchBusy}
                    onChange={(e) => setDirectionsEsVal(e.target.value)}
                    onBlur={handleDirectionsEsBlur}
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
        recipeId={recipe.id}
        inputs={recipe.inputs}
        skus={skus}
        items={items}
        unitRegistryOptions={unitRegistryOptions}
        canEdit={canEdit}
        level={level}
        onRemove={(id) => void removeEdge("recipe_inputs", id)}
      />

      {/* ── PRODUCES ── */}
      <ProducesSection
        recipeId={recipe.id}
        recipeType={recipe.recipeType}
        batchYield={recipe.batchYield}
        outputs={recipe.outputs}
        inputs={recipe.inputs}
        items={items}
        unitRegistryOptions={unitRegistryOptions}
        canEdit={canEdit}
        level={level}
        onRemove={(id) => void removeEdge("recipe_outputs", id)}
      />

      {/* ── LIVE READOUT ── */}
      <LiveReadout inputs={recipe.inputs} outputs={recipe.outputs} batchYield={recipe.batchYield} />
    </div>
  );
}

// ── CONSUMES section ─────────────────────────────────────────────────────────
function ConsumesSection({
  recipeId,
  inputs,
  skus,
  items,
  unitRegistryOptions,
  canEdit,
  level,
  onRemove,
}: {
  recipeId: string;
  inputs: RecipeInputView[];
  skus: Array<{ id: string; name: string }>;
  items: Array<{ id: string; name: string }>;
  unitRegistryOptions: RegistryOption[];
  canEdit: boolean;
  level: number;
  onRemove: (id: string) => void;
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
  const [skuContainerLabel, setSkuContainerLabel] = useState("");
  const [skuPortioned, setSkuPortioned] = useState(false);

  // Item form state
  const [itemId, setItemId] = useState("");
  const [itemQty, setItemQty] = useState("");
  const [itemUnit, setItemUnit] = useState("");

  const resetForms = () => {
    setSkuId(""); setSkuQty(""); setSkuUnit(""); setSkuContainerLabel(""); setSkuPortioned(false);
    setItemId(""); setItemQty(""); setItemUnit("");
    setErrorMsg(null);
  };

  const submitSkuInput = async () => {
    if (busy) return;
    setErrorMsg(null);
    const qty = Number(skuQty);
    if (!skuId) { setErrorMsg(t(rk("recipes.error.invalid_sku"))); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setErrorMsg(t(rk("recipes.error.invalid_quantity"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/recipes/${recipeId}/inputs`, {
      componentSkuId: skuId,
      quantity: qty,
      unit: skuUnit.trim() || null,
      eachContainerLabel: skuContainerLabel.trim() || null,
      portioned: skuPortioned,
    });
    setBusy(false);
    if (result.ok) { resetForms(); setAddKind(null); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const submitItemInput = async () => {
    if (busy) return;
    setErrorMsg(null);
    const qty = Number(itemQty);
    if (!itemId) { setErrorMsg(t(rk("recipes.error.invalid_component_item"))); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setErrorMsg(t(rk("recipes.error.invalid_quantity"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/recipes/${recipeId}/inputs`, {
      componentItemId: itemId,
      quantity: qty,
      unit: itemUnit.trim() || null,
    });
    setBusy(false);
    if (result.ok) { resetForms(); setAddKind(null); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <div className="mt-4 rounded-lg border-2 border-co-border p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t(rk("recipes.builder.consumes_title"))}
      </h2>
      <p className="mt-1 text-xs text-co-text-muted">{t(rk("recipes.builder.consumes_subtitle"))}</p>

      {inputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {inputs.map((inp) => (
            <RecipeInputRow key={inp.id} input={inp} canEdit={canEdit} onRemove={onRemove} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-co-text-muted">{t(rk("recipes.builder.consumes_empty"))}</p>
      )}

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
                  <select className={fieldCls} value={skuId} disabled={busy} onChange={(e) => setSkuId(e.target.value)}>
                    <option value="">{t(rk("recipes.input.pick_sku"))}</option>
                    {skus.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.quantity"))}</span>
                  <input className={fieldCls} type="number" min={0.001} step="any" inputMode="decimal"
                    value={skuQty} disabled={busy} onChange={(e) => setSkuQty(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.unit"))}</span>
                  <input className={fieldCls} type="text" value={skuUnit} disabled={busy}
                    onChange={(e) => setSkuUnit(e.target.value)}
                    placeholder={t(rk("recipes.input.unit_placeholder"))} />
                </label>
                <RegistrySelect
                  label={t(rk("recipes.input.container_label"))}
                  value={skuContainerLabel}
                  onChange={setSkuContainerLabel}
                  options={unitRegistryOptions}
                  actorLevel={level}
                  addEndpoint="/api/admin/checklist-templates/units"
                  addPromptKey="admin.templates.add_unit_prompt"
                  addButtonKey="admin.templates.add_unit"
                />
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

// ── PRODUCES section ─────────────────────────────────────────────────────────
function ProducesSection({
  recipeId,
  recipeType,
  batchYield,
  outputs,
  inputs,
  items,
  unitRegistryOptions,
  canEdit,
  level,
  onRemove,
}: {
  recipeId: string;
  recipeType: "production" | "consumer";
  batchYield: number;
  outputs: RecipeOutputView[];
  inputs: RecipeInputView[];
  items: Array<{ id: string; name: string }>;
  unitRegistryOptions: RegistryOption[];
  canEdit: boolean;
  level: number;
  onRemove: (id: string) => void;
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
  const [menuMode, setMenuMode] = useState<"pick" | "create">("pick");
  const [menuItemName, setMenuItemName] = useState("");
  const [menuItemPrice, setMenuItemPrice] = useState("");
  const [menuItemYield, setMenuItemYield] = useState("1");

  const resetForms = () => {
    setOutputItemId(""); setOutputYield("1"); setOutputContainerLabel("");
    setMenuMode("pick"); setMenuItemName(""); setMenuItemPrice(""); setMenuItemYield("1");
    setErrorMsg(null);
  };

  const submitProductionOutput = async () => {
    if (busy) return;
    setErrorMsg(null);
    const yld = Number(outputYield);
    if (!outputItemId) { setErrorMsg(t(rk("recipes.error.invalid_output_item"))); return; }
    if (!Number.isFinite(yld) || yld <= 0) { setErrorMsg(t(rk("recipes.error.invalid_yield"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/recipes/${recipeId}/outputs`, {
      outputItemId,
      yield: yld,
      outputContainerLabel: outputContainerLabel.trim() || null,
    });
    setBusy(false);
    if (result.ok) { resetForms(); setAddOpen(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const submitConsumerOutput = async () => {
    if (busy) return;
    setErrorMsg(null);
    const yld = Number(menuItemYield);
    if (!Number.isFinite(yld) || yld <= 0) { setErrorMsg(t(rk("recipes.error.invalid_yield"))); return; }

    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);

    let menuId: string | null = null;

    if (menuMode === "create") {
      const name = menuItemName.trim();
      if (!name) { setBusy(false); setErrorMsg(t(rk("recipes.error.invalid_name"))); return; }
      const price = menuItemPrice.trim() ? Number(menuItemPrice) : null;
      const miResult = await postJson("/api/admin/menu-items", {
        name,
        menuPrice: price,
      });
      if (!miResult.ok) { setBusy(false); setErrorMsg(t(resolveErrorKey(miResult.code))); return; }
      menuId = miResult.data["id"] as string | null;
    }
    // For "pick" mode — we don't yet have a menu-item picker (menu_items may not be loaded)
    // so create mode is the primary path for consumer outputs. The "pick" tab is a placeholder
    // that notes future work. For now we only support "create" inline.

    if (!menuId && menuMode === "create") {
      setBusy(false); setErrorMsg(t(rk("recipes.error.invalid_output_menu_item"))); return;
    }

    if (!menuId) {
      // In pick mode without a dedicated picker — guide user to use create instead
      setBusy(false); setErrorMsg(t(rk("recipes.consumer.pick_not_supported"))); return;
    }

    const result = await postJson(`/api/admin/recipes/${recipeId}/outputs`, {
      outputMenuItemId: menuId,
      yield: yld,
    });
    setBusy(false);
    if (result.ok) { resetForms(); setAddOpen(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
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

      {outputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {outputs.map((out) => (
            <RecipeOutputRow key={out.id} output={out} canEdit={canEdit} onRemove={onRemove} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-co-text-muted">{t(rk("recipes.builder.produces_empty"))}</p>
      )}

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
                <RegistrySelect
                  label={t(rk("recipes.output.container_label"))}
                  value={outputContainerLabel}
                  onChange={setOutputContainerLabel}
                  options={unitRegistryOptions}
                  actorLevel={level}
                  addEndpoint="/api/admin/checklist-templates/units"
                  addPromptKey="admin.templates.add_unit_prompt"
                  addButtonKey="admin.templates.add_unit"
                />
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
                {/* Mode toggle */}
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => setMenuMode("create")}
                    className={`inline-flex min-h-[40px] flex-1 items-center justify-center rounded-lg border-2 px-3 text-sm font-bold transition ${menuMode === "create" ? "border-co-gold-deep bg-co-gold text-co-text" : "border-co-border bg-co-surface text-co-text hover:border-co-text"}`}>
                    {t(rk("recipes.consumer.mode_create"))}
                  </button>
                </div>
                {/* Create menu-item inline */}
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

// ── LIVE READOUT ─────────────────────────────────────────────────────────────
function LiveReadout({
  inputs,
  outputs,
  batchYield,
}: {
  inputs: RecipeInputView[];
  outputs: RecipeOutputView[];
  batchYield: number;
}) {
  const { t } = useTranslation();
  if (inputs.length === 0 && outputs.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border-2 border-co-border bg-co-surface/50 p-4">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t(rk("recipes.readout.title"))}
      </h2>
      <p className="mt-1 text-xs text-co-text-muted">{t(rk("recipes.readout.oz_note"))}</p>
      {outputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {outputs.map((out) => {
            // Echo the entered quantities and labels honestly — no fabricated oz.
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
