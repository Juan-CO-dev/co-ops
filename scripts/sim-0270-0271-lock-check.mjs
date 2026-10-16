/**
 * Scheduling Phase 1 — the 0270 / 0271 LOCK proofs that PGlite (one session) cannot make. Run on the SIM ONLY, by CC,
 * after 0268 → 0271 are applied there and BEFORE they are applied to prod (CC's chunk F ruling (d), 2026-10-16):
 *
 *   SIM_DATABASE_URL='postgres://postgres:…@db.jepgzucrvklhqpthowsc.supabase.co:5432/postgres' \
 *     npx -y -p pg node scripts/sim-0270-0271-lock-check.mjs
 *
 * Needs the `pg` client (not a project dependency): `npx -y -p pg node …`, or `npm i --no-save pg` first.
 * THE GUARD (`simDatabaseTarget` in scripts/sim-0270-0271-lock-check-lib.mjs, Astra chunk G #2): it refuses to run
 * without SIM_DATABASE_URL, refuses a URL that names the PROD project, and otherwise PARSES the URL and accepts ONLY
 * the sim's effective destination — the direct host `db.jepgzucrvklhqpthowsc.supabase.co` as `postgres`, or an
 * approved us-east-1 Supabase pooler host as the sim tenant `postgres.jepgzucrvklhqpthowsc` — on port 5432, database
 * `postgres`, one host, no query override but `sslmode`. The client is built from that checked config, never from the
 * raw string. The ref is lib/sim-isolation-shared.ts SIM_PROJECT_REF (pinned equal by tests/sim-lock-check-guard.test.ts).
 * It never runs from CI and the builder never ran it.
 *
 * Three real sessions: A and B race; W (the watcher) sets up, proves that the loser is WAITING ON A LOCK (pg_locks /
 * pg_stat_activity) rather than racing, and checks the invariants afterwards.
 *
 *   1. 0270 — two concurrent FIRST saves of a shop's people settings serialize: B blocks on the per-shop ADVISORY lock
 *      `save_people_shop_settings` takes BEFORE its read (Astra chunk E #6), so it can never take the insert branch
 *      beside A and lose with 23505. Both sessions ROLL BACK; nothing persists.
 *   2. 0271 — two managers editing their own copies of ONE day at once: every writer locks the DAY ROW first, then the
 *      copy (`pm_copy_lock`), so B waits for A and both grades land; one live grade per key; the day stays open.
 *   3. 0271 — the closing manager's submit racing a late copy edit, both ways round, and two submits at once:
 *      (a) the edit holds the day row → the submit waits, then seals BOTH copies with the edit inside;
 *      (b) the submit holds the day row → the late edit waits, then is refused `report_already_submitted` by name
 *          and writes nothing;
 *      (c) two closing managers submit at once → the second answers {changed:false}; submitted_by is the first.
 *
 * Checks 2 and 3 need COMMITTED fixture rows (a second session cannot see an uncommitted day). W commits them, tagged,
 * on far-future business dates (2099-…) at one sim shop, and RETIRES them at the end the append-only way — the fixture
 * days are superseded (`superseded_at`) and a criterion it had to create is deactivated (`active = false`). Nothing is
 * ever deleted. After retiring, it RE-QUERIES and prints any fixture id still live; a failed retirement (or a row
 * still live) is a FAILURE (Astra chunk G #3). Exit 0 = every check passed; 1 = a check or the cleanup failed;
 * 2 = refused / not runnable.
 *
 * THE RETIRED 2099 ROWS REMAIN on the sim (CC's chunk G ruling 3: the sim is disposable; they are retired the
 * append-only way, never deleted). Recognise them as `pm_reports` rows with `format = 'v2'`, a `report_date` in 2099
 * and `superseded_at` set (plus their copies and grades), and — only when the shop had no shared criterion — a
 * `pm_criteria` row labelled `SIM lock check <epoch ms>`, sort 999, `active = false`. Every run prints their ids.
 */
import { retireLockFixture, simDatabaseTarget } from "./sim-0270-0271-lock-check-lib.mjs";

const target = simDatabaseTarget(process.env.SIM_DATABASE_URL);
if (!target.ok) { console.error(target.reason); process.exit(2); }
console.log(`sim target: ${target.config.host} as ${target.config.user} (${target.via})`);

let pg;
try { pg = (await import("pg")).default; }
catch { console.error("the `pg` client is missing — run with `npx -y -p pg node scripts/sim-0270-0271-lock-check.mjs`"); process.exit(2); }

const a = new pg.Client(target.config);
const b = new pg.Client(target.config);
const w = new pg.Client(target.config);
let failures = 0;
let refused = false;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };
const one = async (c, sql, params = []) => (await c.query(sql, params)).rows[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MANAGER_ROLES = ["key_holder", "shift_lead", "agm", "catering_mgr", "prep_mgr", "gm"];

/** Waits until `pid` is blocked on a lock; returns the lock types it is waiting for ([] = it never blocked). */
async function blockedOn(pid, ms = 5000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) {
    const r = await w.query("select locktype from pg_locks where pid = $1 and not granted", [pid]);
    if (r.rows.length) return r.rows.map((x) => x.locktype);
  }
  return [];
}
/** Starts a statement on `c` WITHOUT awaiting it; the promise settles to { ok, value } | { ok: false, error }. */
const race = (c, sql, params) => c.query(sql, params).then((r) => ({ ok: true, value: r.rows[0] }), (e) => ({ ok: false, error: String(e.message) }));
const begin = async (c) => { await c.query("begin"); await c.query("set local statement_timeout = '20s'"); await c.query("set local lock_timeout = '15s'"); };

const fixture = { days: [], criterion: null };
await a.connect(); await b.connect(); await w.connect();
const pidA = (await one(a, "select pg_backend_pid() as p")).p;
const pidB = (await one(b, "select pg_backend_pid() as p")).p;
try {
  const ready = await one(w, `select to_regprocedure('public.save_people_shop_settings(uuid,uuid,boolean,uuid)') is not null as s270,
                                    to_regprocedure('public.submit_pm_day_v2(uuid,uuid)') is not null as s271`);
  if (!ready.s270 || !ready.s271) throw Object.assign(new Error(`0270/0271 are not applied on this database: ${JSON.stringify(ready)}`), { refused: true });

  // ── 1. 0270: two first saves of one shop's settings serialize on the advisory lock ───────────────────────────
  const s1 = await one(w, `
    select (select id from public.locations l where l.active
              and not exists (select 1 from public.people_shop_settings s where s.location_id = l.id) order by id limit 1) as shop,
           (select id from public.users where active and role in ('moo', 'owner', 'cgs') order by id limit 1) as actor`);
  if (!s1.shop || !s1.actor) {
    check(false, `check 1 setup: needs an active shop with NO people_shop_settings row and an active MoO+ (${JSON.stringify(s1)})`);
  } else {
    const save = "select public.save_people_shop_settings($1, $2, false, null) as r";
    await begin(a);
    const first = await one(a, save, [s1.actor, s1.shop]);
    check(first.r.before === null, "1: A's save is a FIRST save (no row before)");
    await begin(b);
    const pB = race(b, save, [s1.actor, s1.shop]);
    const waits = await blockedOn(pidB);
    check(waits.includes("advisory"), `1: B waits on the per-shop ADVISORY lock, taken before its read (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("rollback");
    const rB = await pB;
    check(rB.ok, `1: B completes once A is gone, with no 23505 (${rB.ok ? "ok" : rB.error})`);
    await b.query("rollback");
    const left = await one(w, "select count(*)::int as n from public.people_shop_settings where location_id = $1", [s1.shop]);
    check(left.n === 0, "1: nothing persisted (both sessions rolled back)");
  }

  // ── fixture for 2 and 3: one shop, two managers, a subject, a shared criterion, four open v2 days ───────────
  const f = await one(w, `
    with m as (
      select ul.location_id, u.id from public.user_locations ul join public.users u on u.id = ul.user_id
       where ul.active and u.active and u.role = any($1::text[]))
    select l.id as shop,
           (select id from m where m.location_id = l.id order by id limit 1) as m1,
           (select id from m where m.location_id = l.id order by id offset 1 limit 1) as m2
      from public.locations l
     where l.active and (select count(*) from m where m.location_id = l.id) >= 2
     order by l.id limit 1`, [MANAGER_ROLES]);
  if (!f?.shop || !f.m1 || !f.m2) throw new Error(`sim has no shop with two KH+ managers: ${JSON.stringify(f)}`);
  const subject = (await one(w, `select u.id from public.user_locations ul join public.users u on u.id = ul.user_id
     where ul.location_id = $1 and ul.active and u.active and u.id <> all($2::uuid[]) order by u.id limit 1`, [f.shop, [f.m1, f.m2]]))?.id ?? f.m2;
  let crit = (await one(w, "select id from public.pm_criteria where location_id = $1 and position_id is null and active order by sort, id limit 1", [f.shop]))?.id;
  if (!crit) {
    crit = (await one(w, `insert into public.pm_criteria (location_id, position_id, label, label_es, sort, created_by)
      values ($1, null, $2, $2, 999, $3) returning id`, [f.shop, `SIM lock check ${Date.now()}`, f.m1])).id;
    fixture.criterion = crit;
  }
  const newDay = async () => {
    const date = (await one(w, `select (date '2099-01-01' + n)::text as d from generate_series(0, 3650) n
      where not exists (select 1 from public.pm_reports r where r.location_id = $1 and r.report_date = date '2099-01-01' + n and r.superseded_at is null)
      order by n limit 1`, [f.shop])).d;
    const day = (await one(w, `insert into public.pm_reports (location_id, report_date, status, created_by, format)
      values ($1, $2, 'open', $3, 'v2') returning id`, [f.shop, date, f.m1])).id;
    fixture.days.push(day);
    const c1 = (await one(w, "select public.open_pm_copy($1, $2) as r", [f.m1, day])).r.id;
    const c2 = (await one(w, "select public.open_pm_copy($1, $2) as r", [f.m2, day])).r.id;
    return { day, c1, c2 };
  };
  const grade = "select public.save_pm_copy_grade($1, $2, $3, null, $4, $5) as r";
  const submit = "select public.submit_pm_day_v2($1, $2) as r";

  // ── 2. two managers edit their own copies of one day at once ───────────────────────────────────────────────
  {
    const d = await newDay();
    await begin(a);
    await one(a, grade, [f.m1, d.c1, subject, crit, "great"]);
    await begin(b);
    const pB = race(b, grade, [f.m2, d.c2, subject, crit, "good"]);
    const waits = await blockedOn(pidB);
    check(waits.length > 0, `2: B's edit waits for A's (the day row is locked first; waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("commit");
    const rB = await pB;
    check(rB.ok, `2: B's edit lands after A commits (${rB.ok ? "ok" : rB.error})`);
    await b.query("commit");
    const live = await one(w, `select count(*)::int as n, count(distinct (copy_id, subject_id, criterion_id))::int as keys
      from public.pm_copy_grades where copy_id = any($1::uuid[]) and superseded_at is null`, [[d.c1, d.c2]]);
    check(live.n === 2 && live.keys === 2, `2: both grades are live, one per key (live ${live.n}, keys ${live.keys})`);
    const state = await one(w, `select r.status, (select array_agg(status order by id) from public.pm_report_copies where pm_report_id = r.id) as copies
      from public.pm_reports r where r.id = $1`, [d.day]);
    check(state.status === "open" && state.copies.every((s) => s === "open"), `2: the day and both copies are still open (${JSON.stringify(state)})`);
  }

  // ── 3a. a late edit holds the day row; the closing manager's submit waits, then seals it in ────────────────
  {
    const d = await newDay();
    await begin(b);
    await one(b, grade, [f.m2, d.c2, subject, crit, "needs_work"]);
    await begin(a);
    const pA = race(a, submit, [f.m1, d.day]);
    const waits = await blockedOn(pidA);
    check(waits.length > 0, `3a: the submit waits for the in-flight edit (waiting on: ${waits.join(",") || "nothing"})`);
    await b.query("commit");
    const rA = await pA;
    check(rA.ok && rA.value.r.changed === true && rA.value.r.sealed === 2, `3a: the submit then seals both copies (${JSON.stringify(rA)})`);
    await a.query("commit");
    const after = await one(w, `select r.status, r.submitted_by,
        (select count(*)::int from public.pm_report_copies c where c.pm_report_id = r.id and c.status = 'sealed') as sealed,
        (select count(*)::int from public.pm_copy_grades g where g.copy_id = $2 and g.superseded_at is null) as edit
      from public.pm_reports r where r.id = $1`, [d.day, d.c2]);
    check(after.status === "submitted" && after.submitted_by === f.m1 && after.sealed === 2 && after.edit === 1,
      `3a: submitted by the closing manager, both copies sealed, the late edit kept (${JSON.stringify(after)})`);
  }

  // ── 3b. the submit holds the day row; the late edit waits, then is refused by name ─────────────────────────
  {
    const d = await newDay();
    await begin(a);
    const rA = await one(a, submit, [f.m1, d.day]);
    check(rA.r.changed === true, "3b: the submit runs first");
    await begin(b);
    const pB = race(b, grade, [f.m2, d.c2, subject, crit, "great"]);
    const waits = await blockedOn(pidB);
    check(waits.length > 0, `3b: the late edit waits for the submit (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("commit");
    const rB = await pB;
    check(!rB.ok && rB.error.includes("report_already_submitted"), `3b: the late edit is refused report_already_submitted (${rB.ok ? "it SUCCEEDED" : rB.error})`);
    await b.query("rollback");
    const edits = await one(w, "select count(*)::int as n from public.pm_copy_grades where copy_id = $1", [d.c2]);
    check(edits.n === 0, "3b: the refused edit wrote nothing on the sealed copy");
  }

  // ── 3c. two closing managers submit at once ─────────────────────────────────────────────────────────────────
  {
    const d = await newDay();
    await begin(a);
    const rA = await one(a, submit, [f.m1, d.day]);
    await begin(b);
    const pB = race(b, submit, [f.m2, d.day]);
    const waits = await blockedOn(pidB);
    check(waits.length > 0, `3c: the second submit waits for the first (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("commit");
    const rB = await pB;
    check(rA.r.changed === true && rB.ok && rB.value.r.changed === false, `3c: first {changed:true}, second {changed:false} (${JSON.stringify(rB)})`);
    await b.query("commit");
    const after = await one(w, `select r.submitted_by, r.submitted_at,
        (select array_agg(distinct c.sealed_at) from public.pm_report_copies c where c.pm_report_id = r.id) as sealed_at
      from public.pm_reports r where r.id = $1`, [d.day]);
    check(after.submitted_by === f.m1 && after.sealed_at.length === 1 && +after.sealed_at[0] === +after.submitted_at,
      `3c: one submitter, every copy sealed ONCE at that submit (${JSON.stringify(after)})`);
  }
} catch (e) {
  if (e.refused) { refused = true; console.error(e.message); }
  else { failures++; console.error(`FAIL the check could not complete: ${e.message}`); }
} finally {
  await a.query("rollback").catch(() => {});
  await b.query("rollback").catch(() => {});
  // Retire the fixture the append-only way (supersede the days, deactivate a criterion this run created; never
  // delete), then RE-QUERY: a failed retirement or a row still live fails the run, and is named.
  const cleanup = await retireLockFixture(w, fixture);
  for (const e of cleanup.errors) console.error(`FAIL ${e}`);
  failures += cleanup.failures;
  console.log(`fixture: days ${JSON.stringify(fixture.days)}${fixture.criterion ? `, criterion ${fixture.criterion}` : ""}`);
  if (cleanup.stillLive.days.length || cleanup.stillLive.criterion) {
    console.error(`FAIL fixture still LIVE after cleanup: days ${JSON.stringify(cleanup.stillLive.days)}${cleanup.stillLive.criterion ? `, criterion ${cleanup.stillLive.criterion}` : ""}`);
  } else if (fixture.days.length || fixture.criterion) console.log("ok   fixture retired (re-queried: nothing still live)");
  await a.end(); await b.end(); await w.end();
}
if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
else if (refused) process.exitCode = 2;
else console.log("\nPASS 0270/0271 locks: first settings saves serialize; concurrent copy edits, late edits and double submits never corrupt a day");
