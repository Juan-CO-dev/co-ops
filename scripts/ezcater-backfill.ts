/**
 * Known-webhook UUIDs only. No search/list-order provider operation is assumed.
 * npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts [--execute]
 * Dry run performs DB reads only; execution is an operator action after migration 0223.
 */
import { pathToFileURL } from "node:url";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { syncEzcaterOrder } from "@/lib/ezcater/sync";

export async function backfillEzcater(execute = false) {
  const sb = getServiceRoleClient();
  const known = new Map<string, { caterer: string; eventKey: string | null }>();
  let offset = 0;
  // Fixed reviewed historical interval: 66 UUIDs expected, never silently grow scope.
  while (true) {
    const page = await sb.from("ezcater_events")
      .select("entity_id,parent_id,event_key")
      .eq("signature_valid", true).eq("raw->>entity_type", "Order").gte("received_at", "2026-09-04T00:00:00-04:00")
      .lt("received_at", "2026-10-09T00:00:00-04:00")
      .order("received_at").order("id").range(offset, offset + 499);
    if (page.error) throw new Error("backfill_ledger_read_failed");
    for (const row of page.data ?? []) {
      if (!row.entity_id || !row.parent_id) continue;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.entity_id)) continue;
      const prior = known.get(row.entity_id);
      if (prior && prior.caterer !== row.parent_id) throw new Error("backfill_parent_conflict");
      // Latest lifecycle evidence must survive subsequent modified/advisory deliveries.
      const lifecycle = ["accepted", "cancelled", "rejected", "failed"].includes(row.event_key);
      known.set(row.entity_id, { caterer: row.parent_id, eventKey: lifecycle ? row.event_key : prior?.eventKey ?? null });
    }
    if ((page.data?.length ?? 0) < 500) break;
    offset += 500;
  }
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", known_uuid_count: known.size, expected_uuid_count: 66 }));
  // UUIDs, shop IDs and dates are operational identities; no customer/item text.
  for (const [uuid] of known) console.log(JSON.stringify({ provider_uuid: uuid }));
  let unresolved = 0;
  for (let start = 0; ; start += 500) {
    const page = await sb.from("toast_catering_orders").select("order_guid,location_id,business_date")
      .eq("classification", "ezcater").lt("business_date", "2026-09-04")
      .order("business_date").order("id").range(start, start + 499);
    if (page.error) throw new Error("backfill_unresolved_read_failed");
    for (const row of page.data ?? []) {
      unresolved++;
      console.log(JSON.stringify({ ...row, result: "unresolved_pre_webhook_history" }));
    }
    if ((page.data?.length ?? 0) < 500) break;
  }
  if (!execute) return { known: known.size, unresolved, applied: 0, failed: 0 };
  if (known.size !== 66) throw new Error("backfill_manifest_count_changed_review_required");
  let applied = 0, failed = 0;
  for (const [uuid, row] of known) {
    try {
      const result = await syncEzcaterOrder(uuid, row.caterer, { eventKey: row.eventKey });
      if (result.result.startsWith("error:")) failed++; else applied++;
      console.log(JSON.stringify({ provider_uuid: uuid, result: result.result }));
    } catch { failed++; console.log(JSON.stringify({ provider_uuid: uuid, result: "sync_failed" })); }
  }
  return { known: known.size, unresolved, applied, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillEzcater(process.argv.includes("--execute"))
    .then((result) => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; })
    .catch(() => { console.error("ezcater_backfill_failed; review count and database availability"); process.exitCode = 1; });
}
