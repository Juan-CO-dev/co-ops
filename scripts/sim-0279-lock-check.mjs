/**
 * Staff separations / GM user management — the 0279 TWO-SESSION proofs that PGlite (one session) cannot make (Astra's
 * review of c649ed52, BC-042/040 and BC-007/004). Run on the SIM ONLY, by CC, right after 0279 is applied there and
 * BEFORE it is applied to prod:
 *
 *   SIM_DATABASE_URL='postgres://postgres:…@db.jepgzucrvklhqpthowsc.supabase.co:5432/postgres' \
 *     npx -y -p pg node scripts/sim-0279-lock-check.mjs
 *
 * Needs the `pg` client (not a project dependency): `npx -y -p pg node …`, or `npm i --no-save pg` first.
 * THE GUARD is the one scripts/sim-0270-0271-lock-check.mjs and sim-0278 use (`simDatabaseTarget`,
 * scripts/sim-0270-0271-lock-check-lib.mjs): no SIM_DATABASE_URL, a URL naming the PROD project, or anything that is not
 * the sim's effective destination exits 2 BEFORE the `pg` client is even loaded; the client is built from the checked
 * config, never the raw string. It never runs from CI and the builder never ran it (no SIM_DATABASE_URL on that machine).
 *
 * Three real sessions: A and B race; W (the watcher) sets up, proves a waiter is WAITING ON A LOCK (pg_locks, not
 * granted) rather than racing, and checks the result.
 *
 *   1. THE LOCK ORDER (BC-042/040). `user_admin_lock(X, Y)` and `user_admin_lock(Y, X)` fired at the same time from two
 *      sessions, ROUNDS times each way round, every round rolled back: never a deadlock (40P01) — the gate locks the two
 *      users rows in sorted id order, so the two calls queue. Each round: exactly one call passes (the higher rank acting
 *      on the lower) and the other is refused by name (`forbidden`), never a lock error. Then the held case: A holds
 *      `user_admin_lock(X, Y)`, B's `user_admin_lock(Y, X)` WAITS on a row lock, A rolls back, B ends `forbidden`.
 *   2. ADD USER vs A STALE ACTOR (BC-007/004). A MoO-or-above M demotes (then, separately, deactivates) a GM G inside a
 *      held transaction; G's `admin_user_create` at G's shop WAITS on G's row; A commits; B is refused `forbidden` and
 *      NOTHING is inserted. W restores G (role, then active) through the same writers.
 *   3. ADD USER vs A REHIRE SETTING FLIP (Astra BC-007/004 r2). A fixture person P (created for the run, then separated with
 *      rehire OK) shares the new person's phone; A corrects P's setting to "not eligible" inside a held transaction (the
 *      employment writer's gate holds P's row FOR UPDATE); G's UNCONFIRMED create with that phone WAITS on P's row (every
 *      identity candidate is locked, whatever its setting); A commits; the create is refused `rehire_match`, nothing inserted.
 *
 * THE FIXTURE: nothing of check 1 persists (every round rolls back). Check 2 commits the demotion / deactivation of G and
 * then restores G with `admin_user_set_role` / `admin_user_set_active` (append-only audit is the lib's; these direct calls
 * write no audit row). G's live sessions on the sim are revoked by those writers — the sim is disposable (CC's chunk G
 * ruling 3). The would-be new user is named `SIM lock check <epoch ms>`; if one was created (a FAILURE), it is deactivated
 * and its id printed. Check 3's P (`SIM lock check P <epoch ms>`) stays on the sim separated (inactive, "not eligible") and is
 * printed by id. Exit 0 = every check passed; 1 = a check or the restore failed; 2 = refused / not runnable.
 */
import { simDatabaseTarget } from "./sim-0270-0271-lock-check-lib.mjs";

const target = simDatabaseTarget(process.env.SIM_DATABASE_URL);
if (!target.ok) { console.error(target.reason); process.exit(2); }
console.log(`sim target: ${target.config.host} as ${target.config.user} (${target.via})`);

let pg;
try { pg = (await import("pg")).default; }
catch { console.error("the `pg` client is missing — run with `npx -y -p pg node scripts/sim-0279-lock-check.mjs`"); process.exit(2); }

const ROUNDS = 40;
const a = new pg.Client(target.config);
const b = new pg.Client(target.config);
const w = new pg.Client(target.config);
let failures = 0;
let refused = false;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
const one = async (c, sql, params = []) => (await c.query(sql, params)).rows[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
/**
 * Astra BC-030/042: each session rolls back AS SOON AS ITS OWN statement settles (the rollback is chained onto that
 * statement's promise), so the session that passed releases its locks at once and the other one is never left waiting
 * for its peer until the lock timeout. Settles to the statement's own result.
 */
const settleThenRollback = (c, sql, params) => race(c, sql, params).then(async (r) => { await c.query("rollback").catch(() => {}); return r; });
const begin = async (c) => { await c.query("begin"); await c.query("set local statement_timeout = '20s'"); await c.query("set local lock_timeout = '15s'"); };

const LOCK = "select public.user_admin_lock($1::uuid, $2::uuid) as r";
// admin_user_create by NAMED arguments — the list is pinned equal to the migration's signature (tests/sim-0279-lock-check-guard).
const CREATE = `select public.admin_user_create(p_actor => $1::uuid, p_name => $2, p_role => 'employee', p_email => null, p_phone => $3,
  p_pin_hash => $4, p_password_hash => null, p_locations => $5::uuid[], p_toast_guid => null, p_rehire_confirmed => false,
  p_rehire_user_ids => '{}'::uuid[], p_rehire_reason => null) as r`;
const EMPLOYMENT = "select public.record_user_employment_event(p_actor => $1::uuid, p_user => $2::uuid, p_expected => $3::uuid, p_kind => $4, p_fields => $5::jsonb) as r";
const DUMMY_HASH = `$2b$10$${"x".repeat(53)}`;

const fixture = { m: null, g: null, shop: null, gRole: null, gActive: null, createdIds: [], name: `SIM lock check ${Date.now()}`, p: null };
await a.connect(); await b.connect(); await w.connect();
const pidB = (await one(b, "select pg_backend_pid() as p")).p;
try {
  const ready = await one(w, `select to_regprocedure('public.user_admin_lock(uuid,uuid)') is not null as gate,
    to_regprocedure('public.admin_user_create(uuid,text,text,text,text,text,text,uuid[],text,boolean,uuid[],text)') is not null as create_fn`);
  if (!ready.gate || !ready.create_fn) throw Object.assign(new Error(`0279 is not applied on this database: ${JSON.stringify(ready)}`), { refused: true });

  // ── fixture: M (MoO and up, active), G (an active GM with an active shop), Y (an active hourly person) ──
  const f = await one(w, `
    with m as (select id from public.users where active and role in ('owner', 'cgs', 'moo') order by array_position(array['owner', 'cgs', 'moo'], role), id limit 1),
         g as (select u.id, ul.location_id from public.users u join public.user_locations ul on ul.user_id = u.id and ul.active
                where u.active and u.role = 'gm' order by u.id, ul.location_id limit 1),
         y as (select id from public.users where active and role in ('employee', 'trainee', 'key_holder', 'shift_lead') order by id limit 1)
    select (select id from m) as m, (select id from g) as g, (select location_id from g) as shop, (select id from y) as y`);
  if (!f?.m || !f.g || !f.y) throw Object.assign(new Error(`sim needs an active MoO+, an active GM with a shop and an active hourly person: ${JSON.stringify(f)}`), { refused: true });
  Object.assign(fixture, { m: f.m, g: f.g, shop: f.shop });
  console.log(`fixture: M ${f.m}, G ${f.g} at ${f.shop}, Y ${f.y}`);

  // ── 1a. (X,Y) and (Y,X) at the same time, both ways round, ROUNDS times: never a deadlock ──
  const X = f.m, Y = f.y;
  let deadlocks = 0, lockErrors = 0, passes = 0, forbidden = 0;
  for (let i = 0; i < ROUNDS; i++) {
    await begin(a); await begin(b);
    const [first, second] = i % 2 === 0 ? [[a, X, Y], [b, Y, X]] : [[a, Y, X], [b, X, Y]];
    const [r1, r2] = await Promise.all([settleThenRollback(first[0], LOCK, [first[1], first[2]]), settleThenRollback(second[0], LOCK, [second[1], second[2]])]);
    for (const r of [r1, r2]) {
      if (r.ok) passes++;
      else if (r.code === "40P01") deadlocks++;
      else if (r.code === "55P03" || r.code === "57014") lockErrors++;
      else if (/forbidden/.test(r.error)) forbidden++;
    }
  }
  check(deadlocks === 0, `1a: ${ROUNDS} rounds of (X,Y) ‖ (Y,X): no deadlock (40P01 seen: ${deadlocks})`);
  check(lockErrors === 0, `1a: … no lock timeout either (seen: ${lockErrors})`);
  check(passes === ROUNDS && forbidden === ROUNDS, `1a: each round one passes (higher acting on lower) and one is refused forbidden (${passes} / ${forbidden})`);

  // ── 1b. held: A holds (X,Y); B's (Y,X) waits on a row lock; A rolls back; B is refused by name ──
  {
    await begin(a);
    const held = await race(a, LOCK, [X, Y]);
    check(held.ok, `1b: A holds user_admin_lock(X, Y) (${held.ok ? "ok" : held.error})`);
    await begin(b);
    const pB = race(b, LOCK, [Y, X]);
    const waits = await blockedOn(pidB);
    check(waits.length > 0, `1b: B's user_admin_lock(Y, X) WAITS on a lock (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("rollback");
    const rB = await pB;
    check(!rB.ok && /forbidden/.test(rB.error) && rB.code !== "40P01", `1b: once A is gone, B ends forbidden — never a deadlock (${rB.ok ? "it passed" : `${rB.code} ${rB.error}`})`);
    await b.query("rollback");
  }

  // ── 2. Add user vs a stale actor (demotion, then deactivation) ──
  const g0 = await one(w, "select role, active from public.users where id = $1", [f.g]);
  fixture.gRole = g0.role; fixture.gActive = g0.active;
  const created = async () => (await w.query("select id from public.users where name = $1", [fixture.name])).rows.map((r) => r.id);
  for (const [label, sql, params] of [
    ["demoted", "select public.admin_user_set_role($1::uuid, $2::uuid, 'employee') as r", [f.m, f.g]],
    ["deactivated", "select public.admin_user_set_active($1::uuid, $2::uuid, false) as r", [f.m, f.g]],
  ]) {
    await begin(a);
    const change = await race(a, sql, params);
    check(change.ok, `2 (${label}): A ${label} G inside a held transaction (${change.ok ? "ok" : change.error})`);
    await begin(b);
    const pB = race(b, CREATE, [f.g, fixture.name, null, DUMMY_HASH, [f.shop]]);
    const waits = await blockedOn(pidB);
    check(waits.length > 0, `2 (${label}): G's admin_user_create WAITS on G's row (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("commit");
    const rB = await pB;
    if (rB.ok && rB.value?.r?.id) fixture.createdIds.push(rB.value.r.id);
    check(!rB.ok && /forbidden/.test(rB.error), `2 (${label}): once the ${label === "demoted" ? "demotion" : "deactivation"} commits, the create is refused forbidden (${rB.ok ? `it CREATED ${JSON.stringify(rB.value)}` : rB.error})`);
    await b.query(rB.ok ? "commit" : "rollback");
    check((await created()).length === 0, `2 (${label}): nothing was inserted`);
    // restore G through the same writers
    if (label === "demoted") await w.query("select public.admin_user_set_role($1::uuid, $2::uuid, $3) as r", [f.m, f.g, fixture.gRole]);
    else await w.query("select public.admin_user_set_active($1::uuid, $2::uuid, $3) as r", [f.m, f.g, fixture.gActive]);
  }

  // ── 3. Add user vs a rehire setting flip (every identity candidate locked, the setting read under the lock) ──
  {
    let phone = null;
    for (let i = 0; i < 20 && !phone; i++) {
      const p = `202${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
      const taken = await one(w, "select count(*)::int as n from public.users where public.user_admin_phone_key(phone) = $1", [p]);
      if (taken.n === 0) phone = p;
    }
    if (!phone) throw new Error("no free fixture phone after 20 tries");
    const pName = `SIM lock check P ${Date.now()}`;
    const madeP = await one(w, CREATE, [f.m, pName, phone, DUMMY_HASH, [f.shop]]).catch((e) => { throw Object.assign(new Error(`check 3 fixture: M could not create P at G's shop (${e.message})`), { refused: true }); });
    fixture.p = madeP.r.id;
    const fields = { separationType: "other", lastDayWorked: new Date().toISOString().slice(0, 10), reason: "SIM lock check fixture", rehire: "yes" };
    const sep = await one(w, EMPLOYMENT, [f.m, fixture.p, null, "separated", JSON.stringify(fields)]);
    await begin(a);
    const flip = await race(a, EMPLOYMENT, [f.m, fixture.p, sep.r.id, "correction",
      JSON.stringify({ correctsId: sep.r.id, ...fields, rehire: "no", rehireNote: "SIM lock check: not eligible" })]);
    check(flip.ok, `3: A flips P's rehire setting to not eligible inside a held transaction (${flip.ok ? "ok" : flip.error})`);
    await begin(b);
    const name3 = `${fixture.name} (3)`;
    const pB = race(b, CREATE, [f.g, name3, phone, DUMMY_HASH, [f.shop]]);
    const waits = await blockedOn(pidB);
    check(waits.length > 0, `3: G's unconfirmed create sharing P's phone WAITS on P's row (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("commit");
    const rB = await pB;
    if (rB.ok && rB.value?.r?.id) fixture.createdIds.push(rB.value.r.id);
    check(!rB.ok && /rehire_match/.test(rB.error), `3: once the flip commits, the unconfirmed create is refused rehire_match (${rB.ok ? `it CREATED ${JSON.stringify(rB.value)}` : rB.error})`);
    await b.query(rB.ok ? "commit" : "rollback");
    check((await w.query("select id from public.users where name = $1", [name3])).rows.length === 0, "3: nothing was inserted");
  }
} catch (e) {
  if (e.refused) { refused = true; console.error(e.message); }
  else { failures++; console.error(`FAIL the check could not complete: ${e.message}`); }
} finally {
  await a.query("rollback").catch(() => {});
  await b.query("rollback").catch(() => {});
  // Restore G (role and active) if a step stopped half-way, then re-query; a created user (a FAILURE) is deactivated.
  if (fixture.g && fixture.gRole) {
    try {
      const now = await one(w, "select role, active from public.users where id = $1", [fixture.g]);
      if (now.role !== fixture.gRole) await w.query("select public.admin_user_set_role($1::uuid, $2::uuid, $3) as r", [fixture.m, fixture.g, fixture.gRole]);
      if (now.active !== fixture.gActive) await w.query("select public.admin_user_set_active($1::uuid, $2::uuid, $3) as r", [fixture.m, fixture.g, fixture.gActive]);
      const after = await one(w, "select role, active from public.users where id = $1", [fixture.g]);
      check(after.role === fixture.gRole && after.active === fixture.gActive, `restore: G is back to ${fixture.gRole}, active ${fixture.gActive} (${JSON.stringify(after)})`);
    } catch (e) { failures++; console.error(`FAIL restore: ${e.message}`); }
  }
  for (const id of fixture.createdIds) {
    await w.query("select public.admin_user_set_active($1::uuid, $2::uuid, false) as r", [fixture.m, id]).catch((e) => console.error(`FAIL retiring ${id}: ${e.message}`));
  }
  console.log(`fixture: M ${fixture.m}, G ${fixture.g} (sessions revoked by the writers), shop ${fixture.shop}; unexpected users created (deactivated): ${JSON.stringify(fixture.createdIds)}`);
  if (fixture.p) console.log(`fixture: P ${fixture.p} stays on the sim, separated (inactive, not eligible for rehire)`);
  await a.end(); await b.end(); await w.end();
}
if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
else if (refused) process.exitCode = 2;
else console.log("\nPASS 0279 locks: the gate never deadlocks ((A,B) ‖ (B,A) queue); Add user is refused once its actor is demoted or deactivated, and once a matched person's rehire setting flips");
