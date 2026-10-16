/**
 * SIM ONLY — seed scheduling data into the co-ops-sim project (Scheduling Phase 2, Task 26). CC runs it, AFTER 0274 and
 * 0275 are applied to the sim; the builder never ran it. The runbook is docs/runbooks/scheduling-sim.md.
 *
 *   npx tsx --env-file=.env.sim scripts/sim/seed-scheduling.ts                 # DRY RUN (default): reads, prints, writes nothing
 *   npx tsx --env-file=.env.sim scripts/sim/seed-scheduling.ts --apply         # writes
 *   ... --today=2026-10-28                                                     # pin the clock (default: the ET date now)
 *
 * THE GUARD (before any client is built): the production ref is refused by name anywhere in the environment; the URL must
 * be EXACTLY the sim origin (lib/sim-isolation-shared); a service key must be present. `main()` runs only when this file
 * is invoked directly (pathToFileURL: an import never re-runs a seed).
 *
 * Per sim shop (scripts/sim/personas-shared SIM_LOCATIONS, by id), with --apply:
 *   1. 15 crew users (no credentials: they never sign in) + their memberships, created only when their email is missing;
 *   2. a MANUAL toast_employee_links row per crew member through `link_toast_employee` (source 'manual', actor = the sim
 *      GM persona), never a name match;
 *   3. 8 weeks of toast_time_entries from the fixed patterns (seed-scheduling-shared.ts), upserted on their stable ids
 *      (the 0233 trigger fills user_id from the link);
 *   4. scheduling switched ON with the SIM wage estimates through `save_schedule_shop_settings` (MoO+: the first active
 *      moo / owner / cgs user on the sim; prod starts blank, R2).
 * `--captures` is accepted and changes nothing: the sim's Toast order captures (0221) are not synthesized, so a shop with
 * no sales history builds the Normal crew with the "no sales history" note (documented in the runbook).
 * Re-running is safe: existing users, links and entries are kept; the settings row is saved again with the same values.
 */
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { operationalNow } from "../../lib/midshift-shared";
import { saveShopSettingsCall } from "../../lib/scheduling/rpc-args-shared";
import { SIM_LOCATIONS, SIM_PERSONAS } from "./personas-shared";
import { SIM_ESTIMATED_HOURLY_CENTS, SIM_ESTIMATED_SALARIED_WEEKLY_CENTS, parseSeedArgs, seedPlan, seedTarget } from "./seed-scheduling-shared";

export async function main(): Promise<void> {
  const target = seedTarget(process.env);
  if (!target.ok) { console.error(target.reason); process.exit(2); }
  const parsed = parseSeedArgs(process.argv.slice(2));
  if (!parsed.ok) { console.error(parsed.reason); process.exit(2); }
  const { apply, captures } = parsed.args;
  const today = parsed.args.today ?? operationalNow(new Date()).date;
  const sb = createClient(target.url, target.key, { auth: { persistSession: false } });
  const shops = Object.values(SIM_LOCATIONS).map((l) => l.id);
  const plan = seedPlan(shops, today);
  console.log(`sim scheduling seed: ${apply ? "APPLY" : "DRY RUN"}, today ${today}${captures ? " (--captures: no capture rows are synthesized)" : ""}`);

  const gmPersona = SIM_PERSONAS.find((p) => p.role === "gm");
  if (!gmPersona) throw new Error("no sim GM persona");
  const gm = await sb.from("users").select("id").ilike("email", gmPersona.email).maybeSingle<{ id: string }>();
  if (gm.error || !gm.data) throw new Error(`the sim GM (${gmPersona.email}) is missing: run scripts/sim/seed-staff.ts first`);
  const moo = await sb.from("users").select("id, role").in("role", ["moo", "owner", "cgs"]).eq("active", true).order("id").limit(1);
  if (moo.error) throw new Error("users read failed");
  const mooId = ((moo.data ?? [])[0] as { id: string } | undefined)?.id;
  if (!mooId) throw new Error("no active moo / owner / cgs user on the sim: the shop switch needs MoO+");

  for (const shop of plan) {
    const loc = Object.values(SIM_LOCATIONS).find((l) => l.id === shop.locationId)!;
    console.log(`\n${loc.name} (${shop.locationId}): ${shop.crew.length} crew, ${shop.entries.length} time entries`);
    const ids: Record<string, string> = {};
    for (const c of shop.crew) {
      const found = await sb.from("users").select("id").ilike("email", c.email).maybeSingle<{ id: string }>();
      if (found.error) throw new Error(`${c.email}: users read failed`);
      if (found.data) { ids[c.email] = found.data.id; continue; }
      console.log(`  + user ${c.email} (${c.role}, ${c.pattern})`);
      if (!apply) continue;
      const ins = await sb.from("users").insert({ email: c.email, name: c.name, role: c.role, language: c.language, active: true, pin_hash: null, password_hash: null })
        .select("id").maybeSingle<{ id: string }>();
      if (ins.error || !ins.data) throw new Error(`${c.email}: users insert failed (${ins.error?.code ?? "no row"})`);
      ids[c.email] = ins.data.id;
      const ul = await sb.from("user_locations").insert({ user_id: ins.data.id, location_id: shop.locationId, active: true });
      if (ul.error) throw new Error(`${c.email}: user_locations insert failed (${ul.error.code ?? "?"})`);
    }
    for (const c of shop.crew) {
      const userId = ids[c.email];
      if (!userId) { console.log(`  ~ link ${c.employeeGuid} -> (the new user, on --apply)`); continue; }
      const live = await sb.from("toast_employee_links").select("id").eq("location_id", shop.locationId).eq("employee_guid", c.employeeGuid).eq("active", true).limit(1);
      if (live.error) throw new Error(`${c.employeeGuid}: link read failed`);
      if ((live.data ?? []).length > 0) continue;
      console.log(`  + link ${c.employeeGuid} -> ${c.email} (manual)`);
      if (!apply) continue;
      const r = await sb.rpc("link_toast_employee", { p_actor_id: gm.data.id, p_location_id: shop.locationId, p_employee_guid: c.employeeGuid, p_user_id: userId, p_source: "manual" });
      if (r.error) throw new Error(`${c.employeeGuid}: link_toast_employee refused (${r.error.message})`);
    }
    console.log(`  ${apply ? "+" : "~"} ${shop.entries.length} toast_time_entries (upsert on location_id, time_entry_guid)`);
    if (apply) {
      for (let i = 0; i < shop.entries.length; i += 500) {
        const r = await sb.from("toast_time_entries").upsert(shop.entries.slice(i, i + 500), { onConflict: "location_id,time_entry_guid" });
        if (r.error) throw new Error(`toast_time_entries upsert failed (${r.error.code ?? "?"})`);
      }
    }
    const call = saveShopSettingsCall({ actorId: mooId, locationId: shop.locationId, enabled: true, estimatedHourlyCents: SIM_ESTIMATED_HOURLY_CENTS,
      estimatedSalariedWeeklyCents: SIM_ESTIMATED_SALARIED_WEEKLY_CENTS, agmAccess: "read" });
    console.log(`  ${apply ? "+" : "~"} ${call.fn}: enabled, ${SIM_ESTIMATED_HOURLY_CENTS} c/h, ${SIM_ESTIMATED_SALARIED_WEEKLY_CENTS} c/week salaried, AGM read`);
    if (apply) {
      const r = await sb.rpc(call.fn, call.args);
      if (r.error) throw new Error(`${call.fn} refused (${r.error.message})`);
    }
  }
  console.log(apply ? "\ndone." : "\ndry run: nothing written. Re-run with --apply.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
