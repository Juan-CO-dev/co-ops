/**
 * Local Postgres proof of migration 0309 (CO-OPS bug audit W09: B059, B060, B164), SYNTHETIC ROWS ONLY —
 * PGlite, in memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0309.mjs
 *
 * Applies tests/fixtures/scheduling-pglite-stub.sql, the PM v2 base (scripts/pm-v2-pglite-base.mjs: the REAL
 * 0072 + 0073 + 0267, the REAL 0217 / 0228 / 0233 level helpers, the REAL 0270), the REAL 0271, seeds rows the
 * old code could have written (two live evals for one pair, a self-written eval), then 0309, and proves:
 *   C0  the preflight refuses without 0271; the apply COLLAPSES duplicate live evals to the NEWEST (W09-4 a) with
 *       one audit row naming exactly the superseded ids; a self-written eval stays as history; a second apply
 *       changes nothing and writes no second audit row
 *   C1  two saves for one (report, employee) leave exactly one live eval (the second supersedes the first)
 *   C2  a second live row is refused by the index (23505, direct INSERT)
 *   C3  a save on a submitted day refuses report_already_submitted; a v2 day refuses format_mismatch; a missing
 *       day / another shop's id is not_found
 *   C4  self refuses self_evaluation; the trigger refuses a direct self INSERT; superseding an OLD self-written
 *       row (an UPDATE) still works, so a GM can re-grade that person (pins the trigger-not-CHECK choice)
 *   C5  who: the SMM-free level rule (a level-3 actor and a non-member are forbidden); a non-member employee is
 *       invalid_target; a bad gradient is invalid_payload
 *   C6  B059 in SQL: save_pm_copy_grade / save_pm_copy_note / add_pm_copy_position refuse subject_is_author; grading
 *       another subject still succeeds; a sealed copy still answers its lifecycle code first
 *   C7  the re-emitted writers equal 0271's bodies plus exactly ONE line; grants, definer, pinned search_path,
 *       service_role only, the trigger function not callable, the PM ceilings unchanged
 *   C8  the eval writer locks the day row FOR NO KEY UPDATE and never notifies
 * The two-session proof (a concurrent save WAITS on the day-row lock and then supersedes) cannot run in one
 * PGlite session: scripts/sim/pm-0309-lock-check-management.mjs, run by CC on SIM.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { applyPmV1Tables, applyPmV2Base, LEVEL_HELPERS_SQL, M0271 } from "./pm-v2-pglite-base.mjs";

const STUB = readFileSync("tests/fixtures/scheduling-pglite-stub.sql", "utf8");
export const M0309 = readFileSync("supabase/migrations/0309_pm_reviews_self_and_atomic_eval.sql", "utf8");

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

const fnBody = (sql, start) => {
  const a = sql.indexOf(start);
  if (a < 0) throw new Error(`not found: ${start}`);
  return sql.slice(a, sql.indexOf("end $$;", a) + "end $$;".length);
};

async function fresh({ with0271 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  if (with0271) { await applyPmV2Base(db); await db.exec(M0271); }
  else { await applyPmV1Tables(db); await db.exec(readFileSync("supabase/migrations/0267_pm_evals_privacy.sql", "utf8")); await db.exec(LEVEL_HELPERS_SQL); }
  return db;
}

// ── C0 the preflight ──
{
  const pre = await fresh({ with0271: false });
  await refuses(() => pre.exec(M0309), "0309: 0271 (pm_reports_v2) must be applied first", "C0 without 0271 the preflight refuses");
  await pre.close();
}

const db = await fresh();
try {
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role, active = true) => id("insert into public.users (role, active) values ($1, $2) returning id", [role, active]);
  const shop = () => id("insert into public.locations default values returning id");
  const member = (u, l) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, true)", [u, l]);
  const SA = await shop(), SB = await shop();
  const gmA = await user("gm"), khA = await user("key_holder"), slA = await user("shift_lead"), empA = await user("employee");
  const emp2 = await user("employee"), gmB = await user("gm"), outsider = await user("employee");
  for (const [u, l] of [[gmA, SA], [khA, SA], [slA, SA], [empA, SA], [emp2, SA], [gmB, SB], [outsider, SB]]) await member(u, l);
  let dayN = 0;
  const day = async (format = "v1", loc = SA, status = "open") => {
    dayN++;
    const date = new Date(Date.UTC(2026, 9, 1) + dayN * 86_400_000).toISOString().slice(0, 10);
    return id("insert into public.pm_reports (location_id, report_date, created_by, format, status) values ($1, $2, $3, $4, $5) returning id",
      [loc, date, gmA, format, status]);
  };
  const evalRow = (report, emp, author, at, superseded = null) => id(`insert into public.pm_employee_evals
      (pm_report_id, location_id, employee_id, arrived_ready, attitude, production, team_player, author_id, created_at, superseded_at)
      values ($1, $2, $3, 'good', 'good', 'good', 'good', $4, $5, $6) returning id`, [report, SA, emp, author, at, superseded]);
  const live = async (report, emp) => (await db.query("select id, author_id from public.pm_employee_evals where pm_report_id = $1 and employee_id = $2 and superseded_at is null order by id",
    [report, emp])).rows;
  const audits = async () => (await db.query("select metadata from public.audit_log where action = 'pm_report.eval_duplicate_collapse'")).rows;

  // Pre-0309 rows: a duplicate live pair (the race the index closes), a self-written eval, a normal one.
  const R0 = await day();
  const older = await evalRow(R0, empA, gmA, "2026-10-01T20:00:00Z");
  const newer = await evalRow(R0, empA, khA, "2026-10-01T20:00:05Z");
  const selfOld = await evalRow(R0, khA, khA, "2026-10-01T20:01:00Z");
  const other = await evalRow(R0, emp2, gmA, "2026-10-01T20:02:00Z");

  await db.exec(M0309);
  check(true, "0309 applied with every SQL guard");
  const afterLive = await live(R0, empA);
  check(afterLive.length === 1 && afterLive[0].id === newer, "C0 the duplicate pair collapsed to the NEWEST live eval (W09-4 a)");
  check((await db.query("select superseded_at is not null as s from public.pm_employee_evals where id = $1", [older])).rows[0].s === true,
    "C0 the older duplicate is superseded, never deleted");
  const a1 = await audits();
  check(a1.length === 1 && JSON.stringify(a1[0].metadata.superseded_ids) === JSON.stringify([older]) && a1[0].metadata.pairs === 1
    && a1[0].metadata.actor_context === "migration_apply", "C0 ONE audit row names exactly the superseded id (ids only)");
  check((await db.query("select destructive from public.audit_log where action = 'pm_report.eval_duplicate_collapse'")).rows[0].destructive === true,
    "C0 the collapse audit row is destructive");
  check((await live(R0, khA)).map((r) => r.id).join() === selfOld && (await live(R0, emp2)).map((r) => r.id).join() === other,
    "C0 a self-written eval and an ordinary eval stay as they were (history)");
  await db.exec(M0309);
  check((await audits()).length === 1 && (await live(R0, empA)).length === 1, "C0 a second apply changes nothing and writes no second audit row");

  const rpc = async (fn, args) => {
    await db.exec("set role service_role");
    try { return (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r; }
    finally { await db.exec("reset role"); }
  };
  const save = (actor, report, emp, loc = SA, grade = "great") => rpc("save_pm_employee_eval", [actor, report, loc, emp, grade, "good", "good", "needs_work", null, null]);

  // ── C1 two saves, one live row ──
  const R1 = await day();
  const s1 = await save(gmA, R1, empA);
  const s2 = await save(khA, R1, empA);
  const l1 = await live(R1, empA);
  check(s1.superseded === 0 && s2.superseded === 1 && l1.length === 1 && l1[0].id === s2.id && l1[0].author_id === khA,
    "C1 two saves for one (report, employee) leave exactly one live eval (the second supersedes the first)");

  // ── C2 the index ──
  await refuses(() => evalRow(R1, empA, gmA, "2026-10-02T21:00:00Z"), "23505", "C2 a second live row is refused by the index (direct INSERT)");
  const ix = (await db.query("select indisunique as u, pg_get_expr(indpred, indrelid) as w from pg_index where indexrelid = 'public.pm_employee_evals_one_live'::regclass")).rows[0];
  check(ix?.u === true && /superseded_at IS NULL/i.test(ix.w), "C2 pm_employee_evals_one_live is UNIQUE … WHERE superseded_at IS NULL");

  // ── C3 the day ──
  const Rsub = await day("v1", SA, "submitted");
  await refuses(() => save(gmA, Rsub, empA), "report_already_submitted", "C3 a save on a submitted day");
  const Rv2 = await day("v2");
  await refuses(() => save(gmA, Rv2, empA), "format_mismatch", "C3 a v2 day refuses the v1 writer");
  await refuses(() => save(gmA, "00000000-0000-4000-8000-000000000999", empA), "not_found", "C3 a missing day → not_found");
  await refuses(() => save(gmA, R1, empA, SB), "not_found", "C3 another shop's id for the day → not_found");

  // ── C4 self ──
  await refuses(() => save(khA, R1, khA), "self_evaluation", "C4 the writer refuses evaluating yourself");
  await refuses(() => evalRow(R1, slA, slA, "2026-10-02T22:00:00Z"), "self_evaluation", "C4 the trigger refuses a direct self INSERT");
  // W09 fix round 1: case can't dodge the self checks. Every identity compare in 0309 is uuid-typed, and an
  // uppercased uuid literal parses to the same uuid, so the writer and the trigger refuse it too.
  check(/[a-f]/.test(khA) && /[a-f]/.test(slA), "C4b the generated ids carry letters (so uppercasing changes them)");
  await refuses(() => save(khA, R1, khA.toUpperCase()), "self_evaluation", "C4b the writer refuses an UPPERCASE own id");
  await refuses(() => save(khA.toUpperCase(), R1, khA), "self_evaluation", "C4b the writer refuses an UPPERCASE actor id naming itself");
  await refuses(() => evalRow(R1, slA.toUpperCase(), slA, "2026-10-02T22:00:01Z"), "self_evaluation", "C4b the trigger refuses an UPPERCASE self INSERT");
  const regrade = await save(gmA, R0, khA);
  const lk = await live(R0, khA);
  check(regrade.superseded === 1 && lk.length === 1 && lk[0].author_id === gmA,
    "C4 superseding an OLD self-written row still works: the GM re-grades that person");

  // ── C5 who ──
  await refuses(() => save(empA, R1, emp2), "forbidden", "C5 a level-3 actor is forbidden");
  await refuses(() => save(gmB, R1, emp2), "forbidden", "C5 a non-member actor is forbidden");
  await refuses(() => save(gmA, R1, outsider), "invalid_target", "C5 an employee who is not a member of the shop → invalid_target");
  await refuses(() => rpc("save_pm_employee_eval", [gmA, R1, SA, emp2, "superb", "good", "good", "good", null, null]), "invalid_payload", "C5 a bad gradient → invalid_payload");
  check((await live(R1, emp2)).length === 0, "C5 nothing was written by a refused save");

  // ── C6 B059 in SQL ──
  const station = await id("insert into public.stations (location_id) values ($1) returning id", [SA]);
  const pos = await id("insert into public.station_positions (station_id, location_id, name, active) values ($1, $2, 'Expeditor', true) returning id", [station, SA]);
  const crit = await id("insert into public.pm_criteria (location_id, position_id, label, active, created_by) values ($1, null, 'Arrived ready', true, $2) returning id", [SA, gmA]);
  const D2 = await day("v2");
  const copy = (await rpc("open_pm_copy", [khA, D2])).id;
  await refuses(() => rpc("save_pm_copy_grade", [khA, copy, khA, null, crit, "great"]), "subject_is_author", "C6 save_pm_copy_grade for oneself");
  await refuses(() => rpc("save_pm_copy_note", [khA, copy, khA, null, "I was great"]), "subject_is_author", "C6 save_pm_copy_note for oneself");
  await refuses(() => rpc("add_pm_copy_position", [khA, copy, khA, pos, "me"]), "subject_is_author", "C6 add_pm_copy_position for oneself");
  const KH_UP = khA.toUpperCase();
  await refuses(() => rpc("save_pm_copy_grade", [khA, copy, KH_UP, null, crit, "great"]), "subject_is_author", "C6b save_pm_copy_grade for an UPPERCASE own id");
  await refuses(() => rpc("save_pm_copy_note", [khA, copy, KH_UP, null, "I was great"]), "subject_is_author", "C6b save_pm_copy_note for an UPPERCASE own id");
  await refuses(() => rpc("add_pm_copy_position", [khA, copy, KH_UP, pos, "me"]), "subject_is_author", "C6b add_pm_copy_position for an UPPERCASE own id");
  await refuses(() => rpc("save_pm_copy_grade", [KH_UP, copy, khA, null, crit, "great"]), "subject_is_author", "C6b an UPPERCASE actor id grading itself");
  const g = await rpc("save_pm_copy_grade", [khA, copy, empA, null, crit, "good"]);
  check(typeof g.id === "string", "C6 grading another subject still succeeds");
  await refuses(() => rpc("save_pm_copy_grade", [gmA, copy, gmA, null, crit, "good"]), "not_copy_author", "C6 the lifecycle refusal comes first (another author's copy)");
  await rpc("submit_pm_day_v2", [khA, D2]);
  await refuses(() => rpc("save_pm_copy_grade", [khA, copy, khA, null, crit, "good"]), "report_already_submitted", "C6 a submitted day still answers report_already_submitted first");

  // ── C7 re-emits, grants, ceilings ──
  const SELF = "  if p_subject = p_actor then raise exception 'subject_is_author'; end if;  -- 0309 (W09/B059)\n";
  const LOCK = "  v_copy := public.pm_copy_lock(p_actor, p_copy, 'write');\n";
  for (const name of ["save_pm_copy_grade", "save_pm_copy_note", "add_pm_copy_position"]) {
    const was = fnBody(M0271.replace(/\r\n/g, "\n"), `create function public.${name}(`);
    const now = fnBody(M0309.replace(/\r\n/g, "\n"), `create or replace function public.${name}(`);
    const expected = was.replace(`create function public.${name}(`, `create or replace function public.${name}(`).replace(LOCK, LOCK + SELF);
    check(now === expected, `C7 ${name} = the 0271 body + exactly ONE line after pm_copy_lock`);
  }
  for (const fn of ["save_pm_employee_eval(uuid, uuid, uuid, uuid, text, text, text, text, text, text)", "save_pm_copy_grade(uuid, uuid, uuid, uuid, uuid, text)",
    "save_pm_copy_note(uuid, uuid, uuid, uuid, text)", "add_pm_copy_position(uuid, uuid, uuid, uuid, text)"]) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(r && r.d === true && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s,
      `C7 ${fn.split("(")[0]}: SECURITY DEFINER, search_path pinned, service_role only`);
  }
  const trig = (await db.query(`select has_function_privilege('service_role', 'public.pm_employee_evals_no_self()'::regprocedure, 'EXECUTE') as s,
    has_function_privilege('authenticated', 'public.pm_employee_evals_no_self()'::regprocedure, 'EXECUTE') as u`)).rows[0];
  check(!trig.s && !trig.u, "C7 the trigger function is callable by nobody but the trigger");
  let ceilingOk = true;
  for (const [t, allowed] of [["pm_employee_evals", ["SELECT", "INSERT", "UPDATE"]], ["pm_reports", ["SELECT", "INSERT", "UPDATE"]],
    ["pm_copy_grades", ["SELECT"]], ["pm_copy_notes", ["SELECT"]], ["pm_copy_positions", ["SELECT"]]]) {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const r = (await db.query(`select has_table_privilege('service_role', $1, $2) as s, has_table_privilege('anon', $1, $2) as a,
        has_table_privilege('authenticated', $1, $2) as u`, [`public.${t}`, p])).rows[0];
      if (r.s !== allowed.includes(p) || r.a || r.u) ceilingOk = false;
    }
  }
  check(ceilingOk, "C7 the PM table ceilings are unchanged (0267 / 0271)");

  // ── C8 lock mode, no notification ──
  const src = (await db.query("select prosrc from pg_proc where oid = 'public.save_pm_employee_eval(uuid, uuid, uuid, uuid, text, text, text, text, text, text)'::regprocedure")).rows[0].prosrc;
  check(/from public\.pm_reports where id = p_report and superseded_at is null for no key update/.test(src)
    && src.indexOf("for no key update") < src.indexOf("update public.pm_employee_evals"), "C8 the day row is locked FOR NO KEY UPDATE before any eval write");
  check(!/notifications|enqueue/i.test(M0309.replace(/^--.*$/gm, "")) && !/notification/i.test(src), "C8 no 0309 statement writes a notification; the eval writer never mentions one");
} finally {
  await db.close();
}

console.log(failures === 0 ? `PASS 0309: ${checks} checks` : `FAIL 0309: ${failures} of ${checks} checks failed`);
if (failures) process.exitCode = 1;
