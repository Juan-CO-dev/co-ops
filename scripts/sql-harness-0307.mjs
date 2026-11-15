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
 *   B052 an email change retires the person's open reset links (a name / phone edit and other people's links untouched)
 *   B053 the confirm-your-email issuer: behind the gate, only for an active level-6+ person with an unconfirmed email,
 *        one live link at a time; an email change retires it; the backfill vouches exactly the stranded managers
 *   B159 the per-session re-check counter: five reservations, the sixth revokes the session; a success clears it
 *   S8   the re-emitted 0279 writers still take the ONE gate (user_admin_lock) and no lock of their own
 *   R1   (fix round 1) a reset link is ISSUED by one locked step: a request that read the account before an email
 *        change, an admin password set or a reset is refused and inserts nothing; a link issued first is retired
 *        by the change; a link is good only for the address it was issued for
 *   R2   (fix round 1) "confirm your email" is ONE transaction: an email change, a demotion or a deactivation that
 *        lands during the confirmation refuses it and writes nothing; a failed write leaves the link usable
 *
 * PGlite is ONE connection, so R1 / R2 run each interleaving in the order its statements COMMIT (read → the other
 * writer → the function). What they cannot show is two sessions WAITING on each other: that is the lock order,
 * asserted here by what each function holds inside its transaction (the per-person advisory key and the users row),
 * and proven with real sessions by scripts/sim-0307-lock-check.mjs (sim only, CC's to run, as for 0279).
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  FAILURE_LIMIT, LOCKOUT_MINUTES, REAUTH_LIMIT, createSessionCall, emailConfirmIssueCall, parseAttemptReservation, parseReauthReservation,
  passwordResetConsumeCall, reauthExhausted, reserveAttemptCall, sessionReauthClearCall, sessionReauthReserveCall,
  EMAIL_CONFIRM_CONSUME_REFUSALS, PASSWORD_RESET_EXPIRES_HOURS, PASSWORD_RESET_ISSUE_REFUSALS, emailConfirmConsumeCall, passwordResetIssueCall,
} from "../lib/auth-lockout-shared.ts";
import { setUserActiveCall, setUserCredentialCall, setUserRoleCall, updateUserProfileCall } from "../lib/admin/user-admin-rpc-shared.ts";

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
  "auth_password_reset_consume(text, text)", "admin_user_set_credential(uuid, uuid, text, text)",
  "admin_user_update_profile(uuid, uuid, jsonb)", "auth_email_confirm_issue(uuid, uuid, text, timestamptz)",
  "session_reauth_reserve(uuid)", "session_reauth_clear(uuid)",
  "auth_password_reset_issue(uuid, text, text, text, timestamptz)", "auth_email_confirm_consume(text, text)"];
/** The 0279 writers 0307 re-emits (each must still take the one gate). */
const REEMITTED = ["admin_user_set_credential", "admin_user_update_profile"];

// ── B053's backfill runs INSIDE the migration, so its people are seeded BEFORE the apply (on its own database). ──
{
  const pre = await base();
  const q = async (sql, params = []) => (await pre.query(sql, params)).rows;
  const mk = async (role, extra = {}) => {
    const cols = ["role", ...Object.keys(extra)];
    return (await q(`insert into public.users (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, [role, ...Object.values(extra)]))[0].id;
  };
  const stranded = await mk("agm", { email: "promoted@example.test" });                       // promoted, never verified
  const strandedOff = await mk("gm", { email: "promoted-off@example.test", active: false });   // inactive: vouched too (a later reactivation must not be stuck)
  const noEmail = await mk("agm");                                                             // nothing to vouch
  const blankEmail = await mk("catering_mgr", { email: "  " });
  const lead = await mk("shift_lead", { email: "lead@example.test" });                         // level 5: never
  const already = await mk("moo", { email: "done@example.test", email_verified: true, email_verified_at: "2026-01-01T00:00:00Z" });
  await pre.exec(M0307);
  const row = async (u) => (await q("select email_verified as v, email_verified_at as at from public.users where id = $1", [u]))[0];
  const [a, b, c, d, e, f] = [await row(stranded), await row(strandedOff), await row(noEmail), await row(blankEmail), await row(lead), await row(already)];
  check(a.v === true && a.at !== null && b.v === true && b.at !== null && c.v === false && c.at === null && d.v === false && e.v === false
    && f.v === true && new Date(f.at).toISOString() === "2026-01-01T00:00:00.000Z",
    "B053 the backfill vouches exactly the stranded level-6+ rows (an email on file, any active state), nobody below 6, nobody without an email");
  const auditRows = await q("select actor_id, action, resource_table, destructive, metadata from public.audit_log");
  check(auditRows.length === 1 && auditRows[0].action === "user.email_vouch_backfill" && auditRows[0].destructive === true && auditRows[0].actor_id === null
    && auditRows[0].resource_table === "users" && auditRows[0].metadata.actor_context === "migration_apply" && auditRows[0].metadata.count === 2
    && JSON.stringify([...auditRows[0].metadata.user_ids].sort()) === JSON.stringify([stranded, strandedOff].sort())
    && auditRows[0].metadata.migration === "0307_auth_lockout_reset_hardening",
    "B053 the backfill writes ONE destructive audit row (actor_context migration_apply) naming the ids it vouched");
  await pre.close();
}

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
  check((await db.query("select count(*)::int as n from public.audit_log")).rows[0].n === 0, "B053 with nobody stranded the backfill writes no audit row");
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
    // (the profile writer reads the old email with a plain select after the gate: the gate already holds the row)
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

  // ── B052: an email change retires the person's open reset links ──
  {
    const u = await user("agm", { email: "old-box@example.test", password_hash: HASH("victim"), email_verified: true });
    await member(u, SA);
    const other = await user("agm", { email: "someone-else@example.test", password_hash: HASH("else"), email_verified: true });
    await member(other, SA);
    const mine = await resetLink(u), theirs = await resetLink(other);
    // a name edit and a phone edit are not email changes: nothing is retired
    const nameOnly = await rpc(updateUserProfileCall({ actorId: gm, userId: u, patch: { name: "Renamed" } }));
    const phoneOnly = await rpc(updateUserProfileCall({ actorId: gm, userId: u, patch: { phone: "202-555-0100" } }));
    const sameEmail = await rpc(updateUserProfileCall({ actorId: gm, userId: u, patch: { email: "old-box@example.test" } }));
    const untouched = !(await linkConsumed(mine));
    const changed = await rpc(updateUserProfileCall({ actorId: gm, userId: u, patch: { email: "New-Box@example.test" } }));
    check(nameOnly.reset_links_retired === 0 && phoneOnly.reset_links_retired === 0 && sameEmail.email_changed === false && sameEmail.reset_links_retired === 0 && untouched
      && changed.email_changed === true && changed.reset_links_retired === 1 && (await linkConsumed(mine)) && !(await linkConsumed(theirs))
      && (await one("select email from public.users where id = $1", [u])).email === "new-box@example.test",
      "B052 an email change retires the person's open reset links; a name-only edit and another person's link are untouched");
    await refuses(() => consume(mine, HASH("attacker")), "token_consumed", "B052 the old address's link can no longer set the password");
    check((await one("select password_hash from public.users where id = $1", [u])).password_hash === HASH("victim"), "B052 … and the password is unchanged");
    // the writer's own refusals are unchanged, and a refused change retires nothing
    const again = await resetLink(u);
    await refuses(() => rpc(updateUserProfileCall({ actorId: gm, userId: u, patch: { email: "someone-else@example.test" } })), "email_taken",
      "B052 a taken email is still refused and retires nothing");
    check(!(await linkConsumed(again)), "B052 … the link survives the refused change");
  }

  // ── B053: the confirm-your-email issuer ──
  {
    let tokSeq = 0;
    const tokenHash = () => (++tokSeq).toString(16).padStart(64, "0"); // sha256-hex shaped, synthetic
    const in24h = () => new Date(Date.now() + 24 * 3600_000).toISOString();
    const issue = (actorId, userId, over = {}) => rpc(emailConfirmIssueCall({ actorId, userId, tokenHash: tokenHash(), expiresAt: in24h(), ...over }));
    const openLinks = async (u) => (await one("select count(*)::int as n from public.email_verifications where user_id = $1 and consumed_at is null", [u])).n;

    // the bug's own path: a shift lead (created without email auth) is promoted to AGM and given an email
    const p = await user("shift_lead", { pin_hash: HASH("sl") });
    await member(p, SA);
    await refuses(() => issue(gm, p), "email_confirm_not_available", "B053 a level-5 person gets no confirmation link");
    await rpc(setUserRoleCall({ actorId: gm, userId: p, role: "agm" }));
    check((await one("select email_verified as v from public.users where id = $1", [p])).v === false,
      "B053 (the bug) promotion shift_lead → agm leaves email_verified false: manager sign-in is refused");
    await refuses(() => issue(gm, p), "email_required", "B053 a promoted manager with no email on file is refused by name");
    await rpc(updateUserProfileCall({ actorId: gm, userId: p, patch: { email: "Promoted.Mgr@example.test" } }));
    const first = await issue(gm, p);
    const stored = await one("select user_id, expires_at > now() as live, consumed_at from public.email_verifications where id = $1", [first.id]);
    check(first.email === "promoted.mgr@example.test" && first.links_retired === 0 && stored.user_id === p && stored.live === true && stored.consumed_at === null,
      "B053 promotion shift_lead→agm of a person with an email → one open confirmation link, the address returned lowercased");
    // a resend replaces the link: at most ONE is ever live
    const second = await issue(gm, p);
    check(second.links_retired === 1 && (await openLinks(p)) === 1 && second.id !== first.id, "B053 a resend retires the older link: one live link at a time");
    // an email change retires the link mailed to the old address (0307's re-emitted profile writer)
    await rpc(updateUserProfileCall({ actorId: gm, userId: p, patch: { email: "right.address@example.test" } }));
    check((await openLinks(p)) === 0, "B053 an email change retires the confirmation link mailed to the old address");
    const third = await issue(gm, p);
    check(third.email === "right.address@example.test" && (await openLinks(p)) === 1, "B053 … and a new link goes to the new address");

    // once confirmed (what /api/auth/verify writes), no further link is issued
    await db.query("update public.users set email_verified = true, email_verified_at = now() where id = $1", [p]);
    await refuses(() => issue(gm, p), "email_already_confirmed", "B053 a confirmed email gets no further link");

    // the gate decides who may send: never a peer, never another shop's person, never oneself, never an AGM
    const SB = await shop();
    const elsewhere = await user("agm", { email: "elsewhere@example.test" });
    await member(elsewhere, SB);
    await refuses(() => issue(gm, elsewhere), "target_outside_shop", "B053 a GM cannot send a link to a manager at a shop they do not manage");
    const peerGm = await user("gm", { email: "peer@example.test" });
    await member(peerGm, SA);
    await refuses(() => issue(gm, peerGm), "forbidden", "B053 a GM cannot send a link to a peer");
    const agmActor = await user("agm", { email: "agm-actor@example.test", email_verified: true });
    await member(agmActor, SA);
    const target = await user("catering_mgr", { email: "cm@example.test" });
    await member(target, SA);
    await refuses(() => issue(agmActor, target), "forbidden", "B053 an AGM cannot send a link (GM and up only)");
    await refuses(() => issue(gm, gm), "forbidden", "B053 nobody issues a link for themselves");
    // an inactive manager, and the payload rules
    const off = await user("agm", { email: "off@example.test", active: false });
    await member(off, SA);
    await refuses(() => issue(gm, off), "email_confirm_not_available", "B053 an inactive manager gets no link");
    await refuses(() => issue(gm, target, { tokenHash: "raw-token-not-a-hash" }), "invalid_payload", "B053 anything but a sha-256 hex digest is refused (never a raw token)");
    await refuses(() => issue(gm, target, { expiresAt: new Date(Date.now() - 1000).toISOString() }), "invalid_payload", "B053 an expiry in the past is refused");
    await refuses(() => issue(gm, target, { expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() }), "invalid_payload", "B053 an expiry beyond 7 days is refused");
    check((await openLinks(target)) === 0 && (await openLinks(off)) === 0 && (await openLinks(elsewhere)) === 0, "B053 … and no refused call left a link behind");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await refuses(() => db.query("select public.auth_email_confirm_issue(null, null, null, null)"), "42501", `B053 ${role} cannot EXECUTE auth_email_confirm_issue`);
      await db.exec("reset role");
    }
  }

  // ── B159: the per-session re-check counter ──
  {
    const u = await user("agm", { pin_hash: HASH("re"), password_hash: HASH("re-pw"), email: "recheck@example.test", email_verified: true });
    const session = async () => (await mint(u, { kind: "pin", hash: HASH("re") })).sessionId;
    const row = (s) => one("select reauth_failed_count as n, revoked_at from public.sessions where id = $1", [s]);
    const col = await one(`select column_default as d, is_nullable as n from information_schema.columns
      where table_schema = 'public' and table_name = 'sessions' and column_name = 'reauth_failed_count'`);
    check(col.d === "0" && col.n === "NO", "B159 sessions.reauth_failed_count is NOT NULL DEFAULT 0 (existing sessions start at 0)");

    const s1 = await session();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await rpc(sessionReauthReserveCall(s1)));
    const after = await row(s1);
    check(results.slice(0, 5).every((r, i) => r.allowed === true && r.attempt === i + 1) && results[5].allowed === false && results[5].session_revoked === true
      && after.n === REAUTH_LIMIT && after.revoked_at !== null,
      "B159 five re-check reservations allowed, the sixth refused and the session revoked");
    const fifth = parseReauthReservation(results[4]);
    check(fifth !== null && reauthExhausted(fifth) && !reauthExhausted(parseReauthReservation(results[3])) && parseReauthReservation(results[5]).allowed === false,
      "B159 the lib reads the fifth reservation as the last one, the sixth as refused");
    const again = await rpc(sessionReauthReserveCall(s1));
    check(again.allowed === false && again.session_revoked === false, "B159 a revoked session gets no further re-check");
    check((await lockState(u)).until === null && (await one("select active from public.users where id = $1", [u])).active === true,
      "B159 the ACCOUNT is never locked or deactivated by re-checks (the person signs in again)");

    const s2 = await session();
    for (let i = 0; i < 4; i++) await rpc(sessionReauthReserveCall(s2));
    await rpc(sessionReauthClearCall(s2));
    const cleared = await row(s2);
    const next = await rpc(sessionReauthReserveCall(s2));
    check(cleared.n === 0 && cleared.revoked_at === null && next.allowed === true && next.attempt === 1, "B159 a success clears the count");

    // one session's wrong answers never touch another session of the same person
    const s3 = await session();
    check((await row(s3)).n === 0 && (await rpc(sessionReauthReserveCall(s3))).attempt === 1, "B159 the count is per session, not per person");
    const unknown = await rpc(sessionReauthReserveCall("00000000-0000-4000-8000-000000000000"));
    check(unknown.allowed === false && unknown.session_revoked === false, "B159 an unknown session is refused");
    await refuses(() => rpc({ fn: "session_reauth_reserve", args: { p_session: null } }), "invalid_payload", "B159 a null session is refused");
    await refuses(() => db.query("update public.sessions set reauth_failed_count = -1 where id = $1", [s3]), "sessions_reauth_failed_count_nonneg", "B159 the count can never go negative");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await refuses(() => db.query("select public.session_reauth_reserve(gen_random_uuid())"), "42501", `B159 ${role} cannot EXECUTE session_reauth_reserve`);
      await refuses(() => db.query("select public.session_reauth_clear(gen_random_uuid())"), "42501", `B159 ${role} cannot EXECUTE session_reauth_clear`);
      await db.exec("reset role");
    }
  }

  // ════ FIX ROUND 1 ════
  let hexSeq = 0;
  const sha = () => (0xf00000 + ++hexSeq).toString(16).padStart(64, "0"); // sha256-hex shaped, synthetic
  const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  /** What the route READS before it asks for a link: the account's id, the email it was looked up by, the stored hash. */
  const readAccount = async (email) => one("select id, email, password_hash from public.users where email = $1", [email]);
  /** The exact call POST /api/auth/password-reset-request makes with that read. */
  const issueReset = (seen, over = {}) => {
    const tokenHash = over.tokenHash ?? sha();
    return rpc(passwordResetIssueCall({ userId: seen.id, email: seen.email, seenPasswordHash: seen.password_hash,
      expiresAt: inHours(PASSWORD_RESET_EXPIRES_HOURS), ...over, tokenHash })).then((r) => ({ r, tokenHash }));
  };
  const openResets = async (u) => (await one("select count(*)::int as n from public.password_resets where user_id = $1 and consumed_at is null", [u])).n;
  const allResets = async (u) => (await one("select count(*)::int as n from public.password_resets where user_id = $1", [u])).n;
  /**
   * What a function HOLDS inside its own transaction: the per-person advisory key (the one 0279's gate takes) and
   * the users row (FOR UPDATE stamps xmax with this transaction; a write makes it the new version's xmin).
   */
  const heldLocks = async (u, run) => {
    await db.exec("begin");
    try {
      await run();
      return await one(`select
        (select count(*)::int from pg_locks where locktype = 'advisory' and granted and pid = pg_backend_pid()) as advisory_total,
        (select count(*)::int from pg_locks where locktype = 'advisory' and granted and pid = pg_backend_pid()
            and ((classid::bigint << 32) | objid::bigint) = hashtextextended('user-employment/' || $1::text, 0)) as advisory_person,
        (select xmax::text = (txid_current() % 4294967296)::text or xmin::text = (txid_current() % 4294967296)::text
           from public.users where id = $1::uuid) as row_locked`, [u]);
    } finally { await db.exec("rollback"); }
  };

  // ── R1: a reset link is issued by ONE locked step with the retirers (B052 / B157, review P2 #1) ──
  {
    // (the bug, kept as the reason the route no longer inserts by itself) read → email change → a PLAIN insert: the
    // change's retirement ran before the row existed, so the old mailbox holds a link the consumer accepts.
    const v = await user("agm", { email: "victim-old@example.test", password_hash: HASH("victim-pw"), email_verified: true });
    await member(v, SA);
    const stale = await readAccount("victim-old@example.test");
    await rpc(updateUserProfileCall({ actorId: gm, userId: v, patch: { email: "victim-new@example.test" } }));
    const escaped = await resetLink(stale.id); // the pre-fix route: its own insert, after the pause
    const took = await consume(escaped, HASH("attacker-pw"));
    check(took.user_id === v && (await one("select password_hash from public.users where id = $1", [v])).password_hash === HASH("attacker-pw"),
      "R1 (the bug) read → email change → a plain insert: the old address's link sets the password of the account at the new address");

    // the fix, same interleaving: the function revalidates the email it was given on the LOCKED row
    const u = await user("agm", { email: "mgr-old@example.test", password_hash: HASH("mgr-pw"), email_verified: true });
    await member(u, SA);
    const seen = await readAccount("mgr-old@example.test");
    await rpc(updateUserProfileCall({ actorId: gm, userId: u, patch: { email: "mgr-new@example.test" } }));
    await refuses(() => issueReset(seen), "email_changed", "R1 read → email change → issue: a request that read the old address is refused");
    check((await allResets(u)) === 0, "R1 … and no reset link was inserted for the old address");

    // the other order: the link is issued first, THEN the email changes — the change retires it (B052, now complete)
    const now = await readAccount("mgr-new@example.test");
    const first = await issueReset(now);
    const stored = await one("select user_id, issued_email, consumed_at, expires_at > now() as live from public.password_resets where id = $1", [first.r.id]);
    check(first.r.email === "mgr-new@example.test" && first.r.role === "agm" && stored.user_id === u && stored.issued_email === "mgr-new@example.test"
      && stored.consumed_at === null && stored.live === true,
      "R1 an eligible request issues ONE open link, bound to the address on the locked row (returned lowercased)");
    await rpc(updateUserProfileCall({ actorId: gm, userId: u, patch: { email: "mgr-third@example.test" } }));
    check((await openResets(u)) === 0, "R1 issue → email change: the change retires the link that was just issued");
    await refuses(() => consume(first.tokenHash, HASH("attacker-pw")), "token_consumed", "R1 … and that link can no longer set the password");

    // the binding itself: even a link that somehow ESCAPED retirement is good only for the address it was issued for
    await db.query("update public.password_resets set consumed_at = null where id = $1", [first.r.id]);
    await refuses(() => consume(first.tokenHash, HASH("attacker-pw")), "email_changed", "R1 a link issued for another address is refused by the consumer, retired or not");
    check((await one("select password_hash from public.users where id = $1", [u])).password_hash === HASH("mgr-pw")
      && !(await linkConsumed(first.tokenHash)), "R1 … the password is unchanged (and the refusal consumed nothing)");
    await db.query("update public.password_resets set consumed_at = now() where id = $1", [first.r.id]);

    // the reset generation: read → an ADMIN password set (which retires open links) → issue
    const g = await user("agm", { email: "gen@example.test", password_hash: HASH("gen-0"), email_verified: true });
    await member(g, SA);
    const beforeAdminSet = await readAccount("gen@example.test");
    await rpc(setUserCredentialCall({ actorId: gm, userId: g, kind: "password", hash: HASH("gen-1") }));
    await refuses(() => issueReset(beforeAdminSet), "credential_changed", "R1 read → admin password set → issue: the request read an older password generation");
    // … and read → a self-service RESET (which retires every open link) → issue
    const viaLink = await issueReset(await readAccount("gen@example.test"));
    const beforeReset = await readAccount("gen@example.test");
    await consume(viaLink.tokenHash, HASH("gen-2"));
    await refuses(() => issueReset(beforeReset), "credential_changed", "R1 read → self-service reset → issue: a link can not escape the reset's retirement");
    check((await openResets(g)) === 0, "R1 … after a reset the person has NO open link (the one used, the others, and none issued late)");
    // a request made AFTER the change is a new request on the new generation: it is served
    const fresh = await issueReset(await readAccount("gen@example.test"));
    check(typeof fresh.r.id === "string" && (await openResets(g)) === 1, "R1 a request that read the account after the reset gets its link");
    await consume(fresh.tokenHash, HASH("gen-3"));

    // eligibility is judged on the locked row, not on the request's read
    const e = await user("agm", { email: "elig@example.test", password_hash: HASH("elig"), email_verified: true });
    await member(e, SA);
    const seenE = await readAccount("elig@example.test");
    await rpc(setUserRoleCall({ actorId: gm, userId: e, role: "shift_lead" }));
    await refuses(() => issueReset(seenE), "role_not_email_auth", "R1 read → demotion below manager → issue");
    await rpc(setUserRoleCall({ actorId: gm, userId: e, role: "agm" }));
    await rpc(setUserActiveCall({ actorId: gm, userId: e, active: false }));
    await refuses(() => issueReset(seenE), "user_inactive", "R1 read → deactivation → issue");
    await db.query("update public.users set active = true, email_verified = false where id = $1", [e]);
    await refuses(() => issueReset(seenE), "email_not_verified", "R1 an unconfirmed email gets no reset link");
    await refuses(() => issueReset({ ...seenE, id: "00000000-0000-4000-8000-000000000000" }), "user_not_found", "R1 an unknown user");
    check((await allResets(e)) === 0, "R1 … and no refused request left a link behind");
    check(JSON.stringify([...PASSWORD_RESET_ISSUE_REFUSALS].sort()) === JSON.stringify(["credential_changed", "email_changed", "email_not_verified", "role_not_email_auth", "user_inactive", "user_not_found"]),
      "R1 every refusal exercised above is one the lib names (PASSWORD_RESET_ISSUE_REFUSALS)");

    // the payload rules: a hash, never a raw token; a short life
    await db.query("update public.users set email_verified = true where id = $1", [e]);
    const ok = await readAccount("elig@example.test");
    await refuses(() => issueReset(ok, { tokenHash: "raw-token-not-a-hash" }), "invalid_payload", "R1 anything but a sha-256 hex digest is refused (never a raw token)");
    await refuses(() => issueReset(ok, { expiresAt: inHours(-1) }), "invalid_payload", "R1 an expiry in the past is refused");
    await refuses(() => issueReset(ok, { expiresAt: inHours(3) }), "invalid_payload", "R1 an expiry beyond 2 hours is refused");
    await refuses(() => issueReset({ ...ok, email: "  " }), "invalid_payload", "R1 a blank email is refused");
    // case and padding never defeat the email check (the route sends it lowercased; the column may not be)
    const mixed = await issueReset({ ...ok, email: " ELIG@example.test " });
    check(mixed.r.email === "elig@example.test", "R1 the email check is case- and padding-insensitive");

    // the lock order: the per-person advisory key, then the users row — the SAME two the retirers hold
    const idle = await heldLocks(e, async () => { await one("select email from public.users where id = $1", [e]); });
    check(idle.advisory_total === 0 && idle.advisory_person === 0 && idle.row_locked === false,
      "R1 (control) the lock probe reads NOTHING held for a transaction that only read the row");
    const held = await heldLocks(e, () => issueReset(ok));
    check(held.advisory_total === 1 && held.advisory_person === 1 && held.row_locked === true,
      "R1 the issuer holds the per-person advisory lock (0279's key, and only it) and the users row lock to the end of its transaction");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await refuses(() => db.query("select public.auth_password_reset_issue(null, null, null, null, null)"), "42501", `R1 ${role} cannot EXECUTE auth_password_reset_issue`);
      await db.exec("reset role");
    }
  }

  // ── R2: "confirm your email" is ONE transaction (B053, review P2 #2) ──
  {
    const issueConfirm = async (u) => {
      const tokenHash = sha();
      const r = await rpc(emailConfirmIssueCall({ actorId: gm, userId: u, tokenHash, expiresAt: inHours(24) }));
      return { r, tokenHash };
    };
    const confirm = (tokenHash, passwordHash) => rpc(emailConfirmConsumeCall({ tokenHash, passwordHash }));
    const state = (u) => one("select password_hash, email, email_verified as v, email_verified_at as at, role, active from public.users where id = $1", [u]);
    const linkOpen = async (tokenHash) => (await one("select consumed_at from public.email_verifications where token_hash = $1", [tokenHash])).consumed_at === null;
    /** A promoted manager with an unconfirmed email, a PIN session live, and a link in their inbox. */
    const promoted = async (email) => {
      const u = await user("agm", { email, pin_hash: HASH("pin") });
      await member(u, SA);
      await db.query("insert into public.sessions (user_id) values ($1)", [u]);
      return { u, link: await issueConfirm(u) };
    };

    // the happy path: one transaction does all of it
    const a = await promoted("confirm-a@example.test");
    check((await one("select issued_email from public.email_verifications where id = $1", [a.link.r.id])).issued_email === "confirm-a@example.test",
      "R2 the issuer binds the link to the address it is mailed to");
    const strayReset = await resetLink(a.u);
    const done = await confirm(a.link.tokenHash, HASH("a-pw"));
    const sa = await state(a.u);
    check(done.user_id === a.u && done.role === "agm" && done.email === "confirm-a@example.test" && done.verification_id === a.link.r.id
      && done.sessions_revoked === 1 && done.reset_links_retired === 1
      && sa.password_hash === HASH("a-pw") && sa.v === true && sa.at !== null && !(await linkOpen(a.link.tokenHash))
      && (await liveSessions(a.u)) === 0 && (await linkConsumed(strayReset)),
      "R2 a confirmation writes the password, marks the email confirmed, consumes the link, revokes sessions and retires reset links — together");
    const signedIn = await mint(a.u, { kind: "password", hash: HASH("a-pw"), loginEmail: done.email });
    check(signedIn.r.session_id === signedIn.sessionId, "R2 … and the auto sign-in mints on the hash and the email the confirmation returned");
    await refuses(() => confirm(a.link.tokenHash, HASH("again")), "token_consumed", "R2 a used link is refused by name");

    // WRITE FAILURE during confirmation: nothing is burned
    const w = await promoted("confirm-w@example.test");
    await db.exec(`create function public.harness_fail_users() returns trigger language plpgsql as $f$ begin raise exception 'harness: users write failed'; end $f$;
      create trigger harness_fail_users before update on public.users for each row execute function public.harness_fail_users();`);
    await refuses(() => confirm(w.link.tokenHash, HASH("w-pw")), "harness: users write failed", "R2 (setup) the credential write fails inside the confirmation");
    const sw = await state(w.u);
    check((await linkOpen(w.link.tokenHash)) && sw.password_hash === null && sw.v === false && (await liveSessions(w.u)) === 1,
      "R2 a confirmation whose write fails rolls back the consume — the link is still usable, nothing changed, no session revoked");
    await db.exec("drop trigger harness_fail_users on public.users; drop function public.harness_fail_users();");
    await confirm(w.link.tokenHash, HASH("w-pw"));
    check((await state(w.u)).v === true && !(await linkOpen(w.link.tokenHash)), "R2 … the same link then succeeds");

    // EMAIL CHANGE during confirmation (the route read the link, was hashing, the admin changed the address)
    const c = await promoted("confirm-c@example.test");
    await rpc(updateUserProfileCall({ actorId: gm, userId: c.u, patch: { email: "replacement@example.test" } }));
    await refuses(() => confirm(c.link.tokenHash, HASH("c-pw")), "token_consumed", "R2 confirm → email change → consume: the change retired the link");
    const sc = await state(c.u);
    check(sc.password_hash === null && sc.v === false && sc.email === "replacement@example.test",
      "R2 … the replacement address is NOT confirmed and no password was written");
    // even a link that escaped that retirement confirms only the address it was mailed to
    await db.query("update public.email_verifications set consumed_at = null where token_hash = $1", [c.link.tokenHash]);
    await refuses(() => confirm(c.link.tokenHash, HASH("c-pw")), "email_changed", "R2 a link mailed to another address is refused, retired or not");
    check((await state(c.u)).v === false && (await linkOpen(c.link.tokenHash)), "R2 … and that refusal wrote and consumed nothing");

    // DEMOTION during confirmation: admin_user_set_role does not retire links — the consumer re-checks the role itself
    const d = await promoted("confirm-d@example.test");
    await rpc(setUserRoleCall({ actorId: gm, userId: d.u, role: "shift_lead" }));
    await refuses(() => confirm(d.link.tokenHash, HASH("d-pw")), "role_not_email_auth", "R2 confirm → demotion below manager → consume");
    const sd = await state(d.u);
    check(sd.password_hash === null && sd.v === false && (await linkOpen(d.link.tokenHash)) && (await liveSessions(d.u)) === 0,
      "R2 … no password, no confirmation, the link not consumed (the demotion's own session revoke stands)");
    await rpc(setUserRoleCall({ actorId: gm, userId: d.u, role: "agm" }));
    await confirm(d.link.tokenHash, HASH("d-pw"));
    check((await state(d.u)).v === true, "R2 … promoted again, the SAME link works (a refusal never burns it)");

    // DEACTIVATION during confirmation
    const x = await promoted("confirm-x@example.test");
    await rpc(setUserActiveCall({ actorId: gm, userId: x.u, active: false }));
    await refuses(() => confirm(x.link.tokenHash, HASH("x-pw")), "account_inactive", "R2 confirm → deactivation → consume");
    const sx = await state(x.u);
    check(sx.password_hash === null && sx.v === false && (await linkOpen(x.link.tokenHash)), "R2 … an inactive account gets no password and no confirmation");

    // the link's own state, and the payload
    const t = await promoted("confirm-t@example.test");
    await db.query("update public.email_verifications set expires_at = now() - interval '1 second' where token_hash = $1", [t.link.tokenHash]);
    await refuses(() => confirm(t.link.tokenHash, HASH("t-pw")), "token_expired", "R2 an expired link is refused by name");
    check(await linkOpen(t.link.tokenHash), "R2 … and an expired link is not consumed by the refusal");
    await refuses(() => confirm(sha(), HASH("t-pw")), "token_invalid", "R2 an unknown link is refused by name");
    await refuses(() => confirm(t.link.tokenHash, "short"), "invalid_payload", "R2 a malformed password hash is refused");
    check(JSON.stringify([...EMAIL_CONFIRM_CONSUME_REFUSALS].sort()) === JSON.stringify(["account_inactive", "email_changed", "role_not_email_auth", "token_consumed", "token_expired", "token_invalid"]),
      "R2 every refusal exercised above is one the lib names (EMAIL_CONFIRM_CONSUME_REFUSALS)");

    // a link issued BEFORE 0307 carries no address (the older scripts insert the row themselves): it still works,
    // and every check on the locked row still applies to it
    const l = await user("agm", { email: "legacy-link@example.test" });
    const legacy = sha();
    await db.query("insert into public.email_verifications (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')", [l, legacy]);
    await db.query("update public.users set role = 'key_holder' where id = $1", [l]);
    await refuses(() => confirm(legacy, HASH("l-pw")), "role_not_email_auth", "R2 a pre-0307 link is still refused for a person who is not a manager");
    await db.query("update public.users set role = 'agm' where id = $1", [l]);
    await confirm(legacy, HASH("l-pw"));
    check((await state(l)).v === true, "R2 a pre-0307 link (no address on it) still confirms an eligible manager");

    // the lock order: the per-person advisory key, then the users row, then the link — the reset consumer's order
    const k = await promoted("confirm-k@example.test");
    const held = await heldLocks(k.u, () => confirm(k.link.tokenHash, HASH("k-pw")));
    check(held.advisory_total === 1 && held.advisory_person === 1 && held.row_locked === true,
      "R2 the consumer holds the per-person advisory lock (0279's key, and only it) and the users row lock to the end of its transaction");
    check(await linkOpen(k.link.tokenHash), "R2 … (rolled back: the link is open again)");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await refuses(() => db.query("select public.auth_email_confirm_consume('a', 'b')"), "42501", `R2 ${role} cannot EXECUTE auth_email_confirm_consume`);
      await db.exec("reset role");
    }
  }
} catch (e) {
  failures++;
  console.error("FAIL harness threw:", e);
} finally {
  await db.close();
}
if (failures > 0) { console.error(`FAILED 0307: ${failures} of ${checks} checks`); process.exit(1); }
console.log(`PASS 0307: ${checks} checks`);
