/** Item 2 PR 2b: the fact-layer BACKFILL dry run. READ-ONLY: calls 0337's fact_order_days_stale and
 * prints how many shop-days the hourly build would (re)build from a floor. Backfill needs no enqueue:
 * lowering FACT_CAPTURE_FLOOR makes the diff return the older days, and the hourly pass drains them.
 *   npx tsx --env-file=.env.local scripts/fact-backfill-report.ts --floor=2025-10-01 [--expect=812]
 * Exit 0 = printed (and matched --expect when given); 1 = --expect mismatch; 2 = bad usage / no env /
 * a read that could not be completed (fact_stale_read_failed, fact_stale_list_capped: no count is printed).
 * Script-local client; never imports lib/supabase-server. Writes nothing. */
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { FACT_BUILDER_VERSION } from "../lib/facts/order-facts-shared";
import { readAllStaleDays, STALE_LIST_CAP, summarizeStale } from "../lib/facts/parity-shared";

export function parseArgs(argv: string[]): { floor: string; expect: number | null } | null {
  let floor: string | null = null, expect: number | null = null;
  for (const a of argv) {
    const f = /^--floor=(\d{4}-\d{2}-\d{2})$/.exec(a), e = /^--expect=(\d+)$/.exec(a);
    if (f) floor = f[1]!; else if (e) expect = Number(e[1]); else return null;
  }
  return floor ? { floor, expect } : null;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (!args) { console.error("usage: fact-backfill-report.ts --floor=YYYY-MM-DD [--expect=N]"); return 2; }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) { console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Nothing was read."); return 2; }
  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  // Paged to completion (review r1 #4): one request is capped at PostgREST max-rows whatever p_limit says.
  let rows: { day_location_id: string; day_business_date: string }[];
  try {
    rows = await readAllStaleDays((from, to) => sb.rpc("fact_order_days_stale", { p_floor: args.floor, p_limit: STALE_LIST_CAP, p_builder_version: FACT_BUILDER_VERSION }).range(from, to));
  } catch (e) {
    const code = e instanceof Error && e.message === "fact_stale_list_capped" ? "fact_stale_list_capped" : "fact_stale_read_failed";
    console.error(code === "fact_stale_list_capped"
      ? `fact_stale_list_capped: ${STALE_LIST_CAP}+ stale days from ${args.floor}; the count cannot be proven complete. Use a later floor. No count printed.`
      : "fact_stale_read_failed: fact_order_days_stale failed (is 0337 applied?). No count printed.");
    return 2;
  }
  const summary = summarizeStale(rows);
  console.log(JSON.stringify({ floor: args.floor, builder_version: FACT_BUILDER_VERSION, complete: true, ...summary }, null, 2));
  if (args.expect !== null && args.expect !== summary.total) { console.error(`expected ${args.expect} stale days, found ${summary.total}`); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, () => { console.error("fact-backfill-report failed"); process.exitCode = 2; });
}
