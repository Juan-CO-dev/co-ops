/**
 * Local Postgres proof of migration 0307 (audit wave W07: PINs, lockouts and password resets), SYNTHETIC ROWS ONLY —
 * PGlite, in memory. CC owns the Supabase sim/prod gate; this never touches a real database.
 *
 *   node scripts/sql-harness-0307.mjs
 *
 * THE EXECUTION CONTRACT (as sql-harness-0279.mjs): the stub (Supabase roles + default privileges, users / locations /
 * user_locations), the user-admin columns, the W07 stub (the lockout columns, full sessions, password_resets,
 * email_verifications), then the REAL 0279, the REAL 0076 and 0307. Every function is called `set role service_role`
 * with the EXACT named arguments the lib sends (the builders in lib/auth-lockout-shared.ts and
 * lib/admin/user-admin-rpc-shared.ts).
 *
 *   S0   the preflight: refuses without 0076, without 0279, on a drifted 0076 counter, and on a second apply
 *   S1   the posture: every function 0307 creates or re-emits is SECURITY DEFINER, search_path pinned, service_role only
 *   B049 an expired lock restarts the count (the reservation and the fallback counter)
 *   B050 the lock check and the count are one step: thirty reservations in a row let exactly five through
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { FAILURE_LIMIT, LOCKOUT_MINUTES, parseAttemptReservation, reserveAttemptCall } from "../lib/auth-lockout-shared.ts";

const read = (p) => readFileSync(p, "utf8");
const STUB = read("tests/fixtures/scheduling-pglite-stub.sql");
const COLS = read("tests/fixtures/user-admin-columns-stub.sql");
const W07 = read("tests/fixtures/auth-w07-stub.sql");
const M0076 = read("supabase/migrations/0076_create_increment_failed_login_rpc.sql");
const M0279 = read("supabase/migrations/0279_user_employment_events.sql");
const M0307 = read("supabase/migrations/0307_auth_lockout_reset_hardening.sql");

let failures = 0;
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
async function refuses(fn, code, what) {
  try { await fn(); check(false, `${what} (no error; expected ${code})`); }
  catch (e) { const s = `${e.code ?? ""} ${e.message}`; check(s.includes(code), `${what} → ${code}${s.includes(code) ? "" : ` (got: ${s})`}`); }
}
/** A database with everything 0307 depends on. `m0076` / `m0279` false leave that dependency out (the preflight cases). */
async function base({ m0076 = true, m0279 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(COLS);
  await db.exec(W07);
  if (m0279) await db.exec(M0279);
  if (m0076) await db.exec(M0076);
  return db;
}
const FNS = ["auth_reserve_attempt(uuid)", "increment_failed_login(uuid)"];

const db = await base();
/** Call a function as the app does: service_role, named arguments. */
async function rpc(call) {
  const keys = Object.keys(call.args);
  const vals = keys.map((k) => {
    const v = call.args[k];
    const scalarArray = Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
    return v !== null && typeof v === "object" && !scalarArray ? JSON.stringify(v) : v;
  });
  await db.exec("set role service_role");
  try { return (await db.query(`select public.${call.fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, vals)).rows[0].r; }
  finally { await db.exec("reset role"); }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const id = async (sql, params = []) => (await db.query(sql, params)).rows[0].id;
const user = (role, extra = {}) => {
  const cols = ["role", ...Object.keys(extra)];
  const vals = [role, ...Object.values(extra)];
  return id(`insert into public.users (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals);
};
const lockState = (u) => one("select failed_login_count as n, locked_until as until, locked_until > now() as live from public.users where id = $1", [u]);

try {
  // S0 — the preflight
  {
    const no76 = await base({ m0076: false });
    await refuses(() => no76.exec(M0307), "0307: 0076 (increment_failed_login) must be applied first", "S0 the preflight refuses without 0076");
    await no76.close();
    const no279 = await base({ m0279: false });
    await refuses(() => no279.exec(M0307), "0307: 0279 (user_admin_lock and the user-admin writers) must be applied first", "S0 the preflight refuses without 0279");
    await no279.close();
    const drift = await base();
    await drift.exec(`create or replace function public.increment_failed_login(p_user_id uuid) returns integer language sql security definer
      set search_path = pg_catalog, public as $$ update public.users set failed_login_count = 0 where id = p_user_id returning failed_login_count $$;`);
    await refuses(() => drift.exec(M0307), "0307: increment_failed_login differs from 0076", "S0 the preflight refuses a drifted 0076 counter");
    await drift.close();
  }
  await db.exec(M0307);
  check(true, "0307 applied with every SQL guard (the post-apply posture guard included)");
  {
    // On its own database: a refused apply leaves that connection inside the aborted transaction.
    const again = await base();
    await again.exec(M0307);
    await refuses(() => again.exec(M0307), "0307: already applied", "S0 a second apply is refused by the preflight");
    await again.close();
  }

  // S1 — the posture
  for (const fn of FNS) {
    const r = (await db.query(`select p.prosecdef as d, p.proconfig as c, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
      from pg_proc p where p.oid = $1::regprocedure`, [`public.${fn}`])).rows[0];
    check(r.d === true && JSON.stringify(r.c) === JSON.stringify(["search_path=pg_catalog, public"]) && !r.a && !r.u && r.s,
      `S1 ${fn.split("(")[0]}: SECURITY DEFINER, search_path pinned, service_role only`);
  }
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await refuses(() => db.query("select public.auth_reserve_attempt(gen_random_uuid())"), "42501", `S1 ${role} cannot EXECUTE auth_reserve_attempt`);
    await db.exec("reset role");
  }

  // ── B049: an expired lock restarts the count ──
  {
    const u = await user("employee", { failed_login_count: 5, locked_until: new Date(Date.now() - 1000).toISOString() });
    const r = await rpc(reserveAttemptCall(u));
    const s = await lockState(u);
    check(r.allowed === true && r.attempt === 1 && r.locked_until === null && s.n === 1 && s.until === null,
      "B049 an expired lock restarts the count: one wrong PIN after expiry is attempt 1, not a new lock");
    const parsed = parseAttemptReservation(r, Date.now());
    check(parsed !== null && parsed.allowed && parsed.attempt === 1 && parsed.lockedUntil === null && !parsed.degraded,
      "B049 the lib reads that answer as attempt 1, not locked");

    // the fallback counter (0076 re-emitted): same seed, returns 1 — before 0307 it returned 6
    const f = await user("employee", { failed_login_count: 5, locked_until: new Date(Date.now() - 1000).toISOString() });
    await db.exec("set role service_role");
    const n = (await db.query("select public.increment_failed_login(p_user_id => $1) as n", [f])).rows[0].n;
    await db.exec("reset role");
    const fs = await lockState(f);
    check(n === 1 && fs.n === 1 && fs.until === null, "B049 the fallback counter restarts too: increment_failed_login returns 1 and clears the dead lock");

    // a LIVE lock is not touched by the fallback counter's restart rule, and a plain count still climbs by one
    const live = await user("employee", { failed_login_count: 5, locked_until: new Date(Date.now() + 600_000).toISOString() });
    await db.exec("set role service_role");
    const n2 = (await db.query("select public.increment_failed_login(p_user_id => $1) as n", [live])).rows[0].n;
    const plain = await (async () => { await db.exec("reset role"); return user("employee", { failed_login_count: 2 }); })();
    await db.exec("set role service_role");
    const n3 = (await db.query("select public.increment_failed_login(p_user_id => $1) as n", [plain])).rows[0].n;
    await db.exec("reset role");
    check(n2 === 6 && (await lockState(live)).live === true && n3 === 3, "B049 the fallback counter leaves a live lock alone and still counts 2 → 3");
  }

  // ── B050: the lock check and the count are one step ──
  {
    const u = await user("employee");
    const results = [];
    for (let i = 0; i < 30; i++) results.push(await rpc(reserveAttemptCall(u)));
    const allowed = results.filter((r) => r.allowed === true);
    const refused = results.filter((r) => r.allowed === false);
    const s = await lockState(u);
    check(allowed.length === FAILURE_LIMIT && allowed.map((r) => r.attempt).join(",") === "1,2,3,4,5"
      && allowed.slice(0, 4).every((r) => r.locked_until === null) && typeof allowed[4].locked_until === "string"
      && refused.length === 25 && s.n === FAILURE_LIMIT && s.live === true,
      "B050 thirty reservations in a row: exactly 5 allowed, the 5th sets locked_until, 25 refused, count stays 5");
    const lockMs = new Date(allowed[4].locked_until).getTime() - Date.now();
    check(lockMs > (LOCKOUT_MINUTES - 1) * 60_000 && lockMs <= LOCKOUT_MINUTES * 60_000, `B050 the lock lasts LOCKOUT_MINUTES (${LOCKOUT_MINUTES}) from the fifth attempt`);
    check(refused.every((r) => r.attempt === undefined && r.retry_after_seconds >= 1 && r.retry_after_seconds <= LOCKOUT_MINUTES * 60 && typeof r.locked_until === "string"),
      "B050 a refused reservation carries retry_after_seconds and locked_until, and no attempt number");
    const parsed = parseAttemptReservation(refused[0], Date.now());
    check(parsed !== null && !parsed.allowed && parsed.attempt === null && parsed.retryAfterSeconds >= 1, "B050 the lib reads a refusal as locked with a wait");

    // the precondition law (scripts/phase-2-audit-harness.ts pin-locked-precondition): a refused attempt writes nothing
    const pre = await user("employee", { failed_login_count: 0, locked_until: new Date(Date.now() + 600_000).toISOString() });
    const r = await rpc(reserveAttemptCall(pre));
    check(r.allowed === false && (await lockState(pre)).n === 0, "B050 an attempt on a locked account is refused and does NOT move the counter");

    await refuses(() => rpc(reserveAttemptCall("00000000-0000-4000-8000-000000000000")), "user_not_found", "B050 an unknown user is refused by name");
    await refuses(() => rpc({ fn: "auth_reserve_attempt", args: { p_user: null } }), "invalid_payload", "B050 a null user is refused");
  }
} catch (e) {
  failures++;
  console.error("FAIL harness threw:", e);
} finally {
  await db.close();
}
if (failures > 0) { console.error(`FAILED 0307: ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASS 0307: ${checks} checks`);
