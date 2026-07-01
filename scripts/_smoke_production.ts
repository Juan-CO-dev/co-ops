import { getServiceRoleClient } from "@/lib/supabase-server";
import { recordProduction, predictOutput, loadProductionFormData, type RecordProductionInput } from "@/lib/production";

function log(l: string, ok: boolean, extra = "") { console.log(`${ok ? "PASS" : "FAIL"} ${l} ${extra}`); if (!ok) process.exitCode = 1; }

void (async () => {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  const { data: sku } = await sb.from("vendor_items").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  const { data: item } = await sb.from("items").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  if (!loc || !sku || !item) { console.log("missing fixtures", { loc, sku, item }); return; }
  const { data: cgs } = await sb.from("users").select("id, role").eq("role", "cgs").limit(1).maybeSingle<{ id: string; role: string }>();
  const actor = { user: { id: cgs!.id, role: cgs!.role }, locations: [] as string[] } as any;

  const { data: existingEdge } = await sb.from("item_components").select("id").eq("item_id", item.id).eq("component_sku_id", sku.id).maybeSingle<{ id: string }>();
  let tempEdgeId: string | null = null;
  if (!existingEdge) {
    const { data: ins } = await sb.from("item_components").insert({ item_id: item.id, component_sku_id: sku.id, quantity: 1, unit: "oz", display_order: 99 }).select("id").maybeSingle<{ id: string }>();
    tempEdgeId = ins?.id ?? null;
  }

  const input: RecordProductionInput = { locationId: loc.id, inputSkuId: sku.id, inputQty: 1, outputItemId: item.id, outputQty: 4 };
  const { productionId } = await recordProduction(actor, input);
  log("production created", !!productionId, productionId);

  const pred = await predictOutput(actor, { inputSkuId: sku.id, outputItemId: item.id, inputQty: 2 });
  log("predict after 1 obs = 2×(4/1)=8", pred.predicted === 8, `predicted=${pred.predicted}`);

  const form = await loadProductionFormData(actor, loc.id);
  log("form skus present", form.skus.length >= 1);
  log("skuToItems maps our sku→item", (form.skuToItems[sku.id] ?? []).some((it) => it.itemId === item.id), JSON.stringify(form.skuToItems[sku.id] ?? []));

  await sb.from("productions").delete().eq("id", productionId);
  if (tempEdgeId) await sb.from("item_components").delete().eq("id", tempEdgeId);
  console.log("cleaned up");
})();
