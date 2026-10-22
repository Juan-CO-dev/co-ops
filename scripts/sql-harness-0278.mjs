/**
 * Local Postgres proof of migration 0278 (the guarded person-settings writers), SYNTHETIC ROWS ONLY — PGlite, in memory.
 * CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0278.mjs
 *
 * THE EXECUTION CONTRACT (as sql-harness-0274.mjs): the stub (Supabase roles + default privileges), the REAL level helpers,
 * the REAL 0270, the 0272 posture, the REAL 0274, then 0278. Every writer is called `set role service_role` with the EXACT
 * named arguments the lib sends — the objects come from lib/scheduling/rpc-args-shared.ts.
 *
 *   S0  the preflight refuses without 0274 and on a second apply
 *   S1  the four functions: SECURITY DEFINER, search_path pinned, EXECUTE for service_role only (anon / authenticated refused)
 *   S2  the subject rule in SQL (the twin of personSettingsSubjectRefusal) on all three writers: a GM never sets their own
 *       or another GM's or the MoO's settings, but does an AGM's and a shift lead's; an AGM with edit access never an AGM;
 *       MoO+ anyone
 *   S3  the expected head (save_schedule_person_settings): null with no row, the latest id, and every stale id refused
 *       person_settings_moved with nothing written
 *   S4  the merge (merge_schedule_person_positions): ONLY the changed fields; the list rules (no primary → cleared, no
 *       secondary → [primary], else the tail kept behind them); a malformed change refused invalid_payload; a position of
 *       another shop refused by 0274's own check
 *   S5  INTERLEAVED writes: two requests read the same head; whichever lands second — a full-row save OR a picker merge —
 *       is refused person_settings_moved (Astra BC-007/042: no blind merge), so neither erases nor corrupts the first;
 *       Astra's case: A gives an FOH employee Register while B makes them BOH → A refused, never BOH + Register
 */
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

const db = await base();
async function rpc(call) {
  // Historical migration harness: works_as first exists in 0280.
  const keys = Object.keys(call.args).filter((key) => key !== "p_works_as");
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
  // S0 — the preflight
  {
    const no0274 = await base({ m0274: false });
    await refuses(() => no0274.exec(M0278), "0278: 0274 (schedule_person_settings + record_schedule_person_settings) must be applied first", "S0 the preflight refuses without 0274");
    await no0274.close();
  }
  await db.exec(M0278);
  check(true, "0278 applied with every SQL guard");
  {
    const again = await base();
    await again.exec(M0278);
    await refuses(() => again.exec(M0278), "0278: already applied", "S0 a second apply is refused by the preflight");
    await again.close();
  }

  // S1 — the functions' posture
  for (const fn of FNS) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(r.d === true && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s,
      `S1 ${fn.split("(")[0]}: SECURITY DEFINER, search_path pinned, service_role only`);
  }
  const pub = (await db.query(`select count(*)::int as n from information_schema.routine_privileges where routine_schema = 'public'
    and routine_name in ('schedule_person_subject_check', 'record_schedule_person_settings', 'save_schedule_person_settings', 'merge_schedule_person_positions')
    and grantee in ('PUBLIC', 'anon', 'authenticated')`)).rows[0].n;
  check(pub === 0, "S1 no PUBLIC / anon / authenticated EXECUTE on any 0278 function");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await refuses(() => db.query("select public.merge_schedule_person_positions(p_actor => null, p_location => null, p_user => null, p_expected => null, p_changes => null)"), "42501", `S1 ${role} cannot EXECUTE merge_schedule_person_positions`);
    await db.exec("reset role");
  }

  // ── fixtures (superuser) ──
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role) => id("insert into public.users (role, active) values ($1, true) returning id", [role]);
  const shop = () => id("insert into public.locations (active) values (true) returning id");
  const member = (u, l) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, true)", [u, l]);
  const SA = await shop(), SB = await shop();
  const moo = await user("moo"), gmA = await user("gm"), gmA2 = await user("gm"), agmA = await user("agm"), agmA2 = await user("agm"), slA = await user("shift_lead");
  const empA = await user("employee"), empC = await user("employee");
  for (const u of [gmA, gmA2, agmA, agmA2, slA, empA, empC, moo]) await member(u, SA);
  const stA = await id("insert into public.stations (location_id, active) values ($1, true) returning id", [SA]);
  const stB = await id("insert into public.stations (location_id, active) values ($1, true) returning id", [SB]);
  const pos = (s, l, name) => id("insert into public.station_positions (station_id, location_id, name, active) values ($1, $2, $3, true) returning id", [s, l, name]);
  const REG = await pos(stA, SA, "Register"), WALK = await pos(stA, SA, "Walk-ins"), EXPO = await pos(stA, SA, "Expeditor"), BOI = await pos(stA, SA, "Crunchy Boi");
  const posB = await pos(stB, SB, "Register");
  await rpc(saveShopSettingsCall({ actorId: moo, locationId: SA, enabled: true, estimatedHourlyCents: 1840, estimatedSalariedWeeklyCents: null, agmAccess: "edit" }));
  const fields = (o = {}) => ({ workType: o.workType ?? "foh", alsoAllowed: o.alsoAllowed ?? [], leaderSetting: o.leader ?? null, coverPositions: o.cover ?? [],
    softMinH: o.softMin ?? null, softMaxH: o.softMax ?? null, fullTime: o.fullTime ?? false, fullTimeMinH: o.fullTimeMin ?? null, rosterInclude: o.rosterInclude ?? null });
  const record = (actor, u, o) => rpc(recordPersonSettingsCall({ actorId: actor, locationId: SA, userId: u, ...fields(o) }));
  const save = (actor, u, expectedId, o) => rpc(savePersonSettingsCall({ actorId: actor, locationId: SA, userId: u, expectedId, ...fields(o) }));
  // The picks' expected head: by default the CURRENT latest row (an unmoved head); S5 passes a stale one explicitly.
  const merge = async (actor, u, changes, expectedId) => rpc(mergePersonPositionsCall({ actorId: actor, locationId: SA, userId: u,
    expectedId: expectedId === undefined ? ((await latest(u))?.id ?? null) : expectedId, changes }));
  const latest = async (u) => (await db.query(`select * from public.schedule_person_settings where location_id = $1 and user_id = $2
    order by created_at desc, id desc limit 1`, [SA, u])).rows[0];
  const count = async () => (await db.query("select count(*)::int as n from public.schedule_person_settings")).rows[0].n;

  // S2 — the subject rule, on all three writers
  for (const [label, w] of [["record", (a, u) => record(a, u)], ["save", async (a, u) => save(a, u, (await latest(u))?.id ?? null)], ["merge", (a, u) => merge(a, u, { workType: "foh" })]]) {
    await refuses(() => w(gmA, gmA), "schedule_forbidden", `S2 ${label}: a GM never sets their OWN settings`);
    await refuses(() => w(gmA, gmA2), "schedule_forbidden", `S2 ${label}: a GM never sets another GM's settings`);
    await refuses(() => w(gmA, moo), "schedule_forbidden", `S2 ${label}: a GM never sets the MoO's settings`);
    await refuses(() => w(agmA, agmA2), "schedule_forbidden", `S2 ${label}: an AGM with edit access never sets another AGM's settings`);
    await refuses(() => w(agmA, agmA), "schedule_forbidden", `S2 ${label}: an AGM never sets their own settings`);
    check(typeof (await w(gmA, agmA)).id === "string", `S2 ${label}: a GM sets an AGM's settings`);
    check(typeof (await w(agmA, slA)).id === "string", `S2 ${label}: an AGM with edit access sets a shift lead's settings`);
    check(typeof (await w(moo, gmA)).id === "string", `S2 ${label}: the MoO sets a GM's settings (MoO+ unchanged)`);
  }

  // S3 — the expected head
  const s1 = await save(gmA, empA, null, { cover: [REG] });
  check(typeof s1.id === "string", "S3 no row yet: p_expected null saves");
  const before = await count();
  await refuses(() => save(gmA, empA, null, { cover: [WALK] }), "person_settings_moved", "S3 a row exists: p_expected null → person_settings_moved");
  const s2 = await save(gmA, empA, s1.id, { cover: [WALK] });
  check(typeof s2.id === "string", "S3 p_expected = the latest id saves");
  await refuses(() => save(gmA, empA, s1.id, { cover: [EXPO] }), "person_settings_moved", "S3 a stale p_expected (an older row) → person_settings_moved");
  check(await count() === before + 1, "S3 the refused saves wrote nothing");

  // S4 — the merge: only what changed
  await record(gmA, empC, { workType: "boh", alsoAllowed: ["foh"], leader: "closes", cover: [REG, WALK, EXPO], softMin: 20, softMax: 32, fullTime: true, fullTimeMin: 30 });
  await merge(gmA, empC, { primary: BOI });
  let r = await latest(empC);
  check(r.work_type === "boh" && JSON.stringify(r.also_allowed) === JSON.stringify(["foh"]) && r.leader_setting === "closes" && Number(r.soft_min_h) === 20
    && Number(r.soft_max_h) === 32 && r.full_time === true && Number(r.full_time_min_h) === 30, "S4 a primary change keeps every other field of the latest row");
  check(JSON.stringify(r.cover_positions) === JSON.stringify([BOI, WALK, EXPO]), "S4 primary changed, the latest secondary and tail kept: [new, secondary, …tail]");
  await merge(gmA, empC, { secondary: EXPO });
  check(JSON.stringify((await latest(empC)).cover_positions) === JSON.stringify([BOI, EXPO]), "S4 a secondary chosen from the tail moves up; the replaced secondary is dropped");
  await merge(gmA, empC, { workType: "foh" });
  r = await latest(empC);
  check(r.work_type === "foh" && JSON.stringify(r.cover_positions) === JSON.stringify([BOI, EXPO]), "S4 a work-type-only change keeps the list untouched");
  await merge(gmA, empC, { secondary: REG });
  await record(gmA, empC, { workType: "foh", cover: [BOI, REG, WALK, EXPO], fullTime: true });
  await merge(gmA, empC, { secondary: null });
  check(JSON.stringify((await latest(empC)).cover_positions) === JSON.stringify([BOI]), "S4 no secondary → [primary] (the tail cleared, never promoted)");
  await merge(gmA, empC, { primary: null });
  check(JSON.stringify((await latest(empC)).cover_positions) === JSON.stringify([]), "S4 no primary → the list cleared");
  for (const [bad, what] of [[{}, "an empty change"], [{ softMinH: 4 }, "an unknown key"], [{ workType: "chef" }, "an unknown work type"], [{ primary: "not-a-uuid" }, "a primary that is not a uuid"], [{ primary: 7 }, "a primary that is not a string"]]) {
    await refuses(() => merge(gmA, empC, bad), "invalid_payload", `S4 ${what} → invalid_payload`);
  }
  await refuses(() => merge(gmA, empC, { primary: posB }), "position_not_at_shop", "S4 a position of another shop → position_not_at_shop (0274's check)");

  // S5 — INTERLEAVED writes: A and B read the same head; B writes first; A is refused, whatever kind of write it is.
  await record(gmA, empA, { workType: "foh", cover: [REG, WALK], fullTime: false });
  const head = (await latest(empA)).id;              // request A reads the head
  const headB = (await latest(empA)).id;             // request B reads the SAME head
  check(head === headB, "S5 both requests read the same head");
  await merge(agmA, empA, { workType: "boh" }, headB); // B lands first (a picker change on its head)
  await refuses(() => save(gmA, empA, head, { workType: "foh", cover: [EXPO], fullTime: true }), "person_settings_moved",
    "S5 A's full-row save based on the head B superseded → person_settings_moved (B's change survives)");
  await refuses(() => merge(gmA, empA, { primary: EXPO }, head), "person_settings_moved",
    "S5 A's picker merge based on the head B superseded → person_settings_moved (no blind merge)");
  r = await latest(empA);
  check(r.work_type === "boh" && JSON.stringify(r.cover_positions) === JSON.stringify([REG, WALK]), "S5 only B's change stands; A wrote nothing");
  await merge(gmA, empA, { primary: EXPO }, r.id);    // A retries on the fresh head: merged
  check(JSON.stringify((await latest(empA)).cover_positions) === JSON.stringify([EXPO, WALK]) && (await latest(empA)).work_type === "boh", "S5 A's retry on the new head merges: both changes stand");
  // Astra's case: an FOH employee; A adds Register (valid for FOH), B makes them BOH (valid alone) — together invalid.
  await record(gmA, empC, { workType: "foh", cover: [], fullTime: false });
  const baseC = (await latest(empC)).id;
  await merge(agmA, empC, { workType: "boh" }, baseC);  // B
  await refuses(() => merge(gmA, empC, { primary: REG }, baseC), "person_settings_moved", "S5 Astra's FOH/BOH case: A's Register on the old head is refused");
  r = await latest(empC);
  check(r.work_type === "boh" && JSON.stringify(r.cover_positions) === JSON.stringify([]), "S5 never BOH + Register: the stored row is B's alone");
} catch (e) {
  failures++;
  console.error("FAIL harness threw:", e);
} finally {
  await db.close();
}
if (failures > 0) { console.error(`FAILED 0278: ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASS 0278: ${checks} checks`);
