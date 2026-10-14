/** Reset the SIM day for the next guide tester (Guides v2).
 * Run from the repo root: npx tsx scripts/guide-test/reset.ts [--catering]
 * Calls public.guide_test_reset_day() (installed on the sim only by scripts/guide-test/reset-fn.sql) with the
 * sim service-role key. With --catering it then also calls public.guide_test_reset_catering() (installed on
 * the sim only by scripts/guide-test/reset-catering-fn.sql), which clears tester-made catering leads, quotes,
 * customers, companies and prep demand, and prints the rows deleted per table.
 * loadSimEnv refuses unless .env.sim is a valid sim file whose Supabase URL is the sim project, and
 * assertSimTarget checks it again, so this script cannot reach production.
 */
import { createClient } from "@supabase/supabase-js";
import { loadSimEnv } from "../sim/launch-readiness/env";
import { assertSimTarget } from "../../lib/sim-isolation-shared";

async function main(): Promise<void> {
  const withCatering = process.argv.slice(2).includes("--catering");
  const loaded = loadSimEnv(process.cwd());
  if (!loaded.ok) {
    console.error(`REFUSING: ${loaded.reasons.join("; ")}`);
    process.exit(1);
  }
  const url = loaded.env.NEXT_PUBLIC_SUPABASE_URL;
  assertSimTarget(url);
  const sb = createClient(url!, loaded.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("guide_test_reset_day");
  if (error) {
    console.error(`reset failed: ${error.message}`);
    process.exit(1);
  }
  console.log(data);

  if (withCatering) {
    const { data: counts, error: catErr } = await sb.rpc("guide_test_reset_catering");
    if (catErr) {
      console.error(`catering reset failed: ${catErr.message}`);
      process.exit(1);
    }
    const rows = Object.entries((counts ?? {}) as Record<string, number>);
    const total = rows.reduce((sum, [, n]) => sum + n, 0);
    console.log(`catering reset done: ${total} rows deleted`);
    for (const [table, n] of rows) console.log(`  ${table.padEnd(30)} ${n}`);
  }
}

void main();
