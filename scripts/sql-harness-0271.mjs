/**
 * Local Postgres proof of migration 0271 (Scheduling Phase 1, Task 18), SYNTHETIC ROWS ONLY — PGlite, in
 * memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0271.mjs
 *
 * Applies tests/fixtures/scheduling-pglite-stub.sql, then (scripts/pm-v2-pglite-base.mjs) the REAL 0072 + 0073
 * PM tables, the REAL 0267, the REAL 0217 / 0228 / 0233 level helpers and the REAL 0270, then 0271, and proves:
 *   P0  the preflight: refuses on the PRE-0267 posture (its first statement), refuses without 0270, refuses a
 *       second apply
 *   P1  the DB decides no read visibility (the lib does), but every write by a non-author is `not_copy_author`;
 *       the social media manager, a level-3 employee and a non-member cannot open a copy (`forbidden`)
 *   P1-1 THE SHARED CASE FILE tests/fixtures/pm-grade-target-cases.json against save_pm_copy_grade — (a) another
 *       shop's position, (b) a retired one, (c) a nonexistent UUID, (d) not worked, (e) added by THIS copy vs by
 *       another manager's copy, (f) another shop's criterion, (g) another position's criterion, (h) shared +
 *       null — plus the composite-FK backstop by direct INSERT as owner
 *   LC  THE SHARED LIFECYCLE FILE tests/fixtures/pm-copy-lifecycle-cases.json against the RPC guards, and the
 *       walk: open → done → a write is copy_done → reopen → accepted → done → submit seals; reopen on an open
 *       copy is copy_not_done; nothing writes after the seal
 *   P2  a write after submit is report_already_submitted
 *   P3  a second submit returns changed:false and moves nothing
 *   P4  submit seals every copy (open and done) and defaults observed_to to the submit instant
 *   P5  a criterion from another shop or another position is refused (in P1-1)
 *   P6  supersede keeps ONE live row and keeps history (grades, notes, added positions); a blank note clears
 *   P7  format defaults to v1, is frozen once set, and a v1 day refuses every v2 RPC (format_mismatch)
 *   P8  the ceilings (pm_criteria SELECT/INSERT/UPDATE; copies, grades, notes, positions SELECT only), every
 *       function pinned and service_role only (the internal helpers not even that), and the pm_reports /
 *       pm_employee_evals grant manifests unchanged
 *   P9  no 0271 function references notifications
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { applyPmV1Tables, applyPmV2Base, LEVEL_HELPERS_SQL, M0271 } from "./pm-v2-pglite-base.mjs";

const STUB = readFileSync("tests/fixtures/scheduling-pglite-stub.sql", "utf8");
const GRADE_CASES = JSON.parse(readFileSync("tests/fixtures/pm-grade-target-cases.json", "utf8")).cases;
const LIFECYCLE_CASES = JSON.parse(readFileSync("tests/fixtures/pm-copy-lifecycle-cases.json", "utf8")).cases;

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}
async function errorOf(fn) {
  try { await fn(); return null; } catch (e) { return e.message; }
}

const TABLES = { pm_criteria: ["SELECT", "INSERT", "UPDATE"], pm_report_copies: ["SELECT"], pm_copy_grades: ["SELECT"], pm_copy_notes: ["SELECT"], pm_copy_positions: ["SELECT"] };
const RPCS = [
  "open_pm_copy(uuid, uuid)", "save_pm_copy_grade(uuid, uuid, uuid, uuid, uuid, text)", "save_pm_copy_note(uuid, uuid, uuid, uuid, text)",
  "add_pm_copy_position(uuid, uuid, uuid, uuid, text)", "set_pm_copy_window(uuid, uuid, timestamptz, timestamptz)",
  "mark_pm_copy_done(uuid, uuid)", "reopen_pm_copy(uuid, uuid)", "submit_pm_day_v2(uuid, uuid)",
];
const INTERNAL = ["pm_v2_actor_ok(uuid, uuid)", "pm_v2_subject_ok(uuid, uuid)", "pm_copy_lock(uuid, uuid, text)",
  "pm_subject_worked_position(uuid, uuid, uuid)", "pm_reports_format_frozen()"];

async function fresh({ with0267 = true, with0270 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  if (with0270) await applyPmV2Base(db, { with0267 });
  else { await applyPmV1Tables(db); await db.exec(readFileSync("supabase/migrations/0267_pm_evals_privacy.sql", "utf8")); await db.exec(LEVEL_HELPERS_SQL); }
  return db;
}

const db = await fresh();
try {
  // ── P0 the preflight ──
  {
    const pre = await fresh({ with0267: false });
    await refuses(() => pre.exec(M0271), "0271: requires 0267_pm_evals_privacy", "P0 on the PRE-0267 posture the first statement refuses");
    await pre.exec("rollback");
    check((await pre.query("select count(*)::int as n from information_schema.columns where table_name = 'pm_reports' and column_name = 'format'")).rows[0].n === 0,
      "P0 … and nothing was created (no format column)");
    await pre.close();
    const no270 = await fresh({ with0270: false });
    await refuses(() => no270.exec(M0271), "0271: requires 0270", "P0 without 0270 the preflight refuses");
    await no270.close();
    const first = M0271.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("--"));
    check(first[0] === "begin;" && /^do \$\$/.test(first[1] ?? "") && M0271.indexOf("0271: requires 0267_pm_evals_privacy") < M0271.indexOf("create "),
      "P0 the 0267 posture check is the FIRST statement after begin");
  }
  const reportGrantsBefore = (await db.query(`select grantee || ':' || privilege_type as g from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('pm_reports', 'pm_employee_evals') order by table_name, grantee, privilege_type`)).rows.map((r) => r.g).join(",");
  await db.exec(M0271);
  check(true, "0271 applied with every SQL guard");
  {
    const again = await fresh();
    await again.exec(M0271);
    await refuses(() => again.exec(M0271), "0271: already applied", "P0 a second apply is refused");
    await again.close();
  }

  // ── P8 ceilings, functions, manifests ──
  for (const [t, allowed] of Object.entries(TABLES)) {
    const r = (await db.query("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`public.${t}`])).rows[0];
    const pol = (await db.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1", [t])).rows[0].n;
    let ok = r?.rls === true && pol === 0;
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const g = (await db.query(`select has_table_privilege('service_role', $1, $2) as s, has_table_privilege('anon', $1, $2) as a,
        has_table_privilege('authenticated', $1, $2) as u`, [`public.${t}`, p])).rows[0];
      if (g.s !== allowed.includes(p) || g.a || g.u) ok = false;
    }
    check(ok, `P8 ${t}: RLS on, no policy, PostgREST nothing, service_role exactly ${allowed.join("/")}`);
  }
  for (const fn of RPCS) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(r && r.d === true && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s,
      `P8 ${fn.split("(")[0]}: SECURITY DEFINER, search_path pinned, service_role only`);
  }
  for (const fn of INTERNAL) {
    const r = (await db.query(`select p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(r && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && !r.s,
      `P8 ${fn.split("(")[0]}: internal — pinned, callable only from inside the RPCs`);
  }
  const reportGrantsAfter = (await db.query(`select grantee || ':' || privilege_type as g from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('pm_reports', 'pm_employee_evals') order by table_name, grantee, privilege_type`)).rows.map((r) => r.g).join(",");
  check(reportGrantsBefore === reportGrantsAfter && reportGrantsAfter.includes("service_role:UPDATE") && !/anon|authenticated|PUBLIC/.test(reportGrantsAfter),
    "P8 the pm_reports and pm_employee_evals grants are byte-identical before and after (0267's manifest)");
  for (const idx of ["pm_reports_id_location", "pm_copy_grades_one_live", "pm_copy_notes_one_live", "pm_copy_positions_one_live", "pm_criteria_one_active_label"]) {
    const r = (await db.query("select indisunique as u from pg_index where indexrelid = $1::regclass", [`public.${idx}`])).rows[0];
    check(r?.u === true, `P8 ${idx} is a unique index`);
  }

  // ── P9 no notifications ──
  const bodies = (await db.query(`select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('open_pm_copy','save_pm_copy_grade','save_pm_copy_note','add_pm_copy_position','set_pm_copy_window',
      'mark_pm_copy_done','reopen_pm_copy','submit_pm_day_v2','pm_v2_actor_ok','pm_v2_subject_ok','pm_copy_lock','pm_subject_worked_position')`)).rows;
  check(bodies.length === 12 && bodies.every((b) => !/notification/i.test(b.prosrc)) && !/notification/i.test(M0271.replace(/^--.*$/gm, "")),
    "P9 no 0271 function (and no 0271 statement) references notifications");

  // ── fixtures (superuser) ──
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role, active = true) => id("insert into public.users (role, active) values ($1, $2) returning id", [role, active]);
  const shop = () => id("insert into public.locations default values returning id");
  const member = (u, l) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, true)", [u, l]);
  const station = (l) => id("insert into public.stations (location_id) values ($1) returning id", [l]);
  const position = (s, l, name, active = true) => id("insert into public.station_positions (station_id, location_id, name, active) values ($1, $2, $3, $4) returning id", [s, l, name, active]);
  const criterion = (l, p, label, active = true) => id("insert into public.pm_criteria (location_id, position_id, label, active, created_by) values ($1, $2, $3, $4, $5) returning id", [l, p, label, active, owner]);
  const SA = await shop(), SB = await shop();
  const owner = await user("owner"), gmA = await user("gm"), gmB = await user("gm"), khA = await user("key_holder"), slA = await user("shift_lead");
  const smmA = await user("social_media_mgr"), empA = await user("employee"), empGone = await user("employee", false);
  for (const [u, l] of [[gmA, SA], [gmB, SB], [khA, SA], [slA, SA], [smmA, SA], [empA, SA], [empGone, SA]]) await member(u, l);
  const stA = await station(SA), stB = await station(SB);
  const posP = await position(stA, SA, "Expeditor"), posQ = await position(stA, SA, "Walk-ins"), posR = await position(stA, SA, "Old", false);
  const posS = await position(stB, SB, "Expeditor");
  const CS = await criterion(SA, null, "Arrived ready"), CP = await criterion(SA, posP, "Ticket accuracy"), CQ = await criterion(SA, posQ, "Greets guests");
  const CI = await criterion(SA, null, "Old line", false), CB = await criterion(SB, null, "Arrived ready");
  let dayN = 0;
  const day = async (format = "v2", loc = SA) => {
    dayN++;
    const date = new Date(Date.UTC(2026, 8, 1) + dayN * 86_400_000).toISOString().slice(0, 10);
    const reportId = await id(`insert into public.pm_reports (location_id, report_date, created_by${format ? ", format" : ""}) values ($1, $2, $3${format ? ", $4" : ""}) returning id`,
      format ? [loc, date, gmA, format] : [loc, date, gmA]);
    return { id: reportId, date };
  };
  const event = (u, l, date, s, p) => db.query(`insert into public.station_events (location_id, business_date, user_id, station_id, position_id, kind, actor_id, source)
    values ($1, $2, $3, $4, $5, 'claim', $3, 'claimed')`, [l, date, u, s, p]);
  const rpc = async (fn, args) => {
    await db.exec("set role service_role");
    try { return (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r; }
    finally { await db.exec("reset role"); }
  };
  const count = async (t, where = "true", params = []) => (await db.query(`select count(*)::int as n from public.${t} where ${where}`, params)).rows[0].n;
  const window = (actor, copy, date) => rpc("set_pm_copy_window", [actor, copy, `${date}T18:00:00Z`, `${date}T23:00:00Z`]);

  // ── P7 format ──
  const v1 = await day(null);
  check((await db.query("select format from public.pm_reports where id = $1", [v1.id])).rows[0].format === "v1", "P7 format defaults to v1");
  await refuses(() => db.query("update public.pm_reports set format = 'v2' where id = $1", [v1.id]), "format_frozen", "P7 a day's format never changes once set");
  await refuses(() => rpc("open_pm_copy", [khA, v1.id]), "format_mismatch", "P7 a v1 day refuses open_pm_copy");
  await refuses(() => rpc("submit_pm_day_v2", [khA, v1.id]), "format_mismatch", "P7 a v1 day refuses submit_pm_day_v2");
  await refuses(() => db.query("insert into public.pm_reports (location_id, report_date, created_by, format) values ($1, '2026-12-01', $2, 'v3')", [SA, gmA]), "23514", "P7 only v1 | v2");

  // ── the main day ──
  const D = await day();
  const c1 = (await rpc("open_pm_copy", [khA, D.id])).id;
  const again = await rpc("open_pm_copy", [khA, D.id]);
  check(again.id === c1 && again.created === false, "open_pm_copy is idempotent per (day, author)");
  const c2 = (await rpc("open_pm_copy", [gmA, D.id])).id;
  await refuses(() => rpc("open_pm_copy", [smmA, D.id]), "forbidden", "P1 the social media manager cannot open a copy");
  await refuses(() => rpc("open_pm_copy", [empA, D.id]), "forbidden", "P1 a level-3 employee cannot open a copy");
  await refuses(() => rpc("open_pm_copy", [gmB, D.id]), "forbidden", "P1 a GM of another shop cannot open a copy here");
  await refuses(() => rpc("open_pm_copy", [khA, "00000000-0000-4000-8000-000000000099"]), "not_found", "open_pm_copy on no day → not_found");

  // ── P1 non-author writes ──
  await refuses(() => rpc("save_pm_copy_grade", [gmA, c1, empA, null, CS, "good"]), "not_copy_author", "P1 a grade into another manager's copy");
  await refuses(() => rpc("save_pm_copy_note", [gmA, c1, empA, null, "x"]), "not_copy_author", "P1 a note into another manager's copy");
  await refuses(() => rpc("add_pm_copy_position", [gmA, c1, empA, posP, "covered"]), "not_copy_author", "P1 an added position into another manager's copy");
  await refuses(() => rpc("set_pm_copy_window", [gmA, c1, `${D.date}T18:00:00Z`, null]), "not_copy_author", "P1 another manager's window");
  await refuses(() => rpc("mark_pm_copy_done", [gmA, c1]), "not_copy_author", "P1 marking another manager's copy done");
  await refuses(() => rpc("save_pm_copy_grade", [khA, c1, empGone, null, CS, "good"]), "subject_unavailable", "a deactivated subject → subject_unavailable");
  await refuses(() => rpc("save_pm_copy_grade", [khA, c1, empA, null, CS, "excellent"]), "invalid_payload", "a grade outside great|good|needs_work → invalid_payload");

  // ── P1-1 THE SHARED CASE FILE ──
  const POS = { own_active: posP, own_retired: posR, other_shop: posS, nonexistent: "00000000-0000-4000-8000-0000000000ff", null: null };
  let agree = 0;
  for (const c of GRADE_CASES) {
    const subj = await user("employee");
    await member(subj, SA);
    const pos = POS[String(c.position)];
    if (c.worked) await event(subj, c.position === "other_shop" ? SB : SA, D.date, c.position === "other_shop" ? stB : stA, pos);
    if (c.added === "this") await rpc("add_pm_copy_position", [khA, c1, subj, pos, "covered the rush"]);
    if (c.added === "other") await rpc("add_pm_copy_position", [gmA, c2, subj, pos, "covered the rush"]);
    const crit = { own_shared: CS, own_position_same: c.position === "own_active" ? CP : CQ, own_position_other: CQ, own_inactive: CI, other_shop: CB }[c.criterion];
    const got = await errorOf(() => rpc("save_pm_copy_grade", [khA, c1, subj, pos, crit, "good"]));
    if (got === c.expect) agree++; else console.error(`FAIL P1-1 "${c.name}": expected ${c.expect}, got ${got}`);
    if (c.fkBackstop) {
      const [p, cr] = c.fkBackstop === "position" ? [pos, CS] : [posP, crit];
      await refuses(() => db.query("insert into public.pm_copy_grades (copy_id, location_id, subject_id, position_id, criterion_id, grade) values ($1, $2, $3, $4, $5, 'good')",
        [c1, SA, subj, p, cr]), "23503", `P1-1 FK backstop: "${c.name}" by direct INSERT as owner`);
    }
  }
  check(agree === GRADE_CASES.length, `P1-1 save_pm_copy_grade agrees with the shared case file on all ${GRADE_CASES.length} cases`);
  await refuses(() => db.query("insert into public.pm_copy_grades (copy_id, location_id, subject_id, position_id, criterion_id, grade) values ($1, $2, $3, null, $4, 'good')",
    [c1, SB, empA, CB]), "23503", "P1-1 FK backstop: a grade claiming another shop than its copy's");

  // ── P6 supersede ──
  await event(empA, SA, D.date, stA, posP);
  const g1 = await rpc("save_pm_copy_grade", [khA, c1, empA, posP, CP, "good"]);
  const g2 = await rpc("save_pm_copy_grade", [khA, c1, empA, posP, CP, "great"]);
  const gDidnt = await rpc("save_pm_copy_grade", [khA, c1, empA, posP, CS, null]);
  check(g1.superseded === 0 && g2.superseded === 1 && (await count("pm_copy_grades", "copy_id = $1 and subject_id = $2 and criterion_id = $3", [c1, empA, CP])) === 2
    && (await count("pm_copy_grades", "copy_id = $1 and subject_id = $2 and criterion_id = $3 and superseded_at is null", [c1, empA, CP])) === 1
    && (await db.query("select grade from public.pm_copy_grades where id = $1", [g2.id])).rows[0].grade === "great",
    "P6 a re-grade supersedes: ONE live row, history kept");
  check((await db.query("select grade from public.pm_copy_grades where id = $1", [gDidnt.id])).rows[0].grade === null, "P6 \"Didn't see\" is an explicit null grade");
  await rpc("save_pm_copy_note", [khA, c1, empA, posP, "slow on the slicer"]);
  await rpc("save_pm_copy_note", [khA, c1, empA, posP, "slow on the slicer at rush"]);
  check((await count("pm_copy_notes", "copy_id = $1 and superseded_at is null", [c1])) === 1 && (await count("pm_copy_notes", "copy_id = $1", [c1])) === 2, "P6 a note re-save supersedes");
  const cleared = await rpc("save_pm_copy_note", [khA, c1, empA, posP, "   "]);
  check(cleared.id === null && (await count("pm_copy_notes", "copy_id = $1 and superseded_at is null", [c1])) === 0 && (await count("pm_copy_notes", "copy_id = $1", [c1])) === 2,
    "P6 a blank note clears the live note (history kept)");
  await refuses(() => rpc("save_pm_copy_note", [khA, c1, empA, posP, "x".repeat(501)]), "invalid_note", "a note over 500 characters → invalid_note");
  await rpc("add_pm_copy_position", [khA, c1, empA, posQ, "covered walk-ins"]);
  await rpc("add_pm_copy_position", [khA, c1, empA, posQ, "covered walk-ins at lunch"]);
  check((await count("pm_copy_positions", "copy_id = $1 and position_id = $2 and superseded_at is null", [c1, posQ])) === 1, "P6 an added position stays one live row");
  await refuses(() => rpc("add_pm_copy_position", [khA, c1, empA, posQ, "  "]), "invalid_reason", "an added position needs a reason");
  await refuses(() => rpc("add_pm_copy_position", [khA, c1, empA, posR, "covered"]), "position_retired", "a retired position cannot be added");
  await refuses(() => rpc("add_pm_copy_position", [khA, c1, empA, posS, "covered"]), "position_not_at_shop", "another shop's position cannot be added");
  await refuses(() => rpc("add_pm_copy_position", [khA, c1, empA, null, "covered"]), "invalid_payload", "an added position needs a position");

  // ── the window ──
  await refuses(() => rpc("mark_pm_copy_done", [khA, c1]), "window_required", "Done needs the manager's time on the floor first");
  await refuses(() => rpc("set_pm_copy_window", [khA, c1, `${D.date}T02:00:00Z`, null]), "invalid_window", "a window before the business day → invalid_window");
  await refuses(() => rpc("set_pm_copy_window", [khA, c1, `${D.date}T20:00:00Z`, `${D.date}T19:00:00Z`]), "invalid_window", "to before from → invalid_window");
  const nextNight = new Date(Date.parse(`${D.date}T04:00:00Z`) + 31 * 3_600_000).toISOString();
  await refuses(() => rpc("set_pm_copy_window", [khA, c1, `${D.date}T20:00:00Z`, nextNight]), "invalid_window", "a window past day start + 30 h → invalid_window");
  await rpc("set_pm_copy_window", [khA, c1, `${D.date}T18:00:00Z`, null]);
  const lateClose = new Date(Date.parse(`${D.date}T04:00:00Z`) + 27 * 3_600_000).toISOString();
  await rpc("set_pm_copy_window", [khA, c1, `${D.date}T18:00:00Z`, lateClose]);
  check(true, "a window from 2 PM to a close after midnight (day start + 27 h) is accepted");

  // ── LC the walk ──
  await rpc("mark_pm_copy_done", [khA, c1]);
  await refuses(() => rpc("save_pm_copy_grade", [khA, c1, empA, posP, CP, "good"]), "copy_done", "LC a done copy is read-only: a grade is copy_done");
  await refuses(() => rpc("save_pm_copy_note", [khA, c1, empA, posP, "late"]), "copy_done", "LC … and a note is copy_done");
  await refuses(() => rpc("mark_pm_copy_done", [khA, c1]), "copy_done", "LC done twice → copy_done");
  await refuses(() => rpc("reopen_pm_copy", [gmA, c1]), "not_copy_author", "LC only the author reopens");
  await refuses(() => rpc("reopen_pm_copy", [gmA, c2]), "copy_not_done", "LC reopen on an open copy → copy_not_done");
  await rpc("reopen_pm_copy", [khA, c1]);
  await rpc("save_pm_copy_grade", [khA, c1, empA, posP, CP, "needs_work"]);
  check(true, "LC after Reopen the grade is accepted");
  await rpc("mark_pm_copy_done", [khA, c1]);
  await window(gmA, c2, D.date);
  await db.query("update public.pm_report_copies set observed_to = null where id = $1", [c2]);
  const c3 = (await rpc("open_pm_copy", [slA, D.id])).id;

  // ── P4 / P3 submit ──
  const sub = await rpc("submit_pm_day_v2", [slA, D.id]);
  const rows = (await db.query("select id, status, sealed_at, observed_to from public.pm_report_copies where pm_report_id = $1", [D.id])).rows;
  const dayRow = (await db.query("select status, submitted_by, submitted_at from public.pm_reports where id = $1", [D.id])).rows[0];
  check(sub.changed === true && sub.sealed === 3 && rows.every((r) => r.status === "sealed" && r.sealed_at !== null)
    && dayRow.status === "submitted" && dayRow.submitted_by === slA, "P4 submit seals every copy (done, open, untouched) and records the closing manager");
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  check(byId[c2].observed_to?.getTime() === dayRow.submitted_at.getTime() && byId[c1].observed_to?.toISOString() === lateClose && byId[c3].observed_to?.getTime() === dayRow.submitted_at.getTime(),
    "P4 observed_to defaults to the submit instant where it was empty, and stays where it was set");
  const loser = await rpc("submit_pm_day_v2", [khA, D.id]);
  const dayAfter = (await db.query("select submitted_by, submitted_at from public.pm_reports where id = $1", [D.id])).rows[0];
  check(loser.changed === false && dayAfter.submitted_by === slA && dayAfter.submitted_at.getTime() === dayRow.submitted_at.getTime(), "P3 a second submit is a no-op (changed:false), nothing moves");

  // ── P2 after submit ──
  await refuses(() => rpc("save_pm_copy_grade", [khA, c1, empA, posP, CP, "good"]), "report_already_submitted", "P2 a grade after submit");
  await refuses(() => rpc("save_pm_copy_note", [gmA, c2, empA, null, "x"]), "report_already_submitted", "P2 a note after submit");
  await refuses(() => rpc("reopen_pm_copy", [khA, c1]), "report_already_submitted", "P2 reopen after submit");
  await refuses(() => rpc("open_pm_copy", [khA, D.id]), "report_already_submitted", "P2 a new copy after submit");

  // ── direct writes refused ──
  await db.exec("set role service_role");
  await refuses(() => db.query("update public.pm_report_copies set status = 'open'"), "42501", "service_role cannot UPDATE a copy directly");
  await refuses(() => db.query("insert into public.pm_copy_notes (copy_id, location_id, subject_id, note) values ($1, $2, $3, 'x')", [c1, SA, empA]), "42501", "service_role cannot INSERT a note directly");
  await refuses(() => db.query("delete from public.pm_criteria"), "42501", "service_role cannot DELETE a criterion (deactivate only)");
  await db.query("update public.pm_criteria set label = 'Arrived ready (on time, in uniform)' where id = $1", [CS]);
  await db.exec("reset role");
  check(true, "service_role may UPDATE a criterion (rename / deactivate, audited by the lib)");
  await refuses(() => db.query("insert into public.pm_criteria (location_id, position_id, label, created_by) values ($1, $2, 'Ticket accuracy', $3)", [SA, posP, owner]),
    "23505", "one ACTIVE criterion per label per (shop, position)");
  await refuses(() => db.query("insert into public.pm_criteria (location_id, position_id, label, created_by) values ($1, $2, 'x', $3)", [SA, posS, owner]),
    "23503", "a criterion naming another shop's position fails the composite FK");

  // ── LC THE SHARED LIFECYCLE FILE ──
  const CODE = { not_copy_author: "not_author", report_already_submitted: "day_closed" };
  let lcAgree = 0;
  for (const c of LIFECYCLE_CASES) {
    const d = await day();
    const copy = (await rpc("open_pm_copy", [khA, d.id])).id;
    await window(khA, copy, d.date);
    if (c.copy !== "open") await db.query(`update public.pm_report_copies set status = $1, sealed_at = ${c.copy === "sealed" ? "clock_timestamp()" : "null"} where id = $2`, [c.copy, copy]);
    if (c.day !== "open") await db.query("update public.pm_reports set status = 'submitted', submitted_at = clock_timestamp(), submitted_by = $1 where id = $2", [gmA, d.id]);
    const actor = c.author ? khA : gmA;
    let got;
    if (c.act === "seal") {
      const msg = await errorOf(async () => { const r = await rpc("submit_pm_day_v2", [actor, d.id]); if (r.changed === false) throw new Error("report_already_submitted"); });
      got = msg;
    } else {
      const fn = { write: () => rpc("save_pm_copy_note", [actor, copy, empA, null, "x"]), markDone: () => rpc("mark_pm_copy_done", [actor, copy]), reopen: () => rpc("reopen_pm_copy", [actor, copy]) }[c.act];
      got = await errorOf(fn);
    }
    const norm = got === null ? null : (CODE[got] ?? got);
    if (norm === c.expect) lcAgree++; else console.error(`FAIL LC ${c.act} copy=${c.copy} day=${c.day} author=${c.author}: expected ${c.expect}, got ${got}`);
  }
  check(lcAgree === LIFECYCLE_CASES.length, `LC the RPC guards agree with the shared lifecycle file on all ${LIFECYCLE_CASES.length} cases`);
} catch (e) {
  failures++;
  console.error("FAIL harness crashed:", e);
} finally {
  await db.close();
}

if (failures > 0) { console.error(`FAIL 0271: ${failures} of ${checks} checks failed`); process.exit(1); }
console.log(`PASS 0271: ${checks} checks`);
