import { getServiceRoleClient } from "@/lib/supabase-server";
import { recordDelivery, loadRecentDeliveries, type RecordDeliveryInput } from "@/lib/receiving";

function log(label: string, ok: boolean, extra = "") { console.log(`${ok ? "PASS" : "FAIL"} ${label} ${extra}`); if (!ok) process.exitCode = 1; }

void (async () => {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  const { data: vend } = await sb.from("vendors").select("id").eq("active", true).limit(1).maybeSingle<{ id: string }>();
  const { data: sku } = await sb.from("vendor_items").select("id, avg_oz_per_each").eq("active", true).limit(1).maybeSingle<{ id: string; avg_oz_per_each: number | string | null }>();
  if (!loc || !vend || !sku) { console.log("missing fixtures", { loc, vend, sku }); return; }
  const { data: cgs } = await sb.from("users").select("id, role").eq("role", "cgs").limit(1).maybeSingle<{ id: string; role: string }>();
  const actor = { user: { id: cgs!.id, role: cgs!.role }, locations: [] as string[] } as any;

  const input: RecordDeliveryInput = {
    vendorId: vend.id, locationId: loc.id, deliveryDate: "2026-07-01",
    invoiceNumber: "SMOKE-1", invoiceTotal: 100,
    lines: [ { skuId: sku.id, qtyReceived: 3, unitPrice: 48 }, { skuId: sku.id, qtyReceived: 2, observedOzPerEach: 12 } ],
  };
  const { deliveryId } = await recordDelivery(actor, input);
  log("delivery created", !!deliveryId, deliveryId);
  const { count: lineCount } = await sb.from("vendor_delivery_items").select("*", { count: "exact", head: true }).eq("delivery_id", deliveryId);
  log("2 lines", lineCount === 2, `count=${lineCount}`);
  const { data: prices } = await sb.from("vendor_price_history").select("unit_price").eq("vendor_item_id", sku.id).eq("effective_date", "2026-07-01");
  log("price row", (prices ?? []).some((p: any) => Number(p.unit_price) === 48));
  const { data: after } = await sb.from("vendor_items").select("avg_oz_per_each").eq("id", sku.id).maybeSingle<{ avg_oz_per_each: number | string | null }>();
  log("avg_oz updated (number)", after?.avg_oz_per_each != null && !Number.isNaN(Number(after.avg_oz_per_each)), `avg=${after?.avg_oz_per_each}`);
  const recent = await loadRecentDeliveries(actor, loc.id, 5);
  log("recent list", recent.length >= 1, `n=${recent.length}`);

  // Cleanup — restore the SKU's original avg + delete smoke rows.
  await sb.from("vendor_delivery_items").delete().eq("delivery_id", deliveryId);
  await sb.from("vendor_deliveries").delete().eq("id", deliveryId);
  await sb.from("vendor_price_history").delete().eq("effective_date", "2026-07-01").eq("vendor_item_id", sku.id);
  await sb.from("vendor_items").update({ avg_oz_per_each: sku.avg_oz_per_each == null ? null : Number(sku.avg_oz_per_each) }).eq("id", sku.id);
  console.log("cleaned up");
})();
