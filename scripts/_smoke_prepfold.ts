/**
 * THROWAWAY smoke for the prep-fold record/reverse helpers + loadSkuConsumption integration.
 * Run: npx tsx --env-file=.env.local scripts/_smoke_prepfold.ts
 * Not wired into CI; safe to delete. Hard-deletes only the production headers it creates.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { perUnitSkuOzForItem, recordProductionFromPrep, reverseProductionForPrep } from "@/lib/prep-consumption";
import { loadSkuConsumption } from "@/lib/admin/cost";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

async function liveHeaderIdsFor(instanceId: string, templateItemId: string): Promise<string[]> {
  const sb = getServiceRoleClient();
  const { data } = await sb.from("productions").select("id")
    .eq("instance_id", instanceId).eq("template_item_id", templateItemId)
    .is("superseded_at", null).is("revoked_at", null).returns<Array<{ id: string }>>();
  return (data ?? []).map((r) => r.id);
}

void (async () => {
  const sb = getServiceRoleClient();

  const { data: cgs } = await sb.from("users").select("id, role").eq("role", "cgs").limit(1).maybeSingle<{ id: string; role: string }>();
  if (!cgs) throw new Error("no cgs user found for smoke actor");
  const actor = { user: { id: cgs.id, role: cgs.role }, locations: [] } as any;

  const { data: itemRows } = await sb.from("items").select("id, location_id").returns<Array<{ id: string; location_id: string | null }>>();
  let itemId: string | null = null;
  let skuId: string | null = null;
  for (const it of itemRows ?? []) {
    const m = await perUnitSkuOzForItem(it.id);
    const first = [...m.keys()][0];
    if (first) { itemId = it.id; skuId = first; break; }
  }
  if (!itemId || !skuId) throw new Error("no item with a leaf-SKU edge found for smoke");
  console.log(`item=${itemId} sku=${skuId}`);

  const { data: loc } = await sb.from("locations").select("id").limit(1).maybeSingle<{ id: string }>();
  if (!loc) throw new Error("no location found");
  const locationId = loc.id;

  const { data: inst } = await sb.from("checklist_instances").select("id").limit(1).maybeSingle<{ id: string }>();
  if (!inst) throw new Error("no checklist_instances row found");
  const instanceId = inst.id;
  const { data: tItem } = await sb.from("checklist_template_items").select("id").limit(1).maybeSingle<{ id: string }>();
  if (!tItem) throw new Error("no checklist_template_items row found");
  const templateItemId = tItem.id;

  const createdHeaderIds = new Set<string>();
  try {
    const base = (await loadSkuConsumption(actor, [skuId])).get(skuId)?.consumedOz ?? 0;
    console.log(`baseline consumedOz=${base}`);

    const r1 = await recordProductionFromPrep(actor, {
      locationId, instanceId, templateItemId, outputItemId: itemId, outputQty: 1,
      confirmedConsumption: [{ skuId, qtyOz: 100, qtyEntered: 1, unitEntered: "case", derivedOz: 100 }],
      source: "opening_p2",
    });
    if (r1.productionId) createdHeaderIds.add(r1.productionId);
    let live = await liveHeaderIdsFor(instanceId, templateItemId);
    assert(live.length === 1, "after first record: exactly one live header");
    assert(live[0] === r1.productionId, "live header id matches returned productionId");

    const r2 = await recordProductionFromPrep(actor, {
      locationId, instanceId, templateItemId, outputItemId: itemId, outputQty: 1,
      confirmedConsumption: [{ skuId, qtyOz: 250, qtyEntered: 1, unitEntered: "case", derivedOz: 250 }],
      source: "opening_p2",
    });
    if (r2.productionId) createdHeaderIds.add(r2.productionId);
    live = await liveHeaderIdsFor(instanceId, templateItemId);
    assert(live.length === 1, "after second record: still exactly one live header");
    assert(live[0] === r2.productionId && r2.productionId !== r1.productionId, "live header is the fresh one (first superseded)");
    const { data: r2lines } = await sb.from("production_inputs").select("input_oz").eq("production_id", r2.productionId!).returns<Array<{ input_oz: number | string }>>();
    assert((r2lines ?? []).length === 1 && Number(r2lines![0]!.input_oz) === 250, "fresh header's line input_oz === 250");

    const afterRecord = (await loadSkuConsumption(actor, [skuId])).get(skuId)?.consumedOz ?? 0;
    assert(Math.abs(afterRecord - (base + 250)) < 1e-6, `consumedOz reflects +250 (got ${afterRecord}, base ${base})`);

    await reverseProductionForPrep(actor, { instanceId, templateItemId });
    live = await liveHeaderIdsFor(instanceId, templateItemId);
    assert(live.length === 0, "after reverse: no live header");
    const afterReverse = (await loadSkuConsumption(actor, [skuId])).get(skuId)?.consumedOz ?? 0;
    assert(Math.abs(afterReverse - base) < 1e-6, `consumedOz back to baseline (got ${afterReverse}, base ${base})`);

    console.log("\nSMOKE PASSED");
  } finally {
    if (createdHeaderIds.size > 0) {
      const { error } = await sb.from("productions").delete().in("id", [...createdHeaderIds]);
      if (error) console.error(`cleanup delete failed: ${error.message}`);
      else console.log(`cleaned up ${createdHeaderIds.size} production header(s)`);
    }
  }
})();
