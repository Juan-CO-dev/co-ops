/**
 * Catering menu + packages loaders for the quote picker — Wave: identity arc PR-2.
 *
 * SERVER-ONLY. Read surface over the catering-flagged item registry (à la carte) and the
 * catering_packages KB (bundles). Feeds the quote builder's picker engine (the same engine
 * the client portal will later reuse). Prices come back as integer cents (items.menu_price
 * is numeric dollars → toCents here) so the builder + charge stack stay in the cents model.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { loadActiveRateRules } from "@/lib/catering/rate-rules";
import { cateringUnitPriceCents, resolveRateBps, type RateRule } from "@/lib/catering/pricing-derivation";

export const MENU_READ_MIN = 5;

/** Canonical UUID — locationId is interpolated into a PostgREST `.or()` filter, so guard it. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new Error("catering menu: insufficient role level");
}
function dollarsToCents(v: number | string | null): number {
  if (v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export interface CateringMenuItem {
  kind: "item" | "menu_item";
  id: string;                       // item_id OR menu_item_id (per kind)
  name: string;
  nameEs: string | null;
  section: string | null;
  cateringOnly: boolean;
  portionable: boolean;
  regularPriceCents: number;        // basis for recommend/implied-rate
  rateBps: number;                  // resolved effective rate
  unitPriceCents: number;           // whole catering price (= derived whole; for a sized item = the "from"/smallest size)
  portionPricesCents: { quarter: number; half: number; whole: number } | null; // present iff portionable
  sizes: Array<{ id: string; label: string; unitPriceCents: number; serves: number | null }> | null; // present iff the item has active item_sizes
  /** People covered per ONE whole unit (0154; at-a-glance coverage). Null → 1. */
  serves: number | null;
}

/** Build a priced CateringMenuItem from a raw row + the location's rate rules. Returns null when
 *  the entity has no usable regular price (unpriceable → excluded, never sold at $0). */
export function buildCateringMenuItem(
  row: { kind: "item" | "menu_item"; id: string; name: string; nameEs: string | null; section: string | null;
         menuPriceCents: number; cateringOnly: boolean; portionable: boolean; serves?: number | null;
         sizes?: Array<{ id: string; label: string; priceCents: number; serves: number | null }> },
  rules: RateRule[],
): CateringMenuItem | null {
  // A sized item prices off its sizes (each an explicit base × rate); an un-sized item off menu_price.
  const rawSizes = (row.sizes ?? []).filter((s) => s.priceCents > 0);
  const hasSizes = rawSizes.length > 0;
  if (!hasSizes && !(row.menuPriceCents > 0)) return null;
  const rateBps = resolveRateBps(rules, { kind: row.kind, entityId: row.id, section: row.section });
  const sizes = hasSizes
    ? rawSizes.map((s) => ({ id: s.id, label: s.label, serves: s.serves,
        unitPriceCents: cateringUnitPriceCents(s.priceCents, "whole", rateBps) }))
    : null;
  // "whole"/top-level unit price: the smallest size (the "from …") for a sized item, else regular × rate.
  const whole = sizes && sizes.length > 0
    ? Math.min(...sizes.map((s) => s.unitPriceCents))
    : cateringUnitPriceCents(row.menuPriceCents, "whole", rateBps);
  return {
    kind: row.kind, id: row.id, name: row.name, nameEs: row.nameEs, section: row.section,
    cateringOnly: row.cateringOnly, portionable: row.portionable, serves: row.serves ?? null,
    regularPriceCents: row.menuPriceCents, rateBps, unitPriceCents: whole,
    portionPricesCents: row.portionable
      ? { quarter: cateringUnitPriceCents(row.menuPriceCents, "quarter", rateBps),
          half: cateringUnitPriceCents(row.menuPriceCents, "half", rateBps),
          whole }
      : null,
    sizes,
  };
}
export interface PackageLine {
  itemId: string | null;
  menuItemId: string | null;
  label: string;
  quantity: number;
  unitPriceCents: number;
}
/** An eligible option of a choice slot (sub-project B). */
export interface PackageSlotOption { kind: "item" | "menu_item"; refId: string; name: string }
/** A choice slot on a package: pick `pickN` (whole-sub) picks from `options`. */
export interface PackageSlot { packageItemId: string; label: string; pickN: number; options: PackageSlotOption[] }
export interface CateringPackage {
  id: string;
  labelEn: string;
  labelEs: string | null;
  pricingMode: string;
  priceCents: number;
  minHeadcount: number | null;
  leadTimeHours: number | null;   // advisory
  /** People covered per ONE package (0154; at-a-glance coverage). Null → derived from picks. */
  serves: number | null;
  slots: PackageSlot[];           // choice slots + eligible options (sub-project B)
  items: PackageLine[];
}

/**
 * The unified catering à-la-carte menu for a location: catering-available `items` (extras, whole
 * only) ∪ catering-available `menu_items` (subs, portionable per catering_portionable), each priced
 * by the location's active rate rules (regular price × portion × rate). Unpriceable rows are dropped.
 * Rates are per-location, so a locationId is required.
 */
export async function loadCateringMenuItems(actor: AuthContext, locationId: string): Promise<CateringMenuItem[]> {
  requireLevel(actor, MENU_READ_MIN);
  if (!UUID_RE.test(locationId)) throw new Error("catering menu: invalid locationId");
  const sb = getServiceRoleClient();
  const rules = await loadActiveRateRules(locationId);
  const [{ data: itemRows, error: iErr }, { data: subRows, error: sErr }] = await Promise.all([
    sb
      .from("items")
      .select("id, name, name_es, section, menu_price, catering_only")
      .eq("active", true)
      .eq("catering_available", true)
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_only: boolean }>>(),
    sb
      .from("menu_items")
      .select("id, name, name_es, section, menu_price, catering_only, catering_portionable")
      .eq("active", true)
      .eq("catering_available", true)
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_only: boolean; catering_portionable: boolean }>>(),
  ]);
  if (iErr) throw new Error(`loadCateringMenuItems items: ${iErr.message}`);
  if (sErr) throw new Error(`loadCateringMenuItems menu_items: ${sErr.message}`);
  const out: CateringMenuItem[] = [];
  for (const r of itemRows ?? []) {
    const built = buildCateringMenuItem(
      { kind: "item", id: r.id, name: r.name, nameEs: r.name_es, section: r.section,
        menuPriceCents: dollarsToCents(r.menu_price), cateringOnly: r.catering_only, portionable: false },
      rules,
    );
    if (built) out.push(built);
  }
  for (const r of subRows ?? []) {
    const built = buildCateringMenuItem(
      { kind: "menu_item", id: r.id, name: r.name, nameEs: r.name_es, section: r.section,
        menuPriceCents: dollarsToCents(r.menu_price), cateringOnly: r.catering_only, portionable: r.catering_portionable },
      rules,
    );
    if (built) out.push(built);
  }
  return out.sort((a, b) => (a.section ?? "").localeCompare(b.section ?? "") || a.name.localeCompare(b.name));
}

/** Active catering packages (global + this location) with their line items, for expansion. */
export async function loadCateringPackagesForQuote(actor: AuthContext, locationId: string): Promise<CateringPackage[]> {
  requireLevel(actor, MENU_READ_MIN);
  // Guard the interpolated `.or()` filter below — reject a malformed locationId before the query
  // (staff-auth'd, but closes the injection class for parity with the portal-side menu loader).
  if (!UUID_RE.test(locationId)) throw new Error("catering menu: invalid locationId");
  const sb = getServiceRoleClient();
  const { data: pkgs, error } = await sb
    .from("catering_packages")
    .select("id, label_en, label_es, pricing_mode, price_cents, min_headcount, location_id")
    .eq("active", true)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .order("display_order", { ascending: true })
    .returns<Array<{ id: string; label_en: string; label_es: string | null; pricing_mode: string; price_cents: number; min_headcount: number | null; location_id: string | null }>>();
  if (error) throw new Error(`loadCateringPackagesForQuote: ${error.message}`);
  const packages = pkgs ?? [];
  if (packages.length === 0) return [];

  const { data: items, error: iErr } = await sb
    .from("catering_package_items")
    .select("package_id, item_id, menu_item_id, description, quantity")
    .in("package_id", packages.map((p) => p.id))
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<Array<{ package_id: string; item_id: string | null; menu_item_id: string | null; description: string | null; quantity: number | string }>>();
  if (iErr) throw new Error(`loadCateringPackagesForQuote items: ${iErr.message}`);
  const pkgItems = items ?? [];

  // Resolve names + prices for the referenced spine leaves so expanded lines are labeled + priced.
  const itemIds = [...new Set(pkgItems.map((r) => r.item_id).filter((v): v is string => v != null))];
  const menuItemIds = [...new Set(pkgItems.map((r) => r.menu_item_id).filter((v): v is string => v != null))];
  const itemMap = new Map<string, { name: string; priceCents: number }>();
  const menuMap = new Map<string, { name: string; priceCents: number }>();
  if (itemIds.length > 0) {
    const { data: rows } = await sb.from("items").select("id, name, menu_price").in("id", itemIds).returns<Array<{ id: string; name: string; menu_price: number | string | null }>>();
    for (const r of rows ?? []) itemMap.set(r.id, { name: r.name, priceCents: dollarsToCents(r.menu_price) });
  }
  if (menuItemIds.length > 0) {
    const { data: rows } = await sb.from("menu_items").select("id, name, menu_price").in("id", menuItemIds).returns<Array<{ id: string; name: string; menu_price: number | string | null }>>();
    for (const r of rows ?? []) menuMap.set(r.id, { name: r.name, priceCents: dollarsToCents(r.menu_price) });
  }

  const byPackage = new Map<string, PackageLine[]>();
  for (const r of pkgItems) {
    const resolved = r.item_id ? itemMap.get(r.item_id) : r.menu_item_id ? menuMap.get(r.menu_item_id) : undefined;
    const label = (r.description && r.description.trim()) || resolved?.name || "Item";
    const arr = byPackage.get(r.package_id) ?? [];
    arr.push({ itemId: r.item_id, menuItemId: r.menu_item_id, label, quantity: Number(r.quantity), unitPriceCents: resolved?.priceCents ?? 0 });
    byPackage.set(r.package_id, arr);
  }

  return packages.map((p) => ({
    id: p.id,
    labelEn: p.label_en,
    labelEs: p.label_es,
    pricingMode: p.pricing_mode,
    priceCents: p.price_cents,
    minHeadcount: p.min_headcount,
    leadTimeHours: null, // staff quote picker doesn't consume these in sub-project B
    serves: null,
    slots: [],
    items: byPackage.get(p.id) ?? [],
  }));
}
