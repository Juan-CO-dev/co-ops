/** Item 2 PR 2b: the fact-layer PARITY PROBE. READ-ONLY. For every active shop and every 31-day window
 * in [--from, --to], compares sales_report_daily's `classes` and `refunds` (checks, money, refunds,
 * sales_refund_missing, undated refunds from before the window) with the same arrays rebuilt from the
 * facts (0337 read helpers, classified through sales_report_class). Exact net follows from these inputs.
 *   npx tsx --env-file=.env.local scripts/fact-parity-probe.ts --from=2025-10-01 --to=2026-11-15
 * Refuses (exit 3) while any day in the range is still stale: build first. Exit 1 on any difference.
 * Script-local client; never imports lib/supabase-server. Writes nothing. */
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { FACT_BUILDER_VERSION } from "../lib/facts/order-facts-shared";
import { compareDaily, factDaily, readAllStaleDays, STALE_LIST_CAP, type DailyMoney, type FactCheckClassRow, type FactRefundReadRow } from "../lib/facts/parity-shared";
import { etYmdMinusDays } from "../lib/operational-day";

export function windows(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  for (let start = from; start <= to; start = etYmdMinusDays(start, -31)) {
    const end = etYmdMinusDays(start, -30);
    out.push([start, end < to ? end : to]);
  }
  return out;
}

async function pages<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error("read_failed");
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const from = get("from"), to = get("to");
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    console.error("usage: fact-parity-probe.ts --from=YYYY-MM-DD --to=YYYY-MM-DD"); return 2;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) { console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Nothing was read."); return 2; }
  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  // Paged to completion (review r1 #4): a truncated stale list could pass this gate with days still stale.
  let stale: { day_location_id: string; day_business_date: string }[];
  try {
    stale = await readAllStaleDays((a, b) => sb.rpc("fact_order_days_stale", { p_floor: from, p_limit: STALE_LIST_CAP, p_builder_version: FACT_BUILDER_VERSION }).range(a, b));
  } catch (e) {
    console.error(e instanceof Error && e.message === "fact_stale_list_capped" ? "fact_stale_list_capped: too many stale days to prove the range built; build first."
      : "fact_stale_read_failed: fact_order_days_stale failed (is 0337 applied?)");
    return 2;
  }
  const pending = stale.filter((d) => d.day_business_date <= to);
  if (pending.length) { console.error(`${pending.length} day(s) in range still stale: run the build (or wait a pass) first.`); return 3; }
  const shops = await sb.from("locations").select("id, name").eq("active", true).order("name");
  if (shops.error) { console.error("locations read failed"); return 2; }
  let differences = 0, compared = 0;
  for (const shop of shops.data ?? []) {
    for (const [wFrom, wTo] of windows(from, to)) {
      const report = await sb.rpc("sales_report_daily", { p_location_id: shop.id, p_from: wFrom, p_to: wTo });
      if (report.error) { console.error(`sales_report_daily failed for ${shop.name} ${wFrom}`); return 2; }
      const args = { p_location_id: shop.id, p_from: wFrom, p_to: wTo };
      const checks = await pages<FactCheckClassRow>((a, b) => sb.rpc("fact_sales_check_classes", args).range(a, b));
      const refunds = await pages<FactRefundReadRow>((a, b) => sb.rpc("fact_sales_refund_rows", args).range(a, b));
      const diffs = compareDaily(report.data as DailyMoney, factDaily(checks, refunds, wFrom, wTo));
      compared++;
      if (diffs.length) { differences += diffs.length; console.log(`${shop.name} ${wFrom}..${wTo}:\n  ${diffs.join("\n  ")}`); }
    }
  }
  console.log(JSON.stringify({ windows: compared, differences, builder_version: FACT_BUILDER_VERSION }));
  return differences ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, () => { console.error("fact-parity-probe failed"); process.exitCode = 2; });
}
