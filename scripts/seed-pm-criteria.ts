/**
 * SEED the PM v2 criteria Juan CONFIRMED on 2026-10-15 into `pm_criteria` (Scheduling Phase 1, Task 22, R1).
 *
 *   npx tsx --env-file=.env.local scripts/seed-pm-criteria.ts                          # dry run, every active shop
 *   npx tsx --env-file=.env.local scripts/seed-pm-criteria.ts --shop <location id>     # dry run, one shop
 *   npx tsx --env-file=.env.local scripts/seed-pm-criteria.ts --shop <id> --actor <user id> --apply
 *
 * ONLY ON JUAN'S WORD: CC runs --apply on sim first, then on prod (never a builder; never in CI). It runs once
 * per shop AFTER Task 14b's BOH positions exist there ("Prep", "Prep/Dishwasher"; scripts/check-boh-positions.ts
 * exit 0) and BEFORE the shop's PM v2 switch is turned on. After that, managers edit the criteria in the Tier E
 * editor (/admin/pm-criteria): the criteria are DATA, never code.
 *
 * It reads docs/seed/pm-criteria-2026-10-15.json (the plan's confirmed table, verbatim — pinned by
 * tests/pm-criteria.test.ts), matches each position to a `station_positions` row of the shop by its EXACT
 * name, PRINTS every match, and REFUSES (exit 1, nothing written) on any unmatched, ambiguous or retired name
 * — it never guesses. A dry run unless --apply; --apply needs --shop and --actor (the recorded `created_by`).
 * Re-running inserts nothing already there. Audit rows carry `actor_context: "seed_pm_criteria"`.
 *
 * A SCRIPT-LOCAL client from the environment (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY): it never
 * imports lib/supabase-server, whose `server-only` guard throws outside Next. Exit 0 = ready (dry run) or
 * applied; 1 = refused (not ready); 2 = could not run.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { formatSeedPlan, planPmCriteriaSeed, seedFileProblem, type PmCriteriaSeedFile } from "../lib/pm-criteria-shared";

export const SEED_FILE = "docs/seed/pm-criteria-2026-10-15.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SeedArgs { apply: boolean; shop: string | null; actor: string | null }
/** The CLI arguments; anything unknown or malformed is refused before any read. */
export function parseSeedArgs(argv: readonly string[]): SeedArgs | { error: string } {
  const out: SeedArgs = { apply: false, shop: null, actor: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--shop" || a === "--actor") {
      const v = argv[++i];
      if (!v || !UUID.test(v)) return { error: `${a} needs a uuid` };
      if (a === "--shop") out.shop = v; else out.actor = v;
    } else return { error: `unknown argument ${a}` };
  }
  if (out.apply && (!out.shop || !out.actor)) return { error: "--apply needs --shop <location id> and --actor <user id>" };
  return out;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseSeedArgs(argv);
  if ("error" in args) { console.error(args.error); return 2; }
  const seed = JSON.parse(readFileSync(SEED_FILE, "utf8")) as PmCriteriaSeedFile;
  const problem = seedFileProblem(seed);
  if (problem) { console.error(`seed file: ${problem}`); return 2; }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (e.g. npx tsx --env-file=.env.local …). Nothing was read.");
    return 2;
  }
  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  let shopsQ = sb.from("locations").select("id, name, active").eq("active", true);
  if (args.shop) shopsQ = shopsQ.eq("id", args.shop);
  const shops = await shopsQ.order("name", { ascending: true });
  if (shops.error) throw new Error(`locations: ${shops.error.message}`);
  const ids = (shops.data ?? []).map((s) => s.id as string);
  if (args.shop && !ids.includes(args.shop)) { console.error("--shop is not an active shop. Nothing was written."); return 1; }
  const stations = ids.length ? await sb.from("stations").select("id, location_id, name, active").in("location_id", ids) : { data: [], error: null };
  if (stations.error) throw new Error(`stations: ${stations.error.message}`);
  const positions = ids.length ? await sb.from("station_positions").select("id, station_id, location_id, name, active").in("location_id", ids) : { data: [], error: null };
  if (positions.error) throw new Error(`station_positions: ${positions.error.message}`);
  const existing = ids.length ? await sb.from("pm_criteria").select("location_id, position_id, label, active").in("location_id", ids) : { data: [], error: null };
  if (existing.error) throw new Error(`pm_criteria (is 0271 applied?): ${existing.error.message}`);

  const plan = planPmCriteriaSeed(seed, (shops.data ?? []) as never, (stations.data ?? []) as never, (positions.data ?? []) as never, (existing.data ?? []) as never);
  console.log(formatSeedPlan(plan, { apply: args.apply }));
  if (!plan.ready) { console.log("NOT READY: nothing was written. Fix the positions (docs/runbooks/boh-positions.md) and run the dry run again."); return 1; }
  if (!args.apply) { console.log("Dry run: nothing was written. Add --shop <id> --actor <id> --apply on Juan's word."); return 0; }

  const actor = await sb.from("users").select("id, role, active").eq("id", args.actor!).maybeSingle();
  if (actor.error || !actor.data || actor.data.active !== true) { console.error("--actor is not an active user. Nothing was written."); return 1; }
  const shop = plan.shops[0]!;
  if (!shop.inserts.length) { console.log("Nothing to insert: every confirmed criterion is already there."); return 0; }
  const inserted = await sb.from("pm_criteria").insert(shop.inserts.map((r) => ({ ...r, created_by: args.actor }))).select("id, location_id, position_id, label, label_es, sort");
  if (inserted.error) throw new Error(`pm_criteria insert: ${inserted.error.message}`);
  const rows = (inserted.data ?? []) as Array<{ id: string; location_id: string; position_id: string | null; label: string; label_es: string | null; sort: number }>;
  const audit = await sb.from("audit_log").insert(rows.map((r) => ({
    actor_id: args.actor, actor_role: actor.data!.role, action: "pm_criteria.create", resource_table: "pm_criteria", resource_id: r.id, destructive: true,
    metadata: { actor_context: "seed_pm_criteria", seed_file: SEED_FILE, confirmed_by: seed.confirmedBy, confirmed_on: seed.confirmedOn, location_id: r.location_id,
      before: null, after: { position_id: r.position_id, label: r.label, label_es: r.label_es, sort: r.sort, active: true } },
  })));
  if (audit.error) console.error(`audit rows failed (the criteria ARE written; record an audit.gap_recovery): ${audit.error.message}`);
  console.log(`Applied: ${rows.length} criteria written for ${shop.shop}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
}
