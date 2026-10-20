/**
 * Scheduling — the 0278 TWO-SESSION proof that PGlite (one session) cannot make (Astra's review of 011eda11, NIT).
 * Run on the SIM ONLY, by CC, right after 0278 is applied there and BEFORE it is applied to prod:
 *
 *   SIM_DATABASE_URL='postgres://postgres:…@db.jepgzucrvklhqpthowsc.supabase.co:5432/postgres' \
 *     npx -y -p pg node scripts/sim-0278-lock-check.mjs
 *
 * Needs the `pg` client (not a project dependency): `npx -y -p pg node …`, or `npm i --no-save pg` first.
 * THE GUARD is the one scripts/sim-0270-0271-lock-check.mjs uses (`simDatabaseTarget`, scripts/sim-0270-0271-lock-check-lib.mjs):
 * no SIM_DATABASE_URL, a URL naming the PROD project, or anything that is not the sim's effective destination (the
 * direct host as `postgres`, or an approved us-east-1 pooler host as `postgres.jepgzucrvklhqpthowsc`; port 5432;
 * database `postgres`; no query override but `sslmode`) exits 2 BEFORE the `pg` client is even loaded. The client is
 * built from the checked config, never from the raw string. It never runs from CI and the builder never ran it.
 *
 * Three real sessions: A and B race; W (the watcher) sets up, proves the loser is WAITING ON THE ADVISORY LOCK
 * (pg_locks, not granted) rather than racing, and checks the result. Both 0278 write paths:
 *
 *   1. save_schedule_person_settings (the staff card): A saves against head H0 inside a transaction and HOLDS it (the
 *      per-person lock `hashtextextended('schedule-person/<shop>/<user>', 0)` is taken before the read). B saves against
 *      the same H0 → B BLOCKS on the advisory lock. A commits → B is refused `person_settings_moved` by name and writes
 *      nothing (never a silent overwrite of A's row).
 *   2. merge_schedule_person_positions (the user-screen pickers): the same race against the new head H1 — A saves and
 *      holds, B's merge blocks, A commits → B is refused `person_settings_moved`.
 *
 * THE FIXTURE: schedule_person_settings is append-only (the latest row wins; nothing is ever deleted or updated). A's
 * rows are COPIES of the subject's pre-run settings (H0's values, or the all-default row when the subject had none), so
 * the effective settings never change during the run. At the end W RETIRES the fixture the append-only way: one more
 * save, against the current head, of H0's values — which also proves the unmoved head still saves — then RE-QUERIES that
 * the head is that restore row and that its values equal H0's (a failure, or a mismatch, fails the run). It prints every
 * fixture row id. The rows REMAIN on the sim as history (the sim is disposable; CC's chunk G ruling 3): recognise them as
 * `schedule_person_settings` rows for the printed subject at the printed shop, `created_by` the printed actor, created
 * during the run. Exit 0 = every check passed; 1 = a check or the restore failed; 2 = refused / not runnable.
 */
import { simDatabaseTarget } from "./sim-0270-0271-lock-check-lib.mjs";

const target = simDatabaseTarget(process.env.SIM_DATABASE_URL);
if (!target.ok) { console.error(target.reason); process.exit(2); }
console.log(`sim target: ${target.config.host} as ${target.config.user} (${target.via})`);

let pg;
try { pg = (await import("pg")).default; }
catch { console.error("the `pg` client is missing — run with `npx -y -p pg node scripts/sim-0278-lock-check.mjs`"); process.exit(2); }

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
/** Starts a statement on `c` WITHOUT awaiting it; the promise settles to { ok, value } | { ok: false, error }. */
const race = (c, sql, params) => c.query(sql, params).then((r) => ({ ok: true, value: r.rows[0] }), (e) => ({ ok: false, error: String(e.message) }));
const begin = async (c) => { await c.query("begin"); await c.query("set local statement_timeout = '20s'"); await c.query("set local lock_timeout = '15s'"); };

/** A full-row save against `expected` ($4), whose VALUES are a copy of the row `$5` (null = the all-default row). */
const SAVE_COPY = `
  select public.save_schedule_person_settings($1::uuid, $2::uuid, $3::uuid, $4::uuid,
           s.work_type, coalesce(s.also_allowed, '{}'::text[]), s.leader_setting, coalesce(s.cover_positions, '{}'::uuid[]),
           s.soft_min_h, s.soft_max_h, coalesce(s.full_time, false), s.full_time_min_h, s.roster_include) as r
    from (select 1) one left join public.schedule_person_settings s on s.id = $5::uuid`;
/** The pickers' merge against `expected` ($4): it re-sends the head's own work type (no effective change). */
const MERGE_SAME = "select public.merge_schedule_person_positions($1::uuid, $2::uuid, $3::uuid, $4::uuid, jsonb_build_object('workType', $5::text)) as r";
const HEAD = `select id, work_type, also_allowed, leader_setting, cover_positions::text[] as cover_positions, soft_min_h, soft_max_h,
                     full_time, full_time_min_h, roster_include
                from public.schedule_person_settings where location_id = $1 and user_id = $2 order by created_at desc, id desc limit 1`;
const valuesOf = (row) => JSON.stringify(row ? { ...row, id: undefined } : null);
const DEFAULT_VALUES = { work_type: null, also_allowed: [], leader_setting: null, cover_positions: [], soft_min_h: null, soft_max_h: null,
  full_time: false, full_time_min_h: null, roster_include: null };

const fixture = { actor: null, shop: null, subject: null, h0: null, rows: [] };
await a.connect(); await b.connect(); await w.connect();
const pidA = (await one(a, "select pg_backend_pid() as p")).p;
const pidB = (await one(b, "select pg_backend_pid() as p")).p;
try {
  const ready = await one(w, `select to_regprocedure('public.save_schedule_person_settings(uuid,uuid,uuid,uuid,text,text[],text,uuid[],numeric,numeric,boolean,numeric,boolean)') is not null as save,
                                    to_regprocedure('public.merge_schedule_person_positions(uuid,uuid,uuid,uuid,jsonb)') is not null as merge`);
  if (!ready.save || !ready.merge) throw Object.assign(new Error(`0278 is not applied on this database: ${JSON.stringify(ready)}`), { refused: true });

  // ── the fixture: a MoO+ actor (the subject rule passes for an hourly subject below them), a shop, an hourly subject there.
  //    Prefer a subject who already has a settings row (A's copies are then exact copies of real values).
  const f = await one(w, `
    with actor as (select id from public.users where active and role in ('moo', 'owner', 'cgs')
                    order by array_position(array['owner', 'cgs', 'moo'], role), id limit 1),
         subj as (
           select ul.location_id as shop, u.id as subject,
                  exists (select 1 from public.schedule_person_settings s where s.location_id = ul.location_id and s.user_id = u.id) as has_row
             from public.user_locations ul join public.users u on u.id = ul.user_id join public.locations l on l.id = ul.location_id
            where ul.active and u.active and l.active and u.role in ('employee', 'trainer', 'trainee', 'shift_lead', 'key_holder')
              and u.id <> (select id from actor))
    select (select id from actor) as actor, shop, subject, has_row from subj order by has_row desc, shop, subject limit 1`);
  if (!f?.actor || !f.shop || !f.subject) throw Object.assign(new Error(`sim has no MoO+ actor and hourly subject at an active shop: ${JSON.stringify(f)}`), { refused: true });
  Object.assign(fixture, { actor: f.actor, shop: f.shop, subject: f.subject });
  const h0 = await one(w, HEAD, [f.shop, f.subject]);
  fixture.h0 = h0 ?? null;
  console.log(`fixture: actor ${f.actor}, shop ${f.shop}, subject ${f.subject}, head before the run ${h0?.id ?? "(none: the all-default row)"}`);
  const args = (expected, copyOf) => [f.actor, f.shop, f.subject, expected, copyOf];

  // ── 1. save vs save: B blocks on the per-person advisory lock; A commits; B → person_settings_moved ────────────
  {
    const h0id = h0?.id ?? null;
    await begin(a);
    const rA = await one(a, SAVE_COPY, args(h0id, h0id));
    check(!!rA?.r?.id, `1: A saves against the head (${h0id ?? "none"}) and holds its transaction (row ${rA?.r?.id})`);
    const held = await one(w, "select count(*)::int as n from pg_locks where pid = $1 and locktype = 'advisory' and granted", [pidA]);
    check(held.n >= 1, `1: A holds the advisory lock (granted advisory locks on A: ${held.n})`);
    await begin(b);
    const pB = race(b, SAVE_COPY, args(h0id, h0id));
    const waits = await blockedOn(pidB);
    check(waits.includes("advisory"), `1: B's save BLOCKS on the per-person ADVISORY lock (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("commit");
    if (rA?.r?.id) fixture.rows.push(rA.r.id);
    const rB = await pB;
    check(!rB.ok && /person_settings_moved/.test(rB.error), `1: once A commits, B is refused person_settings_moved (${rB.ok ? `it WROTE ${JSON.stringify(rB.value)}` : rB.error})`);
    if (rB.ok && rB.value?.r?.id) fixture.rows.push(rB.value.r.id);
    await b.query("rollback");
    const head = await one(w, HEAD, [f.shop, f.subject]);
    check(head?.id === rA?.r?.id, `1: the head is A's row; B wrote nothing (head ${head?.id})`);
  }

  // ── 2. save vs the pickers' merge: the same race on the new head ────────────────────────────────────────────
  {
    const h1 = (await one(w, HEAD, [f.shop, f.subject]))?.id ?? null;
    await begin(a);
    const rA = await one(a, SAVE_COPY, args(h1, h0?.id ?? null));
    check(!!rA?.r?.id, `2: A saves against the head (${h1}) and holds its transaction (row ${rA?.r?.id})`);
    await begin(b);
    const pB = race(b, MERGE_SAME, [f.actor, f.shop, f.subject, h1, h0?.work_type ?? null]);
    const waits = await blockedOn(pidB);
    check(waits.includes("advisory"), `2: B's picker merge BLOCKS on the per-person ADVISORY lock (waiting on: ${waits.join(",") || "nothing"})`);
    await a.query("commit");
    if (rA?.r?.id) fixture.rows.push(rA.r.id);
    const rB = await pB;
    check(!rB.ok && /person_settings_moved/.test(rB.error), `2: once A commits, B's merge is refused person_settings_moved (${rB.ok ? `it WROTE ${JSON.stringify(rB.value)}` : rB.error})`);
    if (rB.ok && rB.value?.r?.id) fixture.rows.push(rB.value.r.id);
    await b.query("rollback");
    const head = await one(w, HEAD, [f.shop, f.subject]);
    check(head?.id === rA?.r?.id, `2: the head is A's row; B's merge wrote nothing (head ${head?.id})`);
  }
} catch (e) {
  if (e.refused) { refused = true; console.error(e.message); }
  else { failures++; console.error(`FAIL the check could not complete: ${e.message}`); }
} finally {
  await a.query("rollback").catch(() => {});
  await b.query("rollback").catch(() => {});
  // Retire the fixture the append-only way: one more save of the pre-run values against the CURRENT head (this also
  // proves an unmoved head saves), then re-query that the head is that row and carries the pre-run values.
  if (fixture.rows.length) {
    try {
      const cur = (await one(w, HEAD, [fixture.shop, fixture.subject]))?.id ?? null;
      const r = await one(w, SAVE_COPY, [fixture.actor, fixture.shop, fixture.subject, cur, fixture.h0?.id ?? null]);
      fixture.rows.push(r.r.id);
      const head = await one(w, HEAD, [fixture.shop, fixture.subject]);
      const want = valuesOf(fixture.h0 ?? { id: null, ...DEFAULT_VALUES });
      check(head?.id === r.r.id && valuesOf(head) === want,
        `restore: the head is the restore row ${r.r.id} and carries the pre-run values (${head?.id === r.r.id ? valuesOf(head) : `head ${head?.id}`})`);
    } catch (e) { failures++; console.error(`FAIL restore: ${e.message}`); }
  }
  console.log(`fixture rows (schedule_person_settings, append-only history; the last is the restore): ${JSON.stringify(fixture.rows)}`);
  if (fixture.subject) console.log(`fixture subject ${fixture.subject} at shop ${fixture.shop}, written by ${fixture.actor}; pre-run head ${fixture.h0?.id ?? "(none)"}`);
  await a.end(); await b.end(); await w.end();
}
if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
else if (refused) process.exitCode = 2;
else console.log("\nPASS 0278 locks: a concurrent save or picker merge waits on the per-person lock, then is refused person_settings_moved — never a silent overwrite");
