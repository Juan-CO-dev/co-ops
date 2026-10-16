import type { RecipeLineFields } from "@/lib/recipe-line-shared";
export type SwapMode = "for_now" | "for_good";
export const SWAP_MODES: readonly SwapMode[] = ["for_now", "for_good"];

export interface SwapRequest {
  oldSkuId: string;
  newSkuId: string;
  /** A shop; or null = every shop's default — "For good" only, MoO+. */
  scope: string | null;
  mode: SwapMode;
  /** The new product's name when neither item has a product yet (default: the old item's name). */
  productName: string | null;
  productNameEs: string | null;
  note: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textOrNull = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t.length <= max ? t : undefined;
};

export function parseSwapRequest(raw: unknown, oldSkuId: string): { ok: true; request: SwapRequest } | { ok: false; field: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, field: "body" };
  if (!UUID.test(oldSkuId)) return { ok: false, field: "oldSkuId" };
  const b = raw as Record<string, unknown>;
  if (typeof b.newSkuId !== "string" || !UUID.test(b.newSkuId) || b.newSkuId === oldSkuId) return { ok: false, field: "newSkuId" };
  const scope = b.scope === null ? null : typeof b.scope === "string" && UUID.test(b.scope) ? b.scope : undefined;
  if (scope === undefined) return { ok: false, field: "scope" };
  if (!SWAP_MODES.includes(b.mode as SwapMode)) return { ok: false, field: "mode" };
  const mode = b.mode as SwapMode;
  if (mode === "for_now" && scope === null) return { ok: false, field: "scope" };
  const productName = textOrNull(b.productName, 120);
  if (productName === undefined) return { ok: false, field: "productName" };
  const productNameEs = textOrNull(b.productNameEs, 120);
  if (productNameEs === undefined) return { ok: false, field: "productNameEs" };
  const note = textOrNull(b.note, 200);
  if (note === undefined) return { ok: false, field: "note" };
  return { ok: true, request: { oldSkuId, newSkuId: b.newSkuId, scope, mode, productName, productNameEs, note } };
}

export type SwapLineResult = { ok: true; line: RecipeLineFields; converted: boolean } | { ok: false; reason: "unit_unknown" };

/** What ONE `unit` of each item weighs at the scope (the shop's resolved packs), and which units are measures. */
export interface SwapUnitContext {
  isMeasure(unit: string): boolean;
  oldOz(unit: string): number | null;
  newOz(unit: string): number | null;
}

export function roundQty(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * ONE LINE, OLD ITEM → NEW ITEM, the same food:
 *   · a MEASURE unit carries over as written — weight is weight, and a count is a PORTION (2 slices stay 2 slices from
 *     the new vendor; a different slice weight is the point of the swap, not an error);
 *   · a PACK label both items hold with the same contents ("1 jar" = 32 oz in both) carries over;
 *   · any other pack label becomes OUNCES of what the old pack held — "1 jar" of a 32 oz jar is 32 oz of the new item,
 *     never "1 jar" of a jar of another size;
 *   · a label the OLD item cannot weigh cannot be carried: refused, and named (the swap waits for it to be fixed).
 */
export function swapLine(line: RecipeLineFields, newSkuId: string, ctx: SwapUnitContext): SwapLineResult {
  const unit = line.unit?.trim() ?? "";
  if (unit === "") return { ok: false, reason: "unit_unknown" };
  const same: RecipeLineFields = { ...line, componentSkuId: newSkuId };
  if (ctx.isMeasure(unit)) return { ok: true, line: same, converted: false };
  const oldOz = ctx.oldOz(unit);
  if (oldOz === null || !Number.isFinite(oldOz) || !(oldOz > 0)) return { ok: false, reason: "unit_unknown" };
  const newOz = ctx.newOz(unit);
  if (newOz !== null && Math.abs(newOz - oldOz) <= 1e-9 * Math.max(1, oldOz)) return { ok: true, line: same, converted: false };
  const quantity = roundQty(line.quantity * oldOz);
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, reason: "unit_unknown" };
  return { ok: true, line: { ...same, quantity, unit: "oz", eachContainerLabel: null }, converted: true };
}
/** SQL and route refusals share one closed application vocabulary. */
export const SWAP_RPC_STATUS = {
  invalid_payload: 400, invalid_mode: 400, same_sku: 400, unit_unknown: 400,
  replacement_ineligible: 400, not_temporary: 400,
  location_not_found: 404, sku_not_found: 404, swap_not_found: 404, not_found: 404,
  already_swapped: 409, not_live: 409, in_other_product: 409, product_needs_primary: 409,
  product_name_taken: 409, recipes_changed: 409, product_changed: 409,
  dependencies_changed: 409, dependencies_busy: 409, preview_stale: 409,
  forbidden: 403, global_requires_moo: 403,
} as const;
export type SwapErrorCode = keyof typeof SWAP_RPC_STATUS;
export const SWAP_ERROR_CODES: readonly SwapErrorCode[] = Object.keys(SWAP_RPC_STATUS) as SwapErrorCode[];

export class SwapError extends Error {
  constructor(public status: number, public code: SwapErrorCode) {
    super(code);
    this.name = "SwapError";
  }
}

export function swapErrorFromRpc(message: string): never {
  const code = /^swap:([a-z_]+)$/.exec(message)?.[1];
  if (code && Object.hasOwn(SWAP_RPC_STATUS, code)) {
    throw new SwapError(SWAP_RPC_STATUS[code as SwapErrorCode], code as SwapErrorCode);
  }
  throw new Error("swap RPC failed");
}
