/** Operator-only comparison run; dry-run by default. Execute may READ Toast notes transiently; no operational depletion writes.
 * `--links-only` (item 1 PR B recovery, plan r3 §4.5): rebuild links only — pass 2 then reconcile_ezcater_toast per
 * event date — and never record a comparison, so it never needs capture coverage and may end tomorrow (D+1). */
import { pathToFileURL } from "node:url";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { materializeEzcaterLinks, materializeEzcaterReconciliation } from "@/lib/ezcater/reconcile";
import { etYmdMinusDays } from "@/lib/operational-day";
import { scriptErrorCode } from "./script-error-code";

export function parseShadowArgs(args: string[]) {
  let execute = false, linksOnly = false, from = "", to = "", expect: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute") execute = true;
    else if (args[i] === "--links-only") linksOnly = true;
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
  return { execute, from, to, expect, linksOnly };
}
export async function runShadowBackfill(options: ReturnType<typeof parseShadowArgs>) {
  const sb = getServiceRoleClient();
  const orders = await selectAllRows<{ id: string; event_date: string }>((from, to) => sb.from("ezcater_orders")
    .select("id,event_date").not("snapshot_id", "is", null).not("lead_id", "is", null)
    .gte("event_date", options.from).lte("event_date", options.to).order("id").range(from, to));
  if (!options.execute) return { dryRun: true, ...(options.linksOnly ? { linksOnly: true } : {}), orders: orders.length, from: options.from, to: options.to };
  if (orders.length !== options.expect) throw new Error("shadow_expected_count_mismatch");
  const materialize = options.linksOnly ? materializeEzcaterLinks : materializeEzcaterReconciliation;
  const runs = [];
  for (let date = options.from; date <= options.to; date = etYmdMinusDays(date, -1)) {
    const result = await materialize(date, date, Date.now() + 60_000);
    runs.push({ date, ...result });
    // Links-only prints each date as it finishes, so a stopped recovery resumes at the first date that did not report ok.
    if (options.linksOnly) console.log(JSON.stringify({ date, ok: !(result.failed || result.deferred || "skipped" in result), ...result }));
    if (result.failed || result.deferred || "skipped" in result) throw new Error("shadow_backfill_incomplete");
  }
  return { dryRun: false, ...(options.linksOnly ? { linksOnly: true } : {}), orders: orders.length, runs };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runShadowBackfill(parseShadowArgs(process.argv.slice(2))).then((r) => console.log(JSON.stringify(r)))
    .catch((error: unknown) => { console.error(scriptErrorCode(error, /^shadow_/, "shadow_backfill_failed")); process.exitCode = 1; });
}
