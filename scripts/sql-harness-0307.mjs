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
 *   B051 the session mint is a compare-and-set on the verified credential: a mint with a pre-reset hash, or after an
 *        email change, is refused and inserts nothing; a good mint inserts one session and clears the lockout
 *   B156 the self-service reset is one transaction: a failed password write leaves the link usable
 *   B157 a reset (and an admin password set) retires every other open reset link of that person, nobody else's
 *   B158 an admin PIN / password reset clears the lockout; a refused reset clears nothing
 *   S8   the re-emitted 0279 writers still take the ONE gate (user_admin_lock) and no lock of their own
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  FAILURE_LIMIT, LOCKOUT_MINUTES, createSessionCall, parseAttemptReservation, passwordResetConsumeCall, reserveAttemptCall,
} from "../lib/auth-lockout-shared.ts";
import { setUserCredentialCall, updateUserProfileCall } from "../lib/admin/user-admin-rpc-shared.ts";

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
const FNS = ["auth_reserve_attempt(uuid)", "increment_failed_login(uuid)",
  "auth_create_session(uuid, uuid, text, text, text, text, text, timestamptz, text, text)",
  "auth_password_reset_consume(text, text)", "admin_user_set_credential(uuid, uuid, text, text)"];
/** The 0279 writers 0307 re-emits (each must still take the one gate). */
const REEMITTED = ["admin_user_set_credential"];

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
const shop = () => id("insert into public.locations (active) values (true) returning id");
const member = (u, l) => db.query("insert into public.user_locations (user_id, location_id, active) values ($1, $2, true)", [u, l]);
const HASH = (tag) => `$2a$10$${tag.padEnd(53, "x")}`; // bcrypt-shaped, synthetic
let mintSeq = 0;
/** The exact call lib/session.ts createSession makes. */
const mint = (userId, credential, over = {}) => {
  const sessionId = crypto.randomUUID();
  return rpc(createSessionCall({ sessionId, userId, authMethod: credential.kind, credential, tokenHash: `tok-${++mintSeq}`,
    expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(), ipAddress: "203.0.113.7", userAgent: "harness", ...over })).then((r) => ({ r, sessionId }));
};
let linkSeq = 0;
/** An open reset link for a person (superuser insert, as the reset-request route's service-role insert). Returns its token hash. */
const resetLink = async (u, { expiresInMs = 3600_000 } = {}) => {
  const tokenHash = `reset-${++linkSeq}`;
  await db.query("insert into public.password_resets (user_id, token_hash, expires_at) values ($1, $2, $3)", [u, tokenHash, new Date(Date.now() + expiresInMs).toISOString()]);
  return tokenHash;
};
const linkConsumed = async (tokenHash) => (await one("select consumed_at from public.password_resets where token_hash = $1", [tokenHash])).consumed_at !== null;
const consume = (tokenHash, passwordHash) => rpc(passwordResetConsumeCall({ tokenHash, passwordHash }));
const liveSessions = async (u) => (await one("select count(*)::int as n from public.sessions where user_id = $1 and revoked_at is null", [u])).n;
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

  // S8 — the re-emitted 0279 writers keep the ONE gate
  for (const fn of REEMITTED) {
    const body = (await one("select prosrc from pg_proc where proname = $1", [fn])).prosrc;
    const gateAt = body.indexOf("public.user_admin_lock(p_actor, p_user)");
    const firstWrite = body.search(/(update|insert into|delete from) public[.]/);
    check(gateAt >= 0 && firstWrite > gateAt && !/pg_advisory_xact_lock/.test(body) && !/for update/.test(body),
      `S8 ${fn} takes the ONE gate (user_admin_lock) before any write, and no lock of its own`);
  }

  // ── fixtures for the admin-writer cases (superuser) ──
  const SA = await shop();
  const gm = await user("gm");
  await member(gm, SA);

  // ── B051: the session mint is a compare-and-set on the verified credential ──
  {
    // a PIN sign-in racing an admin PIN reset: the sign-in verified H_OLD, the reset commits, THEN the mint runs
    const e = await user("employee", { pin_hash: HASH("old-pin") });
    await member(e, SA);
    await db.query("insert into public.sessions (user_id) values ($1)", [e]); // a session that was live before the reset
    const reset = await rpc(setUserCredentialCall({ actorId: gm, userId: e, kind: "pin", hash: HASH("new-pin") }));
    check(reset.sessions_revoked === 1 && (await liveSessions(e)) === 0, "B051 (setup) the admin PIN reset revoked the live session");
    await refuses(() => mint(e, { kind: "pin", hash: HASH("old-pin") }), "credential_changed",
      "B051 a mint with the pre-reset hash after admin_user_set_credential");
    check((await liveSessions(e)) === 0 && (await one("select count(*)::int as n from public.sessions where user_id = $1", [e])).n === 1,
      "B051 … and no sessions row was inserted (the reset's revoke stands)");

    // a password sign-in racing an email change (admin_user_update_profile revokes on an email change)
    const m = await user("agm", { email: "old@example.test", password_hash: HASH("pw"), email_verified: true });
    await member(m, SA);
    await rpc(updateUserProfileCall({ actorId: gm, userId: m, patch: { email: "new@example.test" } }));
    await refuses(() => mint(m, { kind: "password", hash: HASH("pw"), loginEmail: "old@example.test" }), "credential_changed",
      "B051 a password mint after an email change");
    check((await liveSessions(m)) === 0, "B051 … and that mint inserted nothing");
    // the same person signing in with the NEW email (same password) is fine; the email compare is case-insensitive
    const okNew = await mint(m, { kind: "password", hash: HASH("pw"), loginEmail: "NEW@example.test" });
    check(okNew.r.session_id === okNew.sessionId && (await liveSessions(m)) === 1, "B051 the new email signs in (case-insensitive compare)");

    // the happy path: one live session, the lockout cleared, last_login_at stamped — in the same transaction
    const g = await user("employee", { pin_hash: HASH("good"), failed_login_count: 5, locked_until: new Date(Date.now() + 600_000).toISOString() });
    const ok = await mint(g, { kind: "pin", hash: HASH("good") });
    const row = await one("select failed_login_count as n, locked_until as until, last_login_at as at from public.users where id = $1", [g]);
    const sess = await one("select token_hash, auth_method, step_up_unlocked, ip_address::text as ip, user_agent, expires_at > now() as live, revoked_at from public.sessions where id = $1", [ok.sessionId]);
    check(ok.r.session_id === ok.sessionId && (await liveSessions(g)) === 1 && row.n === 0 && row.until === null && row.at !== null,
      "B051 a mint with the current hash → one live session, failed_login_count 0, locked_until null, last_login_at set");
    check(sess.auth_method === "pin" && sess.step_up_unlocked === false && sess.ip.startsWith("203.0.113.7") && sess.user_agent === "harness" && sess.live === true && sess.revoked_at === null,
      "B051 the minted row carries the method, the address, the agent and no step-up");

    // the wrong KIND of hash never matches, an inactive account never mints, a malformed address never blocks a sign-in
    await refuses(() => mint(g, { kind: "password", hash: HASH("good") }), "credential_changed", "B051 a PIN hash offered as the password credential");
    const off = await user("employee", { pin_hash: HASH("off"), active: false });
    await refuses(() => mint(off, { kind: "pin", hash: HASH("off") }), "account_inactive", "B051 an inactive account");
    const badIp = await mint(g, { kind: "pin", hash: HASH("good") }, { ipAddress: "not-an-ip" });
    check((await one("select ip_address from public.sessions where id = $1", [badIp.sessionId])).ip_address === null, "B051 a malformed address is stored as null, the sign-in still succeeds");
    await refuses(() => mint(g, { kind: "pin", hash: HASH("good") }, { expiresAt: new Date(Date.now() - 1000).toISOString() }), "invalid_payload", "B051 an already-expired session is refused");
    await refuses(() => mint("00000000-0000-4000-8000-000000000000", { kind: "pin", hash: HASH("good") }), "user_not_found", "B051 an unknown user");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await refuses(() => db.query("select public.auth_create_session(null, null, null, null, null, null, null, null, null, null)"), "42501", `B051 ${role} cannot EXECUTE auth_create_session`);
      await db.exec("reset role");
    }

    // B050 + B051 together: the fifth reserved attempt with the RIGHT credential signs in and clears its own lock
    const fifth = await user("employee", { pin_hash: HASH("fifth"), failed_login_count: 4 });
    const res = await rpc(reserveAttemptCall(fifth));
    await mint(fifth, { kind: "pin", hash: HASH("fifth") });
    const after = await lockState(fifth);
    check(res.attempt === 5 && typeof res.locked_until === "string" && after.n === 0 && after.until === null,
      "B051 a correct answer on the fifth reserved attempt signs in and clears the lock it reserved");
  }

  // ── B156: the reset is one transaction ──
  {
    const u = await user("agm", { email: "reset@example.test", password_hash: HASH("before"), email_verified: true,
      failed_login_count: 5, locked_until: new Date(Date.now() + 600_000).toISOString() });
    await db.query("insert into public.sessions (user_id) values ($1), ($1)", [u]);
    const link = await resetLink(u);
    // a password write that fails once (a transient fault on users), inside the function's own transaction
    await db.exec(`create function public.harness_fail_users() returns trigger language plpgsql as $f$ begin raise exception 'harness: users write failed'; end $f$;
      create trigger harness_fail_users before update on public.users for each row execute function public.harness_fail_users();`);
    await refuses(() => consume(link, HASH("after")), "harness: users write failed", "B156 (setup) the password write fails inside the reset");
    const mid = await one("select password_hash from public.users where id = $1", [u]);
    check(!(await linkConsumed(link)) && mid.password_hash === HASH("before") && (await liveSessions(u)) === 2,
      "B156 a reset whose password write fails rolls back the consume — the link is still open, nothing changed");
    await db.exec("drop trigger harness_fail_users on public.users; drop function public.harness_fail_users();");
    const r = await consume(link, HASH("after"));
    const done = await one("select password_hash, failed_login_count as n, locked_until as until from public.users where id = $1", [u]);
    check(r.user_id === u && r.role === "agm" && r.sessions_revoked === 2 && r.other_links_retired === 0 && typeof r.reset_id === "string"
      && done.password_hash === HASH("after") && done.n === 0 && done.until === null && (await linkConsumed(link)) && (await liveSessions(u)) === 0,
      "B156 … the same link then succeeds: password written, lockout cleared, link consumed, both sessions revoked");
    await refuses(() => consume(link, HASH("again")), "token_consumed", "B156 a used link is refused by name");
    check((await one("select password_hash from public.users where id = $1", [u])).password_hash === HASH("after"), "B156 … and the replay changed nothing");

    const expired = await resetLink(u, { expiresInMs: -1000 });
    await refuses(() => consume(expired, HASH("x")), "token_expired", "B156 an expired link is refused by name");
    check(!(await linkConsumed(expired)), "B156 … and an expired link is not consumed by the refusal");
    await refuses(() => consume("no-such-token", HASH("x")), "token_invalid", "B156 an unknown link is refused by name");
    const forShort = await resetLink(u);
    await refuses(() => consume(forShort, "short"), "invalid_payload", "B156 a malformed password hash is refused");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await refuses(() => db.query("select public.auth_password_reset_consume('a', 'b')"), "42501", `B156 ${role} cannot EXECUTE auth_password_reset_consume`);
      await db.exec("reset role");
    }
  }

  // ── B157: one reset retires the person's other open links ──
  {
    const u = await user("agm", { email: "two-links@example.test", password_hash: HASH("p0"), email_verified: true });
    await member(u, SA);
    const other = await user("agm", { email: "bystander@example.test", password_hash: HASH("o0"), email_verified: true });
    const t1 = await resetLink(u), t2 = await resetLink(u), bystander = await resetLink(other);
    const r = await consume(t2, HASH("p2"));
    check(r.other_links_retired === 1 && (await linkConsumed(t1)) && (await linkConsumed(t2)) && !(await linkConsumed(bystander)),
      "B157 two open links: using T2 retires T1; another person's link untouched");
    await refuses(() => consume(t1, HASH("attacker")), "token_consumed", "B157 T1 then");
    check((await one("select password_hash from public.users where id = $1", [u])).password_hash === HASH("p2"), "B157 … and the password is still the one T2 set");

    // the same family on the admin path: a GM sets the password while a reset email is still out
    const t3 = await resetLink(u);
    const set = await rpc(setUserCredentialCall({ actorId: gm, userId: u, kind: "password", hash: HASH("gm-set") }));
    check(set.kind === "password" && set.reset_links_retired === 1 && (await linkConsumed(t3)) && !(await linkConsumed(bystander)),
      "B157 an admin password set retires the person's open reset links, nobody else's");
    await refuses(() => consume(t3, HASH("stale-email")), "token_consumed", "B157 the older reset email can no longer overwrite the GM's password");
    // a PIN reset is not a password event: an open reset link survives it
    const t4 = await resetLink(u);
    const pinSet = await rpc(setUserCredentialCall({ actorId: gm, userId: u, kind: "pin", hash: HASH("pin-set") }));
    check(pinSet.reset_links_retired === 0 && !(await linkConsumed(t4)), "B157 an admin PIN reset leaves the reset link alone");
  }

  // ── B158: an admin reset ends the lockout ──
  {
    const locked = () => ({ failed_login_count: 5, locked_until: new Date(Date.now() + 15 * 60_000).toISOString() });
    const e = await user("employee", { pin_hash: HASH("forgot"), ...locked() });
    await member(e, SA);
    check((await rpc(reserveAttemptCall(e))).allowed === false, "B158 (setup) the person is locked out");
    await rpc(setUserCredentialCall({ actorId: gm, userId: e, kind: "pin", hash: HASH("fresh-pin") }));
    const s = await lockState(e);
    const next = await rpc(reserveAttemptCall(e));
    const signedIn = await mint(e, { kind: "pin", hash: HASH("fresh-pin") });
    check(s.n === 0 && s.until === null && next.allowed === true && next.attempt === 1 && signedIn.r.session_id === signedIn.sessionId,
      "B158 a GM's PIN reset clears locked_until and failed_login_count; the new PIN signs in at once");

    const m = await user("agm", { email: "locked-mgr@example.test", password_hash: HASH("old-pw"), email_verified: true, ...locked() });
    await member(m, SA);
    await rpc(setUserCredentialCall({ actorId: gm, userId: m, kind: "password", hash: HASH("new-pw") }));
    const ms = await lockState(m);
    check(ms.n === 0 && ms.until === null, "B158 a GM's password set clears the lockout too");

    // the gate still decides first: a GM cannot reset (and so cannot unlock) another GM
    const peer = await user("gm", { pin_hash: HASH("peer"), ...locked() });
    await member(peer, SA);
    await refuses(() => rpc(setUserCredentialCall({ actorId: gm, userId: peer, kind: "pin", hash: HASH("nope") })), "forbidden",
      "B158 a refused reset (a peer, never below the actor) clears nothing");
    const ps = await one("select pin_hash, failed_login_count as n, locked_until > now() as live from public.users where id = $1", [peer]);
    check(ps.pin_hash === HASH("peer") && ps.n === 5 && ps.live === true, "B158 … the peer's PIN and lock are untouched");
  }
} catch (e) {
  failures++;
  console.error("FAIL harness threw:", e);
} finally {
  await db.close();
}
if (failures > 0) { console.error(`FAILED 0307: ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASS 0307: ${checks} checks`);
