/** Offline 0330 proof (W23/B126, B127, B129 + W23-4 b, B209). Ephemeral in-memory PGlite only: no
 * credentials, no network. Loads the REAL 0229 reconcile_ezcater_toast body, then the REAL 0330 file,
 * over a minimal schema. plan_ezcater_toast is a stub that reads a fixture table (0330 never changes
 * the planner). PGlite has ONE backend, so lock WAITS are not provable here; what is proven is the
 * lock COUNT a reconcile takes (pg_locks inside its own transaction). The at-scale proof (~4,000
 * orders: out of shared memory before, success after) is
 * scripts/sim/ezcater-0330-reconcile-lock-check-management.mjs, sim only, run by CC.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g, '\n');
const id = (p, n) => `00000000-0000-4000-${p}-${String(n).padStart(12, '0')}`;
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }

const reconcile0229 = read('0229_ezcater_toast_reconcile.sql')
  .match(/create function public\.reconcile_ezcater_toast[\s\S]*?\nend \$\$;/)?.[0];
const migration = read('0330_ezcater_catering_records_fixes.sql');
const ACTOR = id('8000', 1), EMPLOYEE = id('8000', 2), SHOP = id('8000', 3);

async function setup(n = 300) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges grant execute on functions to anon, authenticated;
    create table users(id uuid primary key, role text not null, active boolean not null default true);
    create table audit_log(id bigserial primary key, actor_id uuid, actor_role text, action text, resource_table text,
      resource_id uuid, metadata jsonb, destructive boolean, created_at timestamptz default now());
    create table catering_companies(id uuid primary key default gen_random_uuid(), name text not null, notes text,
      claimed_by_customer_id uuid, claimed_at timestamptz, active boolean not null default true,
      created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid);
    create table catering_company_domains(id uuid primary key default gen_random_uuid(), company_id uuid not null references catering_companies(id),
      domain text not null, active boolean not null default true, created_at timestamptz not null default now(), created_by uuid);
    create unique index catering_company_domains_one_active on catering_company_domains (lower(domain)) where active;
    create table catering_customers(id uuid primary key default gen_random_uuid(), company_id uuid references catering_companies(id),
      email text, active boolean default true);
    create table catering_pipeline(id uuid primary key, stage text not null, lead_source text, external_ref text,
      location_id uuid, updated_at timestamptz default now());
    create table catering_pipeline_events(id uuid primary key default gen_random_uuid(), pipeline_id uuid not null references catering_pipeline(id),
      from_stage text, to_stage text not null, note text, actor_id uuid, created_at timestamptz default now());
    create table ezcater_events(id uuid primary key default gen_random_uuid(), entity_id text, event_key text,
      signature_valid boolean not null, received_at timestamptz not null default now());
    create table ezcater_orders(id uuid primary key default gen_random_uuid(), provider_uuid text not null unique,
      location_id uuid, lead_id uuid references catering_pipeline(id), status text, pending_event_key text);
    create table customer_orders(id uuid primary key default gen_random_uuid(), source_kind text not null,
      ezcater_order_id uuid references ezcater_orders(id), toast_order_guid text, voided_at timestamptz);
    create table ezcater_toast_links(id uuid primary key default gen_random_uuid(), order_id uuid not null, snapshot_id uuid not null,
      location_id uuid not null, toast_snapshot_id uuid not null, order_guid text not null, check_guid text not null,
      selection_guid text not null, business_date date not null, evidence text not null, is_current boolean not null default true,
      amount_diff_cents bigint, amount_mismatch boolean not null default false, reconciliation_details jsonb not null default '{}'::jsonb);
    create table harness_plan(order_id uuid, snapshot_id uuid, location_id uuid, toast_snapshot_id uuid, order_guid text, check_guid text,
      selection_guid text, business_date date, evidence text, amount_diff_cents bigint, amount_mismatch boolean, reconciliation_details jsonb);
    create function plan_ezcater_toast() returns table(order_id uuid, snapshot_id uuid, location_id uuid, toast_snapshot_id uuid,
      order_guid text, check_guid text, selection_guid text, business_date date, evidence text, amount_diff_cents bigint,
      amount_mismatch boolean, reconciliation_details jsonb)
      language sql stable security definer set search_path = pg_catalog, public as $p$ select * from public.harness_plan $p$;
    create table ezcater_review_queue(id uuid primary key default gen_random_uuid(), order_id uuid, location_id uuid, source text,
      code text, resolved_at timestamptz);
    create table ezcater_reconciliation_status(order_id uuid, location_id uuid, event_date date, rule text);
    create table ezcater_review_resolutions(id uuid primary key default gen_random_uuid(), review_id uuid not null unique,
      rule text not null, created_at timestamptz not null default clock_timestamp());
    grant all on all tables in schema public to service_role;
    insert into users values ('${ACTOR}', 'catering_mgr', true), ('${EMPLOYEE}', 'employee', true);`);
  check(Boolean(reconcile0229), '0229 reconcile body extracted');
  await db.exec(reconcile0229);
  await db.exec(`revoke all on function reconcile_ezcater_toast(date,date) from public, anon, authenticated;
    grant execute on function reconcile_ezcater_toast(date,date) to service_role;`);
  // n stored ezCater orders; only three of them change this run (two inserts, one retire).
  await db.exec(`insert into ezcater_orders(id, provider_uuid, location_id)
    select ('00000000-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid, 'prov-' || lpad(g::text, 6, '0'), '${SHOP}'
    from generate_series(1, ${n}) g;
    insert into ezcater_toast_links(order_id, snapshot_id, location_id, toast_snapshot_id, order_guid, check_guid, selection_guid, business_date, evidence)
      values ('${id('a000', 3)}', '${id('b000', 3)}', '${SHOP}', '${id('c000', 3)}', 'og3', 'cg3', 'sg3', '2026-11-10', 'normalized_code'),
             ('${id('a000', 4)}', '${id('b000', 4)}', '${SHOP}', '${id('c000', 4)}', 'og4', 'cg4', 'sg4', '2026-11-10', 'normalized_code');
    insert into harness_plan values
      ('${id('a000', 1)}', '${id('b000', 1)}', '${SHOP}', '${id('c000', 1)}', 'og1', 'cg1', 'sg1', '2026-11-10', 'normalized_code', null, false, '{}'),
      ('${id('a000', 2)}', '${id('b000', 2)}', '${SHOP}', '${id('c000', 2)}', 'og2', 'cg2', 'sg2', '2026-11-10', 'daily_batch', 0, false, '{}'),
      ('${id('a000', 4)}', '${id('b000', 4)}', '${SHOP}', '${id('c000', 4)}', 'og4', 'cg4', 'sg4', '2026-11-10', 'normalized_code', null, false, '{}');`);
  return db;
}
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
async function refuses(db, run, expected) {
  await db.exec('savepoint s'); let error;
  try { await run(); } catch (e) { error = e; }
  await db.exec('rollback to savepoint s');
  check(error?.message === expected, `expected ${expected}, got ${error?.message ?? 'success'}`);
}

/** Reconcile inside its own transaction; returns the result and the advisory locks it held. */
async function reconcileWithLocks(db) {
  await db.exec('begin');
  try {
    await db.exec('set local role service_role');
    const r = (await one(db, `select reconcile_ezcater_toast('2026-11-01', '2026-11-30') r`)).r;
    const locks = (await one(db, `select count(*)::int n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`)).n;
    const links = (await db.query(`select order_id::text, is_current from ezcater_toast_links order by order_id, is_current`)).rows;
    return { r, locks, links };
  } finally { await db.exec('rollback'); }
}

async function seedCompanies(db) {
  await db.exec(`insert into catering_companies(id, name, created_at) values
      ('${id('d000', 1)}', 'Acme', now() - interval '3 days'),   -- empty orphan; a later Acme exists -> OFF
      ('${id('d000', 2)}', 'acme ', now() - interval '1 day'),   -- the kept one (has a domain)
      ('${id('d000', 3)}', 'Solo', now() - interval '2 days'),   -- empty, but no later twin -> stays
      ('${id('d000', 4)}', 'Beta', now() - interval '3 days'),   -- has a contact -> stays
      ('${id('d000', 5)}', 'Beta', now() - interval '1 day'),
      ('${id('d000', 6)}', 'Gamma', now() - interval '3 days'),  -- empty, a later empty twin -> OFF
      ('${id('d000', 7)}', 'Gamma', now() - interval '1 day'),   -- the newest Gamma stays
      ('${id('d000', 8)}', 'Delta', now() - interval '3 days'),  -- empty but a REMOVED domain row -> stays
      ('${id('d000', 9)}', 'Delta', now() - interval '1 day');
    insert into catering_company_domains(company_id, domain) values ('${id('d000', 2)}', 'acme.com');
    insert into catering_company_domains(company_id, domain, active) values ('${id('d000', 8)}', 'delta.com', false);
    insert into catering_customers(company_id, email) values ('${id('d000', 4)}', 'b@beta.com');`);
}

async function companyCases(db) {
  await db.exec('begin');
  try {
    await db.exec('set local role service_role');
    const ok = (await one(db, `select create_catering_company($1, 'Zeta', null, array['zeta.com','zeta.io']) r`, [ACTOR])).r;
    check(ok.company_id && ok.domain_ids.length === 2, 'B129: company + two domains created');
    check((await one(db, `select count(*)::int n from catering_company_domains where company_id = $1`, [ok.company_id])).n === 2, 'B129: both domains bound');
    await refuses(db, () => db.query(`select create_catering_company($1, 'Zeta Again', null, array['new.com','zeta.com'])`, [ACTOR]), 'domain_taken');
    check((await one(db, `select count(*)::int n from catering_companies where name = 'Zeta Again'`)).n === 0, 'B129: a taken domain leaves NO company row');
    check((await one(db, `select count(*)::int n from catering_company_domains where domain = 'new.com'`)).n === 0, 'B129: and no partial domain');
    await refuses(db, () => db.query(`select create_catering_company($1, 'X', null, '{}')`, [EMPLOYEE]), 'company_forbidden');
    await refuses(db, () => db.query(`select create_catering_company($1, '  ', null, '{}')`, [ACTOR]), 'company_invalid_name');
    const bare = (await one(db, `select create_catering_company($1, 'Eta', 'n', null) r`, [ACTOR])).r;
    check(bare.company_id && bare.domain_ids.length === 0, 'B129: no domains is fine');
  } finally { await db.exec('rollback'); }
}

async function cancelledLinkCases(db) {
  await db.exec('begin');
  try {
    await db.exec(`insert into catering_pipeline(id, stage, lead_source, external_ref) values
        ('${id('e000', 1)}', 'lost', 'ezcater', 'L1'), ('${id('e000', 2)}', 'confirmed', 'ezcater', 'L2');
      insert into ezcater_orders(id, provider_uuid, lead_id, status, pending_event_key) values
        ('${id('f000', 1)}', 'C1', null, 'CANCELLED', null),             -- cancelled status
        ('${id('f000', 2)}', 'C2', '${id('e000', 1)}', 'accepted', null), -- lead lost
        ('${id('f000', 3)}', 'C3', null, 'accepted', 'cancelled'),        -- loss pending refetch
        ('${id('f000', 4)}', 'C4', '${id('e000', 2)}', 'accepted', null), -- live
        ('${id('f000', 5)}', 'C5', null, 'accepted', null);               -- live, voided earlier -> restored
      insert into customer_orders(source_kind, ezcater_order_id, voided_at) values
        ('ezcater', '${id('f000', 1)}', null), ('ezcater', '${id('f000', 2)}', null), ('ezcater', '${id('f000', 3)}', null),
        ('ezcater', '${id('f000', 4)}', null), ('ezcater', '${id('f000', 5)}', now());
      insert into customer_orders(source_kind, toast_order_guid, voided_at) values ('toast', 'T1', now());`);
    await db.exec('set local role service_role');
    const r = (await one(db, `select customer_orders_sync_ezcater_cancelled() r`)).r;
    check(r.voided === 3 && r.restored === 1, `B127: 3 voided + 1 restored, got ${JSON.stringify(r)}`);
    const live = (await db.query(`select ezcater_order_id::text o from customer_orders where source_kind = 'ezcater' and voided_at is null order by 1`)).rows.map(x => x.o);
    check(JSON.stringify(live) === JSON.stringify([id('f000', 4), id('f000', 5)]), 'B127: only the live orders count');
    check((await one(db, `select count(*)::int n from customer_orders where source_kind = 'toast' and voided_at is not null`)).n === 1, 'B127: Toast rows untouched');
    const again = (await one(db, `select customer_orders_sync_ezcater_cancelled() r`)).r;
    check(again.voided === 0 && again.restored === 0, 'B127: idempotent');
    check((await one(db, `select count(*)::int n from customer_orders`)).n === 6, 'B127: nothing deleted');
  } finally { await db.exec('rollback'); }
}

async function reopenCases(db) {
  await db.exec('begin');
  try {
    await db.exec(`insert into catering_pipeline(id, stage, lead_source, external_ref) values
        ('${id('9000', 1)}', 'lost', 'ezcater', 'R1'),   -- cancel, then uncancel, accepted -> confirmed
        ('${id('9000', 2)}', 'lost', 'ezcater', 'R2'),   -- uncancel, then cancel again -> no
        ('${id('9000', 3)}', 'lost', 'ezcater', 'R3'),   -- uncancelled but status still cancelled -> no
        ('${id('9000', 4)}', 'lost', 'web', null),       -- not ezCater
        ('${id('9000', 5)}', 'lost', 'ezcater', 'R5'),   -- uncancel, status null -> inquiry
        ('${id('9000', 6)}', 'lost', 'ezcater', 'R6');   -- uncancel only UNSIGNED -> no
      insert into ezcater_orders(provider_uuid, lead_id, status, pending_event_key) values
        ('R1', '${id('9000', 1)}', 'accepted', null), ('R2', '${id('9000', 2)}', 'accepted', null),
        ('R3', '${id('9000', 3)}', 'cancelled', null), ('R5', '${id('9000', 5)}', null, null), ('R6', '${id('9000', 6)}', 'accepted', null);
      insert into ezcater_events(entity_id, event_key, signature_valid, received_at) values
        ('R1', 'cancelled', true, now() - interval '2 hours'), ('R1', 'uncancelled', true, now() - interval '1 hour'),
        ('R2', 'uncancelled', true, now() - interval '2 hours'), ('R2', 'cancelled', true, now() - interval '1 hour'),
        ('R3', 'cancelled', true, now() - interval '2 hours'), ('R3', 'uncancelled', true, now() - interval '1 hour'),
        ('R5', 'cancelled', true, now() - interval '2 hours'), ('R5', 'uncancelled', true, now() - interval '1 hour'),
        ('R6', 'cancelled', true, now() - interval '2 hours'), ('R6', 'uncancelled', false, now() - interval '1 hour');`);
    await db.exec('set local role service_role');
    const reopen = (lead, actor = ACTOR) => db.query(`select reopen_ezcater_lead($1, $2) r`, [lead, actor]);
    await refuses(db, () => reopen(id('9000', 1), EMPLOYEE), 'reopen_forbidden');
    const r1 = (await one(db, `select reopen_ezcater_lead($1, $2) r`, [id('9000', 1), ACTOR])).r;
    check(r1.from_stage === 'lost' && r1.to_stage === 'confirmed', 'B126: accepted -> Confirmed (W23-1 a)');
    check((await one(db, `select stage from catering_pipeline where id = $1`, [id('9000', 1)])).stage === 'confirmed', 'B126: stage written');
    const ev = await one(db, `select count(*)::int n, max(from_stage) f, max(to_stage) t, max(actor_id::text) a from catering_pipeline_events where pipeline_id = $1`, [id('9000', 1)]);
    check(ev.n === 1 && ev.f === 'lost' && ev.t === 'confirmed' && ev.a === ACTOR, 'B126: one pipeline event by the actor');
    await refuses(db, () => reopen(id('9000', 1)), 'reopen_not_lost');
    await refuses(db, () => reopen(id('9000', 2)), 'reopen_no_uncancel');
    await refuses(db, () => reopen(id('9000', 3)), 'reopen_still_cancelled');
    await refuses(db, () => reopen(id('9000', 4)), 'reopen_not_ezcater');
    await refuses(db, () => reopen(id('9000', 6)), 'reopen_no_uncancel');
    const r5 = (await one(db, `select reopen_ezcater_lead($1, $2) r`, [id('9000', 5), ACTOR])).r;
    check(r5.to_stage === 'inquiry', 'B126: not accepted -> Inquiry');
  } finally { await db.exec('rollback'); }
}

async function contracts(db) {
  const names = ['create_catering_company', 'customer_orders_sync_ezcater_cancelled', 'reopen_ezcater_lead', 'reconcile_ezcater_toast'];
  const rows = (await db.query(`select proname, oid, prosecdef, proconfig from pg_proc where proname = any($1) order by proname`, [names])).rows;
  check(rows.length === 4, 'all four functions present once');
  for (const r of rows) {
    check(r.prosecdef && r.proconfig.includes('search_path=pg_catalog, public'), `${r.proname}: definer + search path`);
    for (const role of ['anon', 'authenticated']) {
      check(!(await one(db, `select has_function_privilege($1, $2::oid, 'EXECUTE') ok`, [role, r.oid])).ok, `${r.proname}: ${role} cannot execute`);
    }
    check((await one(db, `select has_function_privilege('service_role', $1::oid, 'EXECUTE') ok`, [r.oid])).ok, `${r.proname}: service_role executes`);
  }
  check((await one(db, `select count(*)::int n from audit_log where action = 'security.grants_change'
    and metadata->>'migration' = '0330_ezcater_catering_records_fixes'`)).n === 1, 'one migration audit row');
}

let db, broken, refuse;
try {
  // Broken variant: the REAL 0229 body takes one advisory lock per stored order (B209).
  broken = await setup(300);
  const before = await reconcileWithLocks(broken);
  check(before.locks >= 301, `0229 body holds >= 301 advisory locks for 300 orders, got ${before.locks}`);
  console.log(`EXPECTED FAIL 0330 broken variant: 0229 reconcile held ${before.locks} advisory locks for 300 stored orders (3 change)`);

  // W23-4 b guard: an unacknowledged or wrong count refuses the whole migration.
  refuse = await setup(5);
  await seedCompanies(refuse);
  let msg = '';
  try { await refuse.exec(migration); } catch (e) { msg = e.message; await refuse.exec('rollback'); }
  check(/0330: 2 empty duplicate catering company\(ies\) would be switched off/.test(msg), `unacknowledged switch-off refused, got: ${msg}`);
  await refuse.exec(`select set_config('co_ops.w23_company_switchoff', '3', false)`);
  msg = '';
  try { await refuse.exec(migration); } catch (e) { msg = e.message; await refuse.exec('rollback'); }
  check(/would be switched off/.test(msg) && /\(got 3\)/.test(msg), 'a count that differs from the listing refuses');
  check((await one(refuse, `select count(*)::int n from catering_companies where not active`)).n === 0, 'a refused apply switched nothing off');

  db = await setup(300);
  await seedCompanies(db);
  await db.exec(`select set_config('co_ops.w23_company_switchoff', '2', false)`);
  await db.exec(migration);
  const off = (await db.query(`select id::text from catering_companies where not active order by id`)).rows.map(r => r.id);
  check(JSON.stringify(off) === JSON.stringify([id('d000', 1), id('d000', 6)]), `W23-4 b: exactly the two empty duplicates are off, got ${off}`);
  check((await one(db, `select count(*)::int n from audit_log where action = 'catering.company.deactivate_duplicate' and destructive
    and metadata->>'actor_context' = 'migration_apply'`)).n === 2, 'W23-4 b: one destructive audit row per company');
  let again = false;
  try { await db.exec(migration); } catch (e) { again = /0330: already applied/.test(e.message); await db.exec('rollback'); }
  check(again, 'a second apply is refused by the pre-flight');
  await contracts(db);

  const after = await reconcileWithLocks(db);
  check(after.locks === 1 + 3, `0330 body holds the global lock + the 3 changed providers, got ${after.locks}`);
  check(JSON.stringify(after.r) === JSON.stringify(before.r), `same reconcile result as 0229: ${JSON.stringify(after.r)} vs ${JSON.stringify(before.r)}`);
  check(JSON.stringify(after.links) === JSON.stringify(before.links), 'same link rows as 0229');
  check(after.r.added === 2 && after.r.retired === 1, `two links added, one retired, got ${JSON.stringify(after.r)}`);
  // Idempotent: once applied, a second run plans no change and takes only the global lock.
  await db.exec('begin');
  await db.exec('set local role service_role');
  await db.query(`select reconcile_ezcater_toast('2026-11-01', '2026-11-30')`);
  const second = (await one(db, `select reconcile_ezcater_toast('2026-11-01', '2026-11-30') r`)).r;
  check(second.added === 0 && second.retired === 0, 'a re-run with nothing to change changes nothing');
  await db.exec('rollback');

  await companyCases(db);
  await cancelledLinkCases(db);
  await reopenCases(db);
  console.log(`PASS 0330: ${checks} checks; two-session lock waits and the 4,000-order scale proof NOT RUN (sim only)`);
} catch (e) { console.error(`FAIL 0330: ${e.stack ?? e}`); process.exitCode = 1; }
finally { for (const d of [db, broken, refuse]) if (d) await d.close(); }
