import { getServiceRoleClient } from "@/lib/supabase-server";
import { skuConsumptionForItem } from "@/lib/prep-consumption";
function log(l: string, ok: boolean, extra = "") { console.log(`${ok ? "PASS" : "FAIL"} ${l} ${extra}`); if (!ok) process.exitCode = 1; }
void (async () => {
  const sb = getServiceRoleClient();
  const { data: edge } = await sb.from("item_components").select("item_id, component_sku_id").not("component_sku_id", "is", null).limit(1).maybeSingle<{ item_id: string; component_sku_id: string }>();
  if (!edge) { console.log("no SKU-edge item to test"); return; }
  const map = await skuConsumptionForItem(edge.item_id, 2);
  log("returns a Map", map instanceof Map);
  log("SKU present OR recipe incomplete (empty)", map.size === 0 || map.has(edge.component_sku_id), JSON.stringify([...map.entries()]));
  for (const [, oz] of map) log("oz finite", Number.isFinite(oz), String(oz));
})();
