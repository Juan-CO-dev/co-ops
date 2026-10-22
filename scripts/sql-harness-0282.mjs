/** Real migration behavior, synthetic rows only; PGlite in memory. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { mergePersonPositionsCall, savePersonSettingsCall } from "../lib/scheduling/rpc-args-shared.ts";

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
const M0281 = read("supabase/migrations/0281_schedule_person_availability.sql");
const M0282 = read("supabase/migrations/0282_schedule_person_usual_shift.sql");
const db = await base();
async function rpc(call) {
  const keys = Object.keys(call.args);
  const vals = keys.map((k) => {
    const v = call.args[k];
    if ((k === "p_availability" || k === "p_usual_shift") && v !== null) return JSON.stringify(v);
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
  await db.exec(M0281);
  await db.exec(M0282);
  check(true, "0274 + 0278 + 0280 + 0281 + 0282 applied");
  for (const old of FNS.slice(1, 3).flatMap((f) => [f, f.replace(/\)$/, ", text)"), f.replace(/\)$/, ", text, jsonb)")])) {
    check((await db.query("select to_regprocedure($1) as r", [`public.${old}`])).rows[0].r === null, `old signature gone: ${old}`);
  }
  for (const fn of FNS.map((f, i) => i === 1 || i === 2 ? f.replace(/\)$/, ", text, jsonb, jsonb)") : f)) {
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
  const actor = await user("moo"), floor = await user("employee");
  const fields = { actorId: actor, locationId: shop, workType: null, alsoAllowed: [], leaderSetting: null,
    coverPositions: [], softMinH: null, softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null };
  const usualShift = { typeId: "opener", fromQ: 30, toQ: 64 };
  const availability = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), { mode: "works" }]));
  const save = (expectedId, value) => rpc(savePersonSettingsCall({ ...fields, userId: floor, expectedId, availability, usualShift: value }));
  const first = await save(null, usualShift);
  const row = (await db.query("select usual_shift from public.schedule_person_settings where id = $1", [first.id])).rows[0];
  check(JSON.stringify(first.after.usual_shift) === JSON.stringify(row.usual_shift), "save round-trips row and audit");
  check(first.after.usual_shift.fromQ === 30 && first.after.usual_shift.toQ === 64, "own times preserved");
  const second = await rpc(mergePersonPositionsCall({ actorId: actor, locationId: shop, userId: floor, expectedId: first.id, changes: { workType: "foh" } }));
  check(JSON.stringify(second.after.usual_shift) === JSON.stringify(first.after.usual_shift), "position merge carries usual shift");
  check(JSON.stringify(second.before.usual_shift) === JSON.stringify(first.after.usual_shift), "audit before carries usual shift");
  check(JSON.stringify(second.after.availability) === JSON.stringify(first.after.availability), "availability preserved alongside usual shift");
  await refuses(() => save(first.id, null), "person_settings_moved", "stale full-row write refused");
  const badShapes = [[], "opener", 42, {}, { typeId: null }, { typeId: 1 },
    { typeId: "x", extra: true }, { typeId: "x", fromQ: 1 }, { typeId: "x", toQ: 96 },
    ...[[-1,96], [0,97], [64,64], [96,0], [1.5,64], [1,64.5], [null,64], [1,null], ["1",64], [1,"64"]]
      .map(([fromQ,toQ]) => ({ typeId: "x", fromQ, toQ }))];
  for (const [i, bad] of badShapes.entries()) {
    await refuses(() => save(second.id, bad), "invalid_payload", `bad usual shift ${i} refused`);
  }
  for (const [i, bad] of [null, ...badShapes].entries()) {
    await refuses(() => db.query("insert into public.schedule_person_settings (location_id, user_id, created_by, usual_shift) values ($1, $2, $3, $4)",
      [shop, floor, actor, JSON.stringify(bad)]), "schedule_person_settings_usual_shift_check", `direct bad shape ${i} refused by CHECK`);
  }
  const denied = await user("employee");
  await refuses(() => rpc(savePersonSettingsCall({ ...fields, actorId: denied, userId: floor, expectedId: second.id, usualShift })), "forbidden", "employee actor refused");
  check((await db.query("select count(*)::int as n from public.schedule_person_settings")).rows[0].n === 2, "refused payloads append no rows");
  const third = await save(second.id, null);
  check(third.after.usual_shift === null, "explicit NULL clears usual shift");
  const fourth = await save(third.id, { typeId: "", fromQ: 0, toQ: 96 });
  check(fourth.after.usual_shift.fromQ === 0 && fourth.after.usual_shift.toQ === 96, "full-day bounds accepted; type existence not checked in SQL");
  const fifth = await save(fourth.id, { typeId: "deleted-type" });
  check(fifth.after.usual_shift.typeId === "deleted-type", "type-only reference accepted");
  const validator = (await db.query(`select provolatile as v,
    has_function_privilege('anon', oid, 'EXECUTE') as a,
    has_function_privilege('authenticated', oid, 'EXECUTE') as u,
    has_function_privilege('service_role', oid, 'EXECUTE') as s
    from pg_proc where oid = 'public.valid_person_usual_shift(jsonb)'::regprocedure`)).rows[0];
  check(validator.v === "i" && !validator.a && !validator.u && validator.s, "validator immutable and service-role only");
  await refuses(() => db.exec(M0282), "0282: already applied", "second apply refused");
  await db.exec("rollback");
  const prereq = await base();
  try {
    await prereq.exec(M0278);
    await prereq.exec(M0280);
    await refuses(() => prereq.exec(M0282), "0282: 0281 must be applied first", "missing prerequisite refused");
    await prereq.exec("rollback");
  } finally { await prereq.close(); }
} catch (e) {
  failures++;
  console.error("FAIL harness threw:", e);
} finally {
  await db.close();
}
if (failures) { console.error(`FAILED 0282: ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASS 0282: ${checks} checks`);
