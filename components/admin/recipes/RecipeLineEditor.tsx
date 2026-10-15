"use client";

/**
 * RecipeLineEditor — ONE form for adding a recipe line AND editing one in place, saved or
 * draft (catalog redesign Phase 1, 2026-10-15). Replaces the three per-kind add forms and their
 * unsearchable selects: the ingredient comes from the searchable IngredientPicker, then qty + unit.
 *
 * The unit rules are the server's, offered up front (lib/recipe-line-shared.ts lineUnitChoices):
 * a PRODUCT line offers every active measure-registry unit and no pack label (D3); a SKU line
 * offers its pack labels plus the measure registry and keeps its current unit first; a prep-item
 * line keeps its free-text unit. The server re-checks every rule (assertInputLineIsValid).
 * Edit mode disables Save until something changed (diffRecipeLine — the server's own test).
 */
import { useId, useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { ozForRecipeInput, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import { productInputBasis } from "@/lib/products-shared";
import { diffRecipeLine, lineUnitOptions, type RecipeLineDraft } from "@/lib/recipe-line-shared";
import { lineTargetKey, optionForLine, type IngredientOption } from "@/lib/ingredient-picker-shared";
import { IngredientPicker } from "./IngredientPicker";
import type { RecipeBuilderProduct, RecipeBuilderSku } from "./RecipeBuilder";

const rk = (k: string): TranslationKey => k as TranslationKey;

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

export function RecipeLineEditor({
  title,
  submitLabel,
  options,
  skus,
  products,
  measures,
  activeMeasureLabels,
  initial,
  busy,
  errorMsg,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  options: IngredientOption[];
  skus: RecipeBuilderSku[];
  products: RecipeBuilderProduct[];
  measures: Map<string, MeasureUnitFactor>;
  /** ACTIVE measure_units labels — the only measures offered (Astra full-branch #4). Absent → every
   *  key of `measures` (which also carries retired units, so old lines still convert to oz). */
  activeMeasureLabels?: readonly string[];
  /** null = add a new line; a line = edit it in place. */
  initial: RecipeLineDraft | null;
  busy: boolean;
  errorMsg: string | null;
  onSubmit: (line: RecipeLineDraft) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // Every control is named programmatically (aria-labelledby → its visible, translated label).
  const ids = useId();
  const qtyLabelId = `${ids}-qty`;
  const unitLabelId = `${ids}-unit`;
  const portionedLabelId = `${ids}-portioned`;
  const [choice, setChoice] = useState<IngredientOption | null>(() => (initial ? optionForLine(initial, options) : null));
  const [qty, setQty] = useState(initial ? String(initial.quantity) : "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [portioned, setPortioned] = useState(initial?.portioned ?? false);
  const [localError, setLocalError] = useState<string | null>(null);

  const measureLabels = useMemo(
    () => [...(activeMeasureLabels ?? [...measures.keys()])].sort((a, b) => a.localeCompare(b)),
    [activeMeasureLabels, measures],
  );
  const retiredMeasureLabels = useMemo(
    () => new Set([...measures.keys()].filter((l) => !measureLabels.includes(l))),
    [measures, measureLabels],
  );
  const keepsTarget = initial !== null && choice !== null && lineTargetKey(initial) === choice.key;
  const sku = choice?.kind === "sku" ? (skus.find((s) => s.id === choice.id) ?? null) : null;
  const product = choice?.kind === "product" ? (products.find((p) => p.id === choice.id) ?? null) : null;
  const unitOptions = choice
    ? lineUnitOptions(choice.kind, sku, measureLabels, retiredMeasureLabels, keepsTarget ? (initial?.unit ?? null) : null, unit)
    : { choices: [] as string[], legacy: null, mustChange: false };
  const unitChoices = unitOptions.choices;

  const pick = (next: IngredientOption | null) => {
    setChoice(next);
    setLocalError(null);
    const keeps = initial !== null && next !== null && lineTargetKey(initial) === next.key;
    setUnit(keeps ? (initial?.unit ?? "") : "");
    if (next?.kind === "item") setPortioned(false);
  };

  const qtyNum = Number(qty);
  const qtyOk = qty.trim() !== "" && Number.isFinite(qtyNum) && qtyNum > 0;
  const basis: RecipeInputSku | null =
    sku ?? (product ? productInputBasis({ productId: product.id, unitOz: product.unitOz }, null) : null);
  const oz = basis && unit !== "" && qtyOk ? ozForRecipeInput(qtyNum, unit, basis, measures) : null;
  const productNeedsUnitOz =
    product != null && product.unitOz == null && unit !== "" && measures.get(unit)?.dimension !== "weight";
  const skuUnitUnresolved = sku != null && unit !== "" && qtyOk && oz == null;

  const draft: RecipeLineDraft | null = choice
    ? {
        componentSkuId: choice.kind === "sku" ? choice.id : null,
        componentItemId: choice.kind === "item" ? choice.id : null,
        componentProductId: choice.kind === "product" ? choice.id : null,
        quantity: qtyNum,
        unit: unit.trim() || null,
        eachContainerLabel:
          choice.kind !== "sku" ? null : keepsTarget ? (initial?.eachContainerLabel ?? null) : (sku?.eachContainerLabel ?? null),
        portioned: choice.kind === "item" ? false : portioned,
        componentName: choice.name,
      }
    : null;
  const unchanged = initial !== null && draft !== null && diffRecipeLine(initial, draft).length === 0;
  // A saved unit the list no longer offers shows as a labelled legacy option; a PRODUCT line (any
  // off-list unit) or a line saved in a RETIRED measure must trade it before it can save
  // (chunk-3 review; Astra full-branch #4).
  const legacyUnit = unitOptions.legacy;
  const unitMustChange = unitOptions.mustChange;
  const canSave = !busy && draft !== null && qtyOk && !unchanged && !unitMustChange;

  const submit = () => {
    setLocalError(null);
    if (!draft) { setLocalError(t(rk("recipes.error.invalid_component"))); return; }
    if (!qtyOk) { setLocalError(t(rk("recipes.error.invalid_quantity"))); return; }
    if (unitMustChange || (draft.componentProductId !== null && draft.unit === null)) {
      setLocalError(t(rk("recipes.error.product_line_needs_measure_unit")));
      return;
    }
    onSubmit(draft);
  };

  const shownError = localError ?? errorMsg;

  return (
    <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
      <h3 className="text-sm font-extrabold text-co-text">{title}</h3>
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <span className="text-sm font-bold text-co-text">{t(rk("recipes.picker.label"))}</span>
          <IngredientPicker options={options} value={choice} onChange={pick} disabled={busy} />
        </div>
        {choice?.kind === "product" ? (
          <p className="text-xs text-co-text-muted">{t(rk("recipes.input.product_hint"))}</p>
        ) : null}
        <label className="block">
          <span id={qtyLabelId} className="text-sm font-bold text-co-text">{t(rk("recipes.input.quantity"))}</span>
          <input
            aria-labelledby={qtyLabelId}
            className={fieldCls}
            type="number"
            min={0.001}
            step="any"
            inputMode="decimal"
            value={qty}
            disabled={busy || choice === null}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <label className="block">
          <span id={unitLabelId} className="text-sm font-bold text-co-text">{t(rk("recipes.input.unit"))}</span>
          {unitChoices === null ? (
            <input
              aria-labelledby={unitLabelId}
              className={fieldCls}
              type="text"
              value={unit}
              disabled={busy || choice === null}
              placeholder={t(rk("recipes.input.unit_placeholder"))}
              onChange={(e) => setUnit(e.target.value)}
            />
          ) : (
            <select aria-labelledby={unitLabelId} className={fieldCls} value={unit} disabled={busy || choice === null} onChange={(e) => setUnit(e.target.value)}>
              <option value="">{t(rk("recipes.input.unit_placeholder"))}</option>
              {legacyUnit ? <option value={legacyUnit}>{t(rk("recipes.input.legacy_unit"), { unit: legacyUnit })}</option> : null}
              {unitChoices.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          )}
        </label>
        {oz != null ? (
          <p className="text-xs text-co-text-muted">{qty} {unit} ≈ {oz.toFixed(1)} oz</p>
        ) : null}
        {productNeedsUnitOz ? <p className="text-xs text-co-warning-text">{t(rk("recipes.input.product_needs_unit_oz"))}</p> : null}
        {skuUnitUnresolved ? <p className="text-xs text-co-warning-text">{t(rk("recipes.input.sku_unit_unresolved"))}</p> : null}
        {unitMustChange ? <p className="text-xs text-co-warning-text">{t(rk("recipes.input.legacy_unit_must_change"))}</p> : null}
        {choice !== null && choice.kind !== "item" ? (
          <label className="flex min-h-[44px] items-center gap-2">
            <input
              aria-labelledby={portionedLabelId}
              type="checkbox"
              checked={portioned}
              disabled={busy}
              onChange={(e) => setPortioned(e.target.checked)}
              className="h-5 w-5 rounded border-2 border-co-border"
            />
            <span id={portionedLabelId} className="text-sm font-bold text-co-text">{t(rk("recipes.input.portioned"))}</span>
          </label>
        ) : null}
        {shownError ? <p role="alert" className="text-sm text-co-cta-text">{shownError}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
          >
            {t(rk("recipes.builder.cancel"))}
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={submit}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
