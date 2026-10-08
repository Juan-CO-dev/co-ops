/**
 * Known-webhook UUIDs only. No search/list-order provider operation is assumed.
 * npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-backfill.ts [--execute --expect N [--uuid UUID]]
 * Dry run performs DB reads only; execution is an operator action after migration 0223.
 */
import { pathToFileURL } from "node:url";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { syncEzcaterOrder } from "@/lib/ezcater/sync";

export interface BackfillOptions { execute?: boolean; expect?: number; uuid?: string }

export function parseBackfillArgs(args: string[]): BackfillOptions {
  const options: BackfillOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--expect") {
      const value = args[++i];
      if (!value || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("backfill_invalid_expected_count");
      options.expect = Number(value);
    } else if (arg === "--uuid") {
      const value = args[++i];
      if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("backfill_invalid_uuid");
      options.uuid = value.toLowerCase();
    } else throw new Error("backfill_unknown_argument");
  }
  return options;
}

export async function backfillEzcater(options: BackfillOptions = {}) {
  const execute = options.execute === true;
  const sb = getServiceRoleClient();
  const known = new Map<string, { caterer: string; eventKey: string | null }>();
  let offset = 0;
  // Fixed reviewed historical interval. The dry-run count must be supplied on execution.
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
      const uuid = row.entity_id.toLowerCase();
      const prior = known.get(uuid);
      if (prior && prior.caterer !== row.parent_id) throw new Error("backfill_parent_conflict");
      // Latest lifecycle evidence must survive subsequent modified/advisory deliveries.
      const lifecycle = ["accepted", "cancelled", "rejected", "failed"].includes(row.event_key);
      known.set(uuid, { caterer: row.parent_id, eventKey: lifecycle ? row.event_key : prior?.eventKey ?? null });
    }
    if ((page.data?.length ?? 0) < 500) break;
    offset += 500;
  }
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", known_uuid_count: known.size, expected_uuid_count: options.expect ?? null }));
  const existing = new Set<string>();
  for (let start = 0; ; start += 500) {
    const page = await sb.from("catering_pipeline").select("external_ref")
      .eq("lead_source", "ezcater").order("id").range(start, start + 499);
    if (page.error) throw new Error("backfill_leads_read_failed");
    for (const row of page.data ?? []) if (row.external_ref) existing.add(row.external_ref.toLowerCase());
    if ((page.data?.length ?? 0) < 500) break;
  }
  // UUIDs and lifecycle keys only: lead-less historical orders require human review.
  let leadless = 0;
  for (const [uuid, row] of known) {
    const hasLead = existing.has(uuid);
    if (!hasLead) leadless++;
    console.log(JSON.stringify({ provider_uuid: uuid, event_key: row.eventKey,
      result: hasLead ? "existing_lead" : "leadless_review_required" }));
  }
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
  if (!execute) return { known: known.size, leadless, unresolved, applied: 0, failed: 0 };
  if (!Number.isSafeInteger(options.expect) || (options.expect ?? 0) <= 0) throw new Error("backfill_expected_count_required");
  if (known.size !== options.expect) throw new Error("backfill_manifest_count_changed_review_required");
  if (options.uuid && !known.has(options.uuid)) throw new Error("backfill_uuid_outside_manifest");
  if (options.uuid && !existing.has(options.uuid)) throw new Error("backfill_uuid_has_no_lead");
  let applied = 0, failed = 0;
  for (const [uuid, row] of known) {
    if (!existing.has(uuid) || (options.uuid && uuid !== options.uuid)) continue;
    try {
      const result = await syncEzcaterOrder(uuid, row.caterer, { eventKey: row.eventKey });
      if (result.sync_error || result.result === "sync_error" || result.result.startsWith("error:")) failed++; else applied++;
      console.log(JSON.stringify({ provider_uuid: uuid, result: result.result }));
    } catch { failed++; console.log(JSON.stringify({ provider_uuid: uuid, result: "sync_failed" })); }
  }
  return { known: known.size, leadless, unresolved, applied, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => backfillEzcater(parseBackfillArgs(process.argv.slice(2))))
    .then((result) => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; })
    .catch(() => { console.error("ezcater_backfill_failed; review count and database availability"); process.exitCode = 1; });
}
