/** Real migration behavior, synthetic rows only; PGlite in memory. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { mergePersonPositionsCall, recordPersonSettingsCall, savePersonSettingsCall, saveShopSettingsCall } from "../lib/scheduling/rpc-args-shared.ts";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0270 = read("supabase/migrations/0270_people_layer.sql");
const M0274 = read("supabase/migrations/0274_schedule_settings.sql");
const M0278 = read("supabase/migrations/0278_schedule_person_settings_guarded.sql");
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
const LOCKDOWN_0272 = "revoke insert, update, delete, truncate on public.locations, public.user_locations from anon, authenticated;";

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}
async function base({ m0274 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(HELPERS);
  await db.exec(M0270);
  await db.exec(LOCKDOWN_0272);
  if (m0274) await db.exec(M0274);
  return db;
}
const FNS = [
  "schedule_person_subject_check(uuid, integer, uuid)",
  "record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)",
  "save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)",
  "merge_schedule_person_positions(uuid, uuid, uuid, uuid, jsonb)",
];

const M0280 = read("supabase/migrations/0280_schedule_person_works_as.sql");
const db = await base();
async function rpc(call) {
  const keys = Object.keys(call.args);
  const vals = keys.map((k) => {
    const v = call.args[k];
    const scalarArray = Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
    return v !== null && typeof v === "object" && !scalarArray ? JSON.stringify(v) : v;
  });
  await db.exec("set role service_role");
  try { return (await db.query(`select public.${call.fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, vals)).rows[0].r; }
  finally { await db.exec("reset role"); }
}

try {
  await db.exec(M0278);
  await db.exec(M0280);
  check(true, "0274 + 0278 + 0280 applied");
  for (const old of FNS.slice(1, 3)) {
    check((await db.query("select to_regprocedure($1) as r", [`public.${old}`])).rows[0].r === null, `old signature gone: ${old}`);
  }
  for (const fn of FNS.map((f, i) => i === 1 || i === 2 ? f.replace(/\)$/, ", text)") : f)) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c,
      has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(r.d && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s, `definer and grants: ${fn}`);
  }
  check((await db.query(`select count(*)::int as n from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name in ('schedule_person_subject_check', 'record_schedule_person_settings',
    'save_schedule_person_settings', 'merge_schedule_person_positions') and grantee in ('PUBLIC', 'anon', 'authenticated')`)).rows[0].n === 0, "no public execution grants");
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const shop = await id("insert into public.locations (active) values (true) returning id");
  const user = async (role) => {
    const u = await id("insert into public.users (role, active) values ($1, true) returning id", [role]);
    await db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, true)", [u, shop]);
    return u;
  };
  const actor = await user("moo"), office = await user("cgs"), floor = await user("employee");
  const fields = { actorId: actor, locationId: shop, workType: null, alsoAllowed: [], leaderSetting: null,
    coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null };
  const record = (userId, overrides = {}) => rpc(recordPersonSettingsCall({ ...fields, userId, ...overrides }));
  await refuses(() => record(floor, { worksAs: "key_holder" }), "works_as_refused", "floor override refused");
  await refuses(() => record(office, { worksAs: "gm" }), "invalid_payload", "invalid override refused");
  await refuses(() => record(office, { rosterInclude: true }), "roster_include_refused", "CGS without override cannot opt in");
  const first = await record(office, { worksAs: "key_holder", rosterInclude: true });
  check(first.after.works_as === "key_holder" && first.after.roster_include === true, "CGS with override can opt in");
  const merge = (expectedId) => rpc(mergePersonPositionsCall({ actorId: actor, locationId: shop, userId: office, expectedId, changes: { workType: "foh" } }));
  const second = await merge(first.id);
  check(second.after.works_as === "key_holder", "merge carries off-floor override");
  await db.query("update public.users set role = 'employee' where id = $1", [office]);
  const third = await merge(second.id);
  check(third.after.works_as === null, "merge clears stale floor override");
  const fourth = await rpc(savePersonSettingsCall({ ...fields, userId: office, expectedId: third.id, worksAs: null }));
  check(fourth.after.works_as === null, "full-row save clears override");
  await refuses(() => db.query("update public.schedule_person_settings set works_as = 'gm' where id = $1", [fourth.id]), "23514", "CHECK rejects invalid override");
  await refuses(() => db.exec(M0280), "0280: already applied", "second apply refused");
  await db.exec("rollback");
} catch (e) {
  failures++;
  console.error("FAIL harness threw:", e);
} finally {
  await db.close();
}
if (failures) { console.error(`FAILED 0280: ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASS 0280: ${checks} checks`);
