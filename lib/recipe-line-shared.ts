/**
 * Recipe LINE (one recipe_inputs row) — CLIENT-SAFE pure surface (catalog redesign Phase 1,
 * 2026-10-15). Used by the edit route (parse), the lib (row ↔ line, diff, the compare-and-set
 * shape) and the builder (unit choices, "nothing changed", the expected snapshot), so all three
 * agree on what a line IS and when it changed.
 *
 * An edit carries the WHOLE new line AND the line the client saw (`expected`). The server
 * writes only if the stored row still equals `expected` (Astra r1 P2-4): a concurrent edit is
 * a named 409, never a silent overwrite, and the audit's "before" is the row that matched.
 * `expected` is a RAW snapshot — text untrimmed — because it must equal the stored value byte
 * for byte; the diff compares it NORMALISED, so whitespace alone never counts as a change.
 */
import type { RecipeInputView } from "@/lib/recipes-shared";

export type RecipeLineKind = "sku" | "item" | "product";

export interface RecipeLineFields {
  componentSkuId: string | null;
  componentItemId: string | null;
  componentProductId: string | null;
  quantity: number;
  unit: string | null;
  eachContainerLabel: string | null;
  portioned: boolean;
}

/** A line plus the name the builder shows for its target. */
export interface RecipeLineDraft extends RecipeLineFields {
  componentName: string;
}

/** The recipe_inputs columns a line owns, as the database spells them. */
export interface RecipeLineRow {
  component_sku_id: string | null;
  component_item_id: string | null;
  component_product_id: string | null;
  quantity: number | string;
  unit: string | null;
  each_container_label: string | null;
  portioned: boolean | null;
}

export const RECIPE_LINE_FIELDS = [
  "componentSkuId",
  "componentItemId",
  "componentProductId",
  "quantity",
  "unit",
  "eachContainerLabel",
  "portioned",
] as const satisfies ReadonlyArray<keyof RecipeLineFields>;

export type RecipeLineParseError =
  | "invalid_payload"
  | "invalid_component"
  | "invalid_quantity"
  | "product_line_needs_measure_unit";

export type RecipeLineParse =
  | { ok: true; line: RecipeLineFields }
  | { ok: false; code: RecipeLineParseError };

export type RecipeLineEditParse =
  | { ok: true; line: RecipeLineFields; expected: RecipeLineFields }
  | { ok: false; code: RecipeLineParseError };

/** Trimmed text, or null for absent/blank — the same rule lib/recipes.ts normStr applies at insert. */
export function normLineText(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

const isAbsent = (v: unknown) => v === undefined || v === null;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The shared shape checks: typed ids (non-blank strings), typed text, typed portioned. */
function shapeOk(b: Record<string, unknown>): boolean {
  for (const id of [b.componentSkuId, b.componentItemId, b.componentProductId]) {
    if (!isAbsent(id) && (typeof id !== "string" || id.trim() === "")) return false;
  }
  for (const text of [b.unit, b.eachContainerLabel]) {
    if (!isAbsent(text) && typeof text !== "string") return false;
  }
  return isAbsent(b.portioned) || typeof b.portioned === "boolean";
}

const idOf = (v: unknown): string | null => (typeof v === "string" ? v.trim() : null);
const positive = (q: unknown): q is number => typeof q === "number" && Number.isFinite(q) && q > 0;

export function parseRecipeLinePatch(raw: unknown): RecipeLineParse {
  if (!isObject(raw) || !shapeOk(raw)) return { ok: false, code: "invalid_payload" };
  const skuId = idOf(raw.componentSkuId);
  const itemId = idOf(raw.componentItemId);
  const productId = idOf(raw.componentProductId);
  if ([skuId, itemId, productId].filter((v) => v !== null).length !== 1) return { ok: false, code: "invalid_component" };
  if (!positive(raw.quantity)) return { ok: false, code: "invalid_quantity" };
  const unit = normLineText(raw.unit as string | null | undefined);
  if (productId !== null && unit === null) return { ok: false, code: "product_line_needs_measure_unit" };
  return {
    ok: true,
    line: {
      componentSkuId: skuId,
      componentItemId: itemId,
      componentProductId: productId,
      quantity: raw.quantity,
      unit,
      // A container label is a SKU's own word; an item or product line never carries one.
      eachContainerLabel: skuId !== null ? normLineText(raw.eachContainerLabel as string | null | undefined) : null,
      // Portioning is a bought-ingredient idea; a prep-item line is never portioned.
      portioned: itemId !== null ? false : raw.portioned === true,
    },
  };
}

/** The line as the client SAW it — raw text, no business rules beyond the table's own. Null = malformed. */
export function parseRecipeLineSnapshot(raw: unknown): RecipeLineFields | null {
  if (!isObject(raw) || !shapeOk(raw)) return null;
  const skuId = typeof raw.componentSkuId === "string" ? raw.componentSkuId : null;
  const itemId = typeof raw.componentItemId === "string" ? raw.componentItemId : null;
  const productId = typeof raw.componentProductId === "string" ? raw.componentProductId : null;
  if ([skuId, itemId, productId].filter((v) => v !== null).length !== 1) return null;
  if (!positive(raw.quantity)) return null;
  return {
    componentSkuId: skuId,
    componentItemId: itemId,
    componentProductId: productId,
    quantity: raw.quantity,
    unit: typeof raw.unit === "string" ? raw.unit : null,
    eachContainerLabel: typeof raw.eachContainerLabel === "string" ? raw.eachContainerLabel : null,
    portioned: raw.portioned === true,
  };
}

export function parseRecipeLineEdit(raw: unknown): RecipeLineEditParse {
  if (!isObject(raw)) return { ok: false, code: "invalid_payload" };
  const line = parseRecipeLinePatch(raw.line);
  if (!line.ok) return line;
  const expected = parseRecipeLineSnapshot(raw.expected);
  if (!expected) return { ok: false, code: "invalid_payload" };
  return { ok: true, line: line.line, expected };
}

export function normalizeRecipeLine(l: RecipeLineFields): RecipeLineFields {
  return { ...l, unit: normLineText(l.unit), eachContainerLabel: normLineText(l.eachContainerLabel) };
}

export function recipeLineKind(
  l: Pick<RecipeLineFields, "componentSkuId" | "componentItemId" | "componentProductId">,
): RecipeLineKind {
  if (l.componentProductId !== null) return "product";
  if (l.componentItemId !== null) return "item";
  return "sku";
}

export function lineFromRow(r: RecipeLineRow): RecipeLineFields {
  return {
    componentSkuId: r.component_sku_id,
    componentItemId: r.component_item_id,
    componentProductId: r.component_product_id,
    quantity: Number(r.quantity),
    unit: normLineText(r.unit),
    eachContainerLabel: normLineText(r.each_container_label),
    portioned: r.portioned === true,
  };
}

export function lineToRow(l: RecipeLineFields): {
  component_sku_id: string | null;
  component_item_id: string | null;
  component_product_id: string | null;
  quantity: number;
  unit: string | null;
  each_container_label: string | null;
  portioned: boolean;
} {
  return {
    component_sku_id: l.componentSkuId,
    component_item_id: l.componentItemId,
    component_product_id: l.componentProductId,
    quantity: l.quantity,
    unit: l.unit,
    each_container_label: l.eachContainerLabel,
    portioned: l.portioned,
  };
}

/** The fields that differ, in RECIPE_LINE_FIELDS order. Empty = nothing to write. */
export function diffRecipeLine(before: RecipeLineFields, after: RecipeLineFields): Array<keyof RecipeLineFields> {
  return RECIPE_LINE_FIELDS.filter((k) => before[k] !== after[k]);
}

/**
 * The unit choices for a line's target. null = free text (prep-item lines, as before).
 * PRODUCT: every ACTIVE measure-registry label, any dimension (AGENTS.md "measure-registry unit";
 * a pack label means a different thing per vendor — deviation D3). SKU: the line's current unit
 * first (an edit never silently changes it), then the SKU's pack labels, then the measure
 * registry (ozForRecipeInput step 3 resolves those for any SKU).
 */
export function lineUnitChoices(
  kind: RecipeLineKind,
  sku: { packFormat: string | null; eachContainerLabel: string | null; eachMeasure: string | null } | null,
  measureLabels: readonly string[],
  current: string | null,
): string[] | null {
  if (kind === "item") return null;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string | null | undefined) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t !== "" && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };
  if (kind === "product") {
    for (const m of measureLabels) push(m);
    return out;
  }
  push(current);
  push(sku?.packFormat);
  push(sku?.eachContainerLabel);
  push(sku?.eachMeasure);
  for (const m of measureLabels) push(m);
  return out;
}

/** The editor's starting line (normalised). */
export function lineDraftFromView(v: RecipeInputView): RecipeLineDraft {
  return {
    componentSkuId: v.componentSkuId,
    componentItemId: v.componentItemId,
    componentProductId: v.componentProductId,
    quantity: v.quantity,
    unit: normLineText(v.unit),
    eachContainerLabel: normLineText(v.eachContainerLabel),
    portioned: v.portioned,
    componentName: v.componentName,
  };
}

/** The compare-and-set `expected` (RAW, exactly as loadRecipe returned it). */
export function lineSnapshotFromView(v: RecipeInputView): RecipeLineFields {
  return {
    componentSkuId: v.componentSkuId,
    componentItemId: v.componentItemId,
    componentProductId: v.componentProductId,
    quantity: v.quantity,
    unit: v.unit,
    eachContainerLabel: v.eachContainerLabel,
    portioned: v.portioned,
  };
}

/** A live edit's state, captured ONCE when editing begins (Astra r2 #1). */
export interface LineEditStart {
  id: string;
  /** What the editor starts from (normalised). */
  initial: RecipeLineDraft;
  /** What the server must still hold for the save to land (raw). */
  expected: RecipeLineFields;
}

/**
 * Capture the editor's starting line AND the compare-and-set snapshot at the moment the person
 * taps Edit. Both are copies: a router.refresh() mid-edit hands the row a NEW view (another
 * manager's change), but the save must still be compared against what this person SAW — so a
 * stale save is a 409, never a silent overwrite of the other manager's change.
 */
export function beginLineEdit(v: RecipeInputView): LineEditStart {
  return { id: v.id, initial: lineDraftFromView(v), expected: lineSnapshotFromView(v) };
}

/**
 * A saved unit the unit list no longer offers (chunk-3 review): e.g. a legacy PRODUCT line in a
 * vendor's pack label ("case") from before the measure-registry rule. The editor shows it as a
 * labelled legacy option — so the select never pretends the line has no unit — and a product
 * line must change it before saving. null for free-text units (prep items), blanks, and any unit
 * that IS offered (a SKU line's current unit is always offered first by lineUnitChoices).
 */
export function legacyLineUnit(choices: readonly string[] | null, unit: string | null): string | null {
  if (choices === null) return null;
  const u = normLineText(unit);
  return u !== null && !choices.includes(u) ? u : null;
}
