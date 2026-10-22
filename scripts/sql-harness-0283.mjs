/** Real migration behavior, synthetic rows only; PGlite in memory. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { crewStructureCases, loadStructureCases, materializeStructureCase } from "./schedule-structure-cases.mjs";

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
const M0283 = read("supabase/migrations/0283_schedule_crew_structure.sql");
const db = await base();
try {
  const missing = await base({ m0274: false });
  try { await refuses(() => missing.exec(M0283), "0274 must be applied first", "prerequisite"); } finally { await missing.close(); }
  // 0283 is independent of the person-settings migrations 0278 and 0280-0282.
  await db.exec(M0283);
  const actor = (await db.query("insert into public.users(role, active) values ('owner', true) returning id")).rows[0].id;
  const loc = (await db.query("insert into public.locations(active) values(true) returning id")).rows[0].id;
  const fresh = structuredClone(crewStructureCases().find((c) => c.name === 'new defaults').value);
  fresh.engine = 'crew'; fresh.shiftTypes = [{ ...crewStructureCases().find((c) => c.name === 'crew').value.shiftTypes[0], stations: [] }];
  fresh.catering.crewShift = { enabled: true, typeId: fresh.shiftTypes[0].id, extraHeads: 1 };
  const legacy = structuredClone(fresh); delete legacy.engine; delete legacy.shiftTypes; delete legacy.catering.crewShift;
  async function save(value, expected) {
    await db.exec('set role service_role');
    try { return (await db.query('select public.save_schedule_structure($1,$2,$3,$4::jsonb) r', [actor, loc, expected, JSON.stringify(value)])).rows[0].r; }
    finally { await db.exec('reset role'); }
  }
  const old = await save(legacy, null);
  const next = await save(fresh, old.after_id);
  check((await db.query('select structure = $2::jsonb ok from public.schedule_structures where id=$1',[next.after_id, JSON.stringify(fresh)])).rows[0].ok, 'writer readback');
  check((await db.query('select count(*)::int n from public.schedule_structures')).rows[0].n === 2, 'append-only two versions');
  check(!(await db.query('select structure from public.schedule_structures where id=$1',[old.after_id])).rows[0].structure.engine, 'historical structure untouched');
  await refuses(() => save(fresh, old.after_id), 'structure_moved', 'stale expected head');
  await refuses(() => save({ ...fresh, shiftTypes: [] }, next.after_id), 'structure_invalid', 'writer refuses crew without types');
  await refuses(() => db.query('insert into public.schedule_structures(location_id,created_by,structure) values($1,$2,$3::jsonb)', [loc,actor,JSON.stringify({...fresh,engine:'wrong'})]), '23514', 'table CHECK rejects invalid structure');
  const cases = [...loadStructureCases().map((c) => ({ name: c.name, value: materializeStructureCase(c), key: c.valid ? null : c.key })), ...crewStructureCases()];
  for (const c of cases) {
    const result = (await db.query("select public.valid_schedule_structure($1::jsonb) as ok", [JSON.stringify(c.value)])).rows[0].ok;
    check(result === (c.key === null), `validator: ${c.name}`);
  }
  const props = (await db.query(`select provolatile, proconfig,
    has_function_privilege('anon', oid, 'EXECUTE') a,
    has_function_privilege('authenticated', oid, 'EXECUTE') u,
    has_function_privilege('service_role', oid, 'EXECUTE') s
    from pg_proc where oid = 'public.valid_schedule_structure(jsonb)'::regprocedure`)).rows[0];
  check(props.provolatile === 'i' && JSON.stringify(props.proconfig) === JSON.stringify(['search_path=pg_catalog, public']) && !props.a && !props.u && props.s, "immutable/search_path/grants");
  await refuses(() => db.exec(M0283), "already applied", "repeat apply");
  await db.exec("rollback");
} finally { await db.close(); }
console.log(`0283: ${checks - failures}/${checks} checks passed`);
if (failures) process.exitCode = 1;
