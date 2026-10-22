/**
 * Local Postgres proof of migration 0274 (Scheduling Phase 2, Task 13), SYNTHETIC ROWS ONLY — PGlite, in memory.
 * CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0274.mjs
 *
 * THE EXECUTION CONTRACT (plan chunk D, r2 P3-13): tests/fixtures/scheduling-pglite-stub.sql first (it models the
 * Supabase roles AND their default privileges — every new table / function / sequence granted to anon,
 * authenticated and service_role — so the migration must REVOKE what Supabase would really grant); the REAL level
 * helpers (0217 / 0228 / 0233, extracted verbatim) and the REAL 0270; the 0272 lockdown posture on the two tables
 * 0274's preflight reads; then 0274. Every writer is called `set role service_role` with the EXACT named arguments
 * the lib sends — the objects come from lib/scheduling/rpc-args-shared.ts, the module the lib itself uses.
 *
 *   S0  the preflight refuses without 0270, without the 0272 posture, and on a second apply
 *   S1  seven tables: RLS on, no policy; PUBLIC / anon / authenticated hold NOTHING; service_role exactly SELECT —
 *       direct INSERT / UPDATE / DELETE / TRUNCATE as service_role refused (42501), SELECT allowed
 *   S2  every function: search_path pinned, EXECUTE for service_role only (anon / authenticated refused by CALLING
 *       it under each role, and no PUBLIC / anon / authenticated row in information_schema.routine_privileges);
 *       the writers and the actor helpers SECURITY DEFINER
 *   S3  THE SHARED CASE FILE (tests/fixtures/schedule/structure-cases.json) against valid_schedule_structure AND the
 *       table CHECK — every valid case accepted, every invalid refused, the infeasible-valid rows accepted: the
 *       same verdict as the TS validator
 *   S4  the actor rule: SMM by role, catering / prep managers and a shift lead forbidden, a deactivated GM, another
 *       shop's GM, an inactive shop; MoO at any shop; the AGM read-only unless agm_access = 'edit' at an own shop
 *   S5  structure versions: structure_moved, structure_invalid, a position of ANOTHER shop / retired / not a uuid
 *       refused by name, before/after ids, the lock taken before the read
 *   S6  shop settings: MoO+ only, wage_estimate_invalid, invalid agm_access, before/after, one row per shop
 *   S7  person settings: subject at the shop, cover positions active / distinct, roster_include refused for the CGS
 *       and the social media manager, the payload rules, before/after, the CHECKs as the backstop
 *   S8  budgets (r3 per-DATE precedence): F11, F12 and F13 replayed as entry writes, the newest row per date owns
 *       every date (schedule_budget_by_date), both entry orders; day rows that do not cover exactly the entry's dates
 *       or do not sum to its hours refused (budget_invalid)
 *   S9  day types and pins: past dates day_locked, the closed vocabularies, a pin retired once, an added pin needs a
 *       position, every position active at the shop
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { loadStructureCases, materializeStructureCase, shopBase, CASE_POSITION_IDS } from "./schedule-structure-cases.mjs";
import {
  SCHEDULE_RPC, recordBudgetEntryCall, recordDayTypeCall, recordPersonSettingsCall, recordPinCall, saveShopSettingsCall, saveStructureCall,
} from "../lib/scheduling/rpc-args-shared.ts";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0270 = read("supabase/migrations/0270_people_layer.sql");
const M0274 = read("supabase/migrations/0274_schedule_settings.sql");
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
// 0272 (applied on prod 2026-10-15) closed PostgREST writes on 42 tables; 0274's preflight reads its posture on two.
const LOCKDOWN_0272 = "revoke insert, update, delete, truncate on public.locations, public.user_locations from anon, authenticated;";

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

async function base({ m0270 = true, lockdown = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(HELPERS);
  if (m0270) await db.exec(M0270);
  if (lockdown) await db.exec(LOCKDOWN_0272);
  return db;
}

const TABLES = ["schedule_shop_settings", "schedule_structures", "schedule_person_settings", "schedule_budget_entries", "schedule_budget_days",
  "schedule_day_types", "schedule_pins"];
const FNS = [
  ["schedule_json_num(jsonb)", false], ["schedule_json_int(jsonb, numeric, numeric)", false], ["schedule_json_quarter(jsonb)", false],
  ["schedule_json_qhours(jsonb, numeric, numeric)", false], ["schedule_json_exact_keys(jsonb, text[])", false], ["schedule_role_codes()", false],
  ["schedule_role_list_ok(jsonb)", false], ["valid_schedule_structure(jsonb)", false], ["schedule_actor_level(uuid, uuid)", true],
  ["schedule_actor_require(uuid, uuid, integer)", true], ["schedule_subject_at_shop(uuid, uuid)", true], ["schedule_et_today()", false],
  ["save_schedule_shop_settings(uuid, uuid, boolean, integer, integer, text)", true], ["save_schedule_structure(uuid, uuid, uuid, jsonb)", true],
  ["record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)", true],
  ["record_schedule_budget_entry(uuid, uuid, text, date, date, numeric, jsonb, text, text, text)", true],
  ["record_schedule_day_type(uuid, uuid, date, text)", true], ["record_schedule_pin(uuid, uuid, date, uuid, integer, integer, uuid[], text, uuid)", true],
  ["schedule_budget_by_date(uuid, date, date)", false],
];

const db = await base();
/** Call a writer exactly as the lib does: its name and NAMED arguments from rpc-args-shared. */
async function rpc(call) {
  // Historical migration harness: works_as first exists in 0280.
  const keys = Object.keys(call.args).filter((key) => key !== "p_works_as");
  const vals = keys.map((k) => {
    const v = call.args[k];
    const scalarArray = Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
    return v !== null && typeof v === "object" && !scalarArray ? JSON.stringify(v) : v;
  });
  return (await db.query(`select public.${call.fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, vals)).rows[0].r;
}
const asService = async (fn) => { await db.exec("set role service_role"); try { return await fn(); } finally { await db.exec("reset role"); } };
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const etToday = (await db.query("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;

try {
  // S0 — the preflight
  {
    const no0270 = await base({ m0270: false });
    await refuses(() => no0270.exec(M0274), "0274: 0270 (people_position_at_shop + station_positions_id_location) must be applied first", "S0 the preflight refuses without 0270");
    await no0270.close();
    const no0272 = await base({ lockdown: false });
    await refuses(() => no0272.exec(M0274), "0274: 0272 (the PostgREST write lockdown) must be applied first", "S0 the preflight refuses without the 0272 posture");
    await no0272.close();
  }
  await db.exec(M0274);
  check(true, "0274 applied with every SQL guard");
  {
    const again = await base();
    await again.exec(M0274);
    await refuses(() => again.exec(M0274), "0274: already applied", "S0 a second apply is refused by the preflight");
    await again.close();
  }

  // S1 — tables, RLS, the SELECT ceiling (on top of the stub's Supabase default grants)
  for (const t of TABLES) {
    const r = (await db.query("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`public.${t}`])).rows[0];
    const pol = (await db.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1", [t])).rows[0].n;
    check(r?.rls === true && pol === 0, `S1 ${t}: RLS on, no policy`);
    let ok = true;
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const g = (await db.query(`select has_table_privilege('service_role', $1, $2) as s, has_table_privilege('anon', $1, $2) as a,
        has_table_privilege('authenticated', $1, $2) as u`, [`public.${t}`, p])).rows[0];
      if (g.s !== (p === "SELECT") || g.a || g.u) ok = false;
    }
    const grants = (await db.query(`select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and table_name = $1
      and grantee in ('PUBLIC', 'anon', 'authenticated')`, [t])).rows[0].n;
    check(ok && grants === 0, `S1 ${t}: PUBLIC/anon/authenticated hold nothing; service_role exactly SELECT`);
  }
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await refuses(() => db.query("select * from public.schedule_structures"), "42501", `S1 ${role} cannot even SELECT a schedule table`);
    await db.exec("reset role");
  }

  // S2 — functions
  for (const [fn, definer] of FNS) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s && (!definer || r.d === true),
      `S2 ${fn.split("(")[0]}: search_path pinned, service_role only${definer ? ", SECURITY DEFINER" : ""}`);
  }
  const pub = (await db.query(`select count(*)::int as n from information_schema.routine_privileges where routine_schema = 'public'
    and routine_name in (${FNS.map((_, i) => `$${i + 1}`).join(", ")}) and grantee in ('PUBLIC', 'anon', 'authenticated')`, FNS.map(([f]) => f.split("(")[0]))).rows[0].n;
  check(pub === 0, "S2 information_schema.routine_privileges: no PUBLIC / anon / authenticated EXECUTE on any 0274 function");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await refuses(() => db.query("select public.valid_schedule_structure('{}'::jsonb)"), "42501", `S2 ${role} cannot EXECUTE valid_schedule_structure`);
    await refuses(() => db.query("select public.save_schedule_structure(p_actor => null, p_location => null, p_expected => null, p_structure => null)"), "42501", `S2 ${role} cannot EXECUTE save_schedule_structure`);
    await refuses(() => db.query("select public.record_schedule_day_type(p_actor => null, p_location => null, p_date => null, p_day_type => null)"), "42501", `S2 ${role} cannot EXECUTE record_schedule_day_type`);
    await db.exec("reset role");
  }

  // ── fixtures (superuser) ──
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role, active = true) => id("insert into public.users (role, active) values ($1, $2) returning id", [role, active]);
  const shop = (active = true) => id("insert into public.locations (active) values ($1) returning id", [active]);
  const member = (u, l, active = true) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, $3)", [u, l, active]);
  const station = (l, active = true) => id("insert into public.stations (location_id, active) values ($1, $2) returning id", [l, active]);
  const position = (s, l, name, active = true, pid = null) => pid
    ? id("insert into public.station_positions (id, station_id, location_id, name, active) values ($1, $2, $3, $4, $5) returning id", [pid, s, l, name, active])
    : id("insert into public.station_positions (station_id, location_id, name, active) values ($1, $2, $3, $4) returning id", [s, l, name, active]);
  const SA = await shop(), SB = await shop(), SX = await shop(false), SC = await shop(), SD = await shop();
  const cgs = await user("cgs"), owner = await user("owner"), moo = await user("moo");
  const gmA = await user("gm"), gmB = await user("gm"), gmOff = await user("gm", false), agmA = await user("agm"), smmA = await user("social_media_mgr");
  const catA = await user("catering_mgr"), prepA = await user("prep_mgr"), slA = await user("shift_lead");
  const empA = await user("employee"), empB = await user("employee"), empOff = await user("employee", false), khA = await user("key_holder");
  for (const [u, l] of [[gmA, SA], [gmA, SC], [gmA, SD], [gmB, SB], [gmOff, SA], [agmA, SA], [smmA, SA], [catA, SA], [prepA, SA], [slA, SA],
    [empA, SA], [empB, SB], [empOff, SA], [khA, SA], [cgs, SA], [moo, SA]]) await member(u, l);
  // Shop A's positions use the case file's ids, so the case file's "shop" structure is a valid structure OF SHOP A.
  const stA = await station(SA), stB = await station(SB), stAOff = await station(SA, false);
  const P = {};
  for (const [token, pid] of Object.entries(CASE_POSITION_IDS)) P[token] = await position(stA, SA, token, true, pid);
  const posB = await position(stB, SB, "Register");
  const posAOld = await position(stA, SA, "Retired", false);
  const posUnderOff = await position(stAOff, SA, "Under an inactive station");

  // S1 (cont.) — direct DML refused for service_role, SELECT allowed
  await asService(async () => {
    await refuses(() => db.query("insert into public.schedule_shop_settings (location_id, updated_by) values ($1, $2)", [SA, gmA]), "42501", "S1 service_role cannot INSERT shop settings directly");
    await refuses(() => db.query("insert into public.schedule_structures (location_id, structure, created_by) values ($1, $2::jsonb, $3)", [SA, JSON.stringify(shopBase()), gmA]), "42501", "S1 service_role cannot INSERT a structure directly");
    await refuses(() => db.query("update public.schedule_pins set active = false"), "42501", "S1 service_role cannot UPDATE a pin");
    await refuses(() => db.query("delete from public.schedule_budget_days"), "42501", "S1 service_role cannot DELETE a budget day row");
    await refuses(() => db.query("truncate public.schedule_day_types"), "42501", "S1 service_role cannot TRUNCATE day types");
    await refuses(() => db.query("delete from public.schedule_person_settings"), "42501", "S1 service_role cannot DELETE person settings");
    check((await db.query("select count(*)::int as n from public.schedule_structures")).rows[0].n === 0, "S1 service_role CAN select (the reads the loader makes)");
  });

  // S3 — the SHARED case file, against the function AND the table CHECK
  const cases = loadStructureCases();
  let agreeFn = 0, agreeCheck = 0;
  for (const c of cases) {
    const value = JSON.stringify(materializeStructureCase(c));
    const fnSays = (await db.query("select public.valid_schedule_structure($1::jsonb) as v", [value])).rows[0].v;
    if (fnSays === c.valid) agreeFn++; else console.error(`FAIL S3 valid_schedule_structure disagrees on "${c.name}": got ${fnSays}`);
    let inserted;
    await db.exec("begin");
    try { await db.query("insert into public.schedule_structures (location_id, structure, created_by) values ($1, $2::jsonb, $3)", [SA, value, gmA]); inserted = true; }
    catch (e) { inserted = false; if (e.code !== "23514") console.error(`S3 "${c.name}": unexpected error ${e.code} ${e.message}`); }
    await db.exec("rollback");
    if (inserted === c.valid) agreeCheck++; else console.error(`FAIL S3 the CHECK disagrees on "${c.name}": inserted=${inserted}`);
  }
  check(agreeFn === cases.length, `S3 valid_schedule_structure agrees with the shared case file on all ${cases.length} cases (${cases.filter((c) => c.valid).length} valid)`);
  check(agreeCheck === cases.length, `S3 the schedule_structures CHECK agrees with the shared case file on all ${cases.length} cases`);
  const infeasible = cases.filter((c) => c.infeasible);
  check(infeasible.length > 0 && infeasible.every((c) => c.valid), `S3 the infeasible-but-valid rows (${infeasible.length}) are accepted, never refused`);
  check(cases.some((c) => !c.valid && String(c.key).includes("waveProfile")), "S3 the case file carries the wave-bounds refusal (the closed form is exercised)");
  check(cases.some((c) => !c.valid && c.key === "limits.maxShiftH"), "S3 the case file carries the maxShiftH refusals (CC rulings)");

  const S = (patch) => { const s = shopBase(); patch?.(s); return s; };
  await db.exec("set role service_role");

  // S4 — the actor rule (through the structure writer — level 7 — and the day-type writer — the edit class, 6)
  const future = addDays(etToday, 14);
  const dayType = (actor, loc, date = future, t = "busy") => rpc(recordDayTypeCall({ actorId: actor, locationId: loc, date, dayType: t }));
  await refuses(() => dayType(smmA, SA), "schedule_role_refused", "S4 the social media manager is refused by ROLE");
  await refuses(() => dayType(catA, SA), "schedule_forbidden", "S4 the catering manager is forbidden");
  await refuses(() => dayType(prepA, SA), "schedule_forbidden", "S4 the prep manager is forbidden");
  await refuses(() => dayType(slA, SA), "schedule_forbidden", "S4 a shift lead is forbidden");
  await refuses(() => dayType(gmOff, SA), "schedule_forbidden", "S4 a deactivated GM is forbidden");
  await refuses(() => dayType(gmB, SA), "shop_not_allowed", "S4 a GM of another shop is refused");
  await refuses(() => dayType(moo, SX), "shop_not_allowed", "S4 an inactive shop is refused, MoO included");
  check(typeof (await dayType(gmA, SA)).id === "string", "S4 a GM at their own shop writes");
  check(typeof (await dayType(moo, SB)).id === "string" && typeof (await dayType(owner, SB)).id === "string" && typeof (await dayType(cgs, SB)).id === "string",
    "S4 MoO, Owner and CGS write at any active shop");
  await refuses(() => dayType(agmA, SA), "schedule_forbidden", "S4 the AGM is read-only by default (agm_access 'read', R1)");

  // S6 — shop settings (MoO+ only); also flips agm_access for S4's AGM edit case
  const saveSettings = (actor, loc, o = {}) => rpc(saveShopSettingsCall({ actorId: actor, locationId: loc, enabled: o.enabled ?? false,
    estimatedHourlyCents: o.hourly ?? null, estimatedSalariedWeeklyCents: o.salaried ?? null, agmAccess: o.agm ?? "read" }));
  await refuses(() => saveSettings(gmA, SA), "schedule_forbidden", "S6 a GM cannot change the switch / wages / AGM access (MoO+ only)");
  await refuses(() => saveSettings(smmA, SA), "schedule_role_refused", "S6 the social media manager is refused by role");
  await refuses(() => saveSettings(moo, SA, { hourly: 0 }), "wage_estimate_invalid", "S6 a zero hourly estimate → wage_estimate_invalid");
  await refuses(() => saveSettings(moo, SA, { hourly: 100001 }), "wage_estimate_invalid", "S6 an hourly estimate over $1,000 → wage_estimate_invalid");
  await refuses(() => saveSettings(moo, SA, { salaried: 10000001 }), "wage_estimate_invalid", "S6 a salaried estimate over the ceiling → wage_estimate_invalid");
  await refuses(() => saveSettings(moo, SA, { agm: "write" }), "invalid_payload", "S6 an unknown agm_access → invalid_payload");
  const s1 = await saveSettings(moo, SA, { agm: "edit" });
  check(s1.before === null && s1.after.enabled === false && s1.after.agm_access === "edit" && s1.after.estimated_hourly_cents === null,
    "S6 MoO's first save: before = null, money blank (R2), the switch off");
  const s2 = await saveSettings(owner, SA, { enabled: true, hourly: 2050, salaried: 125000, agm: "edit" });
  check(s2.before.enabled === false && s2.after.enabled === true && s2.after.estimated_hourly_cents === 2050
    && (await db.query("select count(*)::int as n from public.schedule_shop_settings where location_id = $1", [SA])).rows[0].n === 1,
    "S6 a second save updates the ONE row and returns before/after");
  check(typeof (await dayType(agmA, SA)).id === "string", "S4 the AGM writes the edit class at their own shop once agm_access = 'edit'");
  await refuses(() => rpc(saveStructureCall({ actorId: agmA, locationId: SA, expectedId: null, structure: S() })), "schedule_forbidden",
    "S4 … but never the structure (GM own / MoO+ only), whatever agm_access says");
  {
    const src = (await db.query("select prosrc from pg_proc where oid = 'public.save_schedule_shop_settings(uuid, uuid, boolean, integer, integer, text)'::regprocedure")).rows[0].prosrc;
    check(src.indexOf("pg_advisory_xact_lock") > -1 && src.indexOf("pg_advisory_xact_lock") < src.indexOf("select * into v_old"), "S6 the settings writer locks the shop before it reads");
  }

  // S5 — structure versions
  const saveS = (actor, loc, expected, structure) => rpc(saveStructureCall({ actorId: actor, locationId: loc, expectedId: expected, structure }));
  await refuses(() => saveS(gmA, SA, null, S((s) => { s.limits.maxShiftH = 3.75; })), "structure_invalid", "S5 an invalid structure → structure_invalid (named, before the CHECK)");
  const v1 = await saveS(gmA, SA, null, S());
  check(v1.before_id === null && typeof v1.after_id === "string", "S5 GM saves the first version (before = null)");
  await refuses(() => saveS(gmA, SA, null, S()), "structure_moved", "S5 a save against a stale version → structure_moved");
  const v2 = await saveS(moo, SA, v1.after_id, S((s) => { s.limits.maxShiftH = 12; }));
  check(v2.before_id === v1.after_id && v2.after_id !== v1.after_id, "S5 MoO saves on top of the version it saw; before/after ids");
  check((await db.query("select based_on_id from public.schedule_structures where id = $1", [v2.after_id])).rows[0].based_on_id === v1.after_id, "S5 the new version names the one it was based on");
  await refuses(() => saveS(gmB, SA, v2.after_id, S()), "shop_not_allowed", "S5 a GM of another shop cannot save it");
  const foreign = S((s) => { s.positions[posB] = s.positions[CASE_POSITION_IDS.$THIRD]; });
  await refuses(() => saveS(gmA, SA, v2.after_id, foreign), "position_not_at_shop", "S5 a position of ANOTHER shop → position_not_at_shop");
  await refuses(() => saveS(gmA, SA, v2.after_id, S((s) => { s.positions[posAOld] = s.positions[CASE_POSITION_IDS.$THIRD]; })), "position_retired", "S5 a retired position → position_retired");
  await refuses(() => saveS(gmA, SA, v2.after_id, S((s) => { s.positions[posUnderOff] = s.positions[CASE_POSITION_IDS.$THIRD]; })), "position_retired", "S5 a position under an inactive station → position_retired");
  await refuses(() => saveS(gmA, SA, v2.after_id, S((s) => { s.positions["not-a-uuid"] = s.positions[CASE_POSITION_IDS.$THIRD]; })), "position_not_at_shop", "S5 a key that is not a position id → position_not_at_shop");
  await refuses(() => saveS(gmA, SA, v2.after_id, null), "invalid_payload", "S5 a null structure → invalid_payload");
  {
    const src = (await db.query("select prosrc from pg_proc where oid = 'public.save_schedule_structure(uuid, uuid, uuid, jsonb)'::regprocedure")).rows[0].prosrc;
    check(src.indexOf("pg_advisory_xact_lock") > -1 && src.indexOf("pg_advisory_xact_lock") < src.indexOf("select id into v_live"), "S5 the structure writer locks the shop before it reads the live version");
  }
  await db.exec("reset role");
  await refuses(() => db.query("insert into public.schedule_structures (location_id, structure, created_by) values ($1, $2::jsonb, $3)", [SA, JSON.stringify(S((s) => { s.version = 2; })), gmA]),
    "23514", "S5 the CHECK refuses an invalid structure past the writer");
  await db.exec("set role service_role");

  // S7 — person settings
  const person = (actor, u, o = {}) => rpc(recordPersonSettingsCall({ actorId: actor, locationId: SA, userId: u, workType: o.workType ?? "foh", alsoAllowed: o.alsoAllowed ?? [],
    leaderSetting: o.leader ?? null, coverPositions: o.cover ?? [], softMinH: o.softMin ?? null, softMaxH: o.softMax ?? null, fullTime: o.fullTime ?? false,
    fullTimeMinH: o.fullTimeMin ?? null, rosterInclude: o.rosterInclude ?? null }));
  const p1 = await person(gmA, empA, { cover: [P.$REG, P.$EXPO], softMin: 20, softMax: 32.25, alsoAllowed: ["boh"] });
  check(p1.before === null && JSON.stringify(p1.after.cover_positions) === JSON.stringify([P.$REG, P.$EXPO]), "S7 GM records Ben's settings; the cover list keeps its ORDER");
  const p2 = await person(agmA, empA, { workType: "boh" });
  check(p2.before.work_type === "foh" && p2.after.work_type === "boh", "S7 the AGM (agm_access 'edit') records a newer row; before = the previous latest");
  check((await db.query("select count(*)::int as n from public.schedule_person_settings where user_id = $1", [empA])).rows[0].n === 2, "S7 append-only: two rows, the latest wins");
  check(typeof (await person(gmA, prepA, { rosterInclude: true, workType: "boh" })).id === "string", "S7 a prep manager may be included on the roster (R6)");
  await refuses(() => person(gmA, smmA, { rosterInclude: true }), "roster_include_refused", "S7 roster_include for the social media manager → roster_include_refused");
  await refuses(() => person(moo, cgs, { rosterInclude: true }), "roster_include_refused", "S7 roster_include for the CGS → roster_include_refused");
  await refuses(() => person(gmA, empB), "person_not_at_shop", "S7 a person of another shop → person_not_at_shop");
  await refuses(() => person(gmA, empOff), "person_not_at_shop", "S7 a deactivated person → person_not_at_shop");
  await refuses(() => person(gmA, empA, { cover: [posB] }), "position_not_at_shop", "S7 a cover position of another shop → position_not_at_shop");
  await refuses(() => person(gmA, empA, { cover: [posAOld] }), "position_retired", "S7 a retired cover position → position_retired");
  await refuses(() => person(gmA, empA, { cover: [P.$REG, P.$REG] }), "invalid_payload", "S7 a repeated cover position → invalid_payload");
  await refuses(() => person(gmA, empA, { softMin: 30, softMax: 20 }), "invalid_payload", "S7 soft min above soft max → invalid_payload");
  await refuses(() => person(gmA, empA, { softMin: 10.1 }), "invalid_payload", "S7 an off-quarter soft min → invalid_payload");
  await refuses(() => person(gmA, empA, { workType: "kitchen" }), "invalid_payload", "S7 an unknown work type → invalid_payload");
  await refuses(() => person(gmA, empA, { alsoAllowed: ["management"] }), "invalid_payload", "S7 'management' is never an also-allowed type → invalid_payload");
  await refuses(() => person(gmA, empA, { leader: "always" }), "invalid_payload", "S7 an unknown leader setting → invalid_payload");
  await refuses(() => person(gmB, empA), "shop_not_allowed", "S7 a GM of another shop → shop_not_allowed");
  await db.exec("reset role");
  await refuses(() => db.query("insert into public.schedule_person_settings (location_id, user_id, soft_min_h, soft_max_h, created_by) values ($1, $2, 30, 20, $3)", [SA, empA, gmA]),
    "23514", "S7 the CHECK refuses soft min > soft max past the writer");
  await db.exec("set role service_role");

  // S8 — budgets: F11 / F12 / F13 (WEEK = Mon Oct 26 – Sun Nov 1 2026) as entry writes, per-DATE precedence in SQL
  const WEEK = "2026-10-26";
  const DAYS = Array.from({ length: 7 }, (_, i) => addDays(WEEK, i));
  const monthDays = (m) => { const out = []; for (let d = m; d.slice(0, 7) === m.slice(0, 7); d = addDays(d, 1)) out.push(d); return out; };
  const even = (dates, hours) => {
    const total = Math.round(hours * 100);
    const base = Math.floor(total / dates.length);
    let left = total - base * dates.length;
    return dates.map((date) => { const h = base + (left > 0 ? 1 : 0); if (left > 0) left--; return { date, hours: h / 100 }; });
  };
  const budget = (actor, loc, o) => rpc(recordBudgetEntryCall({ actorId: actor, locationId: loc, scope: o.scope, weekStart: o.scope === "week" ? o.week : null,
    month: o.scope === "month" ? o.month : null, hours: o.hours, days: o.days ?? even(o.scope === "week" ? Array.from({ length: 7 }, (_, i) => addDays(o.week, i)) : monthDays(o.month), o.hours),
    source: o.source ?? "manager", suggestionDigest: o.digest ?? null, apportionedBy: o.by ?? "even" }));
  const owners = async (loc) => {
    const rows = (await db.query("select business_date::text as d, entry_id, scope, hours::float8 as h from public.schedule_budget_by_date($1, $2, $3)", [loc, DAYS[0], DAYS[6]])).rows;
    return Object.fromEntries(rows.map((r) => [r.d, { entry: r.entry_id, h: r.h }]));
  };
  // F11 (shop A): the week (70 h) then October (310 h) → Oct 26–31 October's 10 h, Nov 1 KEEPS the week's row.
  const f11w = (await budget(gmA, SA, { scope: "week", week: WEEK, hours: 70 })).id;
  const f11o = (await budget(gmA, SA, { scope: "month", month: "2026-10-01", hours: 310 })).id;
  let o = await owners(SA);
  check(DAYS.slice(0, 6).every((d) => o[d]?.entry === f11o && o[d].h === 10) && o[DAYS[6]]?.entry === f11w && o[DAYS[6]].h === 10,
    "S8 F11 week → month: Oct 26–31 owned by October, Nov 1 keeps the week entry's row");
  // F12 (shop C): October, then the week (77 h), then November (300 h) → the week wins Oct 26–31, November wins Nov 1.
  const f12o = (await budget(gmA, SC, { scope: "month", month: "2026-10-01", hours: 310 })).id;
  const f12w = (await budget(gmA, SC, { scope: "week", week: WEEK, hours: 77 })).id;
  const f12n = (await budget(gmA, SC, { scope: "month", month: "2026-11-01", hours: 300 })).id;
  o = await owners(SC);
  check(DAYS.slice(0, 6).every((d) => o[d]?.entry === f12w && o[d].h === 11) && o[DAYS[6]]?.entry === f12n && o[DAYS[6]].h === 10
    && Object.values(o).reduce((n, r) => n + r.h, 0) === 76 && !Object.values(o).some((r) => r.entry === f12o),
    "S8 F12 month → week → adjacent month: the week owns 6 dates (11 h), November owns Nov 1 (10 h), 76 h in all");
  // F13 (shop D): October only → Nov 1 has NO budget (absent, never 0).
  await budget(gmA, SD, { scope: "month", month: "2026-10-01", hours: 310 });
  o = await owners(SD);
  check(Object.keys(o).length === 6 && !(DAYS[6] in o) && Object.values(o).reduce((n, r) => n + r.h, 0) === 60, "S8 F13 partial week: Nov 1 has no row (no budget, never 0); 60 h");
  // Both entry orders: November then October (shop B, MoO) gives the same week as October then November.
  await budget(moo, SB, { scope: "month", month: "2026-11-01", hours: 300 });
  await budget(moo, SB, { scope: "month", month: "2026-10-01", hours: 310 });
  const ob = await owners(SB);
  check(DAYS.every((d) => ob[d]?.h === 10), "S8 November then October gives every date of the week its month's 10 h (both entry orders agree)");
  // The accepted suggestion keeps its EXPLICIT per-date amounts (F16: 34/32/32/32/40/40/40 = 250).
  const f16 = [34, 32, 32, 32, 40, 40, 40].map((h, i) => ({ date: DAYS[i], hours: h }));
  const acc = await budget(gmA, SD, { scope: "week", week: WEEK, hours: 250, days: f16, source: "accepted_suggestion", digest: "a1b2c3d4e5f60718", by: "explicit" });
  o = await owners(SD);
  check(DAYS.every((d, i) => o[d]?.entry === acc.id && o[d].h === f16[i].hours), "S8 F16's accepted suggestion: its explicit rows own all 7 dates (250 h)");
  // Refusals by name: rows not covering exactly the entry's dates, or not summing to its hours.
  await refuses(() => budget(gmA, SA, { scope: "week", week: WEEK, hours: 70, days: even(DAYS.slice(0, 6), 70) }), "budget_invalid", "S8 six rows for a week entry → budget_invalid");
  await refuses(() => budget(gmA, SA, { scope: "week", week: WEEK, hours: 70, days: [...even(DAYS, 70).slice(0, 6), { date: addDays(WEEK, 7), hours: 10 }] }), "budget_invalid", "S8 a row outside the week → budget_invalid");
  await refuses(() => budget(gmA, SA, { scope: "week", week: WEEK, hours: 70, days: [...even(DAYS, 70).slice(0, 6), { date: DAYS[0], hours: 10 }] }), "budget_invalid", "S8 a repeated date → budget_invalid");
  await refuses(() => budget(gmA, SA, { scope: "week", week: WEEK, hours: 71, days: even(DAYS, 70) }), "budget_invalid", "S8 rows that do not sum to the entry → budget_invalid");
  await refuses(() => budget(gmA, SA, { scope: "week", week: WEEK, hours: 70, days: even(DAYS, 70).map((r, i) => (i === 0 ? { ...r, hours: 10.005 } : i === 1 ? { ...r, hours: 9.995 } : r)) }), "budget_invalid", "S8 a row off the hundredths grid → budget_invalid");
  await refuses(() => budget(gmA, SA, { scope: "week", week: "2026-10-27", hours: 70 }), "budget_invalid", "S8 a week that is not a Monday → budget_invalid");
  await refuses(() => budget(gmA, SA, { scope: "week", week: WEEK, hours: 10.1, days: even(DAYS, 10.1) }), "budget_invalid", "S8 hours off the quarter grid → budget_invalid");
  await refuses(() => budget(gmA, SA, { scope: "month", month: "2026-10-01", hours: 310, days: even(monthDays("2026-10-01").slice(0, 30), 310) }), "budget_invalid", "S8 a month entry missing a day → budget_invalid");
  await refuses(() => budget(gmA, SA, { scope: "week", week: WEEK, hours: 70, source: "accepted_suggestion", digest: null, by: "explicit" }), "budget_invalid", "S8 an accepted suggestion without its digest → budget_invalid");
  await refuses(() => budget(gmA, SA, { scope: "week", week: WEEK, hours: 70, source: "accepted_suggestion", digest: "abc", by: "even" }), "budget_invalid", "S8 an accepted suggestion not apportioned explicitly → budget_invalid");
  await refuses(() => budget(gmB, SA, { scope: "week", week: WEEK, hours: 70 }), "shop_not_allowed", "S8 a GM of another shop → shop_not_allowed");
  check((await db.query("select count(*)::int as n from public.schedule_budget_entries e where not exists (select 1 from public.schedule_budget_days d where d.entry_id = e.id)")).rows[0].n === 0,
    "S8 every entry has its day rows (written in the same transaction; refusals left nothing behind)");

  // S9 — day types and pins
  const past = addDays(etToday, -1);
  await refuses(() => dayType(gmA, SA, past), "day_locked", "S9 a day type for a past date → day_locked");
  await refuses(() => dayType(gmA, SA, future, "weekend"), "invalid_payload", "S9 'weekend' is not an override (the closed list) → invalid_payload");
  const d2 = await dayType(gmA, SA, future, "slow");
  const latest = (await db.query("select day_type from public.schedule_day_types where location_id = $1 and business_date = $2 order by created_at desc, id desc limit 1", [SA, future])).rows[0];
  check(typeof d2.id === "string" && latest.day_type === "slow", "S9 the latest override per date wins (append-only)");
  const pin = (o) => rpc(recordPinCall({ actorId: o.actor ?? gmA, locationId: SA, date: o.date ?? future, userId: o.user ?? moo, startQ: o.start ?? 40, endQ: o.end ?? 56,
    positions: o.positions ?? [], kind: o.kind ?? "presence", retiresId: o.retires ?? null }));
  const pres = await pin({});
  check(typeof pres.id === "string", "S9 a presence toggle for the MoO (a member or not, MoO+ works any shop)");
  const added = await pin({ user: empA, kind: "added", positions: [P.$REG, P.$EXPO] });
  check(typeof added.id === "string", "S9 'Add to schedule' with the positions they may flex across");
  await refuses(() => pin({ user: empA, kind: "added", positions: [] }), "pin_invalid", "S9 an added block with no position → pin_invalid");
  await refuses(() => pin({ start: 56, end: 56 }), "pin_invalid", "S9 an empty window → pin_invalid");
  await refuses(() => pin({ end: 97 }), "pin_invalid", "S9 past the end of the day → pin_invalid");
  await refuses(() => pin({ kind: "always" }), "pin_invalid", "S9 an unknown kind → pin_invalid");
  await refuses(() => pin({ date: past }), "day_locked", "S9 a pin on a past date → day_locked");
  await refuses(() => pin({ user: empB }), "person_not_at_shop", "S9 a person of another shop → person_not_at_shop");
  await refuses(() => pin({ user: empA, kind: "added", positions: [posB] }), "position_not_at_shop", "S9 a position of another shop → position_not_at_shop");
  await refuses(() => pin({ user: empA, kind: "added", positions: [posAOld] }), "position_retired", "S9 a retired position → position_retired");
  const ret = await pin({ retires: added.id });
  check(ret.retired === added.id, "S9 retiring a pin writes a NEW row naming it");
  await refuses(() => pin({ retires: added.id }), "pin_invalid", "S9 a pin retires once → pin_invalid");
  await refuses(() => pin({ retires: ret.id }), "pin_invalid", "S9 a retirement row cannot itself be retired → pin_invalid");
  const live = (await db.query(`select count(*)::int as n from public.schedule_pins p where p.location_id = $1 and p.active
    and not exists (select 1 from public.schedule_pins r where r.retires_id = p.id)`, [SA])).rows[0].n;
  check(live === 1, "S9 one live pin remains (the presence toggle)");
  await db.exec("reset role");
  await refuses(() => db.query("insert into public.schedule_pins (location_id, business_date, user_id, start_q, end_q, kind, active, retires_id, created_by) values ($1, $2, $3, 40, 56, 'presence', false, $4, $5)", [SA, future, moo, added.id, gmA]),
    "23505", "S9 the unique index refuses a second retirement past the writer");
  void SCHEDULE_RPC;
} catch (e) {
  failures++;
  console.error(`FAIL 0274 harness: ${e.stack ?? e}`);
} finally {
  await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0274: ${checks} checks`);
