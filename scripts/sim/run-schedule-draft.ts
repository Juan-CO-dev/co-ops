/**
 * SIM ONLY — run the Wednesday draft by hand on an injected clock (Scheduling Phase 2, Task 26, runbook step 9). The cron
 * route reads the real clock and `?now=` is NOT accepted in prod code; this script calls the SAME lib the route calls
 * (`draftPrecheck`, then `runWednesdayDraft`) with `--now=<ISO instant>`. It WRITES on the sim (a generated revision per
 * enabled shop): CC runs it after the seed; the builder never ran it. It does not claim the cron lease.
 *
 *   npx tsx --conditions=react-server --env-file=.env.sim scripts/sim/run-schedule-draft.ts --now=2026-10-28T10:15:00Z
 *
 * (`--conditions=react-server` lets the lib's `server-only` imports load outside Next.) The guard is the seed's: the
 * production ref refused by name, the exact sim origin, a service key, before any client is built.
 */
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { seedTarget } from "./seed-scheduling-shared";

export async function main(): Promise<void> {
  const target = seedTarget(process.env);
  if (!target.ok) { console.error(target.reason); process.exit(2); }
  const argv = process.argv.slice(2);
  const arg = argv.find((a) => a.startsWith("--now="));
  const now = arg ? new Date(arg.slice(6)) : null;
  if (!now || Number.isNaN(now.getTime()) || argv.length !== 1) { console.error("usage: --now=<ISO instant> (one argument)"); process.exit(2); }
  const service = createClient(target.url, target.key, { auth: { persistSession: false } });
  const { draftPrecheck, runWednesdayDraft } = await import("../../lib/scheduling/draft");
  const pre = await draftPrecheck({ service, now });
  console.log("precheck:", JSON.stringify(pre));
  if (!pre.go) return;
  const run = await runWednesdayDraft({ service, now });
  console.log("run:", JSON.stringify(run));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
