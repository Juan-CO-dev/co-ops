/**
 * Local Postgres proof of migration 0310 (CO-OPS bug audit W09 fix round 2: B060's SQL backstop, split out of
 * 0309), SYNTHETIC ROWS ONLY — PGlite, in memory. CC owns the Supabase sim/prod gate; this never touches a real
 * database.
 *
 *   node scripts/sql-harness-0310.mjs
 *
 * Applies tests/fixtures/scheduling-pglite-stub.sql, the PM v2 base (scripts/pm-v2-pglite-base.mjs), the REAL 0271
 * and the REAL 0309, seeds an old self-written eval, then 0310, and proves:
 *   T0  the preflight refuses without 0309 (save_pm_employee_eval missing)
 *   T1  the trigger refuses a direct self INSERT, an uppercased own id included
 *   T2  the W09 writer still answers self_evaluation itself (first) and the GM's live eval is untouched; an ordinary
 *       save of someone else still works
 *   T3  INSERT only: superseding an OLD self-written row still works, so a GM can re-grade that person
 *   T4  WHY 0310 WAITS FOR THE DRAIN: the pre-W09 two-call writer (supersede UPDATE, then INSERT) saving a self
 *       evaluation under this trigger leaves NO live eval for that pair — the hazard 0309 deliberately avoids
 *   T5  the trigger is BEFORE INSERT FOR EACH ROW only; the function is SECURITY DEFINER, search_path pinned, and
 *       callable by nobody; no CHECK constraint was added
 *   T6  a second apply changes nothing; re-applying 0309 after 0310 leaves the trigger in place
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { applyPmV2Base, M0271 } from "./pm-v2-pglite-base.mjs";

const STUB = readFileSync("tests/fixtures/scheduling-pglite-stub.sql", "utf8");
const M0309 = readFileSync("supabase/migrations/0309_pm_reviews_self_and_atomic_eval.sql", "utf8");
export const M0310 = readFileSync("supabase/migrations/0310_pm_eval_no_self_trigger.sql", "utf8");

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

async function fresh({ with0309 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await applyPmV2Base(db);
  await db.exec(M0271);
  if (with0309) await db.exec(M0309);
  return db;
}

// ── T0 the preflight ──
{
  const pre = await fresh({ with0309: false });
  await refuses(() => pre.exec(M0310), "0310: 0309 (save_pm_employee_eval) must be applied first", "T0 without 0309 the preflight refuses");
  await pre.exec("rollback");
  check((await pre.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.pm_employee_evals'::regclass and not tgisinternal")).rows[0].n === 0,
    "T0 … and installs nothing");
  await pre.close();
}

const db = await fresh();
try {
  const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
  const user = (role) => id("insert into public.users (role, active) values ($1, true) returning id", [role]);
  const shop = () => id("insert into public.locations default values returning id");
  const member = (u, l) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, true)", [u, l]);
  const SA = await shop();
  const gmA = await user("gm"), khA = await user("key_holder"), slA = await user("shift_lead"), empA = await user("employee");
  for (const u of [gmA, khA, slA, empA]) await member(u, SA);
  let dayN = 0;
  const day = async () => {
    dayN++;
    const date = new Date(Date.UTC(2026, 10, 1) + dayN * 86_400_000).toISOString().slice(0, 10);
    return id("insert into public.pm_reports (location_id, report_date, created_by, format, status) values ($1, $2, $3, 'v1', 'open') returning id", [SA, date, gmA]);
  };
  const evalRow = (report, emp, author) => id(`insert into public.pm_employee_evals
      (pm_report_id, location_id, employee_id, arrived_ready, attitude, production, team_player, author_id)
      values ($1, $2, $3, 'good', 'good', 'good', 'good', $4) returning id`, [report, SA, emp, author]);
  const live = async (report, emp) => (await db.query("select id, author_id from public.pm_employee_evals where pm_report_id = $1 and employee_id = $2 and superseded_at is null",
    [report, emp])).rows;
  const asService = async (fn) => { await db.exec("set role service_role"); try { return await fn(); } finally { await db.exec("reset role"); } };
  const save = (actor, report, emp) => asService(async () => (await db.query(
    "select public.save_pm_employee_eval($1, $2, $3, $4, 'great', 'good', 'good', 'good', null, null) as r", [actor, report, SA, emp])).rows[0].r);

  // A self-written eval from before 0310 (the old app could write one): it stays as history.
  const R0 = await day();
  const selfOld = await evalRow(R0, khA, khA);

  await db.exec(M0310);
  check(true, "0310 applied with every SQL guard");

  // ── T1 the trigger ──
  const R1 = await day();
  await refuses(() => evalRow(R1, slA, slA), "self_evaluation", "T1 the trigger refuses a direct self INSERT");
  check(/[a-f]/.test(slA), "T1 the generated id carries letters (so uppercasing changes it)");
  await refuses(() => evalRow(R1, slA.toUpperCase(), slA), "self_evaluation", "T1 the trigger refuses an UPPERCASE self INSERT");
  await refuses(() => asService(() => evalRow(R1, slA, slA)), "self_evaluation", "T1 … as service_role too (the API path)");
  check((await live(R1, slA)).length === 0, "T1 nothing was written by a refused INSERT");

  // ── T2 the W09 writer is unchanged ──
  const gmRow = (await save(gmA, R1, khA)).id;
  await refuses(() => save(khA, R1, khA), "self_evaluation", "T2 the W09 writer still answers self_evaluation itself");
  const l2 = await live(R1, khA);
  check(l2.length === 1 && l2[0].id === gmRow && l2[0].author_id === gmA, "T2 … and the GM's live eval is untouched");
  const other = await save(khA, R1, empA);
  check(typeof other.id === "string" && (await live(R1, empA)).length === 1, "T2 an ordinary save of someone else still works under the trigger");

  // ── T3 INSERT only ──
  check((await live(R0, khA)).map((r) => r.id).join() === selfOld, "T3 a self-written eval from before 0310 stays as history");
  const regrade = await save(gmA, R0, khA);
  const l3 = await live(R0, khA);
  check(regrade.superseded === 1 && l3.length === 1 && l3[0].author_id === gmA,
    "T3 superseding an OLD self-written row still works under the trigger: the GM re-grades that person");

  // ── T4 why 0310 waits: the pre-W09 two-call writer under the trigger ──
  const R4 = await day();
  const gmOfKh = (await save(gmA, R4, khA)).id;
  check((await live(R4, khA)).map((r) => r.id).join() === gmOfKh, "T4 setup: the GM's live eval of the key holder");
  await asService(() => db.query(
    "update public.pm_employee_evals set superseded_at = clock_timestamp() where pm_report_id = $1 and employee_id = $2 and superseded_at is null", [R4, khA]));
  await refuses(() => asService(() => evalRow(R4, khA, khA)), "self_evaluation", "T4 the OLD writer's INSERT (after its supersede committed) is refused");
  check((await live(R4, khA)).length === 0,
    "T4 HAZARD: the OLD writer + this trigger leaves NO live eval — so 0310 is applied only after the W09 deploy drains");

  // ── T5 shape, privileges ──
  const t = (await db.query(`select tgtype, tgenabled, pg_get_triggerdef(oid) as def from pg_trigger
     where tgrelid = 'public.pm_employee_evals'::regclass and not tgisinternal`)).rows;
  check(t.length === 1 && t[0].tgenabled === "O" && /BEFORE INSERT ON public\.pm_employee_evals FOR EACH ROW/i.test(t[0].def) && !/UPDATE|DELETE/i.test(t[0].def),
    "T5 one trigger, BEFORE INSERT FOR EACH ROW only, enabled");
  const f = (await db.query(`select p.prosecdef as d, p.proconfig as c,
     has_function_privilege('service_role', p.oid, 'EXECUTE') as s, has_function_privilege('authenticated', p.oid, 'EXECUTE') as u,
     has_function_privilege('anon', p.oid, 'EXECUTE') as a
     from pg_proc p where p.oid = 'public.pm_employee_evals_no_self()'::regprocedure`)).rows[0];
  check(f.d === true && JSON.stringify(f.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !f.s && !f.u && !f.a,
    "T5 the trigger function: SECURITY DEFINER, search_path pinned, callable by nobody but the trigger");
  check((await db.query("select count(*)::int as n from pg_constraint where conrelid = 'public.pm_employee_evals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~* 'author_id'")).rows[0].n === 0,
    "T5 no CHECK constraint on author_id (it would break superseding an old self row)");
  check(!/notifications|enqueue/i.test(M0310.replace(/^--.*$/gm, "")), "T5 no 0310 statement writes a notification");

  // ── T6 idempotent; 0309 re-applied keeps it ──
  await db.exec(M0310);
  check((await db.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.pm_employee_evals'::regclass and not tgisinternal")).rows[0].n === 1,
    "T6 a second apply leaves exactly one trigger");
  await db.exec(M0309);
  check((await db.query("select count(*)::int as n from pg_trigger where tgname = 'pm_employee_evals_no_self' and tgenabled = 'O'")).rows[0].n === 1,
    "T6 re-applying 0309 after 0310 leaves the trigger in place");
  await refuses(() => evalRow(R1, slA, slA), "self_evaluation", "T6 … and it still refuses a self INSERT");
} finally {
  await db.close();
}

console.log(failures === 0 ? `PASS 0310: ${checks} checks` : `FAIL 0310: ${failures} of ${checks} checks failed`);
if (failures) process.exitCode = 1;
