/** Reset the SIM day for the next guide tester (Guides v2).
 * Run from the repo root: npx tsx scripts/guide-test/reset.ts
 * Calls public.guide_test_reset_day() (installed on the sim only by scripts/guide-test/reset-fn.sql) with the
 * sim service-role key. loadSimEnv refuses unless .env.sim is a valid sim file whose Supabase URL is the sim
 * project, and assertSimTarget checks it again, so this script cannot reach production.
 */
import { createClient } from "@supabase/supabase-js";
import { loadSimEnv } from "../sim/launch-readiness/env";
import { assertSimTarget } from "../../lib/sim-isolation-shared";

async function main(): Promise<void> {
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
}

void main();
