/**
 * Local Postgres proof of migration 0270 (Scheduling Phase 1, Task 14), SYNTHETIC ROWS ONLY — PGlite,
 * in memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0270.mjs
 *
 * Applies tests/fixtures/scheduling-pglite-stub.sql, the REAL level helpers (0217 assignment_user_level,
 * 0228 assignment_author_level, 0233 toast_link_actor_level — extracted verbatim), then 0270, and proves:
 *   P0  the preflight refuses without the helpers and on a second apply
 *   P1  the four tables: RLS on, no policy; anon / authenticated nothing; service_role exactly SELECT
 *       (direct INSERT / UPDATE / DELETE refused — append-only by grant, the RPCs are the only writers)
 *   P2  every function pins its search_path and is service_role only; the writers are SECURITY DEFINER;
 *       the station_positions (id, location_id) unique index exists
 *   P3  THE SHARED CASE FILE (tests/fixtures/skill-tunables-cases.json) against valid_skill_tunables AND the
 *       table CHECK: every accepted case accepted, every refused case refused (k = 0, building = 0, strong = 1,
 *       building = strong, all-zero, negative, string, 1e308 ×3 …; 3/1/1 and a lone 5 ACCEPTED)
 *   P4  tunables: MoO+ only, one row per scope, before/after; valid A then invalid B → A still live (the
 *       writer refuses invalid_tunables; a direct UPDATE fails the CHECK and leaves A)
 *   P5  shop settings: GM own shop / MoO any; prep position must be an active position of THIS shop (named
 *       refusal, and the composite FK as the backstop); before/after
 *   P6  adjustments: 0.05 steps within ±0.30 (named refusal + CHECK backstop, 0.149 never rounded); reasons
 *       ('other' needs a note); the actor strictly outranks an active member subject; GM own shop, MoO any;
 *       a position of another shop / retired refused; the FK backstop
 *   P7  ratings: [0, 1] in 0.05 steps; the same actor / subject / position rules
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { loadTunablesCases, materializeTunablesCase } from "./skill-tunables-cases.mjs";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0270 = read("supabase/migrations/0270_people_layer.sql");

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

async function base({ helpers = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  if (helpers) await db.exec(HELPERS);
  return db;
}

const TABLES = ["people_shop_settings", "people_skill_adjustments", "people_skill_ratings", "people_skill_tunables"];
const FNS = [
  ["skill_tunable_num(jsonb)", false], ["valid_skill_tunables(jsonb)", false],
  ["people_position_at_shop(uuid, uuid)", true], ["people_skill_reason_ok(text, text)", false],
  ["save_people_shop_settings(uuid, uuid, boolean, uuid)", true],
  ["record_skill_adjustment(uuid, uuid, uuid, uuid, numeric, text, text)", true],
  ["record_skill_rating(uuid, uuid, uuid, uuid, numeric, text, text)", true],
  ["save_skill_tunables(uuid, uuid, jsonb)", true],
];

const db = await base();
try {
  // P0 — the preflight
  {
    const noHelpers = await base({ helpers: false });
    await refuses(() => noHelpers.exec(M0270), "0270: the 0217 / 0228 / 0233 level helpers must exist", "P0 the preflight refuses without the level helpers");
    await noHelpers.close();
  }
  await db.exec(M0270);
  check(true, "0270 applied with every SQL guard");
  {
    const again = await base();
    await again.exec(M0270);
    await refuses(() => again.exec(M0270), "0270: already applied", "P0 a second apply is refused by the preflight");
    await again.close();
  }

  // P1 — tables, RLS, the SELECT ceiling
  for (const t of TABLES) {
    const r = (await db.query("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`public.${t}`])).rows[0];
    const pol = (await db.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1", [t])).rows[0].n;
    check(r?.rls === true && pol === 0, `P1 ${t}: RLS on, no policy`);
    let ok = true;
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const g = (await db.query(`select has_table_privilege('service_role', $1, $2) as s, has_table_privilege('anon', $1, $2) as a,
        has_table_privilege('authenticated', $1, $2) as u`, [`public.${t}`, p])).rows[0];
      if (g.s !== (p === "SELECT") || g.a || g.u) ok = false;
    }
    check(ok, `P1 ${t}: anon/authenticated nothing; service_role exactly SELECT`);
  }

  // P2 — functions and the index
  for (const [fn, definer] of FNS) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s && (!definer || r.d === true),
      `P2 ${fn.split("(")[0]}: search_path pinned, service_role only${definer ? ", SECURITY DEFINER" : ""}`);
  }
  const idx = (await db.query(`select indisunique as u from pg_index where indexrelid = 'public.station_positions_id_location'::regclass`)).rows[0];
  check(idx?.u === true, "P2 station_positions_id_location is a unique index (the composite FK key)");

  // P3 — the SHARED case file, against the function AND the table CHECK
  const cases = loadTunablesCases();
  const caseActor = (await db.query("insert into public.users (role) values ('moo') returning id")).rows[0].id;
  let agreeFn = 0, agreeCheck = 0;
  for (const c of cases) {
    const value = JSON.stringify(materializeTunablesCase(c));
    const fnSays = (await db.query("select public.valid_skill_tunables($1::jsonb) as v", [value])).rows[0].v;
    if (fnSays === c.valid) agreeFn++; else console.error(`FAIL P3 valid_skill_tunables disagrees on "${c.name}": got ${fnSays}`);
    let inserted;
    await db.exec("begin");
    try { await db.query("insert into public.people_skill_tunables (location_id, tunables, updated_by) values (null, $1::jsonb, $2)", [value, caseActor]); inserted = true; }
    catch (e) { inserted = false; if (e.code !== "23514") console.error(`P3 "${c.name}": unexpected error ${e.code} ${e.message}`); }
    await db.exec("rollback");
    if (inserted === c.valid) agreeCheck++; else console.error(`FAIL P3 the CHECK disagrees on "${c.name}": inserted=${inserted}`);
  }
  check(agreeFn === cases.length, `P3 valid_skill_tunables agrees with the shared case file on all ${cases.length} cases`);
  check(agreeCheck === cases.length, `P3 the people_skill_tunables CHECK agrees with the shared case file on all ${cases.length} cases`);
  for (const name of ["k = 0", "building = 0", "strong = 1", "building = strong", "all weights 0", "a negative weight", "a string number",
    "three weights of 1e308 (the sum overflows a double)"]) {
    const c = cases.find((x) => x.name === name);
    check(c && c.valid === false, `P3 the case file refuses: ${name}`);
  }
  for (const name of ["weights 3 / 1 / 1 (no per-weight cap)", "one weight above 1, the others 0"]) {
    const c = cases.find((x) => x.name === name);
    check(c && c.valid === true, `P3 the case file accepts: ${name}`);
  }

  // ── fixtures (superuser) ──
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role, active = true) => id("insert into public.users (role, active) values ($1, $2) returning id", [role, active]);
  const shop = (active = true) => id("insert into public.locations (active) values ($1) returning id", [active]);
  const member = (u, l, active = true) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, $3)", [u, l, active]);
  const station = (l) => id("insert into public.stations (location_id) values ($1) returning id", [l]);
  const position = (s, l, name, active = true) => id("insert into public.station_positions (station_id, location_id, name, active) values ($1, $2, $3, $4) returning id", [s, l, name, active]);
  const SA = await shop(), SB = await shop(), SX = await shop(false);
  const owner = await user("owner"), moo = await user("moo"), mooOff = await user("moo", false);
  const gmA = await user("gm"), gmB = await user("gm"), gm2A = await user("gm"), agmA = await user("agm"), smmA = await user("social_media_mgr");
  const empA = await user("employee"), empB = await user("employee"), empOff = await user("employee", false), newA = await user("hired_not_yet_worked");
  for (const [u, l] of [[gmA, SA], [gmB, SB], [gm2A, SA], [agmA, SA], [smmA, SA], [empA, SA], [empB, SB], [empOff, SA], [newA, SA], [moo, SA]]) await member(u, l);
  const stA = await station(SA), stB = await station(SB);
  const posA = await position(stA, SA, "Prep"), posA2 = await position(stA, SA, "Prep/Dishwasher"), posAOld = await position(stA, SA, "Old", false);
  const posB = await position(stB, SB, "Prep");

  const rpc = async (fn, args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
  const count = async (t, where = "true") => (await db.query(`select count(*)::int as n from public.${t} where ${where}`)).rows[0].n;
  const T = (patch = {}) => JSON.stringify({ ...materializeTunablesCase({ set: {} }), ...patch });

  // P1 (cont.) — direct writes refused for service_role
  await db.exec("set role service_role");
  await refuses(() => db.query("insert into public.people_skill_adjustments (user_id, location_id, position_id, delta, reason_code, actor_id) values ($1, $2, $3, 0.1, 'correction', $4)", [empA, SA, posA, gmA]),
    "42501", "P1 service_role cannot INSERT an adjustment directly");
  await refuses(() => db.query("update public.people_skill_ratings set rating = 0.5"), "42501", "P1 service_role cannot UPDATE a rating");
  await refuses(() => db.query("delete from public.people_skill_adjustments"), "42501", "P1 service_role cannot DELETE an adjustment");
  await refuses(() => db.query("insert into public.people_skill_tunables (tunables, updated_by) values ($1::jsonb, $2)", [T(), moo]), "42501", "P1 service_role cannot INSERT tunables directly");
  await refuses(() => db.query("update public.people_shop_settings set pm_v2 = true"), "42501", "P1 service_role cannot UPDATE shop settings directly");

  // P4 — tunables
  const saveT = (actor, loc, t) => rpc("save_skill_tunables", [actor, loc, t]);
  await refuses(() => saveT(gmA, null, T()), "role_insufficient", "P4 a GM cannot save tunables (MoO+ only)");
  await refuses(() => saveT(smmA, null, T()), "role_insufficient", "P4 the social media manager cannot save tunables");
  await refuses(() => saveT(mooOff, null, T()), "role_insufficient", "P4 a deactivated MoO is refused");
  await refuses(() => saveT(moo, SX, T()), "location_access_denied", "P4 an inactive shop is refused");
  await refuses(() => saveT(null, null, T()), "invalid_payload", "P4 no actor → invalid_payload");
  const A = T({ priorStrength: 8 });
  const first = await saveT(moo, null, A);
  check(first.before === null && first.after.priorStrength === 8, "P4 MoO saves company set A (before = null, after = A)");
  await refuses(() => saveT(moo, null, T({ priorStrength: 0 })), "invalid_tunables", "P4 invalid set B (k = 0) → invalid_tunables");
  await refuses(() => saveT(owner, null, T({ weights: { pm: 1e308, closeOnTime: 1e308, prepYield: 1e308 } })), "invalid_tunables", "P4 invalid set B (1e308 ×3) → invalid_tunables");
  const sorted = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  const live = async (where) => (await db.query(`select tunables from public.people_skill_tunables where ${where}`)).rows.map((r) => JSON.stringify(sorted(r.tunables)));
  const same = (a, b) => a === JSON.stringify(sorted(JSON.parse(b)));
  check(same((await live("location_id is null"))[0], A), "P4 after the refusals, set A is still live");
  await db.exec("reset role");
  await refuses(() => db.query("update public.people_skill_tunables set tunables = $1::jsonb where location_id is null", [T({ bands: { building: 0.6, strong: 0.6 } })]),
    "23514", "P4 a bad set that reaches the table fails the CHECK (single statement)");
  check(same((await live("location_id is null"))[0], A), "P4 … and set A is still live");
  await db.exec("set role service_role");
  const second = await saveT(owner, null, T({ priorStrength: 9 }));
  check(second.before.priorStrength === 8 && second.after.priorStrength === 9 && second.id === first.id && (await count("people_skill_tunables", "location_id is null")) === 1,
    "P4 a second company save updates the ONE company row and returns before/after");
  const shopRow = await saveT(moo, SA, T({ windowDays: 30 }));
  check(shopRow.before === null && (await count("people_skill_tunables")) === 2, "P4 a shop override is its own row (one per scope)");
  await db.exec("reset role");
  await refuses(() => db.query("insert into public.people_skill_tunables (location_id, tunables, updated_by) values (null, $1::jsonb, $2)", [T(), moo]),
    "23505", "P4 a second company row is refused by the one-per-scope index");
  await db.exec("set role service_role");

  // P5 — shop settings
  const saveS = (actor, loc, pmV2, prep) => rpc("save_people_shop_settings", [actor, loc, pmV2, prep]);
  await refuses(() => saveS(agmA, SA, false, posA), "role_insufficient", "P5 an AGM cannot change people settings");
  await refuses(() => saveS(smmA, SA, false, posA), "role_insufficient", "P5 the social media manager cannot");
  await refuses(() => saveS(gmB, SA, false, posA), "location_access_denied", "P5 a GM of another shop cannot");
  await refuses(() => saveS(gmA, SA, false, posB), "position_not_at_shop", "P5 a prep position of ANOTHER shop → position_not_at_shop");
  await refuses(() => saveS(gmA, SA, false, posAOld), "position_retired", "P5 a retired prep position → position_retired");
  await refuses(() => saveS(gmA, SA, null, posA), "invalid_payload", "P5 a null switch → invalid_payload");
  const s1 = await saveS(gmA, SA, false, posA);
  check(s1.before === null && s1.after.prep_position_id === posA && s1.after.pm_v2 === false, "P5 GM sets their shop's prep position (before = null)");
  const s2 = await saveS(moo, SA, false, null);
  check(s2.before.prep_position_id === posA && s2.after.prep_position_id === null && (await count("people_shop_settings")) === 1, "P5 MoO clears it; one row per shop; before/after");
  check((await saveS(moo, SB, false, posB)).after.prep_position_id === posB, "P5 MoO sets another shop");
  check((await db.query("select pm_v2 from public.people_shop_settings where location_id = $1", [SB])).rows[0].pm_v2 === false, "P5 pm_v2 stays as written (default off)");
  await db.exec("reset role");
  await refuses(() => db.query("update public.people_shop_settings set prep_position_id = $1 where location_id = $2", [posB, SA]),
    "23503", "P5 the composite FK refuses another shop's position even past the writer");
  // Astra chunk E #6: one shop's saves serialise on a per-shop advisory lock taken BEFORE the read.
  {
    const src = (await db.query("select prosrc from pg_proc where oid = 'public.save_people_shop_settings(uuid, uuid, boolean, uuid)'::regprocedure")).rows[0].prosrc;
    const lockAt = src.indexOf("pg_advisory_xact_lock(hashtextextended('people-shop-settings/' || p_location::text, 0))");
    check(lockAt > -1 && lockAt < src.indexOf("select * into v_old"), "P5 the shop-settings writer locks the shop before it reads (source order)");
    await db.exec("begin");
    await db.exec("set local role service_role");
    await saveS(gmA, SA, false, null);
    await db.exec("reset role");
    const held = (await db.query("select count(*)::int as n from pg_locks where locktype = 'advisory' and granted")).rows[0].n;
    await db.exec("commit");
    check(held >= 1, "P5 … and the lock is really held inside the writer's transaction (pg_locks)");
  }
  // Astra chunk E #2: a position counts only when its STATION is active too.
  {
    const stOff = await station(SA);
    await db.query("update public.stations set active = false where id = $1", [stOff]);
    const posOff = await position(stOff, SA, "Prep (old station)");
    await db.exec("set role service_role");
    await refuses(() => saveS(gmA, SA, false, posOff), "position_retired", "P5 a position under an INACTIVE station is retired (prep position)");
    await refuses(() => rpc("record_skill_adjustment", [gmA, SA, empA, posOff, 0.1, "observed_on_floor", null]), "position_retired", "P6 … and for an adjustment");
    await refuses(() => rpc("record_skill_rating", [gmA, SA, newA, posOff, 0.5, "observed_on_floor", null]), "position_retired", "P7 … and for a rating");
    await db.exec("reset role");
  }

  // P6 — adjustments
  await db.exec("set role service_role");
  const adj = (actor, loc, u, pos, delta, reason = "observed_on_floor", note = null) => rpc("record_skill_adjustment", [actor, loc, u, pos, delta, reason, note]);
  check(typeof (await adj(gmA, SA, empA, posA, 0.1)).id === "string", "P6 GM adjusts an employee of their shop by +0.10");
  check(typeof (await adj(gmA, SA, empA, posA, -0.3)).id === "string", "P6 −0.30 is accepted (the clamp edge)");
  check(typeof (await adj(gmA, SA, empA, posA2, 0.3, "other", "covered the whole rush")).id === "string", "P6 +0.30 with 'other' and a note");
  check(typeof (await adj(moo, SB, empB, posB, 0.05)).id === "string", "P6 MoO adjusts at any shop");
  check(typeof (await adj(gmA, SA, newA, posA, 0)).id === "string", "P6 a zero adjustment (a reset) is a row");
  await refuses(() => adj(gmA, SA, empA, posA, 0.35), "invalid_adjustment", "P6 +0.35 → invalid_adjustment");
  await refuses(() => adj(gmA, SA, empA, posA, 0.149), "invalid_adjustment", "P6 0.149 is refused, never rounded to 0.15");
  await refuses(() => adj(gmA, SA, empA, posA, 0.12), "invalid_adjustment", "P6 0.12 (not a 0.05 step) → invalid_adjustment");
  await refuses(() => adj(gmA, SA, empA, posA, 0.1, "other", "   "), "invalid_reason", "P6 'other' with a blank note → invalid_reason");
  await refuses(() => adj(gmA, SA, empA, posA, 0.1, "because"), "invalid_reason", "P6 an unknown reason → invalid_reason");
  await refuses(() => adj(gmA, SA, empA, posA, 0.1, "correction", "x".repeat(501)), "invalid_reason", "P6 a 501-character note → invalid_reason");
  await refuses(() => adj(gmA, SA, gm2A, posA, 0.1), "role_insufficient", "P6 a GM cannot adjust another GM (strictly outrank)");
  await refuses(() => adj(gmA, SA, moo, posA, 0.1), "role_insufficient", "P6 a GM cannot adjust a MoO");
  await refuses(() => adj(agmA, SA, empA, posA, 0.1), "role_insufficient", "P6 an AGM cannot adjust");
  await refuses(() => adj(smmA, SA, empA, posA, 0.1), "role_insufficient", "P6 the social media manager cannot adjust");
  await refuses(() => adj(gmB, SA, empA, posA, 0.1), "location_access_denied", "P6 a GM of another shop cannot adjust here");
  await refuses(() => adj(gmA, SA, empB, posA, 0.1), "location_access_denied", "P6 the subject must be an active member of the shop");
  await refuses(() => adj(gmA, SA, empOff, posA, 0.1), "assignee_unavailable", "P6 a deactivated subject is refused");
  await refuses(() => adj(gmA, SA, empA, posB, 0.1), "position_not_at_shop", "P6 a position of another shop → position_not_at_shop");
  await refuses(() => adj(gmA, SA, empA, "00000000-0000-4000-8000-000000000000", 0.1), "position_not_at_shop", "P6 a nonexistent position → position_not_at_shop");
  await refuses(() => adj(gmA, SA, empA, posAOld, 0.1), "position_retired", "P6 a retired position → position_retired");
  await refuses(() => adj(gmA, SA, empA, posA, null), "invalid_payload", "P6 a null delta → invalid_payload");
  check((await count("people_skill_adjustments")) === 5, "P6 five adjustment rows (append-only: every act is a row)");
  const noteRow = (await db.query("select reason_note from public.people_skill_adjustments where reason_code = 'other'")).rows[0];
  check(noteRow.reason_note === "covered the whole rush", "P6 the note is kept (trimmed)");
  await db.exec("reset role");
  await refuses(() => db.query("insert into public.people_skill_adjustments (user_id, location_id, position_id, delta, reason_code, actor_id) values ($1, $2, $3, 0.1, 'correction', $4)", [empA, SA, posB, gmA]),
    "23503", "P6 the composite FK refuses another shop's position past the writer");
  await refuses(() => db.query("insert into public.people_skill_adjustments (user_id, location_id, position_id, delta, reason_code, actor_id) values ($1, $2, $3, 0.149, 'correction', $4)", [empA, SA, posA, gmA]),
    "23514", "P6 the step CHECK refuses 0.149 past the writer");
  await refuses(() => db.query("insert into public.people_skill_adjustments (user_id, location_id, position_id, delta, reason_code, actor_id) values ($1, $2, $3, 0.1, 'other', $4)", [empA, SA, posA, gmA]),
    "23514", "P6 the CHECK refuses 'other' without a note past the writer");

  // P7 — ratings
  await db.exec("set role service_role");
  const rate = (actor, loc, u, pos, r, reason = "training_completed", note = null) => rpc("record_skill_rating", [actor, loc, u, pos, r, reason, note]);
  check(typeof (await rate(gmA, SA, newA, posA, 0.8)).id === "string", "P7 GM rates a new hire 0.80");
  check(typeof (await rate(gmA, SA, newA, posA, 0)).id === "string" && typeof (await rate(gmA, SA, newA, posA, 1)).id === "string", "P7 0 and 1 are accepted");
  await refuses(() => rate(gmA, SA, newA, posA, 1.05), "invalid_rating", "P7 1.05 → invalid_rating");
  await refuses(() => rate(gmA, SA, newA, posA, -0.05), "invalid_rating", "P7 −0.05 → invalid_rating");
  await refuses(() => rate(gmA, SA, newA, posA, 0.33), "invalid_rating", "P7 0.33 → invalid_rating");
  await refuses(() => rate(gmA, SA, gm2A, posA, 0.5), "role_insufficient", "P7 a GM cannot rate another GM");
  await refuses(() => rate(gmA, SA, newA, posB, 0.5), "position_not_at_shop", "P7 a position of another shop → position_not_at_shop");
  await refuses(() => rate(agmA, SA, newA, posA, 0.5), "role_insufficient", "P7 an AGM cannot rate");
  check((await count("people_skill_ratings")) === 3, "P7 three rating rows (the latest wins at read time)");
  await db.exec("reset role");
  await refuses(() => db.query("insert into public.people_skill_ratings (user_id, location_id, position_id, rating, reason_code, actor_id) values ($1, $2, $3, 0.42, 'correction', $4)", [newA, SA, posA, gmA]),
    "23514", "P7 the step CHECK refuses 0.42 past the writer");
} catch (e) {
  failures++;
  console.error(`FAIL 0270 harness: ${e.stack ?? e}`);
} finally {
  await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0270: ${checks} checks`);
