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
import { buildCateringMenuItem } from "@/lib/catering/menu";
import type { CateringMenuItem, CateringPackage, PackageLine, PackageSlot, PackageSlotOption } from "@/lib/catering/menu";
import { loadActiveRateRules } from "@/lib/catering/rate-rules";
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

/**
 * The portal's locationId is CLIENT-SUPPLIED, and loadPublicCateringPackages interpolates it
 * into a PostgREST `.or()` filter STRING (`.eq()` values are parameterized and safe, but an
 * `.or(...)` argument is parsed as a filter expression). An unvalidated value is therefore a
 * filter-injection vector. A location id is always a UUID — reject anything else up front so a
 * value carrying commas/parens/operators never reaches the filter.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertLocationId(locationId: string): void {
  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    throw new Error("catering portal menu: locationId must be a UUID");
  }
}

export interface PublicPricingContext {
  rates: ChargeRates;
  hasPricingRule: boolean;
  zones: DeliveryZone[];
}

/**
 * The unified public catering à-la-carte menu for a location: catering-available `items` (extras,
 * whole only) ∪ catering-available `menu_items` (subs, portionable per catering_portionable), each
 * priced by the location's active rate rules. Un-gated (portal has no staff AuthContext); the
 * derived prices are the server-owned authority. Unpriceable rows are dropped. section→name ordered.
 */
export async function loadPublicCateringMenu(locationId: string): Promise<CateringMenuItem[]> {
  assertLocationId(locationId);
  const sb = getServiceRoleClient();
  const rules = await loadActiveRateRules(locationId);
  const [{ data: itemRows, error: iErr }, { data: subRows, error: sErr }] = await Promise.all([
    sb
      .from("items")
      .select("id, name, name_es, section, menu_price, catering_only, serves")
      .eq("active", true)
      .eq("catering_available", true)
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_only: boolean; serves: number | string | null }>>(),
    sb
      .from("menu_items")
      .select("id, name, name_es, section, menu_price, catering_only, catering_portionable, serves")
      .eq("active", true)
      .eq("catering_available", true)
      .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; menu_price: number | string | null; catering_only: boolean; catering_portionable: boolean; serves: number | string | null }>>(),
  ]);
  if (iErr) throw new Error(`loadPublicCateringMenu items: ${iErr.message}`);
  if (sErr) throw new Error(`loadPublicCateringMenu menu_items: ${sErr.message}`);

  // Batch-load the catering SIZE tiers for the fetched items (sub-project A). Grouped by item_id,
  // ordered by display_order; passed into buildCateringMenuItem so a sided item prices off its sizes.
  const itemIdList = (itemRows ?? []).map((r) => r.id);
  const sizesByItem = new Map<string, Array<{ id: string; label: string; priceCents: number; serves: number | null }>>();
  if (itemIdList.length > 0) {
    const { data: sizeRows, error: szErr } = await sb
      .from("item_sizes")
      .select("id, item_id, label, price_cents, serves, display_order")
      .in("item_id", itemIdList)
      .eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ id: string; item_id: string; label: string; price_cents: number; serves: number | string | null; display_order: number }>>();
    if (szErr) throw new Error(`loadPublicCateringMenu sizes: ${szErr.message}`);
    for (const s of sizeRows ?? []) {
      const arr = sizesByItem.get(s.item_id) ?? [];
      arr.push({ id: s.id, label: s.label, priceCents: s.price_cents, serves: s.serves == null ? null : Number(s.serves) });
      sizesByItem.set(s.item_id, arr);
    }
  }

  const out: CateringMenuItem[] = [];
  for (const r of itemRows ?? []) {
    const built = buildCateringMenuItem(
      { kind: "item", id: r.id, name: r.name, nameEs: r.name_es, section: r.section,
        menuPriceCents: dollarsToCents(r.menu_price), cateringOnly: r.catering_only, portionable: false, serves: r.serves == null ? null : Number(r.serves),
        sizes: sizesByItem.get(r.id) },
      rules,
    );
    if (built) out.push(built);
  }
  for (const r of subRows ?? []) {
    const built = buildCateringMenuItem(
      { kind: "menu_item", id: r.id, name: r.name, nameEs: r.name_es, section: r.section,
        menuPriceCents: dollarsToCents(r.menu_price), cateringOnly: r.catering_only, portionable: r.catering_portionable, serves: r.serves == null ? null : Number(r.serves) },
      rules,
    );
    if (built) out.push(built);
  }
  return out.sort((a, b) => (a.section ?? "").localeCompare(b.section ?? "") || a.name.localeCompare(b.name));
}

/** Active catering packages (global + this location) with their expanded, priced line items. Un-gated. */
export async function loadPublicCateringPackages(locationId: string): Promise<CateringPackage[]> {
  assertLocationId(locationId); // filter-injection guard — locationId reaches an .or() string below
  const sb = getServiceRoleClient();
  const { data: pkgs, error } = await sb
    .from("catering_packages")
    .select("id, label_en, label_es, pricing_mode, price_cents, min_headcount, lead_time_hours, location_id, serves")
    .eq("active", true)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .order("display_order", { ascending: true })
    .returns<Array<{ id: string; label_en: string; label_es: string | null; pricing_mode: string; price_cents: number; min_headcount: number | null; lead_time_hours: number | null; location_id: string | null; serves: number | string | null }>>();
  if (error) throw new Error(`loadPublicCateringPackages: ${error.message}`);
  const packages = pkgs ?? [];
  if (packages.length === 0) return [];

  const { data: items, error: iErr } = await sb
    .from("catering_package_items")
    .select("id, package_id, slot_type, item_id, menu_item_id, description, quantity")
    .in("package_id", packages.map((p) => p.id))
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<Array<{ id: string; package_id: string; slot_type: string; item_id: string | null; menu_item_id: string | null; description: string | null; quantity: number | string }>>();
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

  // Choice slots + their eligible options (sub-project B). Mirrors lib/admin/catering/packages.ts hydratePackages.
  const choiceLines = pkgItems.filter((r) => r.slot_type === "choice");
  const slotsByPackage = new Map<string, PackageSlot[]>();
  if (choiceLines.length > 0) {
    const { data: optRows, error: oErr } = await sb
      .from("catering_package_slot_options")
      .select("package_item_id, item_id, menu_item_id, display_order")
      .in("package_item_id", choiceLines.map((r) => r.id))
      .eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ package_item_id: string; item_id: string | null; menu_item_id: string | null; display_order: number }>>();
    if (oErr) throw new Error(`loadPublicCateringPackages options: ${oErr.message}`);
    // Resolve names for any option refs not already in the fixed-line maps.
    const optItemIds = [...new Set((optRows ?? []).map((o) => o.item_id).filter((v): v is string => v != null && !itemMap.has(v)))];
    const optMenuIds = [...new Set((optRows ?? []).map((o) => o.menu_item_id).filter((v): v is string => v != null && !menuMap.has(v)))];
    if (optItemIds.length > 0) { const { data } = await sb.from("items").select("id, name").in("id", optItemIds).returns<Array<{ id: string; name: string }>>(); for (const x of data ?? []) itemMap.set(x.id, { name: x.name, priceCents: 0 }); }
    if (optMenuIds.length > 0) { const { data } = await sb.from("menu_items").select("id, name").in("id", optMenuIds).returns<Array<{ id: string; name: string }>>(); for (const x of data ?? []) menuMap.set(x.id, { name: x.name, priceCents: 0 }); }
    const optionsByLine = new Map<string, PackageSlotOption[]>();
    for (const o of optRows ?? []) {
      const kind = o.menu_item_id ? ("menu_item" as const) : ("item" as const);
      const refId = (o.menu_item_id ?? o.item_id)!;
      const name = kind === "menu_item" ? menuMap.get(refId)?.name ?? "Item" : itemMap.get(refId)?.name ?? "Item";
      const arr = optionsByLine.get(o.package_item_id) ?? []; arr.push({ kind, refId, name }); optionsByLine.set(o.package_item_id, arr);
    }
    for (const line of choiceLines) {
      const arr = slotsByPackage.get(line.package_id) ?? [];
      arr.push({ packageItemId: line.id, label: (line.description && line.description.trim()) || "Choose", pickN: Number(line.quantity), options: optionsByLine.get(line.id) ?? [] });
      slotsByPackage.set(line.package_id, arr);
    }
  }

  return packages.map((p) => ({
    id: p.id,
    serves: p.serves == null ? null : Number(p.serves),
    labelEn: p.label_en,
    labelEs: p.label_es,
    pricingMode: p.pricing_mode,
    priceCents: p.price_cents,
    minHeadcount: p.min_headcount,
    leadTimeHours: p.lead_time_hours,
    slots: slotsByPackage.get(p.id) ?? [],
    items: byPackage.get(p.id) ?? [],
  }));
}

/** Active pricing rule (or ZERO_RATES) + active delivery zones for a location. Un-gated. */
export async function loadPublicPricingContext(locationId: string): Promise<PublicPricingContext> {
  assertLocationId(locationId); // defense-in-depth (these .eq() are parameterized, but keep it uniform)
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
