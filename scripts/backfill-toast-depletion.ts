/** Rebuild capture depletion for completed, closed capture days. Never reads env files. */
import { pathToFileURL } from "node:url";
import { etCalendarDate } from "../lib/operational-day";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: string): boolean {
  if (!YMD.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  let from: string | undefined, through: string | undefined;
  if (args[0]?.startsWith("--")) {
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i], value = args[i + 1];
      if (flag === "--from" && from === undefined) from = value;
      else if (flag === "--through" && through === undefined) through = value;
      else throw new Error("depletion_backfill_invalid_window");
    }
  } else if (args.length === 2) [from, through] = args;
  if (!from || !through || !validDate(from) || !validDate(through) || from > through) {
    throw new Error("depletion_backfill_invalid_window");
  }
  if (through >= etCalendarDate(new Date().toISOString())) throw new Error("depletion_backfill_open_day");
  const [{ getServiceRoleClient }, { selectAllRows }, { materializeCapturedDepletion }, { audit }] = await Promise.all([
    import("../lib/supabase-server"), import("../lib/supabase-paginate"), import("../lib/catering/toast-sales"),
    import("../lib/audit"),
  ]);
  const sb = getServiceRoleClient();
  const runs = await selectAllRows<{ id: string; location_id: string; business_date: string }>(async (start, end) => {
    const { data, error } = await sb.from("toast_capture_runs").select("id,location_id,business_date")
      .eq("status", "completed").gte("business_date", from).lte("business_date", through)
      .order("id", { ascending: true }).range(start, end)
      .returns<Array<{ id: string; location_id: string; business_date: string }>>();
    if (error) throw new Error("depletion_backfill_coverage_unavailable");
    return { data };
  });
  const pairs = new Map<string, { locationId: string; businessDate: string }>();
  for (const row of runs) pairs.set(`${row.location_id}:${row.business_date}`, { locationId: row.location_id, businessDate: row.business_date });
  let failures = 0, successful = 0, degraded = 0, rows = 0;
  for (const pair of [...pairs.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.locationId.localeCompare(b.locationId))) {
    try {
      const result = await materializeCapturedDepletion(pair.locationId, pair.businessDate, { audit: false });
      if (result.status === "degraded") degraded += 1;
      else successful += 1;
      rows += result.rows;
      console.log(JSON.stringify({ status: result.status, reason: result.reason, location_id: pair.locationId, business_date: pair.businessDate, rows: result.rows, run_id: result.runId }));
    } catch {
      failures += 1;
      console.error(JSON.stringify({ status: "failed", location_id: pair.locationId, business_date: pair.businessDate, code: "depletion_materialize_failed" }));
    }
  }
  await audit({ actorId: null, actorRole: null, action: "toast_depletion.materialize",
    resourceTable: "toast_capture_daily_depletion", resourceId: null,
    metadata: { actor_context: "backfill", source: "capture", from, through,
      days: pairs.size, successful, degraded, failed: failures, rows },
    ipAddress: null, userAgent: null });
  if (failures) throw new Error(`depletion_backfill_failed_days:${failures}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message.split(":", 1)[0] : "depletion_backfill_failed");
    process.exitCode = 1;
  });
}
