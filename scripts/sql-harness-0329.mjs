/** 0329 offline proof (audit W22: B122 reserve and settle under the lead lock, B120 reschedule, B205 LTO create, B201 stale-reserved repair):
 *  the REAL parent DDL + 0329 in PGlite, synthetic rows only. Never touches a real database. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8');
const grab = (file, re, label) => { const m = read(file).match(re); assert.ok(m, `extract ${label}`); return m[0]; };
const table = (file, name) => grab(file, new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'), name);
const migration = read('0329_catering_prep_demand_lifecycle.sql');

const db = new PGlite();
let checks = 0;
const check = (v, s) => { assert.ok(v, s); checks++; console.log(`ok ${s}`); };
const one = async (s, a = []) => (await db.query(s, a)).rows[0];
const all = async (s, a = []) => (await db.query(s, a)).rows;
const reject = async (f, re, s) => { await assert.rejects(f, re); check(true, s); };

const reserve = (pipe, quote, rows, actor = null) => one('select public.reserve_catering_prep_demand($1,$2,$3,$4) r', [pipe, quote, JSON.stringify(rows), actor]).then((x) => x.r);
const settle = (pipe, to) => one('select public.settle_catering_prep_demand($1,$2) r', [pipe, to]).then((x) => x.r);
const reschedule = (lead, date, actor = null) => one('select public.reschedule_catering_lead($1,$2,$3) r', [lead, date, actor]).then((x) => x.r);
const createLto = (actor, ev, items) => one('select public.create_lto_event($1,$2,$3) r', [actor, JSON.stringify(ev), JSON.stringify(items)]).then((x) => x.r);
const demand = (pipe) => all("select status, need_date::text d, item_id::text, choice_package_item_id::text c, qty::numeric q, quote_id::text from catering_prep_demand where pipeline_id=$1 order by status, need_date, item_id", [pipe]);

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to public, anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to public, anon, authenticated, service_role;
    create function public.current_user_role_level() returns integer language sql as 'select 0';
    create function public.current_user_locations() returns uuid[] language sql as 'select array[]::uuid[]';
    create table public.locations(id uuid primary key, name text, active boolean not null default true);
    create table public.users(id uuid primary key, role text not null, active boolean not null default true);
    create table public.items(id uuid primary key);
    create table public.menu_items(id uuid primary key);
    create table public.catering_package_items(id uuid primary key);
    create table public.audit_log(id uuid primary key default gen_random_uuid(), actor_id uuid, actor_role text, action text not null,
      resource_table text, resource_id uuid, destructive boolean not null default false, metadata jsonb, created_at timestamptz default now());
    ${table('0108_catering_scaffold_capture.sql', 'catering_customers')}
    ${table('0108_catering_scaffold_capture.sql', 'catering_pipeline')}
    ${grab('0129_order_artifact_intake.sql', /ALTER TABLE public\.catering_pipeline DROP CONSTRAINT catering_pipeline_stage_check;\s*ALTER TABLE public\.catering_pipeline\s+ADD CONSTRAINT catering_pipeline_stage_check[\s\S]*?;/i, '0129 out stage')}
    ${table('0110_catering_pipeline_events.sql', 'catering_pipeline_events')}
    ${grab('0191_pipeline_events_out_stage.sql', /ALTER TABLE public\.catering_pipeline_events\s+DROP CONSTRAINT IF EXISTS catering_pipeline_events_from_stage_check;[\s\S]*?CHECK \(to_stage IN \([^)]*\)\);/i, '0191 out stage')}
    ${table('0117_catering_delivery_zones.sql', 'catering_delivery_zones')}
    ${table('0120_catering_quotes.sql', 'catering_quotes')}
    ${table('0137_catering_prep_demand.sql', 'catering_prep_demand')}
    ${grab('0140_catering_prep_demand_released_at.sql', /ALTER TABLE public\.catering_prep_demand\s+ADD COLUMN released_at timestamptz;/i, '0140 released_at')}
    ${table('0141_lto_events.sql', 'lto_events')}
    ${table('0141_lto_events.sql', 'lto_event_items')}
    ${grab('0225_ezcater_pass2.sql', /create function public\.bind_catering_insert_location\(\)[\s\S]*?end \$\$;/i, '0225 bind fn')}
    ${grab('0225_ezcater_pass2.sql', /create trigger catering_prep_demand_bind_location[\s\S]*?;/i, '0225 bind trigger')}
    ${grab('0279_user_employment_events.sql', /create function public\.user_admin_role_level\(p_role text\)[\s\S]*?\$\$;/i, '0279 role level')}
  `);

  // ── Preflight refusals: each in a transaction, rolled back, leaving no partial DDL ─────────────
  const noFunctions = async () => (await one("select to_regprocedure('public.reserve_catering_prep_demand(uuid,uuid,jsonb,uuid)') a, to_regprocedure('public.create_lto_event(uuid,jsonb,jsonb)') b")).a === null;
  const refusePreflight = async (sql, re, label) => {
    await db.exec('begin;' + sql);
    await reject(() => db.exec(migration), re, label);
    await db.exec('rollback');
    check(await noFunctions(), `${label}: no partial DDL`);
  };
  await refusePreflight('alter table public.catering_prep_demand drop column released_at', /missing columns .*catering_prep_demand\.released_at/, 'missing released_at refused');
  await refusePreflight('alter table public.lto_event_items drop column source_pipeline_id', /missing columns .*lto_event_items\.source_pipeline_id/, 'missing lto_event_items column refused');
  await refusePreflight('alter table public.audit_log drop column destructive', /missing columns .*audit_log\.destructive/, 'missing audit_log column refused');
  await refusePreflight('drop function public.user_admin_role_level(text)', /missing public\.user_admin_role_level/, 'missing 0279 helper refused');
  await refusePreflight('drop trigger catering_prep_demand_bind_location on public.catering_prep_demand; drop function public.bind_catering_insert_location()', /missing public\.bind_catering_insert_location/, 'missing 0225 trigger function refused');
  await refusePreflight("create function public.create_lto_event(uuid,jsonb,jsonb) returns uuid language sql as 'select null::uuid'", /already applied/, 'already applied refused');

  await db.exec(migration);
  check(!(await noFunctions()), '0329 applies');
  await reject(() => db.exec(migration), /already applied/, 're-apply refused');
  await db.exec('rollback');

  // ── Privileges ─────────────────────────────────────────────────────────────────────────────
  for (const f of ['public.reserve_catering_prep_demand(uuid,uuid,jsonb,uuid)', 'public.settle_catering_prep_demand(uuid,text)', 'public.reschedule_catering_lead(uuid,date,uuid)', 'public.create_lto_event(uuid,jsonb,jsonb)']) {
    const p = await one(`select has_function_privilege('anon',$1,'EXECUTE') a, has_function_privilege('authenticated',$1,'EXECUTE') b, has_function_privilege('service_role',$1,'EXECUTE') s, (select prosecdef from pg_proc where oid=$1::regprocedure) d, (select proconfig from pg_proc where oid=$1::regprocedure) c`, [f]);
    check(!p.a && !p.b && p.s, `${f}: service_role only`);
    check(p.d === true && p.c.includes('search_path=pg_catalog, public'), `${f}: security definer, pinned search_path`);
  }
  const bf = await one("select has_function_privilege('service_role','public.catering_prep_demand_backfill_stale(integer,integer)','EXECUTE') s, has_function_privilege('anon','public.catering_prep_demand_backfill_stale(integer,integer)','EXECUTE') a, has_function_privilege('authenticated','public.catering_prep_demand_backfill_stale(integer,integer)','EXECUTE') b");
  check(!bf.s && !bf.a && !bf.b, 'backfill executable by no API role');
  check((await one("select has_table_privilege('anon','public.catering_prep_demand','INSERT') a")).a === true, 'table grants untouched by 0329 (the synthetic default ACL still stands)');

  // ── Fixtures ───────────────────────────────────────────────────────────────────────────────
  const loc = randomUUID(), loc2 = randomUUID(), cust = randomUUID(), item = randomUUID(), item2 = randomUUID(), slot = randomUUID();
  const mgr = randomUUID(), smm = randomUUID(), kh = randomUUID(), gone = randomUUID();
  await db.query("insert into locations(id,name) values($1,'Shop A'),($2,'Shop B')", [loc, loc2]);
  await db.query("insert into users(id,role,active) values($1,'catering_mgr',true),($2,'social_media_mgr',true),($3,'key_holder',true),($4,'gm',false)", [mgr, smm, kh, gone]);
  await db.query('insert into items values($1),($2)', [item, item2]);
  await db.query('insert into catering_package_items values($1)', [slot]);
  await db.query("insert into catering_customers(id,name) values($1,'Synthetic')", [cust]);
  const newLead = async (stage = 'confirmed', date = '2030-11-20', location = loc) => {
    const id = randomUUID();
    await db.query("insert into catering_pipeline(id,customer_id,contact_name,stage,location_id,event_date) values($1,$2,'Synthetic',$3,$4,$5)", [id, cust, stage, location, date]);
    return id;
  };
  const newQuote = async (pipe, date = '2030-11-20', location = loc) => {
    const id = randomUUID();
    await db.query("insert into catering_quotes(id,pipeline_id,customer_id,location_id,status,event_date) values($1,$2,$3,$4,'sent',$5)", [id, pipe, cust, location, date]);
    return id;
  };
  const rows = (qty = 2) => [
    { item_id: item, menu_item_id: null, choice_package_item_id: null, portion: null, qty },
    { item_id: item2, menu_item_id: null, choice_package_item_id: null, portion: 'half', qty: qty * 3 },
    { item_id: null, menu_item_id: null, choice_package_item_id: slot, portion: null, qty: 1 },
  ];

  // ── B122: reserve ───────────────────────────────────────────────────────────────────────────
  const L1 = await newLead();
  const Q1 = await newQuote(L1);
  let r = await reserve(L1, Q1, rows(2), mgr);
  check(r.result === 'reserved' && r.released === 0 && r.inserted === 3, 'happy path: 3 rows reserved');
  let d = await demand(L1);
  check(d.every((x) => x.status === 'reserved' && x.d === '2030-11-20' && x.quote_id === Q1), 'reserved on the live quote\'s date');
  r = await reserve(L1, Q1, rows(4), mgr);
  check(r.result === 'reserved' && r.released === 3 && r.inserted === 3, 're-reserve retires the old set and inserts the new');
  d = await demand(L1);
  check(d.filter((x) => x.status === 'reserved').length === 3 && d.filter((x) => x.status === 'released').length === 3, 'append-only: 3 released + 3 reserved');
  check(d.some((x) => x.status === 'reserved' && Number(x.q) === 4), 'the new quantities are the reserved ones');

  const L2 = await newLead('lost');
  const Q2 = await newQuote(L2);
  r = await reserve(L2, Q2, rows(), mgr);
  check(r.result === 'not_confirmed' && r.stage === 'lost', 'a lead no longer confirmed → not_confirmed');
  check((await demand(L2)).length === 0, 'not_confirmed inserts nothing');

  const L3 = await newLead();
  const Q3old = await newQuote(L3);
  await db.query("update catering_quotes set superseded_at = now() where id = $1", [Q3old]);
  const Q3 = await newQuote(L3);
  r = await reserve(L3, Q3old, rows(), mgr);
  check(r.result === 'quote_changed', 'a superseded quote id → quote_changed');
  check((await demand(L3)).length === 0, 'quote_changed inserts nothing');
  await db.query("update catering_quotes set event_date = null where id = $1", [Q3]);
  r = await reserve(L3, Q3, rows(), mgr);
  check(r.result === 'no_event_date', 'an undated live quote → no_event_date');

  const L4 = await newLead();
  const Q4 = await newQuote(L4);
  await reserve(L4, Q4, rows(), mgr);
  await db.query("update catering_prep_demand set status='consumed', consumed_at=now() where pipeline_id=$1", [L4]);
  r = await reserve(L4, Q4, rows(), mgr);
  check(r.result === 'already_consumed', 'consumed demand present → already_consumed');
  check((await demand(L4)).every((x) => x.status === 'consumed'), 'already_consumed stacks no reserved copy');

  const L5 = await newLead();
  const Q5 = await newQuote(L5);
  await reserve(L5, Q5, rows(), mgr);
  await reject(() => reserve(L5, Q5, [{ item_id: item, menu_item_id: null, choice_package_item_id: null, portion: null, qty: 2 }, { item_id: item, menu_item_id: null, choice_package_item_id: null, portion: null, qty: 0 }], mgr), /check constraint|violates/, 'a bad row (qty 0) aborts the whole call');
  check((await demand(L5)).filter((x) => x.status === 'reserved').length === 3, '…and the previous reserved set is untouched (all or nothing)');
  r = await reserve(L5, Q5, [], mgr);
  check(r.result === 'reserved' && r.released === 3 && r.inserted === 0, 'an empty row set releases the old demand and reserves none');
  await reject(() => reserve(randomUUID(), Q5, [], mgr), /reserve_lead_not_found/, 'unknown lead refused by name');
  await reject(() => one('select public.reserve_catering_prep_demand($1,$2,$3,null)', [L5, Q5, '{}']), /reserve_invalid_rows/, 'non-array rows refused by name');

  // ── B122, the reverse order: settle re-checks the CURRENT stage under the lead lock ─────────────
  // A: confirmed → quote_sent, then stalls before its release. B: re-confirms and reserves a fresh set.
  // A's release resumes: the lead is confirmed again, so it must leave B's set alone.
  const RV = await newLead();
  const RVQ = await newQuote(RV);
  await reserve(RV, RVQ, rows(2), mgr);                                         // the original confirm
  await db.query("update catering_pipeline set stage='quote_sent' where id=$1", [RV]);  // A's stage flip
  await db.query("update catering_pipeline set stage='confirmed' where id=$1", [RV]);   // B's re-confirm
  r = await reserve(RV, RVQ, rows(5), mgr);                                     // B's fresh reservation
  check(r.result === 'reserved' && r.released === 3 && r.inserted === 3, 'B re-reserves a fresh set');
  r = await settle(RV, 'released');                                             // A's delayed release
  check(r.result === 'stage_changed' && r.stage === 'confirmed', "A's delayed release after B re-confirmed → stage_changed");
  d = await demand(RV);
  check(JSON.stringify(d.filter((x) => x.status === 'reserved').map((x) => Number(x.q)).sort((a, b) => a - b)) === '[1,5,15]',
    "…and B's fresh reservation is still reserved (the confirmed order stays in kitchen demand)");
  r = await settle(RV, 'consumed');
  check(r.result === 'stage_changed', 'a consume on a confirmed lead → stage_changed too');
  check((await demand(RV)).filter((x) => x.status === 'reserved').length === 3, '…writing nothing');
  // The stages that do settle.
  await db.query("update catering_pipeline set stage='lost' where id=$1", [RV]);
  r = await settle(RV, 'released');
  check(r.result === 'released' && r.rows === 3, 'lost → release settles the reserved rows');
  d = await demand(RV);
  check(d.every((x) => x.status === 'released'), '…every row released, nothing reserved');
  check((await all("select count(*)::int n from catering_prep_demand where pipeline_id=$1 and status='released' and released_at is null", [RV]))[0].n === 0, '…each with released_at');
  r = await settle(RV, 'released');
  check(r.result === 'released' && r.rows === 0, 'a repeated settle is a no-op (idempotent)');
  r = await settle(RV, 'consumed');
  check(r.result === 'stage_changed' && r.stage === 'lost', 'a consume on a lost lead → stage_changed');
  for (const stage of ['inquiry', 'quote_sent']) {
    const X = await newLead(); const XQ = await newQuote(X);
    await reserve(X, XQ, rows(), mgr);
    await db.query('update catering_pipeline set stage=$2 where id=$1', [X, stage]);
    r = await settle(X, 'released');
    check(r.result === 'released' && r.rows === 3, `${stage} → release settles`);
  }
  for (const stage of ['out', 'completed']) {
    const X = await newLead(); const XQ = await newQuote(X);
    await reserve(X, XQ, rows(), mgr);
    await db.query('update catering_pipeline set stage=$2 where id=$1', [X, stage]);
    r = await settle(X, 'released');
    check(r.result === 'stage_changed' && r.stage === stage, `a release on a lead now ${stage} → stage_changed`);
    r = await settle(X, 'consumed');
    check(r.result === 'consumed' && r.rows === 3, `${stage} → consume settles`);
    check((await demand(X)).every((x) => x.status === 'consumed'), `${stage}: every row consumed`);
    check((await all("select count(*)::int n from catering_prep_demand where pipeline_id=$1 and consumed_at is null", [X]))[0].n === 0, `${stage}: each with consumed_at`);
  }
  await reject(() => settle(RV, 'reserved'), /settle_invalid_target/, 'settle to reserved refused by name');
  await reject(() => settle(RV, null), /settle_invalid_target/, 'settle with no target refused by name');
  await reject(() => settle(randomUUID(), 'released'), /settle_lead_not_found/, 'settle on an unknown lead refused by name');

  // Location: the 0225 trigger still binds a reserved insert to the lead's current shop.
  const L6 = await newLead('confirmed', '2030-11-20', loc2);
  const Q6 = await newQuote(L6, '2030-11-20', loc);
  await reserve(L6, Q6, rows(), mgr);
  check((await all('select distinct location_id::text l from catering_prep_demand where pipeline_id=$1', [L6])).every((x) => x.l === loc2), 'reserved rows land at the lead\'s shop');

  // ── B120: reschedule ────────────────────────────────────────────────────────────────────────
  const R1 = await newLead('confirmed', '2030-11-20');
  const RQold = await newQuote(R1, '2030-11-20');
  await db.query("update catering_quotes set superseded_at = now() where id = $1", [RQold]);
  const RQ = await newQuote(R1, '2030-11-20');
  await reserve(R1, RQ, rows(2), mgr);
  const before = (await demand(R1)).filter((x) => x.status === 'reserved').map((x) => `${x.item_id}|${x.c}|${Number(x.q)}`).sort();
  r = await reschedule(R1, '2030-11-24', mgr);
  check(r.result === 'moved' && r.from_date === '2030-11-20' && r.to_date === '2030-11-24' && r.quote_updated === true && r.prep_rows_moved === 3, 'reschedule moves lead, live quote and 3 prep rows');
  check((await one('select event_date::text d from catering_pipeline where id=$1', [R1])).d === '2030-11-24', 'lead date moved');
  check((await one('select event_date::text d from catering_quotes where id=$1', [RQ])).d === '2030-11-24', 'live quote date moved');
  check((await one('select event_date::text d from catering_quotes where id=$1', [RQold])).d === '2030-11-20', 'superseded revision untouched');
  d = await demand(R1);
  const after = d.filter((x) => x.status === 'reserved');
  check(after.length === 3 && after.every((x) => x.d === '2030-11-24' && x.quote_id === RQ), 'reserved rows re-dated to the new day');
  check(JSON.stringify(after.map((x) => `${x.item_id}|${x.c}|${Number(x.q)}`).sort()) === JSON.stringify(before), 'same refs, picks and quantities');
  check(d.filter((x) => x.status === 'released' && x.d === '2030-11-20').length === 3, 'the old-day rows are retired, not deleted');
  const ev = await all("select from_stage, to_stage, note from catering_pipeline_events where pipeline_id=$1", [R1]);
  check(ev.length === 1 && ev[0].from_stage === 'confirmed' && ev[0].to_stage === 'confirmed' && ev[0].note === 'Rescheduled: 2030-11-20 -> 2030-11-24', 'one no-stage-change event row');
  r = await reschedule(R1, '2030-11-24', mgr);
  check(r.result === 'unchanged' && r.prep_rows_moved === 0 && r.quote_updated === false, 'same date again → unchanged, nothing written');
  check((await all("select 1 from catering_pipeline_events where pipeline_id=$1", [R1])).length === 1, 'unchanged writes no event');
  // Self-healing: a quote that drifted off the lead's date is repaired by re-saving the date.
  await db.query("update catering_quotes set event_date='2030-11-20' where id=$1", [RQ]);
  r = await reschedule(R1, '2030-11-24', mgr);
  check(r.result === 'moved' && r.quote_updated === true && r.prep_rows_moved === 0, 'a drifted quote is repaired on re-save');
  // A lead with no quote and no prep (ezCater / plain inquiry): only the lead moves.
  const R2 = await newLead('inquiry', null);
  r = await reschedule(R2, '2030-12-01', mgr);
  check(r.result === 'moved' && r.quote_updated === false && r.prep_rows_moved === 0, 'an undated quote-less lead just gets its date');
  check((await one("select note from catering_pipeline_events where pipeline_id=$1", [R2])).note === 'Rescheduled: no date -> 2030-12-01', 'the event says it had no date');
  await reject(() => reschedule(R2, null, mgr), /reschedule_invalid_date/, 'a null date refused by name');
  await reject(() => reschedule(randomUUID(), '2030-12-01', mgr), /reschedule_lead_not_found/, 'unknown lead refused by name');
  // Consumed rows never move.
  const R3 = await newLead('confirmed', '2030-11-20');
  const R3Q = await newQuote(R3, '2030-11-20');
  await reserve(R3, R3Q, rows(), mgr);
  await db.query("update catering_pipeline set stage='out' where id=$1", [R3]);
  await db.query("update catering_prep_demand set status='consumed', consumed_at=now() where pipeline_id=$1", [R3]);
  r = await reschedule(R3, '2030-11-21', mgr);
  check(r.prep_rows_moved === 0 && (await demand(R3)).every((x) => x.status === 'consumed' && x.d === '2030-11-20'), 'consumed demand is history: never re-dated');

  // ── B205: create_lto_event ──────────────────────────────────────────────────────────────────
  const evIn = { location_id: loc, kind: 'discount', name: 'Test', discount_bps: 1000, promo_price_cents: null, starts_on: '2030-11-14', ends_on: '2030-11-16', note: '  ' };
  const id = await createLto(mgr, evIn, [{ item_id: item, menu_item_id: null, name_snapshot: 'Chips', qty: 3, source_pipeline_id: null }]);
  check(typeof id === 'string', 'event + item created');
  const evRow = await one('select status, note, created_by::text c from lto_events where id=$1', [id]);
  check(evRow.status === 'active' && evRow.note === null && evRow.c === mgr, 'active, blank note stored as null, actor recorded');
  check((await all('select 1 from lto_event_items where event_id=$1', [id])).length === 1, 'one item row');
  const countEvents = async () => (await one('select count(*)::int n from lto_events')).n;
  const n0 = await countEvents();
  await reject(() => createLto(mgr, evIn, [{ item_id: randomUUID(), menu_item_id: null, name_snapshot: 'Ghost', qty: 1, source_pipeline_id: null }]), /foreign key/, 'a bad item id is refused (FK)…');
  check(await countEvents() === n0, '…and leaves NO lto_events row (B205)');
  await reject(() => createLto(mgr, evIn, [{ item_id: item, menu_item_id: item, name_snapshot: 'Both', qty: 1, source_pipeline_id: null }]), /lto_event_items_one_ref|check constraint/, 'two refs refused by the table CHECK');
  check(await countEvents() === n0, '…with no event left behind');
  await reject(() => createLto(mgr, evIn, []), /lto_no_items/, 'no items refused by name');
  await reject(() => createLto(kh, evIn, [{ item_id: item, menu_item_id: null, name_snapshot: 'x', qty: 1, source_pipeline_id: null }]), /lto_forbidden/, 'level 4 refused in SQL');
  await reject(() => createLto(gone, evIn, [{ item_id: item, menu_item_id: null, name_snapshot: 'x', qty: 1, source_pipeline_id: null }]), /lto_forbidden/, 'a deactivated actor refused in SQL');
  await db.query('update locations set active=false where id=$1', [loc2]);
  await reject(() => createLto(mgr, { ...evIn, location_id: loc2 }, [{ item_id: item, menu_item_id: null, name_snapshot: 'x', qty: 1, source_pipeline_id: null }]), /lto_location_not_found/, 'an inactive shop refused in SQL');
  await db.query('update locations set active=true where id=$1', [loc2]);
  await reject(() => createLto(mgr, { ...evIn, ends_on: '2030-11-01' }, [{ item_id: item, menu_item_id: null, name_snapshot: 'x', qty: 1, source_pipeline_id: null }]), /lto_events_window|check constraint/, 'the table CHECKs still judge the event');
  check(await countEvents() === n0, 'no partial event after any refusal');

  // ── B201: the stale-reserved repair ─────────────────────────────────────────────────────────
  await db.exec("delete from catering_prep_demand; delete from catering_pipeline_events; delete from audit_log;");
  const S1 = await newLead('confirmed');                 // completed by the system, rows still reserved
  const S1Q = await newQuote(S1);
  await reserve(S1, S1Q, rows(), mgr);
  await db.query("update catering_pipeline set stage='completed' where id=$1", [S1]);
  await db.query("insert into catering_pipeline_events(pipeline_id,from_stage,to_stage,note,created_at) values($1,'confirmed','completed','auto: event date passed','2030-11-21T05:00:00Z')", [S1]);
  const S2 = await newLead('confirmed');                 // lost by the Toast scan, rows still reserved
  const S2Q = await newQuote(S2);
  await reserve(S2, S2Q, rows(), mgr);
  await db.query("update catering_pipeline set stage='lost' where id=$1", [S2]);
  const S3 = await newLead('confirmed');                 // still confirmed: never touched
  const S3Q = await newQuote(S3);
  await reserve(S3, S3Q, rows(), mgr);
  await reject(() => one('select public.catering_prep_demand_backfill_stale(2, 3) r'), /backfill_manifest_drift/, 'a drifted manifest refuses');
  check((await all("select 1 from catering_prep_demand where status <> 'reserved'")).length === 0, '…and writes nothing');
  r = (await one('select public.catering_prep_demand_backfill_stale(3, 3) r')).r;
  check(r.consumed === 3 && r.released === 3, 'the manifest matches: 3 consumed, 3 released');
  const s1 = await all("select status, consumed_at from catering_prep_demand where pipeline_id=$1", [S1]);
  check(s1.every((x) => x.status === 'consumed' && new Date(x.consumed_at).toISOString() === '2030-11-21T05:00:00.000Z'), 'consumed_at = the completion event time');
  check((await demand(S2)).every((x) => x.status === 'released'), 'the lost lead\'s rows released');
  check((await demand(S3)).every((x) => x.status === 'reserved'), 'a confirmed lead is untouched');
  const aud = await all("select action, destructive, metadata from audit_log order by action");
  check(aud.length === 2 && aud[0].action === 'catering.prep_demand.consume' && aud[1].action === 'catering.prep_demand.release'
    && aud.every((a) => a.destructive === false && a.metadata.actor_context === 'migration_apply' && a.metadata.rows === 3), 'one audit row per kind, migration_apply, non-destructive');
  await reject(() => one('select public.catering_prep_demand_backfill_stale(3, 3) r'), /backfill_manifest_drift/, 'a second run with the same manifest refuses (idempotent by refusal)');
  r = (await one('select public.catering_prep_demand_backfill_stale(0, 0) r')).r;
  check(r.consumed === 0 && r.released === 0, '(0, 0) is a no-op');
  check((await all('select 1 from audit_log')).length === 2, 'a no-op writes no audit row');
  await reject(() => one('select public.catering_prep_demand_backfill_stale(null, 0) r'), /backfill_manifest_required/, 'the manifest is required');

  console.log(`PASS 0329: ${checks} checks`);
} catch (e) {
  console.log(`FAIL 0329: ${e instanceof Error ? e.stack : String(e)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
