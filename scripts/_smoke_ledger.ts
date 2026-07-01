import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadSkuReceivingLedger } from "@/lib/admin/cost";
function log(l: string, ok: boolean, extra = "") { console.log(`${ok ? "PASS" : "FAIL"} ${l} ${extra}`); if (!ok) process.exitCode = 1; }
void (async () => {
  const sb = getServiceRoleClient();
  const { data: line } = await sb.from("vendor_delivery_items").select("vendor_item_id").limit(1).maybeSingle<{ vendor_item_id: string }>();
  if (!line) { console.log("no delivery lines to test (ok)"); return; }
  const { data: cgs } = await sb.from("users").select("id, role").eq("role", "cgs").limit(1).maybeSingle<{ id: string; role: string }>();
  const actor = { user: { id: cgs!.id, role: cgs!.role }, locations: [] as string[] } as any;
  const map = await loadSkuReceivingLedger(actor, [line.vendor_item_id]);
  const led = map.get(line.vendor_item_id);
  log("ledger present", !!led);
  if (led) {
    log("receivedDollars number", typeof led.receivedDollars === "number", `$=${led.receivedDollars}`);
    log("receivedOz number", typeof led.receivedOz === "number", `oz=${led.receivedOz}`);
    log("counts numbers", typeof led.unpricedLineCount === "number" && typeof led.missingOzLineCount === "number");
    log("has deliveries", led.deliveries.length >= 1, `n=${led.deliveries.length}`);
    log("row shape", led.deliveries.every((d) => typeof d.deliveryId === "string" && typeof d.date === "string" && typeof d.vendorName === "string" && typeof d.qty === "number"));
  }
  const empty = await loadSkuReceivingLedger(actor, []);
  log("empty input → empty map", empty.size === 0);
})();
