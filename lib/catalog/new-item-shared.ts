/**
 * JOB 2 — NEW ITEM, START TO FINISH (catalog Phase 4a; spec §5 job 2). PURE: the request a page sends, and the shop
 * setup steps that follow the one atomic create. No I/O; safe in client bundles.
 *
 *   what it is → vendor → name + vendor item number → how it arrives → price ......... ONE write (create_catalog_sku)
 *   par → order days → order-guide line → where it's used → barcode ................. one save each, its own writer
 *
 * The create is atomic: no item exists without its first pack and price. Each setup step is a SEPARATE save through
 * the writer that already owns it — the par lane, the vendor's rhythm, the vendor's guide, the recipe version writer,
 * the barcode door — so each keeps its own rules, refusals and audit. A step that fails is reported on its own, and
 * the item page's "What's missing" (2b) keeps offering it.
 */
import { isSkuClass, type SkuClass } from "@/lib/admin/catalog-shared";
import type { PackChainLevelInput } from "@/lib/admin/pack-chain";
import { parseLevels } from "@/lib/catalog/sku-item-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuidOrNull = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID.test(v) ? v : undefined;
const textOrNull = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t.length <= max ? t : undefined;
};

/**
 * Open once with the form (for example useState(newItemFormRequest)); reuse on
 * every pending submit, double-submit and lost-response retry, including edits.
 * After an acknowledged success (including replay), replace this factory with
 * newItemFormRequest() before the next create, even if the page stays open.
 * A replay returns the earlier item: show catalog.new_item.replayed and open it
 * to edit; never imply that the latest fields were applied.
 */
export function newItemFormRequest() {
  const request_id = crypto.randomUUID();
  return { request: <T extends object>(fields: T): T & { request_id: string } => ({ ...fields, request_id }) };
}

export interface NewItemRequest {
  /** Client-generated per new creation; retain for retries, re-mint after acknowledged success. */
  request_id: string;
  /** Where it starts (spec §3): a shop the actor works in; null = every shop — MoO+ only. */
  scope?: string | null;
  vendorId: string | null;
  name: string;
  itemNumber: string | null;
  /** How it arrives — 2b's sentence editor, as chain levels (levelsFromSentence). */
  levels: PackChainLevelInput[];
  /** What ONE weighs, in oz — needed when the chain ends in a count ("each") on a food item. */
  avgOzPerEach: number | null;
  /** The first price (per the top container), and the day it took effect. */
  unitPrice: number;
  priceDate: string;
  skuClass: SkuClass;
}

export const NEW_ITEM_ERROR_CODES = ["invalid_payload", "invalid_name", "invalid_levels", "invalid_price", "invalid_date", "needs_vendor"] as const;

export type NewItemParse =
  | { ok: true; request: NewItemRequest }
  | { ok: false; code: "invalid_payload" | "invalid_name" | "invalid_levels" | "invalid_price" | "invalid_date"; field: string };

export function parseNewItemRequest(raw: unknown): NewItemParse {
  if (!isObj(raw)) return { ok: false, code: "invalid_payload", field: "body" };
  if (typeof raw.request_id !== "string" || !UUID.test(raw.request_id)) return { ok: false, code: "invalid_payload", field: "request_id" };
  const request_id = raw.request_id;
  const scope = raw.scope === undefined ? undefined : uuidOrNull(raw.scope);
  if (raw.scope !== undefined && scope === undefined) return { ok: false, code: "invalid_payload", field: "scope" };
  const vendorId = uuidOrNull(raw.vendorId);
  if (vendorId === undefined) return { ok: false, code: "invalid_payload", field: "vendorId" };
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length < 1 || name.length > 200) return { ok: false, code: "invalid_name", field: "name" };
  const itemNumber = textOrNull(raw.itemNumber, 80);
  if (itemNumber === undefined) return { ok: false, code: "invalid_payload", field: "itemNumber" };
  const levels = parseLevels(raw.levels);
  if (!levels || levels.length === 0) return { ok: false, code: "invalid_levels", field: "levels" };
  const avg = raw.avgOzPerEach;
  const avgOzPerEach = avg === null || avg === undefined ? null : typeof avg === "number" && Number.isFinite(avg) && avg > 0 ? avg : undefined;
  if (avgOzPerEach === undefined) return { ok: false, code: "invalid_payload", field: "avgOzPerEach" };
  const p = raw.unitPrice;
  const unitPrice = typeof p === "number" && Number.isFinite(p) && p > 0 && p <= 100000 ? p : undefined;
  if (unitPrice === undefined) return { ok: false, code: "invalid_price", field: "unitPrice" };
  const d = raw.priceDate;
  const priceDate = typeof d === "string" && DATE.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d ? d : undefined;
  if (priceDate === undefined) return { ok: false, code: "invalid_date", field: "priceDate" };
  const skuClass = raw.skuClass === null || raw.skuClass === undefined ? "raw" : isSkuClass(raw.skuClass) ? raw.skuClass : undefined;
  if (skuClass === undefined) return { ok: false, code: "invalid_payload", field: "skuClass" };
  return { ok: true, request: { request_id, scope, vendorId, name, itemNumber, levels, avgOzPerEach, unitPrice, priceDate, skuClass } };
}

/** The shop setup after the create — each one an existing writer, saved and reported on its own. */
export type SetupStep =
  | { kind: "par"; weekdayPar: number | null; weekendPar: number | null }
  | { kind: "order_days"; days: Array<{ orderDow: number; leadDays: number }> }
  | { kind: "guide_line"; sectionId: string | null; newSectionName: string | null }
  | { kind: "use_in"; recipeId: string; quantity: number; unit: string; expectedVersionId: string | null; basedOnVersionId: string | null }
  | { kind: "barcode"; code: string; level: "case" | "inner" };

export const SETUP_STEP_KINDS = ["par", "order_days", "guide_line", "use_in", "barcode"] as const satisfies ReadonlyArray<SetupStep["kind"]>;

export type SetupParse = { ok: true; shopId: string; step: SetupStep } | { ok: false; field: string };

const par = (v: unknown): number | null | undefined =>
  v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100000 ? v : undefined;
const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;

export function parseSetupStep(raw: unknown): SetupParse {
  if (!isObj(raw)) return { ok: false, field: "body" };
  if (typeof raw.shopId !== "string" || !UUID.test(raw.shopId)) return { ok: false, field: "shopId" };
  const shopId = raw.shopId;
  const s = raw.step;
  if (!isObj(s)) return { ok: false, field: "step" };
  switch (s.kind) {
    case "par": {
      const weekdayPar = par(s.weekdayPar);
      const weekendPar = par(s.weekendPar);
      if (weekdayPar === undefined || weekendPar === undefined) return { ok: false, field: "par" };
      return { ok: true, shopId, step: { kind: "par", weekdayPar, weekendPar } };
    }
    case "order_days": {
      if (!Array.isArray(s.days) || s.days.length === 0 || s.days.length > 7) return { ok: false, field: "days" };
      const days: Array<{ orderDow: number; leadDays: number }> = [];
      const seen = new Set<number>();
      for (const d of s.days) {
        if (!isObj(d)) return { ok: false, field: "days" };
        const orderDow = int(d.orderDow, 0, 6);
        const leadDays = int(d.leadDays, 0, 14);
        if (orderDow === undefined || leadDays === undefined || seen.has(orderDow)) return { ok: false, field: "days" };
        seen.add(orderDow);
        days.push({ orderDow, leadDays });
      }
      return { ok: true, shopId, step: { kind: "order_days", days } };
    }
    case "guide_line": {
      const sectionId = uuidOrNull(s.sectionId);
      const newSectionName = textOrNull(s.newSectionName, 60);
      if (sectionId === undefined || newSectionName === undefined || (sectionId === null) === (newSectionName === null)) return { ok: false, field: "section" };
      return { ok: true, shopId, step: { kind: "guide_line", sectionId, newSectionName } };
    }
    case "use_in": {
      if (typeof s.recipeId !== "string" || !UUID.test(s.recipeId)) return { ok: false, field: "recipeId" };
      if (typeof s.quantity !== "number" || !Number.isFinite(s.quantity) || s.quantity <= 0) return { ok: false, field: "quantity" };
      const unit = textOrNull(s.unit, 40);
      if (!unit) return { ok: false, field: "unit" };
      const expectedVersionId = uuidOrNull(s.expectedVersionId);
      const basedOnVersionId = uuidOrNull(s.basedOnVersionId);
      if (expectedVersionId === undefined || basedOnVersionId === undefined) return { ok: false, field: "version" };
      return { ok: true, shopId, step: { kind: "use_in", recipeId: s.recipeId, quantity: s.quantity, unit, expectedVersionId, basedOnVersionId } };
    }
    case "barcode": {
      const code = textOrNull(s.code, 64);
      if (!code || code.length < 6) return { ok: false, field: "code" };
      if (s.level !== "case" && s.level !== "inner") return { ok: false, field: "level" };
      return { ok: true, shopId, step: { kind: "barcode", code, level: s.level } };
    }
    default:
      return { ok: false, field: "kind" };
  }
}
