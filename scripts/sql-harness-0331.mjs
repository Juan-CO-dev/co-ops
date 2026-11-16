/** Offline 0331 proof (W23-5 b on B125). Ephemeral in-memory PGlite only: no credentials, no network.
 * Loads the REAL 0225 apply_ezcater_order body (red), then the REAL 0331 file (green), over a
 * minimal schema. transfer_catering_lead is a stub that refuses, so any shop move would fail loudly.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g, '\n');
const id = (p, n) => `00000000-0000-4000-${p}-${String(n).padStart(12, '0')}`;
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }

const apply0225 = read('0225_ezcater_pass2.sql').match(/create or replace function public\.apply_ezcater_order\([\s\S]*?\nend \$\$;/)?.[0];
const migration = read('0331_ezcater_unmapped_shop_lifecycle.sql');
const SHOP_A = id('8000', 1), SHOP_B = id('8000', 2), MGR = id('8000', 3);

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges grant execute on functions to anon, authenticated;
    create table locations(id uuid primary key, name text, active boolean not null default true, ezcater_caterer_uuid text);
    create table users(id uuid primary key, role text, active boolean default true, created_at timestamptz default now());
    create table user_locations(user_id uuid, location_id uuid, active boolean default true);
    create table audit_log(id bigserial primary key, actor_id uuid, actor_role text, action text, resource_table text,
      resource_id uuid, metadata jsonb, destructive boolean, created_at timestamptz default now());
    create table catering_pipeline(id uuid primary key default gen_random_uuid(), contact_name text, stage text not null,
      lead_source text, external_ref text, location_id uuid, assigned_to uuid, created_by uuid, headcount integer,
      event_date date, time_window text, estimated_revenue_cents integer, updated_at timestamptz default now(),
      location_manually_moved_at timestamptz);
    create table catering_pipeline_events(id uuid primary key default gen_random_uuid(), pipeline_id uuid not null,
      from_stage text, to_stage text, note text, actor_id uuid, created_at timestamptz default now());
    create table ezcater_events(id uuid primary key default gen_random_uuid(), entity_id text, parent_id text,
      signature_valid boolean not null default true, raw jsonb not null default '{}', received_at timestamptz not null default now());
    create table ezcater_orders(id uuid primary key default gen_random_uuid(), provider_uuid text not null unique,
      caterer_uuid text not null, location_id uuid not null, lead_id uuid, snapshot_id uuid, snapshot_digest text,
      fetched_at timestamptz, last_attempt_at timestamptz not null default now(), last_sync_error text, pending_event_key text,
      order_number text, event_date date, event_timestamp timestamptz, handoff_time text, status text, headcount integer,
      fulfillment text, subtotal_cents bigint, tax_cents bigint, tip_cents bigint, fees_cents bigint, discounts_cents bigint,
      total_cents bigint, payment_status text, created_at timestamptz not null default now(),
      provider_location_observed_at timestamptz, location_conflict boolean not null default false,
      location_manual_override boolean not null default false);
    create table ezcater_order_snapshots(id uuid primary key, order_id uuid not null);
    create table ezcater_order_items(id uuid primary key default gen_random_uuid(), order_id uuid, snapshot_id uuid, ordinal integer,
      provider_item_uuid text, name text, quantity numeric, unit_price_cents bigint, total_cents bigint, pos_item_id text,
      menu_item_size_id text, options jsonb, special_instructions text, note_to_caterer text, is_current boolean not null default true);
    create table ezcater_order_contacts(order_id uuid primary key, snapshot_id uuid, contact jsonb);
    create function transfer_catering_lead(uuid, uuid, uuid, text, text) returns jsonb language plpgsql as
      $t$ begin raise exception 'transfer_should_not_run'; end $t$;
    grant all on all tables in schema public to service_role;
    insert into locations values ('${SHOP_A}', 'Shop A', true, null),           -- its mapping was CLEARED
                                 ('${SHOP_B}', 'Shop B', true, 'caterer-b');
    insert into users values ('${MGR}', 'catering_mgr', true, now());
    -- lead L1 (confirmed) at Shop A, order already stored with Shop A's old caterer UUID
    insert into catering_pipeline(id, contact_name, stage, lead_source, external_ref, location_id)
      values ('${id('a000', 1)}', 'Pat', 'confirmed', 'ezcater', 'prov-1', '${SHOP_A}'),
             ('${id('a000', 2)}', 'Sam', 'confirmed', 'ezcater', 'prov-2', '${SHOP_A}');
    insert into ezcater_orders(provider_uuid, caterer_uuid, location_id, lead_id, status)
      values ('prov-1', 'caterer-a', '${SHOP_A}', '${id('a000', 1)}', 'accepted'),
             ('prov-2', 'caterer-a', '${SHOP_A}', '${id('a000', 2)}', 'accepted');`);
  check(Boolean(apply0225), '0225 apply body extracted');
  await db.exec(apply0225);
  await db.exec(`revoke all on function apply_ezcater_order(text,text,jsonb,text,text,text) from public, anon, authenticated;
    grant execute on function apply_ezcater_order(text,text,jsonb,text,text,text) to service_role;`);
  return db;
}
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
async function attempt(db, q, p = []) {
  await db.exec('savepoint s');
  try { const r = await one(db, q, p); await db.exec('release savepoint s'); return { r }; }
  catch (e) { await db.exec('rollback to savepoint s'); return { error: e.message }; }
}
const failCall = `select apply_ezcater_order($1, 'caterer-a', null, null, $2, 'network_error') r`;
const snapshot = (status) => JSON.stringify({ orderNumber: 'N1', catererUuid: 'caterer-a', status, items: [],
  eventTimestamp: '2026-11-20T17:00:00Z', totalDueCents: 1000, enrichmentFields: ['status'] });
const snapCall = `select apply_ezcater_order('prov-2', 'caterer-a', $1::jsonb, 'digest-2', 'cancelled', null) r`;

let broken, db;
try {
  // Red: the REAL 0225 body refuses every order of a shop whose ezCater mapping was cleared.
  broken = await setup();
  await broken.exec('begin');
  const red = await attempt(broken, failCall, ['prov-1', 'cancelled']);
  check(red.error === 'unmapped_location', `0225 refuses the cancellation: ${red.error}`);
  check((await one(broken, `select stage from catering_pipeline where id = $1`, [id('a000', 1)])).stage === 'confirmed', '0225: the lead stays Confirmed (frozen)');
  await broken.exec('rollback');
  console.log('EXPECTED FAIL 0331 broken variant: 0225 raised unmapped_location for a cancelled order whose lead exists at a shop with a cleared mapping');

  db = await setup();
  await db.exec(migration);
  let again = false;
  try { await db.exec(migration); } catch (e) { again = /0331: already applied/.test(e.message); await db.exec('rollback'); }
  check(again, 'a second apply is refused by the pre-flight');
  const f = await one(db, `select oid, prosecdef, proconfig from pg_proc where proname = 'apply_ezcater_order'`);
  check(f.prosecdef && f.proconfig.includes('search_path=pg_catalog, public'), 'definer + search path kept');
  for (const role of ['anon', 'authenticated']) {
    check(!(await one(db, `select has_function_privilege($1, $2::oid, 'EXECUTE') ok`, [role, f.oid])).ok, `${role} cannot execute`);
  }
  check((await one(db, `select count(*)::int n from audit_log where metadata->>'migration' = '0331_ezcater_unmapped_shop_lifecycle'`)).n === 1, 'one migration audit row');

  await db.exec('begin');
  await db.exec('set local role service_role');
  // 1. A cancellation notification with a failed fetch now lands, at the lead's own shop.
  const green = await attempt(db, failCall, ['prov-1', 'cancelled']);
  check(!green.error, `0331 applies the cancellation: ${green.error}`);
  check(green.r.r.result === 'stage_moved' && green.r.r.to_stage === 'lost' && green.r.r.code === 'unmapped_location_kept',
    `stage_moved to lost with the kept code: ${JSON.stringify(green.r.r)}`);
  check((await one(db, `select stage, location_id from catering_pipeline where id = $1`, [id('a000', 1)])).stage === 'lost', 'the lead is Lost');
  const o1 = await one(db, `select location_id, pending_event_key from ezcater_orders where provider_uuid = 'prov-1'`);
  check(o1.location_id === SHOP_A && o1.pending_event_key === 'cancelled', 'the order keeps Shop A and records the pending loss');
  // 2. A fetched snapshot (status cancelled) applies too, without moving the lead.
  const snap = await attempt(db, snapCall, [snapshot('cancelled')]);
  check(!snap.error, `0331 applies a fetched snapshot: ${snap.error}`);
  check(snap.r.r.to_stage === 'lost' && snap.r.r.location_id === SHOP_A, `snapshot moved the lead to lost at Shop A: ${JSON.stringify(snap.r.r)}`);
  const o2 = await one(db, `select location_id, status from ezcater_orders where provider_uuid = 'prov-2'`);
  check(o2.location_id === SHOP_A && o2.status === 'cancelled', 'the stored order keeps its shop and takes the status');
  // 3. A NEW order for the unmapped caterer (no lead) is still refused (the app parks it, B125).
  const fresh = await attempt(db, failCall, ['prov-new', 'submitted']);
  check(fresh.error === 'unmapped_location', `a new order is still unmapped_location: ${fresh.error}`);
  check((await one(db, `select count(*)::int n from ezcater_orders where provider_uuid = 'prov-new'`)).n === 0, 'and nothing is stored for it');
  // 4. A mapped caterer is unchanged: a new submitted order creates its lead at Shop B.
  const mapped = await attempt(db, `select apply_ezcater_order('prov-b', 'caterer-b', $1::jsonb, 'digest-b', 'submitted', null) r`,
    [JSON.stringify({ orderNumber: 'NB', catererUuid: 'caterer-b', status: 'submitted', items: [], eventTimestamp: '2026-11-21T17:00:00Z', totalDueCents: 500 })]);
  check(!mapped.error && mapped.r.r.result === 'created_lead' && mapped.r.r.location_id === SHOP_B && mapped.r.r.code == null,
    `a mapped caterer creates its lead as before: ${JSON.stringify(mapped.r ?? mapped.error)}`);
  await db.exec('rollback');
  console.log(`PASS 0331: ${checks} checks`);
} catch (e) { console.error(`FAIL 0331: ${e.stack ?? e}`); process.exitCode = 1; }
finally { for (const d of [db, broken]) if (d) await d.close(); }
