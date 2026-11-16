/**
 * Local Postgres proof of migration 0334 (W25 / B219: the PM v2 switch decided under the shop-settings lock),
 * SYNTHETIC ROWS ONLY — PGlite, in memory. No env, network or real database.
 *
 *   node scripts/sql-harness-0334.mjs
 *
 * Applies tests/fixtures/scheduling-pglite-stub.sql, the REAL level helpers (0217 / 0228 / 0233, extracted verbatim),
 * the REAL 0270, then 0334, and proves:
 *   P0  the pre-flight refuses without 0270 and on a drifted live body; 0334 applies and RE-APPLIES cleanly
 *   P1  a GM changing the switch is refused pm_v2_moo_only on the LOCKED row — the stored ON stays (the race's end
 *       state: the GM sends the OFF they last saw after a MoO turned it on) — and nothing is written
 *   P2  a GM saving the prep position with the switch unchanged succeeds; a GM's first save (no row) with the
 *       switch off succeeds, with it on is refused
 *   P3  moo / owner / cgs flip it both ways; a GM-level role other than those never does
 *   P4  ceilings: SECURITY DEFINER, pinned search_path, service_role only
 * The two-session proof is scripts/sim/people-0334-pm-v2-lock-check-management.mjs, sim only, run by CC.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0270 = read("supabase/migrations/0270_people_layer.sql");
const M0334 = read("supabase/migrations/0334_people_shop_settings_pm_v2_switch_lock.sql");
function extract(sql, start) {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`extract: ${start} not found`);
  const j = sql.indexOf("end $$;", i);
  return sql.slice(i, j + "end $$;".length);
}
const HELPERS = [
  extract(read("supabase/migrations/0217_assignments_stations.sql"), "create or replace function public.assignment_user_level(p_user_id uuid, p_location_id uuid)"),
  extract(read("supabase/migrations/0228_assignment_attribution.sql"), "create function public.assignment_author_level(p_user_id uuid)"),
  extract(read("supabase/migrations/0233_whos_here.sql"), "create function public.toast_link_actor_level(p_actor_id uuid,p_location_id uuid)"),
].join("\n");

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}
async function base({ m0270 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(HELPERS);
  if (m0270) await db.exec(M0270);
  return db;
}

const db = await base();
try {
  // P0 — the pre-flight
  {
    const no0270 = await base({ m0270: false });
    await refuses(() => no0270.exec(M0334), "0334: 0270 (save_people_shop_settings, people_shop_settings) must be applied first", "P0 refuses without 0270");
    await no0270.close();
    const drift = await base();
    await drift.exec(`create or replace function public.save_people_shop_settings(p_actor uuid, p_location uuid, p_pm_v2 boolean, p_prep_position uuid)
      returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$ begin return null; end $$;`);
    await refuses(() => drift.exec(M0334), "a later definer exists", "P0 refuses a drifted live body by name");
    await drift.close();
  }
  await db.exec(M0334);
  check(true, "P0 0334 applied over the real 0270 (the pre-flight accepted 0270's fingerprint; the post-check its own)");
  await db.exec(M0334);
  check(true, "P0 0334 re-applies cleanly");

  // ── fixtures (superuser) ──
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role, active = true) => id("insert into public.users (role, active) values ($1, $2) returning id", [role, active]);
  const shop = () => id("insert into public.locations (active) values (true) returning id");
  const member = (u, l) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, true)", [u, l]);
  const SA = await shop(), SB = await shop();
  const gmA = await user("gm"), moo = await user("moo"), owner = await user("owner"), cgs = await user("cgs");
  for (const [u, l] of [[gmA, SA], [gmA, SB]]) await member(u, l);
  const stA = await id("insert into public.stations (location_id) values ($1) returning id", [SA]);
  const posA = await id("insert into public.station_positions (station_id, location_id, name, active) values ($1, $2, 'Prep', true) returning id", [stA, SA]);
  const posA2 = await id("insert into public.station_positions (station_id, location_id, name, active) values ($1, $2, 'Prep/Dishwasher', true) returning id", [stA, SA]);
  const rpc = async (args) => (await db.query("select public.save_people_shop_settings($1, $2, $3, $4) as r", args)).rows[0].r;
  const stored = async (l) => (await db.query("select pm_v2, prep_position_id from public.people_shop_settings where location_id = $1", [l])).rows[0] ?? null;

  await db.exec("set role service_role");
  // P2 — a GM's first save with the switch off; with it on, refused
  await refuses(() => rpc([gmA, SB, true, null]), "pm_v2_moo_only", "P2 a GM's first save (no row) turning PM v2 ON is refused");
  check((await stored(SB)) === null, "P2 … and nothing was inserted");
  const first = await rpc([gmA, SA, false, posA]);
  check(first.before === null && first.after.pm_v2 === false && first.after.prep_position_id === posA, "P2 a GM's first save (no row) with the switch OFF succeeds");

  // P3 — moo turns it on (the race's first commit)
  const on = await rpc([moo, SA, true, posA]);
  check(on.after.pm_v2 === true && on.before.pm_v2 === false, "P3 a MoO turns PM v2 ON");

  // P1 — the GM's stale save (the OFF they last saw + a new prep position) is refused under the lock; ON stands
  await refuses(() => rpc([gmA, SA, false, posA2]), "pm_v2_moo_only", "P1 a GM save carrying the old OFF after a MoO's ON is refused pm_v2_moo_only");
  const after = await stored(SA);
  check(after.pm_v2 === true && after.prep_position_id === posA, "P1 … the MoO's ON stands and nothing of the GM's save was written");

  // P2 — the GM's save with the switch unchanged succeeds
  const gmSave = await rpc([gmA, SA, true, posA2]);
  check(gmSave.after.pm_v2 === true && gmSave.after.prep_position_id === posA2, "P2 a GM saving the prep position with the switch unchanged succeeds");

  // P3 — owner / cgs flip both ways; a GM never
  check((await rpc([owner, SA, false, posA2])).after.pm_v2 === false, "P3 the owner turns it OFF");
  check((await rpc([cgs, SA, true, posA2])).after.pm_v2 === true, "P3 the CGS turns it ON");
  await refuses(() => rpc([gmA, SA, false, posA2]), "pm_v2_moo_only", "P3 a GM never turns it OFF");
  check((await rpc([moo, SA, false, null])).after.pm_v2 === false, "P3 a MoO turns it OFF");
  await db.exec("reset role");

  // P4 — ceilings
  const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
    from pg_proc p where p.oid = 'public.save_people_shop_settings(uuid,uuid,boolean,uuid)'::regprocedure`)).rows[0];
  check(r.d === true && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s,
    "P4 SECURITY DEFINER, search_path pinned, service_role only");
} catch (e) {
  failures++;
  console.error(`FAIL 0334 harness: ${e.stack ?? e}`);
} finally {
  await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0334: ${checks} checks`);
