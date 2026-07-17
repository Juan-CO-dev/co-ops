/**
 * Public (customer-facing) catering menu + pricing loaders — Portal-3.
 *
 * SERVER-ONLY. These are un-gated mirrors of the staff loaders in
 * lib/catering/menu.ts + lib/catering/quotes.ts (loadPricingContext): they take a
 * `locationId` directly and do NOT enforce the staff `AuthContext` / requireLevel /
 * canSeeLocation gates, because the customer principal (Portal-2) has no staff role.
 * All reads are service-role; the authorization boundary for the portal is the
 * customer session at the route layer + strict server-side price authority (D20) —
 * these loaders only ever RESOLVE the real, server-owned price for a referenced menu
 * row, never trust a client-supplied price.
 *
 * Prices come back as integer cents (items.menu_price is numeric dollars → toCents)
 * so the charge stack stays in the cents model. The `dollarsToCents` helper and the
 * `ZERO_RATES` default are re-declared locally because the staff files do NOT export
 * them (do not modify the staff files to widen their surface for the portal).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import type { CateringMenuItem, CateringPackage, PackageLine } from "@/lib/catering/menu";
import type { ChargeRates, DeliveryZone } from "@/lib/catering/quotes";

/** items.menu_price is numeric dollars; freeze to integer cents (mirrors lib/catering/menu.ts). */
function dollarsToCents(v: number | string | null): number {
  if (v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/** All-zero rate defaults when a location has no active pricing rule (mirrors lib/catering/quotes.ts). */
const ZERO_RATES: ChargeRates = {
  taxRateBps: 0,
  gratuityBps: 0,
  serviceChargeBps: 0,
  depositPctBps: 0,
  taxOnDelivery: true,
  taxOnGratuity: false,
};

export interface PublicPricingContext {
  rates: ChargeRates;
  hasPricingRule: boolean;
  zones: DeliveryZone[];
}

/** Active catering-available items (the à-la-carte menu), section→name ordered. Un-gated. */
export async function loadPublicCateringMenu(): Promise<CateringMenuItem[]> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("items")
    .select("id, name, name_es, section, menu_price, catering_only")
    .eq("active", true)
    .eq("catering_available", true)
    .order("section", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_only: boolean }>>();
  if (error) throw new Error(`loadPublicCateringMenu: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    nameEs: r.name_es,
    section: r.section,
    unitPriceCents: dollarsToCents(r.menu_price),
    cateringOnly: r.catering_only,
  }));
}

/** Active catering packages (global + this location) with their expanded, priced line items. Un-gated. */
export async function loadPublicCateringPackages(locationId: string): Promise<CateringPackage[]> {
  const sb = getServiceRoleClient();
  const { data: pkgs, error } = await sb
    .from("catering_packages")
    .select("id, label_en, label_es, pricing_mode, price_cents, min_headcount, location_id")
    .eq("active", true)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .order("display_order", { ascending: true })
    .returns<Array<{ id: string; label_en: string; label_es: string | null; pricing_mode: string; price_cents: number; min_headcount: number | null; location_id: string | null }>>();
  if (error) throw new Error(`loadPublicCateringPackages: ${error.message}`);
  const packages = pkgs ?? [];
  if (packages.length === 0) return [];

  const { data: items, error: iErr } = await sb
    .from("catering_package_items")
    .select("package_id, item_id, menu_item_id, description, quantity")
    .in("package_id", packages.map((p) => p.id))
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<Array<{ package_id: string; item_id: string | null; menu_item_id: string | null; description: string | null; quantity: number | string }>>();
  if (iErr) throw new Error(`loadPublicCateringPackages items: ${iErr.message}`);
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

/** Active pricing rule (or ZERO_RATES) + active delivery zones for a location. Un-gated. */
export async function loadPublicPricingContext(locationId: string): Promise<PublicPricingContext> {
  const sb = getServiceRoleClient();
  const [{ data: rule, error: rErr }, { data: zoneRows, error: zErr }] = await Promise.all([
    sb
      .from("catering_pricing_rules")
      .select("tax_rate_bps, gratuity_bps, service_charge_bps, deposit_pct_bps, tax_on_delivery, tax_on_gratuity")
      .eq("location_id", locationId)
      .eq("active", true)
      .maybeSingle<{ tax_rate_bps: number; gratuity_bps: number; service_charge_bps: number; deposit_pct_bps: number; tax_on_delivery: boolean; tax_on_gratuity: boolean }>(),
    sb
      .from("catering_delivery_zones")
      .select("id, slug, label_en, label_es, fee_cents, min_order_cents")
      .eq("location_id", locationId)
      .eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ id: string; slug: string; label_en: string; label_es: string | null; fee_cents: number; min_order_cents: number | null }>>(),
  ]);
  if (rErr) throw new Error(`loadPublicPricingContext rule: ${rErr.message}`);
  if (zErr) throw new Error(`loadPublicPricingContext zones: ${zErr.message}`);
  const rates: ChargeRates = rule
    ? {
        taxRateBps: rule.tax_rate_bps,
        gratuityBps: rule.gratuity_bps,
        serviceChargeBps: rule.service_charge_bps,
        depositPctBps: rule.deposit_pct_bps,
        taxOnDelivery: rule.tax_on_delivery,
        taxOnGratuity: rule.tax_on_gratuity,
      }
    : { ...ZERO_RATES };
  const zones: DeliveryZone[] = (zoneRows ?? []).map((z) => ({
    id: z.id,
    slug: z.slug,
    labelEn: z.label_en,
    labelEs: z.label_es,
    feeCents: z.fee_cents,
    minOrderCents: z.min_order_cents,
  }));
  return { rates, hasPricingRule: !!rule, zones };
}
