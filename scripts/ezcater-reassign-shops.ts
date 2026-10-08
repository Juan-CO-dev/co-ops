/** CC operator only; dry-run default. --execute --expect 1 after reviewed dry run. */
import { pathToFileURL } from "node:url";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { syncEzcaterOrder } from "@/lib/ezcater/sync";

export async function correctEzcaterShops(args: string[]) {
  if (args.some((arg) => !["--execute", "--expect", "1"].includes(arg))) throw new Error("invalid_arguments");
  const execute = args.includes("--execute");
  if (execute && (!args.includes("--expect") || args[args.indexOf("--expect") + 1] !== "1")) throw new Error("expected_count_required");
  const sb = getServiceRoleClient();
  const latest = new Map<string, string>();
  for (let offset = 0; ; offset += 500) {
    const page = await sb.from("ezcater_events").select("entity_id,parent_id")
      .eq("signature_valid", true).eq("raw->>entity_type", "Order")
      .order("received_at").order("id").range(offset, offset + 499);
    if (page.error) throw new Error("ledger_read_failed");
    for (const row of page.data ?? []) if (row.entity_id && row.parent_id) latest.set(row.entity_id, row.parent_id);
    if ((page.data?.length ?? 0) < 500) break;
  }
  const shops = await sb.from("locations").select("id,ezcater_caterer_uuid").eq("active", true);
  if (shops.error) throw new Error("location_read_failed");
  const candidates: Array<{ provider_uuid: string; lead_id: string; from: string; to: string; caterer: string }> = [];
  for (let offset = 0; ; offset += 500) {
    const leads = await sb.from("catering_pipeline").select("id,external_ref,location_id")
      .eq("lead_source", "ezcater").order("id").range(offset, offset + 499);
    if (leads.error) throw new Error("lead_read_failed");
    for (const lead of leads.data ?? []) {
      const caterer = latest.get(lead.external_ref);
      const targets = (shops.data ?? []).filter((shop) => shop.ezcater_caterer_uuid === caterer);
      if (caterer && targets.length === 1 && targets[0]!.id !== lead.location_id) {
        candidates.push({ provider_uuid: lead.external_ref, lead_id: lead.id, from: lead.location_id, to: targets[0]!.id, caterer });
      }
    }
    if ((leads.data?.length ?? 0) < 500) break;
  }
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", candidates }));
  if (!execute) return;
  if (candidates.length !== 1) {
    throw new Error("reviewed_manifest_changed");
  }
  const row = candidates[0]!;
  const order = await sb.from("ezcater_orders").select("order_number").eq("provider_uuid", row.provider_uuid).maybeSingle();
  if (order.error || (!row.provider_uuid.toLowerCase().startsWith("19f4e7a6")
    && order.data?.order_number?.replace(/-/g, "").toUpperCase() !== "19F4E7A6")) {
    throw new Error("reviewed_manifest_changed");
  }
  // Successful provider read and transfer/snapshot publish share the apply transaction.
  const result = await syncEzcaterOrder(row.provider_uuid, row.caterer);
  if (result.sync_error) throw new Error("correction_sync_failed");
  const verify = await sb.from("catering_pipeline").select("location_id").eq("id", row.lead_id).single();
  if (verify.error || verify.data.location_id !== row.to) throw new Error("correction_conflict_review_required");
  console.log(JSON.stringify({ provider_uuid: row.provider_uuid, result: result.result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  correctEzcaterShops(process.argv.slice(2)).catch(() => {
    console.error("ezcater_shop_correction_failed; review dry-run manifest, conflict and schema");
    process.exitCode = 1;
  });
}
