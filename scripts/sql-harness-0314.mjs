/** Offline 0314 proof (W13/B075, B076, B178). Ephemeral in-memory PGlite only: no credentials,
 * no network. Runs the REAL 0046 release body, then the REAL 0314 file, against a minimal schema.
 * Every date is relative to the harness clock (the ET day in SQL), so results never depend on the
 * time of day. PGlite has ONE backend, so the advisory lock is structural here; the two-session
 * cap proof lives in scripts/sim/checklist-0314-midday-cap-lock-check-management.mjs (sim, CC).
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g, '\n');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = id(1), shop = id(2), closingTmpl = id(3), midTmpl = id(4), amTmpl = id(5), otherShop = id(6);
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }

const release0046 = read('0046_state_finalize_columns_and_auto_release.sql')
  .match(/CREATE OR REPLACE FUNCTION release_overdue_closings[\s\S]*?\n\$\$;/)?.[0];
const migration = read('0314_closing_release_floor_midday_create.sql');

async function setup(releaseBody = release0046) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges grant execute on functions to anon, authenticated;
    create table users(id uuid primary key);
    create table audit_log(id bigserial primary key, actor_id uuid, actor_role text, action text, resource_table text,
      resource_id uuid, before_state jsonb, after_state jsonb, metadata jsonb, destructive boolean, created_at timestamptz default now());
    create table checklist_templates(id uuid primary key, location_id uuid, type text, prep_subtype text, active boolean default true);
    create table checklist_instances(id uuid primary key default gen_random_uuid(), template_id uuid references checklist_templates,
      location_id uuid, date date, shift_start_at timestamptz, status text default 'open',
      finalized_at_actor_type text, triggered_by_user_id uuid references users, triggered_at timestamptz,
      allows_multiple_per_day boolean default false, created_at timestamptz default now());
    grant all on all tables in schema public to service_role;
    insert into users values ('${actor}');
    insert into checklist_templates values ('${closingTmpl}','${shop}','closing',null,true),
      ('${midTmpl}','${shop}','prep','mid_day_prep',true), ('${amTmpl}','${shop}','prep','am_prep',true);`);
  check(Boolean(releaseBody), '0046 release body extracted');
  await db.exec(releaseBody);
  await db.exec(`revoke all on function release_overdue_closings(uuid[]) from public, anon, authenticated;
    grant execute on function release_overdue_closings(uuid[]) to service_role;`);
  return db;
}
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
const etToday = `(now() at time zone 'America/New_York')::date`;

async function seedClosings(db) {
  // (a) today, opened 17 h ago  (b) two days ago  (c) today+3  (d) yesterday, opened 10 h ago
  await db.exec(`insert into checklist_instances(id, template_id, location_id, date, shift_start_at) values
    ('${id(10)}','${closingTmpl}','${shop}', ${etToday},     now() - interval '17 hours'),
    ('${id(11)}','${closingTmpl}','${shop}', ${etToday} - 2, now() - interval '17 hours'),
    ('${id(12)}','${closingTmpl}','${shop}', ${etToday} + 3, now() - interval '17 hours'),
    ('${id(13)}','${closingTmpl}','${shop}', ${etToday} - 1, now() - interval '10 hours');`);
}
const statusOf = async (db, n) => (await one(db, `select status, finalized_at_actor_type from checklist_instances where id = $1`, [id(n)]));

async function releaseCases(db) {
  await db.exec('begin');
  try {
    await seedClosings(db);
    await db.exec('set local role service_role');
    const released = (await one(db, `select release_overdue_closings(null) n`)).n;
    check((await statusOf(db, 10)).status === 'open', "(a) today's closing opened 17 h ago is NOT released before the morning after");
    const b = await statusOf(db, 11);
    check(b.status === 'auto_finalized' && b.finalized_at_actor_type === 'system_auto', '(b) a closing two days old is released');
    check((await statusOf(db, 12)).status === 'open', '(c) a future-dated closing is never released before its day (B076)');
    check((await statusOf(db, 13)).status === 'open', '(d) yesterday + only 10 h: the 16 h rule still applies');
    check(released === 1, `exactly one release, got ${released}`);
    const audit = await one(db, `select count(*)::int n, max(metadata->>'release_not_before') nb, max(metadata->>'grace_hours') g
      from audit_log where action = 'closing.released_unfinalized' and resource_id = $1`, [id(11)]);
    check(audit.n === 1 && audit.nb !== null && audit.g === '16', 'one audit row with release_not_before and the 16 h grace');
    check((await one(db, `select release_overdue_closings(array['${otherShop}']::uuid[]) n`)).n === 0, 'location filter kept');
  } finally { await db.exec('rollback'); }
}

async function midDayCases(db) {
  const create = (date, tmpl = midTmpl, cap = 2, loc = shop) => one(db,
    `select create_mid_day_prep_instance_atomic($1,$2,${date},$3,$4) r`, [tmpl, loc, actor, cap]);
  const refuses = async (run, expected) => {
    await db.exec('savepoint s'); let error;
    try { await run(); } catch (e) { error = e; }
    await db.exec('rollback to savepoint s');
    check(error?.message === expected, `expected ${expected}, got ${error?.message ?? 'success'}`);
  };
  await db.exec('begin');
  try {
    await db.exec('set local role service_role');
    const first = (await create(etToday)).r, second = (await create(etToday)).r, third = (await create(etToday)).r;
    check(first.ok && second.ok && first.id !== second.id, 'two creates succeed');
    check(third.ok === false && third.reason === 'cap_reached' && third.cap === 2, 'the third is cap_reached');
    const rows = await one(db, `select count(*)::int n, bool_and(allows_multiple_per_day) m, bool_and(status = 'open') o,
      bool_and(triggered_by_user_id = '${actor}' and shift_start_at = triggered_at) t
      from checklist_instances where template_id = '${midTmpl}'`);
    check(rows.n === 2 && rows.m && rows.o && rows.t, 'exactly two open multi-per-day rows, stamped like the app insert');
    await refuses(() => create(`${etToday} - 1`), 'date_not_today');
    await refuses(() => create(`${etToday} + 1`), 'date_not_today');
    await refuses(() => create(etToday, amTmpl), 'template_mismatch');
    await refuses(() => create(etToday, closingTmpl), 'template_mismatch');
    await refuses(() => create(etToday, midTmpl, 2, otherShop), 'template_mismatch');
    await refuses(() => create(etToday, midTmpl, 0), 'invalid_cap');
    await refuses(() => create(etToday, midTmpl, 11), 'invalid_cap');
  } finally { await db.exec('rollback'); }
}

async function contracts(db) {
  const rows = (await db.query(`select proname, oid, prosecdef, proconfig from pg_proc
    where proname in ('release_overdue_closings','create_mid_day_prep_instance_atomic') order by proname`)).rows;
  check(rows.length === 2, 'both functions present once');
  for (const r of rows) {
    check(r.prosecdef && r.proconfig.includes('search_path=pg_catalog, public'), `${r.proname}: definer + search path`);
    for (const role of ['anon', 'authenticated']) {
      check(!(await one(db, `select has_function_privilege($1, $2::oid, 'EXECUTE') ok`, [role, r.oid])).ok, `${r.proname}: ${role} cannot execute`);
    }
    check((await one(db, `select has_function_privilege('service_role', $1::oid, 'EXECUTE') ok`, [r.oid])).ok, `${r.proname}: service_role executes`);
  }
  check((await one(db, `select count(*)::int n from audit_log where action = 'security.grants_change'
    and metadata->>'migration' = '0314_closing_release_floor_midday_create'`)).n === 1, 'one migration audit row');
}

let db, broken;
try {
  // Broken variant: the REAL 0046 body alone releases today's 17 h-old closing mid-shift (B075).
  broken = await setup();
  await broken.exec('begin');
  await seedClosings(broken);
  await broken.exec('select release_overdue_closings(null)');
  const bugged = await statusOf(broken, 10), future = await statusOf(broken, 12);
  check(bugged.status === 'auto_finalized' && future.status === 'auto_finalized', 'the 0046 body reproduces B075 and B076');
  await broken.exec('rollback');
  console.log("EXPECTED FAIL 0314 broken variant: 0046 alone released today's closing (opened 17 h ago) and a closing dated today+3");

  db = await setup();
  await db.exec(migration);
  let refused = false;
  try { await db.exec(migration); } catch (e) { refused = /0314: release floor already present/.test(e.message); await db.exec('rollback'); }
  check(refused, 'a second apply is refused by the pre-flight');
  await contracts(db);
  await releaseCases(db);
  await midDayCases(db);
  console.log(`PASS 0314: ${checks} checks; two-session cap lock proof NOT RUN (sim only)`);
} catch (e) { console.error(`FAIL 0314: ${e.stack ?? e}`); process.exitCode = 1; }
finally { if (db) await db.close(); if (broken) await broken.close(); }
