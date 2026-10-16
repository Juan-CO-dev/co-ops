/**
 * Local Postgres proof of migration 0268 (Scheduling Phase 1, Task 5), SYNTHETIC ROWS ONLY — PGlite,
 * in memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0268.mjs
 *
 * Applies tests/fixtures/scheduling-pglite-stub.sql, then the REAL 0243 and 0268, and proves:
 *   H0  the preflight refuses a second apply (a sevenshifts_* relation exists) and a missing 0243
 *   H1  every table exists with RLS on and no policy
 *   H2  anon / authenticated hold nothing; service_role sits exactly at its ceiling (DELETE/TRUNCATE refused)
 *   H3  the ledger and the run ids refuse UPDATE under service_role (append-only by grant)
 *   H4  each UPSERT mirror accepts ITS conflict target, and a second upsert updates in place (pulled_at moves)
 *   H4b the reconciler: (a) complete {A,B} → two live; (b) complete {B,C} → A retired, B refreshed, C inserted;
 *       (c) incomplete {C} → B NOT retired, refused_retire; (c2) live {A,B}, incomplete {A} → B stays live,
 *       A refreshed; (d) A reappears → a NEW live row, the retired A kept; (e) an empty complete snapshot
 *       retires all; (f) wages, upcoming → current; (g) service_role cannot write the reconciled tables
 *       directly; plus every invalid row → invalid_payload with NOTHING written, and an unknown run refused
 *   H5  claim_cron_route('sevenshifts-sync') claims once and refuses within the lease; the old jobs still claim
 *   H6  no PII column on any sevenshifts_* table
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const M0243 = read("supabase/migrations/0243_cron_route_leases.sql");
const M0268 = read("supabase/migrations/0268_sevenshifts_sync.sql");

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}

const TABLES = {
  sevenshifts_sync_run_ids: "SELECT,INSERT", sevenshifts_sync_runs: "SELECT,INSERT", sevenshifts_sync_state: "SELECT,INSERT,UPDATE",
  sevenshifts_locations: "SELECT,INSERT,UPDATE", sevenshifts_departments: "SELECT,INSERT,UPDATE", sevenshifts_roles: "SELECT,INSERT,UPDATE",
  sevenshifts_users: "SELECT,INSERT,UPDATE", sevenshifts_availabilities: "SELECT,INSERT,UPDATE", sevenshifts_time_off: "SELECT,INSERT,UPDATE",
  sevenshifts_shifts: "SELECT,INSERT,UPDATE", sevenshifts_time_punches: "SELECT,INSERT,UPDATE", sevenshifts_labor_settings: "SELECT,INSERT,UPDATE",
  sevenshifts_user_assignments: "SELECT", sevenshifts_wages: "SELECT",
};

async function fresh() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(M0243);
  return db;
}

const db = await fresh();
try {
  // H0 — the preflight
  {
    const bare = new PGlite();
    await bare.exec(STUB);
    await refuses(() => bare.exec(M0268), "0243 (cron_route_leases + claim_cron_route) must be applied first", "H0 preflight refuses without 0243");
    await bare.close();
  }
  await db.exec(M0268);
  check(true, "0268 applied with every SQL guard");
  {
    const again = await fresh();
    await again.exec(M0268);
    await refuses(() => again.exec(M0268), "0268: claim_cron_route is not 0243's body", "H0 a second apply is refused by the preflight");
    await again.close();
  }

  // H1 — RLS on, no policy
  for (const t of Object.keys(TABLES)) {
    const r = (await db.query("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`public.${t}`])).rows[0];
    const pol = (await db.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1", [t])).rows[0].n;
    check(r?.rls === true && pol === 0, `H1 ${t}: RLS on, no policy`);
  }
  const allRelations = (await db.query("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' and relname like 'sevenshifts\\_%' order by 1")).rows.map((r) => r.relname);
  check(JSON.stringify(allRelations) === JSON.stringify(Object.keys(TABLES).sort()), `H1 exactly the 14 sevenshifts_* tables (${allRelations.length})`);

  // H2 — privileges
  for (const [t, ceiling] of Object.entries(TABLES)) {
    const want = new Set(ceiling.split(","));
    let ok = true;
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const sr = (await db.query("select has_table_privilege('service_role', $1, $2) as h", [`public.${t}`, p])).rows[0].h;
      const an = (await db.query("select has_table_privilege('anon', $1, $2) as h", [`public.${t}`, p])).rows[0].h;
      const au = (await db.query("select has_table_privilege('authenticated', $1, $2) as h", [`public.${t}`, p])).rows[0].h;
      if (sr !== want.has(p) || an || au) ok = false;
    }
    check(ok, `H2 ${t}: anon/authenticated nothing; service_role exactly ${ceiling}`);
  }
  for (const fn of ["reconcile_sevenshifts_user_snapshot(uuid, bigint, text, boolean, jsonb)", "sevenshifts_snapshot_row_problem(text, bigint, jsonb)", "claim_cron_route(text)"]) {
    const r = (await db.query(`select has_function_privilege('anon', 'public.${fn}', 'EXECUTE') as a, has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as b`)).rows[0];
    check(!r.a && !r.b, `H2 ${fn.split("(")[0]}: not executable by anon / authenticated`);
  }

  await db.exec("set role service_role");
  const run = async (trigger = "cron") => (await db.query("insert into public.sevenshifts_sync_run_ids (trigger) values ($1) returning id", [trigger])).rows[0].id;
  const R1 = await run(), R2 = await run(), R3 = await run(), R4 = await run(), R5 = await run(), R6 = await run();
  await refuses(() => db.query("delete from public.sevenshifts_locations"), "42501", "H2 service_role DELETE refused");
  await refuses(() => db.query("truncate public.sevenshifts_shifts"), "42501", "H2 service_role TRUNCATE refused");

  // H3 — append-only ledger
  await db.query(`insert into public.sevenshifts_sync_runs (id, trigger, started_at, finished_at, status, company_id, requests, results)
    values ($1, 'cron', now(), now(), 'ok', 1234, 3, '{"locations":{"rows":1,"skipped":0,"pages":1,"error_code":null}}')`, [R1]);
  await refuses(() => db.query("update public.sevenshifts_sync_runs set status = 'failed'"), "42501", "H3 the ledger refuses UPDATE");
  await refuses(() => db.query("update public.sevenshifts_sync_run_ids set trigger = 'manual'"), "42501", "H3 the run ids refuse UPDATE");
  await refuses(() => db.query(`insert into public.sevenshifts_sync_runs (id, trigger, started_at, finished_at, status, requests, results)
    values ($1, 'manual', now(), now(), 'ok', 0, '{}')`, [R2]), "sevenshifts_sync_runs_manual_has_requester", "H3 a manual run must name its requester");
  await refuses(() => db.query(`insert into public.sevenshifts_sync_runs (id, trigger, started_at, finished_at, status, requests, results)
    values (gen_random_uuid(), 'cron', now(), now(), 'ok', 0, '{}')`), "23503", "H3 a ledger row needs a minted run id");

  // H4 — every upsert mirror on its own conflict key, twice
  const UPSERTS = [
    ["sevenshifts_locations", "id", "(id, company_id, name, timezone, active) values (4569, 1234, 'Shop', 'America/New_York', true)", "name = 'Shop 2'"],
    ["sevenshifts_departments", "id", "(id, location_id, name) values (7890, 4569, 'FOH')", "name = 'BOH'"],
    ["sevenshifts_roles", "id", "(id, location_id, department_id, name, active) values (2583, 4569, 7890, 'Host', true)", "active = false"],
    ["sevenshifts_users", "id", "(id, company_id, first_name, last_name, employee_id, active) values (501, 1234, 'Ana', 'Ruiz', 'EMP-12', true)", "employee_id = 'EMP-13'"],
    ["sevenshifts_availabilities", "id", `(id, user_id, week, repeating, status, days) values (3001, 501, '2026-10-12', true, 1, '{"mon":{"code":1,"from":null,"to":null}}')`, "status = 2"],
    ["sevenshifts_time_off", "id", "(id, user_id, from_date, to_date, partial, from_time, to_time, status, hours) values (4001, 501, '2026-10-20', '2026-10-21', true, '09:00:00', '13:00:00', 1, 4)", "status = 2"],
    ["sevenshifts_shifts", "id", "(id, user_id, location_id, start_at, end_at, deleted) values (9001, 501, 4569, '2026-10-14T18:00:00Z', '2026-10-15T00:00:00Z', false)", "deleted = true"],
    ["sevenshifts_time_punches", "id", "(id, user_id, location_id, clocked_in, break_minutes, deleted) values (7001, 501, 4569, '2026-10-14T13:58:00Z', 30, false)", "deleted = true"],
    ["sevenshifts_labor_settings", "company_id", `(company_id, daily_ot_threshold, weekly_ot_threshold, premium_ot_threshold, multipliers) values (1234, 8, 40, 12, '{"daily_overtime_multiplier":1.5}')`, "weekly_ot_threshold = 44"],
  ];
  for (const [t, key, values, set] of UPSERTS) {
    const sql = `insert into public.${t} ${values} on conflict (${key}) do update set ${set}`;
    await db.query(sql);
    const before = (await db.query(`select pulled_at from public.${t}`)).rows[0].pulled_at;
    await new Promise((r) => setTimeout(r, 5));
    await db.query(sql);
    const rows = (await db.query(`select count(*)::int as n, max(pulled_at) as p from public.${t}`)).rows[0];
    check(rows.n === 1 && new Date(rows.p) > new Date(before), `H4 ${t}: on conflict (${key}) inserts then updates in place; pulled_at moves`);
  }
  await refuses(() => db.query("insert into public.sevenshifts_labor_settings (company_id, multipliers) values (1234, '{}') on conflict (id) do nothing"), "column", "H4 labor settings has no (id) conflict target");

  // H4b — the reconciler
  const rec = async (runId, user, kind, complete, rows) =>
    (await db.query("select public.reconcile_sevenshifts_user_snapshot($1, $2, $3, $4, $5::jsonb) as r", [runId, user, kind, complete, JSON.stringify(rows)])).rows[0].r;
  const edge = (role, loc = "4569", dep = "7890", primary = null) => ({ edge_key: `501:${loc}:${dep}:${role}`, user_id: "501", location_id: loc, department_id: dep, role_id: role, is_primary: primary });
  const A = edge("11"), B = edge("12"), C = edge("13");
  const live = async () => (await db.query("select edge_key, last_seen_run, first_seen_run from public.sevenshifts_user_assignments where user_id = 501 and active order by edge_key")).rows;
  const keys = async () => (await live()).map((r) => r.edge_key.split(":")[3]).join(",");

  let r = await rec(R1, 501, "assignments", true, [A, B]);
  check((await keys()) === "11,12" && r.inserted === 2 && r.retired === 0, "H4b (a) complete {A,B} → two live rows");
  r = await rec(R2, 501, "assignments", true, [B, C]);
  const retiredA = (await db.query("select retired_run from public.sevenshifts_user_assignments where edge_key = $1 and not active", [A.edge_key])).rows[0];
  const bRow = (await live()).find((x) => x.edge_key === B.edge_key);
  check((await keys()) === "12,13" && retiredA?.retired_run === R2 && bRow.last_seen_run === R2 && bRow.first_seen_run === R1 && r.retired === 1,
    "H4b (b) complete {B,C} → A retired with retired_run, B last_seen advanced, C inserted");
  r = await rec(R3, 501, "assignments", false, [C]);
  check((await keys()) === "12,13" && r.retired === 0 && r.refused_retire === "snapshot_incomplete", "H4b (c) incomplete {C} → B NOT retired, refused_retire");
  r = await rec(R4, 501, "assignments", false, [B]);
  check((await keys()) === "12,13" && (await live()).find((x) => x.edge_key === B.edge_key).last_seen_run === R4,
    "H4b (c2) live {B,C}, incomplete {B} (C rejected upstream) → C stays LIVE, B refreshed");
  r = await rec(R5, 501, "assignments", true, [A, B, C]);
  const aRows = (await db.query("select active from public.sevenshifts_user_assignments where edge_key = $1 order by active", [A.edge_key])).rows.map((x) => x.active);
  check(JSON.stringify(aRows) === "[false,true]" && r.inserted === 1, "H4b (d) A reappears → a NEW live row; the retired A stays as history");
  r = await rec(R6, 501, "assignments", true, []);
  check((await keys()) === "" && r.retired === 3, "H4b (e) an empty COMPLETE snapshot retires every live edge");
  const locOnly = { edge_key: "501:4569:-:-", user_id: "501", location_id: "4569", department_id: null, role_id: null, is_primary: null };
  r = await rec(R6, 501, "assignments", true, [locOnly]);
  check((await keys()) === "-" && r.inserted === 1, "H4b a location-only edge (nulls spelled -) is accepted");

  // every invalid row → invalid_payload, nothing written (complete AND incomplete)
  const count = async () => (await db.query("select count(*)::int as n from public.sevenshifts_user_assignments")).rows[0].n;
  const before = await count();
  const BAD = [
    { ...A, edge_key: "501:4569:7890:99" },                 // key does not match its ids
    { ...A, user_id: "502", edge_key: "502:4569:7890:11" },  // another user's edge
    { ...A, role_id: "x1" },                                 // non-numeric id
    { ...A, role_id: "0", edge_key: "501:4569:7890:0" },     // 0 is not an id
    { ...A, is_primary: "yes" },
    { ...A, email: "planted@example.test" },                 // an unknown key (PII would ride here)
    "not an object",
  ];
  for (const [i, bad] of BAD.entries()) {
    for (const complete of [true, false]) {
      await refuses(() => rec(R6, 501, "assignments", complete, [B, bad]), "invalid_payload", `H4b invalid assignment row #${i} (complete=${complete}) → invalid_payload`);
    }
  }
  check((await count()) === before, "H4b a refused call wrote nothing");
  await refuses(() => rec("00000000-0000-4000-8000-000000000000", 501, "assignments", true, []), "unknown_run", "H4b an unknown run is refused");
  await refuses(() => rec(R6, 501, "shifts", true, []), "invalid_kind", "H4b an unknown kind is refused");

  // (f) wages, including upcoming → current
  const wage = (id, upcoming, cents, date = "2026-11-01") => ({ user_id: "501", wage_id: id, upcoming, effective_date: date, wage_type: "hourly", wage_cents: cents, role_id: "2583" });
  const liveW = async () => (await db.query("select wage_id::text as w, upcoming, wage_cents from public.sevenshifts_wages where user_id = 501 and active order by wage_id, upcoming")).rows
    .map((x) => `${x.w}${x.upcoming ? "u" : "c"}${x.wage_cents}`).join(",");
  await rec(R1, 501, "wages", true, [wage("61", false, 1650, "2026-09-01"), wage("62", true, 1700)]);
  check((await liveW()) === "61c1650,62u1700", "H4b (f) wages: a current and an upcoming wage live");
  await rec(R2, 501, "wages", true, [wage("61", false, 1650, "2026-09-01"), wage("62", false, 1700)]);
  const retiredUpcoming = (await db.query("select count(*)::int as n from public.sevenshifts_wages where wage_id = 62 and upcoming and not active and retired_run = $1", [R2])).rows[0].n;
  check((await liveW()) === "61c1650,62c1700" && retiredUpcoming === 1, "H4b (f) upcoming → current = a retire + a new live row");
  await rec(R3, 501, "wages", false, [wage("62", false, 1750)]);
  check((await liveW()) === "61c1650,62c1750", "H4b (f) incomplete wages: refreshed, nothing retired");
  for (const [i, bad] of [{ ...wage("63", false, 10), wage_type: "daily" }, { ...wage("63", false, -1) }, { ...wage("63", false, 1.5) },
    { ...wage("63", false, 10), effective_date: "2026-13-45" }, { ...wage("63", false, 10), upcoming: "no" }].entries()) {
    await refuses(() => rec(R4, 501, "wages", false, [bad]), "invalid_payload", `H4b invalid wage row #${i} → invalid_payload`);
  }
  await rec(R4, 501, "wages", true, []);
  check((await liveW()) === "", "H4b (f) an empty complete wage snapshot retires all");

  // (g) the reconciled tables refuse direct writes
  await refuses(() => db.query(`insert into public.sevenshifts_user_assignments (edge_key, user_id, first_seen_run, last_seen_run) values ('501:-:-:-', 501, $1, $1)`, [R1]), "42501", "H4b (g) service_role cannot INSERT assignments directly");
  await refuses(() => db.query("update public.sevenshifts_user_assignments set active = true"), "42501", "H4b (g) service_role cannot UPDATE assignments directly");
  await refuses(() => db.query("update public.sevenshifts_wages set wage_cents = 1"), "42501", "H4b (g) service_role cannot UPDATE wages directly");

  // H5 — the lease
  const claim = async (job) => (await db.query("select public.claim_cron_route($1) as c", [job])).rows[0].c;
  check((await claim("sevenshifts-sync")) === true, "H5 claim_cron_route('sevenshifts-sync') claims");
  check((await claim("sevenshifts-sync")) === false, "H5 … and refuses within the lease");
  check((await claim("toast-sales-today")) === true && (await claim("toast-catering-scan")) === true, "H5 the two 0243 jobs still claim");
  await refuses(() => claim("nope"), "invalid_cron_route", "H5 an unknown job is refused");
  await db.exec("reset role");
  const conname = (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'cron_route_leases_job_check'")).rows[0]?.d ?? "";
  check(conname.includes("sevenshifts-sync") && conname.includes("toast-catering-scan"), "H5 the job CHECK carries all three jobs under its 0243 name");

  // H6 — no PII column
  const pii = (await db.query(`select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name like 'sevenshifts\\_%'
      and column_name ~ '(^|_)(email|phone|mobile|birth|birthday|address|tips?|notes?|comments?|reason|category|punch_id|hourly_wage)(_|$)'`)).rows;
  check(pii.length === 0, `H6 no PII column on any sevenshifts_* table${pii.length ? ` (found ${pii.map((x) => `${x.table_name}.${x.column_name}`).join(", ")})` : ""}`);
} catch (e) {
  failures++;
  console.error(`FAIL 0268 harness: ${e.stack ?? e}`);
} finally {
  await db.close();
}
if (failures) { console.error(`${failures} failure(s)`); process.exitCode = 1; }
else console.log(`PASS 0268: ${checks} checks`);
