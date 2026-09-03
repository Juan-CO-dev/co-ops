/**
 * W1b package pricing advice + picker. SERVER-ONLY, service-role. The picker is LOCATION-AGNOSTIC
 * (catering-available item existence is global); the RATE is applied per basis-location in
 * recommendPackagePrice via lib/catering/pricing-derivation.ts. Advisory only — the team's flat
 * package price_cents stays authoritative.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { loadActiveRateRules } from "@/lib/catering/rate-rules";
import { cateringUnitPriceCents, resolveRateBps, impliedRateBps } from "@/lib/catering/pricing-derivation";

export const PACKAGE_PRICE_READ_MIN = 6;

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new Error("package pricing: insufficient role level");
}
/** items.menu_price is numeric dollars; freeze to integer cents (mirrors lib/catering/menu.ts). */
function dollarsToCents(v: number | string | null): number {
  if (v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export interface PickerItem {
  kind: "item" | "menu_item";
  id: string;
  name: string;
  section: string | null;
  regularPriceCents: number;
}

/** The location-AGNOSTIC catering-available item set for the fixed-line + slot-option pickers.
 *  (Item existence is global; the RATE is applied per basis-location in recommendPackagePrice.) */
export async function loadPackagePickerMenu(actor: AuthContext): Promise<PickerItem[]> {
  requireLevel(actor, PACKAGE_PRICE_READ_MIN);
  const sb = getServiceRoleClient();
  const [{ data: items, error: iErr }, { data: subs, error: sErr }] = await Promise.all([
    sb.from("items").select("id, name, section, menu_price").eq("active", true).eq("catering_available", true)
      .returns<Array<{ id: string; name: string; section: string | null; menu_price: number | string | null }>>(),
    sb.from("menu_items").select("id, name, section, menu_price").eq("active", true).eq("catering_available", true)
      .returns<Array<{ id: string; name: string; section: string | null; menu_price: number | string | null }>>(),
  ]);
  if (iErr) throw new Error(`loadPackagePickerMenu items: ${iErr.message}`);
  if (sErr) throw new Error(`loadPackagePickerMenu menu_items: ${sErr.message}`);
  const out: PickerItem[] = [];
  for (const r of items ?? []) out.push({ kind: "item", id: r.id, name: r.name, section: r.section, regularPriceCents: dollarsToCents(r.menu_price) });
  for (const r of subs ?? []) out.push({ kind: "menu_item", id: r.id, name: r.name, section: r.section, regularPriceCents: dollarsToCents(r.menu_price) });
  return out.sort((a, b) => (a.section ?? "").localeCompare(b.section ?? "") || a.name.localeCompare(b.name));
}

export interface PackagePriceRecommendation {
  hasBasis: boolean; // false when a global package has no preview location, or 0 priceable lines
  alaCarteCents: number; // Σ constituent catering value
  priceCents: number; // the team's authoritative flat price
  impliedDiscountBps: number; // 10000 − impliedRateBps(price, alaCarte); + = discount, − = premium
  unpriceableLines: number; // fixed-freeform or empty-choice lines that contribute 0
}

/**
 * Advisory recommendation for a package's price: the à-la-carte catering value of its constituents
 * (fixed: item catering price × qty; choice: avg(eligible options) × qty) against a basis location's
 * rates, plus the implied bundle discount vs the team's flat price_cents. Nothing is written.
 */
export async function recommendPackagePrice(
  actor: AuthContext,
  args: { packageId: string; locationId: string | null },
): Promise<PackagePriceRecommendation> {
  requireLevel(actor, PACKAGE_PRICE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: pkg, error: pErr } = await sb
    .from("catering_packages")
    .select("id, location_id, price_cents")
    .eq("id", args.packageId)
    .maybeSingle<{ id: string; location_id: string | null; price_cents: number }>();
  if (pErr) throw new Error(`recommendPackagePrice package: ${pErr.message}`);
  if (!pkg) throw new Error("recommendPackagePrice: package not found");
  // TENANCY BIND (audit v2 B2): a shop-scoped package's price basis is that shop's data —
  // a single-shop actor may not preview the other shop's package. Constant shape with the
  // not-found above (this advisory read has no typed error class); null = global, unbound.
  if (
    pkg.location_id !== null &&
    !lockLocationContext({ role: actor.user.role, locations: actor.locations } satisfies LocationActor, pkg.location_id)
  ) {
    throw new Error("recommendPackagePrice: package not found");
  }

  const basisLocation = pkg.location_id ?? args.locationId; // package location wins; else the preview location
  const priceCents = pkg.price_cents;
  if (!basisLocation) return { hasBasis: false, alaCarteCents: 0, priceCents, impliedDiscountBps: 0, unpriceableLines: 0 };

  const rules = await loadActiveRateRules(basisLocation);
  const { data: lines } = await sb
    .from("catering_package_items")
    .select("id, slot_type, item_id, menu_item_id, quantity")
    .eq("package_id", args.packageId)
    .eq("active", true)
    .returns<Array<{ id: string; slot_type: string; item_id: string | null; menu_item_id: string | null; quantity: number | string }>>();
  const lineRows = lines ?? [];

  const choiceIds = lineRows.filter((l) => l.slot_type === "choice").map((l) => l.id);
  const { data: optRows } = choiceIds.length
    ? await sb.from("catering_package_slot_options").select("package_item_id, item_id, menu_item_id").in("package_item_id", choiceIds).eq("active", true)
        .returns<Array<{ package_item_id: string; item_id: string | null; menu_item_id: string | null }>>()
    : { data: [] as Array<{ package_item_id: string; item_id: string | null; menu_item_id: string | null }> };

  // Batch price/section lookups for every referenced id.
  const itemIds = new Set<string>();
  const menuIds = new Set<string>();
  for (const l of lineRows) { if (l.item_id) itemIds.add(l.item_id); if (l.menu_item_id) menuIds.add(l.menu_item_id); }
  for (const o of optRows ?? []) { if (o.item_id) itemIds.add(o.item_id); if (o.menu_item_id) menuIds.add(o.menu_item_id); }
  const priceOf = new Map<string, { regularCents: number; section: string | null }>();
  if (itemIds.size) { const { data } = await sb.from("items").select("id, menu_price, section").in("id", [...itemIds]).returns<Array<{ id: string; menu_price: number | string | null; section: string | null }>>(); for (const x of data ?? []) priceOf.set(`item:${x.id}`, { regularCents: dollarsToCents(x.menu_price), section: x.section }); }
  if (menuIds.size) { const { data } = await sb.from("menu_items").select("id, menu_price, section").in("id", [...menuIds]).returns<Array<{ id: string; menu_price: number | string | null; section: string | null }>>(); for (const x of data ?? []) priceOf.set(`menu_item:${x.id}`, { regularCents: dollarsToCents(x.menu_price), section: x.section }); }

  const derived = (kind: "item" | "menu_item", id: string): number | null => {
    const p = priceOf.get(`${kind}:${id}`);
    if (!p || p.regularCents <= 0) return null;
    return cateringUnitPriceCents(p.regularCents, "whole", resolveRateBps(rules, { kind, entityId: id, section: p.section }));
  };

  const optionsByLine = new Map<string, Array<{ kind: "item" | "menu_item"; id: string }>>();
  for (const o of optRows ?? []) {
    const kind = o.menu_item_id ? ("menu_item" as const) : ("item" as const);
    const id = (o.menu_item_id ?? o.item_id)!;
    const arr = optionsByLine.get(o.package_item_id) ?? [];
    arr.push({ kind, id });
    optionsByLine.set(o.package_item_id, arr);
  }

  let alaCarteCents = 0;
  let unpriceableLines = 0;
  for (const l of lineRows) {
    const qty = typeof l.quantity === "string" ? Number(l.quantity) : l.quantity;
    if (l.slot_type === "fixed") {
      const kind = l.menu_item_id ? ("menu_item" as const) : l.item_id ? ("item" as const) : null;
      const id = l.menu_item_id ?? l.item_id;
      const unit = kind && id ? derived(kind, id) : null;
      if (unit == null) { unpriceableLines++; continue; }
      alaCarteCents += Math.round(unit * qty);
    } else {
      const opts = optionsByLine.get(l.id) ?? [];
      const unitVals = opts.map((o) => derived(o.kind, o.id)).filter((v): v is number => v != null);
      if (unitVals.length === 0) { unpriceableLines++; continue; }
      const avg = unitVals.reduce((s, v) => s + v, 0) / unitVals.length; // typical à-la-carte value of the slot
      alaCarteCents += Math.round(avg * qty);
    }
  }

  const impRate = impliedRateBps(priceCents, alaCarteCents); // price / alaCarte × 10000
  const impliedDiscountBps = impRate == null ? 0 : 10000 - impRate;
  return { hasBasis: alaCarteCents > 0, alaCarteCents, priceCents, impliedDiscountBps, unpriceableLines };
}
