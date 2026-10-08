/** Operator-only comparison run; dry-run by default. No provider requests or operational depletion writes. */
import { pathToFileURL } from "node:url";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { materializeEzcaterShadow } from "@/lib/ezcater/pass2";
import { etYmdMinusDays } from "@/lib/operational-day";

export function parseShadowArgs(args: string[]) {
  let execute = false, from = "", to = "", expect: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute") execute = true;
    else if (args[i] === "--from") from = args[++i] ?? "";
    else if (args[i] === "--to") to = args[++i] ?? "";
    else if (args[i] === "--expect") expect = Number(args[++i]);
    else throw new Error("shadow_unknown_argument");
  }
  for (const value of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("shadow_invalid_date");
  }
  if (from < "2026-09-04" || to < from || Date.parse(to) - Date.parse(from) > 93 * 86_400_000) throw new Error("shadow_invalid_window");
  if (execute && (!Number.isSafeInteger(expect) || expect! < 0)) throw new Error("shadow_expected_count_required");
  return { execute, from, to, expect };
}
export async function runShadowBackfill(options: ReturnType<typeof parseShadowArgs>) {
  const sb = getServiceRoleClient();
  const orders = await selectAllRows<{ id: string; event_date: string }>((from, to) => sb.from("ezcater_orders")
    .select("id,event_date").not("snapshot_id", "is", null).not("lead_id", "is", null)
    .gte("event_date", options.from).lte("event_date", options.to).order("id").range(from, to));
  if (!options.execute) return { dryRun: true, orders: orders.length, from: options.from, to: options.to };
  if (orders.length !== options.expect) throw new Error("shadow_expected_count_mismatch");
  const runs = [];
  for (let date = options.from; date <= options.to; date = etYmdMinusDays(date, -1)) {
    const result = await materializeEzcaterShadow(date, date, Date.now() + 60_000);
    runs.push({ date, ...result });
    if (result.failed || result.deferred) throw new Error("shadow_backfill_incomplete");
  }
  return { dryRun: false, orders: orders.length, runs };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runShadowBackfill(parseShadowArgs(process.argv.slice(2))).then((r) => console.log(JSON.stringify(r)))
    .catch(() => { console.error("shadow_backfill_failed"); process.exitCode = 1; });
}
