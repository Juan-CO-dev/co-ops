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
const db = await base();
async function rpc(call) {
  const keys = Object.keys(call.args).filter((key) => key !== "p_usual_shift");
  const vals = keys.map((k) => {
    const v = call.args[k];
    if (k === "p_availability" && v !== null) return JSON.stringify(v);
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
  check(true, "0274 + 0278 + 0280 + 0281 applied");
  for (const old of FNS.slice(1, 3).flatMap((f) => [f, f.replace(/\)$/, ", text)")])) {
    check((await db.query("select to_regprocedure($1) as r", [`public.${old}`])).rows[0].r === null, `old signature gone: ${old}`);
  }
  for (const fn of FNS.map((f, i) => i === 1 || i === 2 ? f.replace(/\)$/, ", text, jsonb)") : f)) {
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
  const availability = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1),
    i < 4 ? { mode: "off" } : i === 4 ? { mode: "if_needed", fromQ: 64, toQ: 96 } : { mode: "works" }]));
  const save = (expectedId, value) => rpc(savePersonSettingsCall({ ...fields, userId: floor, expectedId, availability: value }));
  const first = await save(null, availability);
  check(JSON.stringify(first.after.availability) === JSON.stringify((await db.query("select availability from public.schedule_person_settings where id = $1", [first.id])).rows[0].availability), "save round-trips availability in row and audit");
  check(first.after.availability["5"].fromQ === 64 && first.after.availability["5"].toQ === 96, "quarter-hour window preserved");
  check(first.after.availability["1"].mode === "off" && first.after.availability["6"].mode === "works", "all modes preserved");
  const second = await rpc(mergePersonPositionsCall({ actorId: actor, locationId: shop, userId: floor, expectedId: first.id, changes: { workType: "foh" } }));
  check(JSON.stringify(second.after.availability) === JSON.stringify(first.after.availability), "position merge carries availability");
  check(JSON.stringify(second.before.availability) === JSON.stringify(first.after.availability), "audit before carries availability");
  await refuses(() => save(first.id, null), "person_settings_moved", "stale full-row write refused");
  const badDays = [null, [], "works", {}, { mode: null }, { mode: "unknown" }, { mode: 1 },
    { mode: "works", extra: true }, { mode: "works", fromQ: 1 }, { mode: "works", toQ: 96 },
    { mode: "works", fromQ: null, toQ: 96 }, { mode: "works", fromQ: "64", toQ: 96 },
    { mode: "works", fromQ: 64, toQ: null }, { mode: "works", fromQ: 64, toQ: "96" },
    { mode: "works", fromQ: -1, toQ: 96 }, { mode: "works", fromQ: 64, toQ: 97 },
    { mode: "works", fromQ: 64.5, toQ: 96 }, { mode: "works", fromQ: 64, toQ: 95.5 },
    { mode: "works", fromQ: 64, toQ: 64 }, { mode: "works", fromQ: 96, toQ: 0 }];
  const badShapes = [[], "works", 42, {}, { ...availability, "8": { mode: "off" } },
    Object.fromEntries(Object.entries(availability).filter(([key]) => key !== "1")),
    ...badDays.map((day) => ({ ...availability, "1": day }))];
  for (const [i, bad] of badShapes.entries()) {
    await refuses(() => save(second.id, bad), "invalid_payload", `bad availability ${i} refused`);
  }
  for (const [i, bad] of badShapes.entries()) {
    await refuses(() => db.query("insert into public.schedule_person_settings (location_id, user_id, created_by, availability) values ($1, $2, $3, $4)",
      [shop, floor, actor, JSON.stringify(bad)]), "schedule_person_settings_availability_check", `direct bad shape ${i} refused by CHECK`);
  }
  check((await db.query("select count(*)::int as n from public.schedule_person_settings")).rows[0].n === 2, "refused payloads append no rows");
  const third = await save(second.id, null);
  check(third.after.availability === null, "NULL restores Toast guess");
  const allDay = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), { mode: "works", fromQ: 0, toQ: 96 }]));
  const fourth = await save(third.id, allDay);
  check(fourth.after.availability["1"].fromQ === 0 && fourth.after.availability["7"].toQ === 96, "full-day bounds accepted");
  await refuses(() => db.exec(M0281), "0281: already applied", "second apply refused");
  await db.exec("rollback");
} catch (e) {
  failures++;
  console.error("FAIL harness threw:", e);
} finally {
  await db.close();
}
if (failures) { console.error(`FAILED 0281: ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASS 0281: ${checks} checks`);
