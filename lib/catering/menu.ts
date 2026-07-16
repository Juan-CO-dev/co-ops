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

export const MENU_READ_MIN = 5;

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new Error("catering menu: insufficient role level");
}
function dollarsToCents(v: number | string | null): number {
  if (v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export interface CateringMenuItem {
  id: string;
  name: string;
  nameEs: string | null;
  section: string | null;
  unitPriceCents: number;
  cateringOnly: boolean;
}
export interface PackageLine {
  itemId: string | null;
  menuItemId: string | null;
  label: string;
  quantity: number;
  unitPriceCents: number;
}
export interface CateringPackage {
  id: string;
  labelEn: string;
  labelEs: string | null;
  pricingMode: string;
  priceCents: number;
  minHeadcount: number | null;
  items: PackageLine[];
}

/** Active catering-available items (the à-la-carte menu), à-la-carte-picker ordered. */
export async function loadCateringMenuItems(actor: AuthContext): Promise<CateringMenuItem[]> {
  requireLevel(actor, MENU_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("items")
    .select("id, name, name_es, section, menu_price, catering_only")
    .eq("active", true)
    .eq("catering_available", true)
    .order("section", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_only: boolean }>>();
  if (error) throw new Error(`loadCateringMenuItems: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    nameEs: r.name_es,
    section: r.section,
    unitPriceCents: dollarsToCents(r.menu_price),
    cateringOnly: r.catering_only,
  }));
}

/** Active catering packages (global + this location) with their line items, for expansion. */
export async function loadCateringPackagesForQuote(actor: AuthContext, locationId: string): Promise<CateringPackage[]> {
  requireLevel(actor, MENU_READ_MIN);
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
    items: byPackage.get(p.id) ?? [],
  }));
}
