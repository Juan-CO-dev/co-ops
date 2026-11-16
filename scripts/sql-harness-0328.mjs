/** Offline 0328 proof (W21/B116). Ephemeral in-memory PGlite only: no credentials, no network.
 * Runs the REAL 0217 station_business_date body, then the REAL 0328 file, against a minimal schema.
 * The broken variant is 0217's own rule evaluated at explicit instants (its `now()` bound to the
 * instant): it keeps an open closing's day until 12:30 the next day, so a 07:00 claim lands on
 * yesterday. Instants are fixed UTC values chosen to cross EDT, EST and both DST changes.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g, '\n');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const shop = id(1), otherShop = id(2), closingTmpl = id(3), otherClosing = id(4), amTmpl = id(5);
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }

const body0217 = read('0217_assignments_stations.sql')
  .match(/create or replace function public\.station_business_date\(p_location_id uuid\)[\s\S]*?\n\$\$;/)?.[0];
const migration = read('0328_station_business_date_cutoff.sql');

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges grant execute on functions to anon, authenticated;
    create table audit_log(id bigserial primary key, actor_id uuid, actor_role text, action text, resource_table text,
      resource_id uuid, before_state jsonb, after_state jsonb, metadata jsonb, destructive boolean, created_at timestamptz default now());
    create table checklist_templates(id uuid primary key, location_id uuid, type text, active boolean default true);
    create table checklist_instances(id uuid primary key default gen_random_uuid(), template_id uuid references checklist_templates,
      location_id uuid, date date, shift_start_at timestamptz, status text default 'open', created_at timestamptz default now());
    grant all on all tables in schema public to service_role;
    insert into checklist_templates values ('${closingTmpl}','${shop}','closing',true), ('${otherClosing}','${otherShop}','closing',true),
      ('${amTmpl}','${shop}','prep',true);`);
  check(Boolean(body0217), '0217 station_business_date body extracted');
  await db.exec(body0217);
  await db.exec(`revoke all on function public.station_business_date(uuid) from public, anon, authenticated;
    grant execute on function public.station_business_date(uuid) to service_role;`);
  return db;
}
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

/** One open closing for `date`, opened at `start` (UTC), at `loc`; returns its id. */
async function closing(db, n, date, start, { loc = shop, tmpl = closingTmpl, status = 'open' } = {}) {
  await db.query(`insert into checklist_instances(id, template_id, location_id, date, shift_start_at, status) values ($1,$2,$3,$4,$5,$6)`,
    [id(n), tmpl, loc, date, start, status]);
  return id(n);
}

// Instants (UTC) → expected business day. D = 2026-10-14 (EDT, UTC-4); the closing opens 20:30 ET.
const NORMAL = [
  ['2026-10-15T00:00:00Z', '2026-10-14', '20:00 ET on D, before the closing opened: the calendar day'],
  ['2026-10-15T03:30:00Z', '2026-10-14', '23:30 ET: the open closing holds D'],
  ['2026-10-15T04:30:00Z', '2026-10-14', '00:30 ET on D+1: still D (past midnight)'],
  ['2026-10-15T04:59:00Z', '2026-10-14', '00:59 ET: still D'],
  ['2026-10-15T05:00:00Z', '2026-10-15', '01:00 ET: the cutoff, D+1'],
  ['2026-10-15T11:00:00Z', '2026-10-15', '07:00 ET: the morning crew works on D+1 (B116)'],
];
// Fall back: D = 2026-10-31, closing 20:30 EDT (00:30Z). 01:00 happens twice on 11-01.
const FALL = [
  ['2026-11-01T04:59:00Z', '2026-10-31', '00:59 EDT: D'],
  ['2026-11-01T05:00:00Z', '2026-11-01', 'the FIRST 01:00 (EDT): D+1'],
  ['2026-11-01T06:30:00Z', '2026-11-01', '01:30 EST (the repeated hour): stays D+1, never flips back'],
];
// Spring forward: D = 2026-03-07, closing 20:30 EST (01:30Z on 03-08).
const SPRING = [
  ['2026-03-08T05:59:00Z', '2026-03-07', '00:59 EST: D'],
  ['2026-03-08T06:00:00Z', '2026-03-08', '01:00 EST: D+1'],
  ['2026-03-08T07:30:00Z', '2026-03-08', '03:30 EDT: D+1'],
];

async function cutoffCases(db, fn) {
  const at = async (instant, loc = shop) => iso((await one(db, `select ${fn}($1::uuid, $2::timestamptz) d`, [loc, instant])).d);
  await db.exec('begin');
  try {
    await closing(db, 10, '2026-10-14', '2026-10-15T00:30:00Z');
    for (const [instant, expected, label] of NORMAL) {
      const got = await at(instant);
      check(got === expected, `${fn} ${label}: expected ${expected}, got ${got}`);
    }
    check(await at('2026-10-15T11:00:00Z', otherShop) === '2026-10-15', 'another shop is never held by this shop\'s closing');
    // A closing confirmed at 00:30 releases the day at once, cutoff or not.
    await db.exec(`update checklist_instances set status = 'confirmed' where id = '${id(10)}'`);
    check(await at('2026-10-15T04:45:00Z') === '2026-10-15', 'a confirmed closing holds nothing');
    await closing(db, 11, '2026-10-31', '2026-11-01T00:30:00Z');
    for (const [instant, expected, label] of FALL) check(await at(instant) === expected, `${fn} fall back, ${label}`);
    await closing(db, 12, '2026-03-07', '2026-03-08T01:30:00Z');
    for (const [instant, expected, label] of SPRING) check(await at(instant) === expected, `${fn} spring forward, ${label}`);
    // A non-closing (prep) instance never holds the day.
    await db.query(`insert into checklist_instances(template_id, location_id, date, shift_start_at) values ($1,$2,'2026-05-01','2026-05-01T23:00:00Z')`, [amTmpl, shop]);
    check(await at('2026-05-02T04:30:00Z') === '2026-05-02', 'an open prep instance never holds the day');
  } finally { await db.exec('rollback'); }
}

/** The live wrapper delegates at now(): checked against the ET clock, so it holds at any time of day. */
async function wrapperCases(db) {
  await db.exec('begin');
  try {
    const clock = await one(db, `select (now() at time zone 'America/New_York')::date today,
      ((now() at time zone 'America/New_York')::time < time '01:00') before_cutoff`);
    const today = iso(clock.today);
    const yesterday = iso((await one(db, `select ($1::date - 1) d`, [today])).d);
    await db.query(`insert into checklist_instances(template_id, location_id, date, shift_start_at) values ($1,$2,$3, now() - interval '3 hours')`,
      [closingTmpl, shop, yesterday]);
    await db.exec('set local role service_role');
    const got = iso((await one(db, `select public.station_business_date($1::uuid) d`, [shop])).d);
    const want = clock.before_cutoff ? yesterday : today;
    check(got === want, `station_business_date(uuid) delegates at now(): expected ${want}, got ${got}`);
    const same = await one(db, `select public.station_business_date($1::uuid) = public.station_business_date_at($1::uuid, now()) ok`, [shop]);
    check(same.ok, 'the wrapper equals station_business_date_at(loc, now())');
  } finally { await db.exec('rollback'); }
}

async function contracts(db) {
  const rows = (await db.query(`select proname, oid, prosecdef, provolatile, proconfig, pg_get_function_identity_arguments(oid) args
    from pg_proc where proname in ('station_business_date','station_business_date_at') order by proname`)).rows;
  check(rows.length === 2, 'both functions present once');
  check(rows[0].args === 'p_location_id uuid', 'station_business_date keeps its 0217 signature');
  check(rows[1].args === 'p_location_id uuid, p_at timestamp with time zone', 'station_business_date_at(uuid, timestamptz)');
  for (const r of rows) {
    check(r.prosecdef && r.provolatile === 's' && r.proconfig.includes('search_path=pg_catalog, public'), `${r.proname}: stable definer + search path`);
    for (const role of ['anon', 'authenticated']) {
      check(!(await one(db, `select has_function_privilege($1, $2::oid, 'EXECUTE') ok`, [role, r.oid])).ok, `${r.proname}: ${role} cannot execute`);
    }
    check((await one(db, `select has_function_privilege('service_role', $1::oid, 'EXECUTE') ok`, [r.oid])).ok, `${r.proname}: service_role executes`);
  }
  check((await one(db, `select count(*)::int n from audit_log where action = 'security.grants_change'
    and metadata->>'migration' = '0328_station_business_date_cutoff'`)).n === 1, 'one migration audit row');
}

let db, broken;
try {
  // Broken variant: 0217's OWN rule with its now() bound to an explicit instant.
  broken = await setup();
  const at0217 = body0217
    .replace('create or replace function public.station_business_date(p_location_id uuid)', 'create function public.bd0217_at(p_location_id uuid, p_at timestamptz)')
    .replaceAll('now()', 'p_at');
  check(at0217 !== body0217 && !at0217.includes('now()'), '0217 body rebound to an instant');
  await broken.exec(at0217);
  await broken.exec('begin');
  await closing(broken, 10, '2026-10-14', '2026-10-15T00:30:00Z');
  const morning = iso((await one(broken, `select bd0217_at($1::uuid, '2026-10-15T11:00:00Z') d`, [shop])).d);
  check(morning === '2026-10-14', `0217 reproduces B116: 07:00 ET still on yesterday, got ${morning}`);
  await broken.exec('rollback');
  console.log('EXPECTED FAIL 0328 broken variant: 0217 keeps 07:00 ET on the open closing\'s day (2026-10-14)');

  db = await setup();
  await db.exec(migration);
  let refused = false;
  try { await db.exec(migration); } catch (e) { refused = /0328: station_business_date_at already exists/.test(e.message); await db.exec('rollback'); }
  check(refused, 'a second apply is refused by the pre-flight');
  await contracts(db);
  await cutoffCases(db, 'public.station_business_date_at');
  await wrapperCases(db);
  console.log(`PASS 0328: ${checks} checks`);
} catch (e) { console.error(`FAIL 0328: ${e.stack ?? e}`); process.exitCode = 1; }
finally { if (db) await db.close(); if (broken) await broken.close(); }
