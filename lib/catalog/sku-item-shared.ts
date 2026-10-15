/**
 * The connected ITEM PAGE for a bought item — the client-safe surface (catalog Phase 2b; spec §4).
 * View-model types the server fills (lib/catalog/sku-item.ts) and the client renders
 * (components/catalog/SkuItemClient.tsx), the deep-link builder, the job param, and where each
 * "What's missing" errand sends the fix-it button.
 */
import type { DataErrand, DataErrandCode } from "@/lib/sku-data-readiness";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { ParLane } from "@/lib/location-sku-shared";
import type { PackChangeProposal } from "@/lib/pack-change-requests-shared";
import type { PackChainLevelInput } from "@/lib/admin/pack-chain";
import type { ParConversion, PreviewTarget } from "@/lib/catalog/change-preview-shared";

export const PRICE_BASES = ["per_case", "per_each", "per_lb", "per_dozen", "per_bundle"] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

export type ItemJob = "pack" | "price";
export type ItemSection = "arrives" | "price" | "ordering" | "counting" | "barcodes" | "connections" | "history";

/** The page for one bought item; `shopId` null = the global default, undefined = the remembered shop. */
export function skuItemHref(skuId: string, opts: { shopId?: string | null; job?: ItemJob; requestId?: string } = {}): string {
  const q: string[] = [];
  if (opts.shopId !== undefined) q.push(`location=${opts.shopId === null ? "global" : encodeURIComponent(opts.shopId)}`);
  if (opts.job) q.push(`job=${opts.job}`);
  if (opts.requestId) q.push(`request=${encodeURIComponent(opts.requestId)}`);
  return `/admin/catalog/sku/${encodeURIComponent(skuId)}${q.length ? `?${q.join("&")}` : ""}`;
}

export function readJobParam(v: string | string[] | undefined): ItemJob | null {
  return v === "pack" || v === "price" ? v : null;
}

/** What the header says: the global default, a shop riding it, or a shop with its own version. */
export function versionLabelKind(scope: string | null, shopPack: boolean, shopPrice: boolean): "global" | "shop_default" | "shop_own" {
  if (scope === null) return "global";
  return shopPack || shopPrice ? "shop_own" : "shop_default";
}

/** Where each readiness errand's fix-it button goes (spec §4 "What's missing … each with a fix-it button"). */
export function fixItSection(code: DataErrandCode): ItemSection {
  switch (code) {
    case "no_price":
    case "price_stale":
      return "price";
    case "raw_pack_contents_missing":
    case "no_countable_chain":
    case "no_order_unit":
    case "weight_estimate":
      return "arrives";
    case "no_par":
    case "no_rhythm":
    case "no_vendor":
      return "ordering";
    case "recipe_unresolved":
      return "connections";
  }
}

/** A date whose weekday is `dow` (0 = Sunday), for lib/i18n/format.ts formatWeekday. */
export function sundayAnchoredDate(dow: number): string {
  return `2026-10-${String(18 + dow).padStart(2, "0")}`;
}

export interface SkuItemView {
  sku: {
    id: string; name: string; itemNumber: string | null; active: boolean; skuClass: string;
    priceBasis: PriceBasis | null; avgOzPerEach: number | null; packFormat: string | null;
  };
  vendor: { id: string; name: string; active: boolean } | null;
  product: { id: string; name: string; primarySkuId: string | null; primarySkuName: string | null } | null;
  shops: Array<{ id: string; name: string }>;
  scope: string | null;
  scopeName: string | null;
  can: { editShop: boolean; editGlobal: boolean; editPar: boolean; editBasis: boolean };
  pack: {
    levels: PackChainLevel[];
    versionId: string | null;
    isShopVersion: boolean;
    effectiveFrom: string | null;
    globalVersionId: string | null;
    orderUnit: string | null;
    orderUnitOz: number | null;
    descriptor: string | null;
  };
  price: {
    value: number | null; effectiveDate: string | null; isShopLane: boolean;
    globalValue: number | null; costPerOz: number | null;
    history: Array<{ id: string; unitPrice: number; effectiveDate: string; shop: boolean }>;
  };
  ordering: {
    slots: Array<{ slot: "weekday" | "weekend"; value: number | null; lane: ParLane }>;
    orderDays: number[];
    offHere: boolean;
  };
  counting: { unit: string | null };
  barcodes: Array<{ code: string; level: "case" | "inner"; taughtAt: string }>;
  connections: {
    uses: Array<{ id: string; name: string }>;
    menuItems: Array<{ id: string; name: string; nameEs: string | null; cost: number | null }>;
  };
  missing: DataErrand[];
  history: Array<{ id: string; scope: "global" | "shop"; active: boolean; effectiveFrom: string; retiredAt: string | null; who: string | null; labels: string[] }>;
  openRequests: Array<{ id: string; filedBy: string | null; filedAt: string; note: string | null; proposal: PackChangeProposal | null }>;
  measures: Array<{ label: string; dimension: "weight" | "volume" | "count"; toBaseFactor: number }>;
}

// ── The routes' explicit field lists (catalog Phase 2b Task 6). A route file may export only HTTP
//    methods (Next 16), so the parsers live here. ──────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The explicit level field list every pack route accepts (≤ 8 levels). null = refuse. */
export function parseLevels(raw: unknown): PackChainLevelInput[] | null {
  if (!Array.isArray(raw) || raw.length > 8) return null;
  const out: PackChainLevelInput[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) return null;
    const l = r as Record<string, unknown>;
    if (typeof l.label !== "string" || l.label.length > 60 || typeof l.containsQty !== "number" || !Number.isFinite(l.containsQty)) return null;
    const idx = l.containsIndex === null || l.containsIndex === undefined ? null : l.containsIndex;
    const unit = l.containsMeasureUnit === null || l.containsMeasureUnit === undefined ? null : l.containsMeasureUnit;
    if ((idx !== null && (typeof idx !== "number" || !Number.isInteger(idx))) || (unit !== null && (typeof unit !== "string" || unit.length > 40))) return null;
    out.push({ label: l.label, containsQty: l.containsQty, containsIndex: idx as number | null, containsMeasureUnit: unit as string | null });
  }
  return out;
}

/** The save target: `{ kind: "global" }` or `{ kind: "shop", shopId: uuid }`. null = refuse. */
export function parseTarget(raw: unknown): PreviewTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "global") return { kind: "global" };
  if (t.kind === "shop" && typeof t.shopId === "string" && UUID.test(t.shopId)) return { kind: "shop", shopId: t.shopId };
  return null;
}

/** The conversions a person accepted (absent = none). null = refuse. */
export function parseConversions(raw: unknown): ParConversion[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 8) return null;
  const out: ParConversion[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) return null;
    const c = r as Record<string, unknown>;
    const locationId = c.locationId === null ? null : typeof c.locationId === "string" && UUID.test(c.locationId) ? c.locationId : undefined;
    if (locationId === undefined) return null;
    if (c.slot !== "weekday" && c.slot !== "weekend") return null;
    if (typeof c.expected !== "number" || !Number.isFinite(c.expected) || c.expected < 0) return null;
    if (typeof c.to !== "number" || !Number.isFinite(c.to) || c.to < 0) return null;
    if (c.inherited !== undefined && c.inherited !== true && c.inherited !== false) return null;
    if (c.from !== undefined && c.from !== "auto") return null;
    const inherited = c.inherited === true;
    if (inherited && locationId === null) return null; // "give a shop its own par" names the shop
    if (c.from === "auto" && !inherited) return null; // the auto source only CREATES the shop's own slot
    out.push(!inherited
      ? { locationId, slot: c.slot, expected: c.expected, to: c.to }
      : c.from === "auto"
        ? { locationId, slot: c.slot, expected: c.expected, to: c.to, inherited: true, from: "auto" }
        : { locationId, slot: c.slot, expected: c.expected, to: c.to, inherited: true });
  }
  return out;
}

/** The client body's identity: a different SKU or shop is a different page (state never carries over). */
export function itemClientKey(skuId: string, scope: string | null): string {
  return `${skuId}:${scope ?? "global"}`;
}

/**
 * EVERY named refusal the item page's server half (lib/catalog/sku-item.ts, the rethrown 2a and
 * pack-chain codes, versionErrorFromRpc's 0259/0261 codes), its routes and the dismiss can return.
 * Each one has its OWN en + es message `catalog.error.<code>` (never the generic text);
 * tests/catalog-item-server.test.ts pins both directions. `generic` is only for a 500.
 */
export const CATALOG_ITEM_ERROR_CODES = [
  "already_resolved", "chain_cycle", "chain_invalid", "chain_unreachable", "cycle", "dependencies_changed",
  "duplicate_label", "empty_chain", "flat_pack_exists", "forbidden", "global_cannot_retire", "global_requires_moo",
  "invalid_based_on", "invalid_basis", "invalid_date", "invalid_label", "invalid_levels", "invalid_link",
  "invalid_patch", "invalid_payload", "invalid_pointer", "invalid_price", "invalid_qty", "label_is_measure_unit",
  "leaf_needs_avg", "location_not_found", "location_required", "no_shop_price", "non_positive_qty", "not_found",
  "not_live", "not_one_root", "par_changed", "price_changed", "par_forbidden", "par_lane_mismatch", "preview_stale",
  "request_mismatch", "request_not_open", "self_reference", "shared_child", "sku_inactive", "sku_not_found",
  "sku_owned_by_other_shop", "step_up_required", "step_up_stale", "unknown_measure", "version_changed",
  "version_sku_mismatch",
] as const;
export type CatalogItemErrorCode = (typeof CATALOG_ITEM_ERROR_CODES)[number];
