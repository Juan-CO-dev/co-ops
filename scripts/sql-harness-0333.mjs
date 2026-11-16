/** Offline, ephemeral PostgreSQL proof of 0333: real 0273 → 0289 → 0292 → 0333 in PGlite, plus a minimal
 * catering_payments / audit_log fixture for the B140 columns and backfill. No network, no env.
 * Single-backend PGlite cannot prove blocking; the per-series advisory lock is 0289's, unchanged.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
const m0273 = read('0273_landing_order_click_counts.sql');
const m0289 = read('0289_marketing_scorecard.sql');
const m0292 = read('0292_landing_click_intent.sql');
const migration = read('0333_marketing_entry_moves_and_refund_time.sql');
const sales = read('0232_reports_sales_reads.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const owner = id(1), moo = id(2), gm = id(5), loc = id(10), loc2 = id(11);
const q = v => v === null ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
async function scalar(db, sql) { return Object.values((await db.query(sql)).rows[0])[0]; }
async function refuses(db, sql, name) {
  try { await db.exec(sql); } catch (e) { check(e.message.includes(name), `${name}: got ${e.message}`); return; }
  throw new Error(`Expected ${name}: ${sql}`);
}
async function setup({ payments = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges grant execute on functions to anon,authenticated;
    create table users(id uuid primary key, role text, active boolean);
    create table locations(id uuid primary key);
    insert into users values('${owner}','owner',true),('${moo}','moo',true),('${gm}','gm',true);
    insert into locations values('${loc}'),('${loc2}');
    create table toast_capture_runs(location_id uuid,business_date date,status text);
    create table ezcater_orders(id uuid primary key,subtotal_cents bigint);
    create table ezcater_reconciliation_status(order_id uuid,location_id uuid,event_date date,status text);
    create table fixture_facts(location_id uuid,business_date date,snapshot_id uuid,order_guid text,check_guid text,
      opened_at timestamptz,server_guid text,dining_option text,channel text,provider text,sale_class text,
      amount_cents bigint,tax_cents bigint,selection_units jsonb);
    create table audit_log(id uuid primary key default gen_random_uuid(), action text, resource_table text, resource_id uuid,
      metadata jsonb, created_at timestamptz not null default now());`);
  if (payments) await db.exec(`create table catering_payments(id uuid primary key, quote_id uuid, kind text, amount_cents integer not null,
      status text not null check (status in ('due','paid','refunded','void')), paid_at timestamptz, provider_ref text,
      settlement_cleanup_at timestamptz);`);
  const signature = sales.match(/create function public\.sales_report_facts[\s\S]*?language sql stable as/)[0];
  const guard = sales.match(/create function public\.sales_report_assert_window[\s\S]*?end \$\$;/)[0];
  await db.exec(`${signature} $$ select * from public.fixture_facts where location_id=p_location_id and business_date between p_from and p_to $$; ${guard}`);
  await db.exec(m0273); await db.exec(m0289); await db.exec(m0292);
  return db;
}

const db = await setup();
try {
  // ── B140 fixture BEFORE the migration: four payments, audit rows (partial, whole, a repeat, a bad one) ──
  await db.exec(`insert into catering_payments(id,amount_cents,status,paid_at) values
      ('${id(100)}',10000,'refunded','2026-11-02T15:00:00Z'),
      ('${id(101)}',5000,'refunded','2026-11-02T15:00:00Z'),
      ('${id(102)}',7000,'paid','2026-11-02T15:00:00Z'),
      ('${id(103)}',4000,'refunded','2026-11-02T15:00:00Z');
    insert into audit_log(action,resource_table,resource_id,metadata,created_at) values
      ('catering.payment.provider_refunded','catering_payments','${id(100)}','{"partial":true,"refunded_amount_cents":1000,"charge_amount_cents":10000,"stripe_event_id":"evt_tue"}','2026-11-03T15:00:00Z'),
      ('catering.payment.provider_refunded','catering_payments','${id(100)}','{"partial":false,"refunded_amount_cents":10000,"charge_amount_cents":10000,"stripe_event_id":"evt_wed"}','2026-11-04T15:00:00Z'),
      ('catering.payment.provider_refunded','catering_payments','${id(100)}','{"partial":false,"refunded_amount_cents":10000,"stripe_event_id":"evt_wed"}','2026-11-05T15:00:00Z'),
      ('catering.payment.provider_refunded','catering_payments','${id(101)}','{"refunded_amount_cents":"x","stripe_event_id":"evt_bad"}','2026-11-06T15:00:00Z'),
      ('catering.payment.provider_refunded','catering_payments','${id(102)}','{"partial":true,"refunded_amount_cents":700}','2026-11-07T15:00:00Z'),
      ('catering.payment.provider_refunded','catering_payments','${id(999)}','{"partial":true,"refunded_amount_cents":300,"stripe_event_id":"evt_orphan"}','2026-11-07T15:00:00Z');`);
  const fingerprintBefore = await scalar(db, "select md5(prosrc) from pg_proc where proname='record_marketing_manual_entry'");

  await db.exec(migration);
  check(await scalar(db, "select md5(prosrc) from pg_proc where proname='record_marketing_manual_entry'") !== fingerprintBefore, 'writer re-emitted');

  // B140 (review r1): one event row per refund EVENT, partial ones included; the figure is cumulative.
  const evs = (await db.query(`select stripe_event_id, payment_id::text, refunded_at::text, cumulative_refunded_cents::int as cum, charge_amount_cents::int as charge
    from catering_payment_refund_events order by refunded_at, stripe_event_id`)).rows;
  check(evs.length === 3, `three backfilled events (got ${evs.length})`);
  check(evs[0].stripe_event_id === 'evt_tue' && evs[0].cum === 1000 && evs[0].charge === 10000 && evs[0].refunded_at.startsWith('2026-11-03'), 'the partial refund is its own event');
  check(evs[1].stripe_event_id === 'evt_wed' && evs[1].cum === 10000 && evs[1].refunded_at.startsWith('2026-11-04'), 'a repeated event id keeps its earliest audit row');
  check(evs[2].stripe_event_id.startsWith('audit:') && evs[2].payment_id === id(102) && evs[2].cum === 700, 'an audit row without an event id gets an audit key; a still-paid row\'s partial refund counts');
  check(!evs.some(e => e.stripe_event_id === 'evt_bad' || e.stripe_event_id === 'evt_orphan'), 'non-numeric amounts and unknown payments are skipped');
  // The digest's derivation, in SQL: cumulative minus the payment's earlier maximum → $10 then $90.
  const deltas = (await db.query(`select stripe_event_id, (cumulative_refunded_cents - coalesce(max(cumulative_refunded_cents) over (partition by payment_id
      order by refunded_at, stripe_event_id rows between unbounded preceding and 1 preceding), 0))::int as d
    from catering_payment_refund_events where payment_id='${id(100)}' order by refunded_at`)).rows;
  check(deltas.map(r => r.d).join() === '1000,9000', 'per-event amounts: $10 then $90');
  // Append-only by grant; idempotent by event id; checks hold.
  await refuses(db, `insert into catering_payment_refund_events(stripe_event_id,payment_id,refunded_at,cumulative_refunded_cents) values('evt_tue','${id(100)}',now(),1)`, 'duplicate key');
  await refuses(db, `insert into catering_payment_refund_events(stripe_event_id,payment_id,refunded_at,cumulative_refunded_cents) values('evt_neg','${id(100)}',now(),-1)`, 'check');
  await refuses(db, `insert into catering_payment_refund_events(stripe_event_id,payment_id,refunded_at,cumulative_refunded_cents) values('evt_fk','${id(998)}',now(),1)`, 'foreign key');
  await db.exec(`set role service_role`);
  await db.exec(`insert into catering_payment_refund_events(stripe_event_id,payment_id,refunded_at,cumulative_refunded_cents) values('evt_sr','${id(102)}',now(),900)`);
  check((await db.query(`select count(*)::int as n from catering_payment_refund_events`)).rows[0].n === 4, 'service_role may SELECT and INSERT');
  await refuses(db, `update catering_payment_refund_events set cumulative_refunded_cents = 1 where stripe_event_id='evt_sr'`, 'permission denied');
  await refuses(db, `delete from catering_payment_refund_events where stripe_event_id='evt_sr'`, 'permission denied');
  await db.exec(`reset role`);
  for (const r of ['anon', 'authenticated']) {
    await db.exec(`set role ${r}`);
    await refuses(db, `select 1 from catering_payment_refund_events`, 'permission denied');
    await db.exec(`reset role`);
  }
  check(await scalar(db, "select count(*)=0 from information_schema.columns where table_name='catering_payments' and column_name like 'refunded%'"), 'catering_payments is not altered');

  // ── B139: corrections move by id; W26-2 b: remove ──
  const entry = (o = {}) => {
    const a = { actor: owner, kind: 'meta_spend', location: null, platform: null, from: '2026-11-02', to: null, amount: 5000, count: null, note: null, corrects: null, reason: null, ...o };
    const to = a.to ?? (a.kind === 'email_list_size' ? a.from : null);
    return `select record_marketing_manual_entry(${q(a.actor)},${q(a.kind)},${q(a.location)},${q(a.platform)},${q(a.from)}::date,${to === null ? `(${q(a.from)}::date + 6)` : `${q(to)}::date`},${q(a.amount)},${q(a.count)},${q(a.note)},${q(a.corrects)},${q(a.reason)})`;
  };
  const voidEntry = (entryId, reason = 'not ours', actor = owner) => `select void_marketing_manual_entry(${q(actor)},${q(entryId)},${q(reason)})`;
  const live = async () => (await db.query(`select id, period_start::text, voided from marketing_manual_entries e
    where not exists(select 1 from marketing_manual_entries c where c.corrects_id = e.id) order by recorded_at, id`)).rows;

  // 1. Spend for 11-02..11-08. 2. D moves to 11-05. 3. The correction to 11-05..11-11 succeeds (was correction_target_not_head).
  const first = await scalar(db, entry());
  const moved = await scalar(db, entry({ from: '2026-11-05', corrects: first, reason: 'D moved to 11-05' }));
  check(moved !== first, 'a correction moves the entry to the new D-aligned week');
  check((await live()).filter(r => !r.voided).map(r => r.period_start).join() === '2026-11-05', 'one live head, on the new week');
  // 4. A new entry for the moved week is an overlap, never a second live head.
  await refuses(db, entry({ from: '2026-11-05' }), 'entry_exists_use_correct');
  await refuses(db, entry({ from: '2026-11-08' }), 'entry_overlaps');
  // The old root period is free again (0289's root index is gone): a new root there needs no unique-index error.
  check(await scalar(db, "select to_regclass('public.marketing_manual_entries_root') is null"), 'root unique index dropped');
  await refuses(db, entry({ from: '2026-10-30' }), 'entry_overlaps');
  const older = await scalar(db, entry({ from: '2026-10-29' }));
  check(older !== null, 'adjacent earlier week allowed');
  // 5. A correction cannot change the series.
  await refuses(db, entry({ kind: 'promo_spend', platform: 'other', from: '2026-11-05', corrects: moved, reason: 'x' }), 'correction_target_not_head');
  await refuses(db, entry({ kind: 'promo_spend', platform: 'other', location: loc, from: '2026-11-05', corrects: moved, reason: 'x' }), 'correction_target_not_head');
  const promo = await scalar(db, entry({ kind: 'promo_spend', platform: 'doordash', location: loc }));
  await refuses(db, entry({ kind: 'promo_spend', platform: 'doordash', location: loc2, corrects: promo, reason: 'x' }), 'correction_target_not_head');
  await refuses(db, entry({ kind: 'promo_spend', platform: 'grubhub', location: loc, corrects: promo, reason: 'x' }), 'correction_target_not_head');
  // 6. A superseded row is not a head; an unknown id is not a head.
  await refuses(db, entry({ from: '2026-11-12', corrects: first, reason: 'stale' }), 'correction_target_not_head');
  await refuses(db, entry({ from: '2026-11-12', corrects: id(999), reason: 'x' }), 'correction_target_not_head');
  await refuses(db, entry({ from: '2026-11-12', corrects: moved }), 'reason_required');
  // 7. A correction onto a week another live head covers overlaps.
  await refuses(db, entry({ from: '2026-10-29', corrects: moved, reason: 'onto older' }), 'entry_overlaps');
  await refuses(db, entry({ from: '2026-11-01', corrects: moved, reason: 'partial overlap' }), 'entry_overlaps');
  // Correcting in place (same period) still works.
  const restated = await scalar(db, entry({ from: '2026-11-05', amount: 6000, corrects: moved, reason: 'restate' }));
  check(restated !== moved, 'same-period correction still appends');

  // Email list size: moving onto another live day overlaps (0289 skipped this check for email).
  const e1 = await scalar(db, entry({ kind: 'email_list_size', amount: null, count: 10, from: '2026-11-01' }));
  await scalar(db, entry({ kind: 'email_list_size', amount: null, count: 11, from: '2026-11-02' }));
  await refuses(db, entry({ kind: 'email_list_size', amount: null, count: 12, from: '2026-11-02', corrects: e1, reason: 'move' }), 'entry_overlaps');
  check(await scalar(db, entry({ kind: 'email_list_size', amount: null, count: 12, from: '2026-11-03', corrects: e1, reason: 'move' })) !== null, 'email entry moves to a free day');
  await refuses(db, entry({ kind: 'email_list_size', amount: null, count: 1, from: '2026-11-02' }), 'entry_exists_use_correct');

  // ── Remove (W26-2 b) ──
  await refuses(db, voidEntry(restated, 'x', gm), 'actor_not_allowed');
  await refuses(db, voidEntry(restated, ' '), 'reason_required');
  await refuses(db, voidEntry(restated, null), 'reason_required');
  await refuses(db, voidEntry(restated, 'x'.repeat(301)), 'entry_invalid');
  await refuses(db, voidEntry(id(999)), 'correction_target_not_head');
  await refuses(db, voidEntry(moved), 'correction_target_not_head');
  await refuses(db, voidEntry(e1), 'entry_invalid');
  const removed = await scalar(db, voidEntry(restated, 'never ran'));
  const row = (await db.query(`select * from marketing_manual_entries where id='${removed}'`)).rows[0];
  check(row.voided === true && row.corrects_id === restated && row.reason === 'never ran' && row.period_start.toISOString().startsWith('2026-11-05') && Number(row.amount_cents) === 6000, 'removal is an append-only correction carrying the head');
  check(Number(await scalar(db, 'select count(*) from marketing_manual_entries')) >= 9, 'history kept');
  await refuses(db, voidEntry(removed), 'correction_target_not_head');
  await refuses(db, voidEntry(restated), 'correction_target_not_head');
  // A removed week is free: a new entry may be created there, at exactly that period.
  const again = await scalar(db, entry({ from: '2026-11-05', amount: 100 }));
  check(again !== null, 'a removed week can be entered again');
  // A correction of the removed head restores it, and overlaps the live re-entry.
  await refuses(db, entry({ from: '2026-11-05', amount: 6000, corrects: removed, reason: 'restore' }), 'entry_overlaps');
  check(await scalar(db, entry({ from: '2026-11-12', amount: 6000, corrects: removed, reason: 'restore elsewhere' })) !== null, 'a removed head is restored by a correction');
  await refuses(db, `insert into marketing_manual_entries(kind,period_start,period_end,amount_cents,recorded_by,voided) values('meta_spend','2027-01-04','2027-01-10',1,'${owner}',true)`, 'marketing_manual_entries_void_is_correction');

  // ── Privileges ──
  for (const sig of ['record_marketing_manual_entry(uuid,text,uuid,text,date,date,bigint,integer,text,uuid,text)', 'void_marketing_manual_entry(uuid,uuid,text)']) {
    for (const role of ['anon', 'authenticated']) check(!await scalar(db, `select has_function_privilege('${role}','public.${sig}','EXECUTE')`), `${sig} ${role} denied`);
    check(await scalar(db, `select has_function_privilege('service_role','public.${sig}','EXECUTE')`), `${sig} service_role`);
    check(await scalar(db, `select prosecdef and proconfig @> array['search_path=pg_catalog, public'] from pg_proc where oid='public.${sig}'::regprocedure`), `${sig} definer path`);
  }
  check(await scalar(db, "select has_table_privilege('service_role','marketing_manual_entries','SELECT') and not has_table_privilege('service_role','marketing_manual_entries','INSERT,UPDATE,DELETE')"), 'service_role SELECT ceiling kept');
  await db.exec('set role service_role');
  check(await scalar(db, voidEntry(again, 'service path')) !== null, 'service_role removes through the writer');
  await refuses(db, `update marketing_manual_entries set voided = true where id='${older}'`, 'permission denied');
  await db.exec('reset role');

  // Re-apply refuses by name.
  await refuses(db, migration, '0333: already installed'); await db.exec('rollback');
} finally { await db.close(); }

// Drift and order guards: refused by name, fully rolled back.
for (const mode of ['drift', 'no0303']) {
  const fixture = await setup({ payments: mode !== 'no0303' });
  try {
    if (mode === 'no0303') await fixture.exec('create table catering_payments(id uuid primary key, status text)');
    if (mode === 'drift') await fixture.exec(`create or replace function public.record_marketing_manual_entry(p_actor uuid, p_kind text, p_location_id uuid, p_platform text,
      p_from date, p_to date, p_amount_cents bigint, p_list_count integer, p_note text, p_corrects uuid, p_reason text)
      returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$ begin return null; end $$;`);
    await refuses(fixture, migration, mode === 'drift' ? '0333: record_marketing_manual_entry drifted' : '0333: apply 0303 first');
    await fixture.exec('rollback');
    check(!await scalar(fixture, "select exists(select 1 from information_schema.columns where table_name='marketing_manual_entries' and column_name='voided')"), `${mode}: rolled back`);
  } finally { await fixture.close(); }
}
console.log(`0333 SQL harness: ${checks} checks passed (offline PGlite; the per-series lock is 0289's).`);
