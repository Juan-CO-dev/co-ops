/**
 * Throwaway smoke for the production header + production_inputs reshape (migration 0102).
 * Inserts one production via recordProduction, asserts a header AND an input line land,
 * asserts loadSkuConsumption returns consumedOz > 0 for the SKU, then cleans up
 * (delete header → cascade removes the line; delete any temp item_components edge).
 * Run: npx tsx --env-file=.env.local scripts/_smoke_prod_reshape.ts
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { recordProduction } from "@/lib/production";
import { loadSkuConsumption } from "@/lib/admin/cost";

function log(l: string, ok: boolean, extra = "") { console.log(`${ok ? "PASS" : "FAIL"} ${l} ${extra}`); if (!ok) process.exitCode = 1; }

void (async () => {
  const sb = getServiceRoleClient();

  const { data: actorUser } = await sb.from("users").select("id, role").eq("role", "cgs").eq("active", true).limit(1).maybeSingle<{ id: string; role: string }>();
  if (!actorUser) { console.log("no cgs user to act as; aborting"); return; }
  const actor = { user: { id: actorUser.id, role: actorUser.role }, locations: [] } as any;

  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  if (!loc) { console.log("no active location; aborting"); return; }

  let inputSkuId: string | null = null;
  let outputItemId: string | null = null;
  let tempEdgeId: string | null = null;

  const { data: edges } = await sb.from("item_components").select("item_id, component_sku_id").not("component_sku_id", "is", null).limit(50)
    .returns<Array<{ item_id: string; component_sku_id: string }>>();
  for (const e of edges ?? []) {
    const { data: item } = await sb.from("items").select("id").eq("id", e.item_id).eq("active", true).maybeSingle<{ id: string }>();
    if (!item) continue;
    const { data: sku } = await sb.from("vendor_items").select("id, units_per_pack, each_size, each_measure").eq("id", e.component_sku_id).eq("active", true).maybeSingle<{ id: string; units_per_pack: number | null; each_size: number | null; each_measure: string | null }>();
    if (!sku || sku.units_per_pack == null || sku.each_size == null || sku.each_measure == null) continue; // need content_oz
    inputSkuId = e.component_sku_id; outputItemId = e.item_id; break;
  }

  if (!inputSkuId || !outputItemId) {
    const { data: item } = await sb.from("items").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
    const { data: sku } = await sb.from("vendor_items").select("id").eq("active", true).not("units_per_pack", "is", null).not("each_size", "is", null).not("each_measure", "is", null).limit(1).maybeSingle<{ id: string }>();
    if (!item || !sku) { console.log("no item/SKU pair available to build a temp edge; aborting"); return; }
    const { data: inserted, error: eErr } = await sb.from("item_components").insert({ item_id: item.id, component_sku_id: sku.id, quantity: 1, unit: null }).select("id").maybeSingle<{ id: string }>();
    if (eErr || !inserted) { console.log(`could not create temp edge: ${eErr?.message}; aborting`); return; }
    tempEdgeId = inserted.id; inputSkuId = sku.id; outputItemId = item.id;
    log("temp edge created", true, tempEdgeId);
  }

  let productionId: string | null = null;
  try {
    const res = await recordProduction(actor, { locationId: loc.id, inputSkuId, inputQty: 2, outputItemId, outputQty: 5, notes: "smoke: prod reshape" });
    productionId = res.productionId;
    log("recordProduction returned an id", !!productionId, productionId);

    const { data: hdr } = await sb.from("productions").select("id, source, output_qty").eq("id", productionId).maybeSingle<{ id: string; source: string; output_qty: number | string }>();
    log("header row landed", !!hdr);
    log("header source = manual", hdr?.source === "manual", String(hdr?.source));

    const { data: inputLines } = await sb.from("production_inputs").select("id, input_sku_id, input_oz, qty_entered").eq("production_id", productionId)
      .returns<Array<{ id: string; input_sku_id: string; input_oz: number | string; qty_entered: number | string | null }>>();
    log("exactly one input line landed", (inputLines ?? []).length === 1, JSON.stringify(inputLines));
    const line = (inputLines ?? [])[0];
    log("line SKU matches", line?.input_sku_id === inputSkuId);
    log("line input_oz > 0", Number(line?.input_oz) > 0, String(line?.input_oz));
    log("line qty_entered = 2", Number(line?.qty_entered) === 2, String(line?.qty_entered));

    const cons = await loadSkuConsumption(actor, [inputSkuId]);
    const c = cons.get(inputSkuId);
    log("loadSkuConsumption consumedOz > 0", (c?.consumedOz ?? 0) > 0, JSON.stringify(c));
  } finally {
    if (productionId) {
      const { error: delErr } = await sb.from("productions").delete().eq("id", productionId);
      log("cleanup: header deleted (cascade removes line)", !delErr, delErr?.message ?? "");
      const { data: orphan } = await sb.from("production_inputs").select("id").eq("production_id", productionId).returns<Array<{ id: string }>>();
      log("cleanup: no orphan input lines", (orphan ?? []).length === 0);
    }
    if (tempEdgeId) {
      const { error: eDel } = await sb.from("item_components").delete().eq("id", tempEdgeId);
      log("cleanup: temp edge deleted", !eDel, eDel?.message ?? "");
    }
  }
})();
