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
