/**
 * Audit wave W07 / migration 0307 — the TWO-SESSION proof that PGlite (one session) cannot make (review round 1: the
 * reset-link issuer and the two link consumers must WAIT for a retirer, and a retirer for them). Run on the SIM ONLY,
 * by CC, right after 0307 is applied there and BEFORE it is applied to prod:
 *
 *   SIM_DATABASE_URL='postgres://postgres:…@db.jepgzucrvklhqpthowsc.supabase.co:5432/postgres' \
 *     npx -y -p pg node scripts/sim-0307-lock-check.mjs
 *
 * Needs the `pg` client (not a project dependency): `npx -y -p pg node …`, or `npm i --no-save pg` first.
 * THE GUARD is the one the 0270/0271, 0278 and 0279 checks use (`simDatabaseTarget`,
 * scripts/sim-0270-0271-lock-check-lib.mjs): no SIM_DATABASE_URL, a URL naming the PROD project, or anything that is
 * not the sim's effective destination exits 2 BEFORE the `pg` client is even loaded; the client is built from the
 * checked config, never the raw string. It never runs from CI and THE BUILDER NEVER RAN IT (no SIM_DATABASE_URL on
 * that machine; its guard and shape are pinned by tests/sim-0307-lock-check-guard.test.ts).
 *
 * WHAT scripts/sql-harness-0307.mjs ALREADY PROVES (offline): for each ORDER in which an issuer / consumer and a
 * retirer commit, the outcome is right (R1 / R2), and each function holds the per-person advisory key and the users
 * row inside its transaction. WHAT IS LEFT, and is proven here with real sessions: that the two actually QUEUE.
 *
 * Three sessions: A holds, B is the one expected to wait, W (the watcher) sets up and reads pg_locks.
 * `user_admin_lock(M, T)` is 0279's ONE gate — the first statement of every admin retirer (the email change, the
 * admin password set, the role change, the deactivation) — so holding it IS holding what those writers hold.
 *
 *   1. A holds the gate on T → B's `auth_password_reset_issue` for T WAITS on the advisory key; A rolls back; B then
 *      decides on the row as it now stands (refused by name), never a lock error.
 *   2. A holds the gate on T → B's `auth_password_reset_consume` of a link of T's WAITS; then `token_consumed`.
 *   3. A holds the gate on T → B's `auth_email_confirm_consume` of a link of T's WAITS; then `token_consumed`.
 *   4. The other way round: A holds a (successful, uncommitted) `auth_password_reset_issue` for T → B's gate on T
 *      WAITS; A rolls back; B passes. (The retirer waits for the issuer, so its retirement SEES the new link.)
 *   5. The gate and the issuer fired at the same time, ROUNDS times, alternating who starts: never a deadlock
 *      (40P01), never a lock timeout.
 *
 * NOTHING IT DOES CAN CHANGE AN ACCOUNT. Every transaction of A and B is ROLLED BACK (the script never commits one),
 * and B's calls are refusals by construction: the issuer is given an address no account has (`email_changed`, decided
 * AFTER it took its locks), and the consumers are given links that W inserted ALREADY CONSUMED AND EXPIRED. Those two
 * fixture rows (one in password_resets, one in email_verifications, for T, dead from birth, their raw tokens never
 * existed) are the only rows that remain on the sim; they are printed by id. Check 4's issue is the one call that
 * would insert — a link whose raw token never existed — and it is rolled back like the rest. No hash is printed.
 * Exit 0 = every check passed; 1 = a check failed; 2 = refused / not runnable.
 */
import { randomBytes } from "node:crypto";
import { simDatabaseTarget } from "./sim-0270-0271-lock-check-lib.mjs";

const target = simDatabaseTarget(process.env.SIM_DATABASE_URL);
if (!target.ok) { console.error(target.reason); process.exit(2); }
console.log(`sim target: ${target.config.host} as ${target.config.user} (${target.via})`);

let pg;
try { pg = (await import("pg")).default; }
catch { console.error("the `pg` client is missing — run with `npx -y -p pg node scripts/sim-0307-lock-check.mjs`"); process.exit(2); }

const ROUNDS = 40;
const a = new pg.Client(target.config);
const b = new pg.Client(target.config);
const w = new pg.Client(target.config);
let failures = 0;
let refused = false;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
const one = async (c, sql, params = []) => (await c.query(sql, params)).rows[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = () => randomBytes(32).toString("hex"); // sha-256-hex shaped; no raw token ever existed for it

/** Waits until `pid` is blocked on a lock; returns the lock types it is waiting for ([] = it never blocked). */
async function blockedOn(pid, ms = 5000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) {
    const r = await w.query("select locktype from pg_locks where pid = $1 and not granted", [pid]);
    if (r.rows.length) return r.rows.map((x) => x.locktype);
  }
  return [];
}
/** Starts a statement WITHOUT awaiting it; settles to { ok, value } | { ok: false, error, code }. */
const race = (c, sql, params) => c.query(sql, params).then((r) => ({ ok: true, value: r.rows[0] }), (e) => ({ ok: false, error: String(e.message), code: e.code ?? null }));
/** Each racing session rolls back AS SOON AS ITS OWN statement settles, so the other is never left waiting for it. */
const settleThenRollback = (c, sql, params) => race(c, sql, params).then(async (r) => { await c.query("rollback").catch(() => {}); return r; });
const begin = async (c) => { await c.query("begin"); await c.query("set local statement_timeout = '20s'"); await c.query("set local lock_timeout = '15s'"); };
const isLockError = (r) => !r.ok && ["40P01", "55P03", "57014"].includes(r.code ?? "");

// The functions, by NAMED arguments — the lists are pinned equal to the lib's builders (tests/sim-0307-lock-check-guard).
const GATE = "select public.user_admin_lock($1::uuid, $2::uuid) as r";
const ISSUE = `select public.auth_password_reset_issue(p_user => $1::uuid, p_email => $2, p_seen_password_hash => $3, p_token_hash => $4,
  p_expires_at => now() + interval '30 minutes') as r`;
const RESET_CONSUME = "select public.auth_password_reset_consume(p_token_hash => $1, p_password_hash => $2) as r";
const CONFIRM_CONSUME = "select public.auth_email_confirm_consume(p_token_hash => $1, p_password_hash => $2) as r";
const DUMMY_HASH = `$2b$10$${"x".repeat(53)}`;
/** An address no account has: the issuer takes its locks, then refuses `email_changed` — it can never insert. */
const NOBODYS_EMAIL = "sim-0307-lock-check@invalid.example";

const fixture = { m: null, t: null, resetRow: null, confirmRow: null };
await a.connect(); await b.connect(); await w.connect();
const pidB = (await one(b, "select pg_backend_pid() as p")).p;
try {
  const ready = await one(w, `select to_regprocedure('public.user_admin_lock(uuid,uuid)') is not null as gate,
    to_regprocedure('public.auth_password_reset_issue(uuid,text,text,text,timestamptz)') is not null as issue,
    to_regprocedure('public.auth_password_reset_consume(text,text)') is not null as reset_consume,
    to_regprocedure('public.auth_email_confirm_consume(text,text)') is not null as confirm_consume`);
  if (!ready.gate || !ready.issue || !ready.reset_consume || !ready.confirm_consume) {
    throw Object.assign(new Error(`0307 (after 0279) is not applied on this database: ${JSON.stringify(ready)}`), { refused: true });
  }

  // ── fixture: M (MoO and up, active) and T (an active, email-verified manager BELOW M: a person a reset link is for) ──
  const f = await one(w, `
    with m as (select id, public.user_admin_role_level(role) as lvl from public.users where active and role in ('owner', 'cgs', 'moo')
                order by public.user_admin_role_level(role) desc, id limit 1)
    select (select id from m) as m,
      (select u.id from public.users u, m where u.active and u.id <> m.id and u.email is not null and btrim(u.email) <> ''
          and coalesce(u.email_verified, false) and public.user_admin_role_level(u.role) between 6 and m.lvl - 1
        order by u.id limit 1) as t`);
  if (!f?.m || !f.t) throw Object.assign(new Error(`sim needs an active MoO+ and an active email-verified manager below them: ${JSON.stringify(f)}`), { refused: true });
  Object.assign(fixture, { m: f.m, t: f.t });
  console.log(`fixture: M ${f.m}, T ${f.t}`);
  const M = f.m, T = f.t;

  // Two links of T's that are DEAD FROM BIRTH (consumed and expired): a consumer finds them, takes its locks, refuses.
  const resetToken = sha(), confirmToken = sha();
  fixture.resetRow = (await one(w, `insert into public.password_resets (user_id, token_hash, expires_at, consumed_at)
    values ($1::uuid, $2, now(), now()) returning id`, [T, resetToken])).id;
  fixture.confirmRow = (await one(w, `insert into public.email_verifications (user_id, token_hash, expires_at, consumed_at)
    values ($1::uuid, $2, now(), now()) returning id`, [T, confirmToken])).id;

  /** A holds the gate on T; `sql` (session B) must WAIT on the advisory key, then end in the named refusal. */
  async function waitsBehindGate(n, label, sql, params, refusal) {
    await begin(a);
    const held = await race(a, GATE, [M, T]);
    check(held.ok, `${n}: A holds user_admin_lock(M, T) (${held.ok ? "ok" : held.error})`);
    await begin(b);
    const pB = race(b, sql, params);
    const waits = await blockedOn(pidB);
    check(waits.includes("advisory"), `${n}: B's ${label} WAITS on the per-person advisory lock (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("rollback");
    const rB = await pB;
    check(!rB.ok && new RegExp(refusal).test(rB.error) && !isLockError(rB),
      `${n}: once A is gone, B ends ${refusal} — decided on the row as it stands, never a lock error (${rB.ok ? "it PASSED" : `${rB.code} ${rB.error}`})`);
    await b.query("rollback");
  }

  // ── 1–3. a retirer holds → the issuer and both consumers wait ──
  await waitsBehindGate(1, "auth_password_reset_issue", ISSUE, [T, NOBODYS_EMAIL, null, sha()], "email_changed");
  await waitsBehindGate(2, "auth_password_reset_consume", RESET_CONSUME, [resetToken, DUMMY_HASH], "token_consumed");
  await waitsBehindGate(3, "auth_email_confirm_consume", CONFIRM_CONSUME, [confirmToken, DUMMY_HASH], "token_consumed");

  // ── 4. the issuer holds → a retirer waits (so its retirement runs AFTER the link exists, and sees it) ──
  {
    const seen = await one(w, "select lower(btrim(email)) as email, password_hash from public.users where id = $1", [T]); // never printed
    const issuedToken = sha();
    await begin(a);
    const held = await race(a, ISSUE, [T, seen.email, seen.password_hash, issuedToken]);
    check(held.ok, `4: A holds a successful, uncommitted auth_password_reset_issue for T (${held.ok ? "ok" : held.error})`);
    await begin(b);
    const pB = race(b, GATE, [M, T]);
    const waits = await blockedOn(pidB);
    check(waits.includes("advisory"), `4: B's user_admin_lock(M, T) WAITS on the per-person advisory lock (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("rollback");
    const rB = await pB;
    check(rB.ok, `4: once A is gone, B's gate passes (${rB.ok ? "ok" : `${rB.code} ${rB.error}`})`);
    await b.query("rollback");
    check((await w.query("select 1 from public.password_resets where token_hash = $1", [issuedToken])).rows.length === 0, "4: A's rolled-back link does not exist");
  }

  // ── 5. the gate ‖ the issuer at the same time, both ways round, ROUNDS times: never a deadlock ──
  {
    let deadlocks = 0, lockErrors = 0, gatePasses = 0, issueRefused = 0;
    for (let i = 0; i < ROUNDS; i++) {
      await begin(a); await begin(b);
      const gate = [GATE, [M, T]], issue = [ISSUE, [T, NOBODYS_EMAIL, null, sha()]];
      const [first, second] = i % 2 === 0 ? [[a, ...gate], [b, ...issue]] : [[a, ...issue], [b, ...gate]];
      const [r1, r2] = await Promise.all([settleThenRollback(first[0], first[1], first[2]), settleThenRollback(second[0], second[1], second[2])]);
      for (const r of [r1, r2]) {
        if (r.ok) gatePasses++;
        else if (r.code === "40P01") deadlocks++;
        else if (r.code === "55P03" || r.code === "57014") lockErrors++;
        else if (/email_changed/.test(r.error)) issueRefused++;
      }
    }
    check(deadlocks === 0, `5: ${ROUNDS} rounds of gate ‖ issuer: no deadlock (40P01 seen: ${deadlocks})`);
    check(lockErrors === 0, `5: … no lock timeout either (seen: ${lockErrors})`);
    check(gatePasses === ROUNDS && issueRefused === ROUNDS, `5: every round the gate passes and the issuer is refused by name (${gatePasses} / ${issueRefused})`);
  }
} catch (e) {
  if (e.refused) { refused = true; console.error(e.message); }
  else { failures++; console.error(`FAIL the check could not complete: ${e.message}`); }
} finally {
  await a.query("rollback").catch(() => {});
  await b.query("rollback").catch(() => {});
  console.log(`fixture: M ${fixture.m}, T ${fixture.t}; dead-from-birth links left on the sim: password_resets ${fixture.resetRow}, email_verifications ${fixture.confirmRow}`);
  await a.end(); await b.end(); await w.end();
}
if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
else if (refused) process.exitCode = 2;
else console.log("\nPASS 0307 locks: the reset-link issuer and both link consumers wait for a retirer, a retirer waits for the issuer, and the two never deadlock");
