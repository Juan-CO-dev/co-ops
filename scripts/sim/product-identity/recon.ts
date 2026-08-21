/**
 * SIM RECON — the live state the product-identity sim days run against.
 *
 * READ-ONLY. Zero writes, no exceptions. This is step zero of both day scripts
 * (the sim handbook's "know the floor before you walk it"): a sim assertion is
 * only worth the ground truth it was computed against, and the August program's
 * one recurring lesson was that a scenario written from a plan rather than from
 * the live rows tests the plan, not the system.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/sim/product-identity/recon.ts
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { pathToFileURL } from "node:url";

function h(text: string): void {
  console.log(`\n─── ${text.toUpperCase()} ${"─".repeat(Math.max(3, 68 - text.length))}\n`);
}

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  h("locations");
  const { data: locs } = await sb.from("locations").select("id, name, code, active").order("name");
  for (const l of locs ?? []) console.log(`  ${l.id}  ${l.code ?? "—"}  ${l.name}  active=${l.active}`);

  h("products");
  const { data: products } = await sb
    .from("products")
    .select("id, name, unit_oz, unit_oz_class, active")
    .order("name");
  for (const p of products ?? []) {
    console.log(`  ${p.id}  ${p.name}  unit_oz=${p.unit_oz ?? "NULL"} (${p.unit_oz_class ?? "—"}) active=${p.active}`);
  }

  h("members");
  const { data: members } = await sb
    .from("vendor_items")
    .select("id, name, vendor_id, product_id, active, avg_oz_per_each, weekday_par, weekend_par")
    .not("product_id", "is", null)
    .order("product_id")
    .order("name");
  const { data: vendors } = await sb.from("vendors").select("id, name, active");
  const vName = new Map((vendors ?? []).map((v) => [v.id, `${v.name}${v.active ? "" : " [VENDOR INACTIVE]"}`]));
  const pName = new Map((products ?? []).map((p) => [p.id, p.name]));
  for (const m of members ?? []) {
    console.log(
      `  ${pName.get(m.product_id!) ?? m.product_id}  |  ${m.name}  |  ${vName.get(m.vendor_id ?? "") ?? "NO VENDOR"}  |  active=${m.active}  avgOz=${m.avg_oz_per_each ?? "NULL"}  par=${m.weekday_par ?? "—"}/${m.weekend_par ?? "—"}  ${m.id}`,
    );
  }

  h("primaries");
  const { data: prim } = await sb
    .from("product_primaries")
    .select("product_id, location_id, primary_sku_id, note");
  const mName = new Map((members ?? []).map((m) => [m.id, m.name]));
  for (const p of prim ?? []) {
    console.log(
      `  ${pName.get(p.product_id) ?? p.product_id}  loc=${p.location_id ?? "GLOBAL"}  →  ${mName.get(p.primary_sku_id) ?? p.primary_sku_id}`,
    );
  }

  h("product-pinned recipe lines");
  const { data: pinned } = await sb
    .from("recipe_inputs")
    .select("id, recipe_id, component_product_id, quantity, unit, portioned")
    .not("component_product_id", "is", null);
  const recipeIds = [...new Set((pinned ?? []).map((r) => r.recipe_id))];
  const { data: recipes } = recipeIds.length
    ? await sb.from("recipes").select("id, name, active").in("id", recipeIds)
    : { data: [] as Array<{ id: string; name: string; active: boolean }> };
  const rName = new Map((recipes ?? []).map((r) => [r.id, `${r.name}${r.active ? "" : " [RETIRED]"}`]));
  console.log(`  ${(pinned ?? []).length} product-pinned recipe_inputs`);
  for (const r of pinned ?? []) {
    console.log(
      `    ${rName.get(r.recipe_id) ?? r.recipe_id}  ←  ${pName.get(r.component_product_id!)}  ${r.quantity} ${r.unit ?? "—"}  portioned=${r.portioned}`,
    );
  }

  h("receipt lots per member (all locations)");
  const memberIds = (members ?? []).map((m) => m.id);
  const { data: lines } = memberIds.length
    ? await sb
        .from("vendor_delivery_items")
        .select("id, delivery_id, vendor_item_id, created_at, resolved_oz, qty_received")
        .in("vendor_item_id", memberIds)
        .order("created_at")
    : { data: [] as Array<Record<string, unknown>> };
  const delIds = [...new Set((lines ?? []).map((l) => l.delivery_id as string))];
  const { data: dels } = delIds.length
    ? await sb.from("vendor_deliveries").select("id, location_id, delivery_date").in("id", delIds)
    : { data: [] as Array<{ id: string; location_id: string; delivery_date: string }> };
  const dLoc = new Map((dels ?? []).map((d) => [d.id, d.location_id]));
  const lName = new Map((locs ?? []).map((l) => [l.id, l.name]));
  console.log(`  ${(lines ?? []).length} receipt lines across ${delIds.length} deliveries`);
  for (const l of lines ?? []) {
    console.log(
      `    ${String(l.created_at).slice(0, 19)}  ${lName.get(dLoc.get(l.delivery_id as string) ?? "") ?? "?"}  ${mName.get(l.vendor_item_id as string)}  qty=${l.qty_received}  resolved_oz=${l.resolved_oz ?? "NULL"}  lot=${l.id}`,
    );
  }

  h("counts / overlay / flips");
  const { count: lssCount } = await sb.from("location_sku_settings").select("id", { count: "exact", head: true });
  console.log(`  location_sku_settings rows: ${lssCount ?? 0}`);
  const { count: ceCount } = await sb.from("sku_count_events").select("id", { count: "exact", head: true });
  console.log(`  sku_count_events rows: ${ceCount ?? 0}`);
  const { count: clCount } = await sb.from("sku_count_lines").select("id", { count: "exact", head: true });
  console.log(`  sku_count_lines rows: ${clCount ?? 0}`);
  const { count: allocCount } = await sb
    .from("sku_count_lines")
    .select("id", { count: "exact", head: true })
    .not("allocated_from_product_id", "is", null);
  console.log(`  sku_count_lines with allocated_from_product_id: ${allocCount ?? 0}`);
  const { data: flips } = await sb
    .from("audit_log")
    .select("id, resource_id, metadata, created_at")
    .eq("action", "product.resolution_flip")
    .order("created_at", { ascending: false })
    .limit(20);
  console.log(`  product.resolution_flip audit rows: ${(flips ?? []).length}`);
  for (const f of flips ?? []) {
    console.log(`    ${String(f.created_at).slice(0, 19)}  ${pName.get(f.resource_id as string) ?? f.resource_id}  ${JSON.stringify(f.metadata)}`);
  }

  h("depletion / production presence");
  const { count: depCount } = await sb.from("toast_daily_depletion").select("id", { count: "exact", head: true });
  console.log(`  toast_daily_depletion rows: ${depCount ?? 0}`);
  const { count: prodCount } = await sb.from("productions").select("id", { count: "exact", head: true });
  console.log(`  productions rows: ${prodCount ?? 0}`);
  const { count: piCount } = await sb.from("production_inputs").select("id", { count: "exact", head: true });
  console.log(`  production_inputs rows: ${piCount ?? 0}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
