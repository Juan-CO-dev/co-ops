/** Offline 0356 proof (catering delivery D1, the delivery ledger). Ephemeral in-memory PGlite only: no credentials, no
 * network. Builds a minimal stub of the tables 0356 READS (locations, users, user_locations, catering_pipeline,
 * catering_quotes, catering_pipeline_events, ezcater_orders, audit_log) with Supabase's default grants, loads the REAL
 * 0356 file, and proves:
 *   A. the pre-flight refuses by name (a missing column; applied twice);
 *   B. ceilings: tables read by service_role only, written by nobody; RLS on with no policy; no user role executes
 *      anything; service_role executes the public surface and no internal helper;
 *   C. set_delivery_settings: who, the whole row or nothing, the row the person saw, one audit row;
 *   D. the actor rule, role by role;
 *   E. every named refusal of record_manual_delivery_job, in the plan's order; the one-open-job arbiter;
 *   F. statuses: the manual moves vs the shared case file; status = highest seq with a backdated time; nothing after a
 *      terminal status; closed_at stamped once;
 *   G. costs: first observation, cost_exists, the correction chain, not_current_head, reason_required, bad_amount;
 *   H. the gratuity rule vs the shared case file; the split written on delivered; reassignment when a second job is
 *      delivered (ONE head per lead); recompute to zero; void; split_moved; ambiguity; never an ezCater job;
 *   I. the order-quote selection vs the shared case file (SQL twin of orderQuoteOf);
 *   J. ezCater: never booked by us, incl. a lead whose lead_source was edited away but has an ezcater_orders row;
 *   K. `shop_moved` on EVERY writer after a transfer, nothing written;
 *   L. the pickup decision is bound to the destination shop (A -> B kept; -> C a mismatch again);
 *   M. lock order (lead FOR NO KEY UPDATE -> job FOR UPDATE -> children), pinned on the function sources;
 *   N. audit: one destructive row per write, the registered names, never a note;
 *   O. every refusal name in the file was raised here;
 *   P. OFF MEANS OFF: with the lead's current shop off, EVERY writer refuses `delivery_off` (a cancellation included)
 *      and writes nothing; the save answers the shop's open jobs; turned on again, each writer works.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
export const m0356 = read('supabase/migrations/0356_delivery_jobs.sql');
const gratuityCases = JSON.parse(read('tests/fixtures/delivery/gratuity-split-cases.json'));
const moveCases = JSON.parse(read('tests/fixtures/delivery/manual-transition-cases.json'));
const quoteCases = JSON.parse(read('tests/fixtures/delivery/order-quote-cases.json')).cases;

let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(`FAIL: ${message}`); }
const id = (p, n) => `00000000-0000-4000-${p}-${String(n).padStart(12, '0')}`;
const A = id('1000', 1), B = id('1000', 2), C = id('1000', 3), CLOSED = id('1000', 4);
const OWNER = id('2000', 1), CGS = id('2000', 2), MOO = id('2000', 3), CM = id('2000', 4), GM_A = id('2000', 5), AGM_A = id('2000', 6),
  GM_B = id('2000', 7), AGM_B = id('2000', 8), PREP = id('2000', 9), SMM = id('2000', 10), KH = id('2000', 11), SL = id('2000', 12),
  GONE = id('2000', 13), GM_LEFT = id('2000', 14), NOBODY = id('2000', 99);
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
const num = async (db, q, p = []) => Number((await one(db, q, p)).n);

export const STUB = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges grant all on tables to anon, authenticated, service_role;
  alter default privileges grant execute on functions to anon, authenticated, service_role;
  create table locations(id uuid primary key, name text, active boolean not null default true);
  create table users(id uuid primary key, role text not null, active boolean not null default true);
  create table user_locations(user_id uuid not null references users(id), location_id uuid not null references locations(id),
    active boolean not null default true);
  create table catering_pipeline(id uuid primary key, location_id uuid references locations(id), stage text not null, lead_source text);
  create table catering_quotes(id uuid primary key default gen_random_uuid(), root_id uuid references catering_quotes(id),
    version integer not null default 1, pipeline_id uuid references catering_pipeline(id), location_id uuid,
    status text not null default 'draft', is_delivery boolean not null default false, gratuity_cents integer not null default 0,
    delivery_fee_cents integer not null default 0, created_at timestamptz not null default now(), superseded_at timestamptz);
  create unique index catering_quotes_one_live_per_family on catering_quotes (coalesce(root_id, id)) where superseded_at is null;
  create table catering_pipeline_events(id uuid primary key default gen_random_uuid(), pipeline_id uuid not null references catering_pipeline(id),
    from_stage text, to_stage text not null, note text, actor_id uuid, created_at timestamptz not null default now());
  create table ezcater_orders(id uuid primary key default gen_random_uuid(), lead_id uuid references catering_pipeline(id));
  create table audit_log(id bigserial primary key, actor_id uuid, actor_role text, action text, resource_table text, resource_id uuid,
    metadata jsonb, destructive boolean, created_at timestamptz default now());`;

/** What already exists on the real database under a delivery_ name and is NOT 0356's: the vendor-receipt objects. One of
 *  the functions is executable by `authenticated` and the table carries a policy: 0356 must not judge either. */
export const VENDOR_FNS = ['delivery_match_verdict', 'delivery_receipt_auto_link', 'delivery_receipt_unlink'];
const PRE_EXISTING = `
  create table delivery_receipt_unlinks(id uuid primary key default gen_random_uuid());
  alter table delivery_receipt_unlinks enable row level security;
  create policy delivery_receipt_unlinks_read on delivery_receipt_unlinks for select using (true);
  create function delivery_match_verdict() returns text language sql as $$ select 'x' $$;
  create function delivery_receipt_auto_link() returns text language sql as $$ select 'x' $$;
  create function delivery_receipt_unlink() returns text language sql as $$ select 'x' $$;`;

async function base() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(PRE_EXISTING);
  await db.exec(`insert into locations(id, name, active) values ('${A}', 'A', true), ('${B}', 'B', true), ('${C}', 'C', true), ('${CLOSED}', 'Closed', false);
    insert into users values ('${OWNER}', 'owner', true), ('${CGS}', 'cgs', true), ('${MOO}', 'moo', true), ('${CM}', 'catering_mgr', true),
      ('${GM_A}', 'gm', true), ('${AGM_A}', 'agm', true), ('${GM_B}', 'gm', true), ('${AGM_B}', 'agm', true), ('${PREP}', 'prep_mgr', true),
      ('${SMM}', 'social_media_mgr', true), ('${KH}', 'key_holder', true), ('${SL}', 'shift_lead', true), ('${GONE}', 'moo', false),
      ('${GM_LEFT}', 'gm', true);
    insert into user_locations values ('${GM_A}', '${A}', true), ('${AGM_A}', '${A}', true), ('${GM_B}', '${B}', true), ('${AGM_B}', '${B}', true),
      ('${PREP}', '${A}', true), ('${SMM}', '${A}', true), ('${KH}', '${A}', true), ('${SL}', '${A}', true), ('${GM_LEFT}', '${A}', false),
      ('${CM}', '${B}', true);`);
  return db;
}

async function refuses(db, run, code, message) {
  await db.exec('begin'); let error;
  try { await run(); } catch (e) { error = e; }
  await db.exec('rollback');
  check(String(error?.message ?? '') === code, `${message}: expected ${code}, got ${error?.message ?? 'success'}`);
  refused.add(code);
}
/** Every refusal name a writer was SEEN to raise (section O holds it to the names in the file). */
const refused = new Set();
/** Succeeds, and is rolled back (a probe that leaves nothing behind). */
async function allows(db, run, message) {
  await db.exec('begin'); let error;
  try { await run(); } catch (e) { error = e; }
  await db.exec('rollback');
  check(!error, `${message}: ${error?.message}`);
}

let leadN = 0;
async function lead(db, { shop = A, stage = 'confirmed', source = 'website' } = {}) {
  const lid = id('3000', ++leadN);
  await db.query(`insert into catering_pipeline(id, location_id, stage, lead_source) values ($1, $2, $3, $4)`, [lid, shop, stage, source]);
  return lid;
}
let quoteN = 0;
async function quote(db, lid, { status = 'accepted', delivery = true, gratuity = 0, fee = 2500, at = '2026-11-01T10:00:00Z', superseded = false, root = null, qid = null } = {}) {
  const q = qid ?? id('4000', ++quoteN);
  await db.query(`insert into catering_quotes(id, root_id, pipeline_id, status, is_delivery, gratuity_cents, delivery_fee_cents, created_at, superseded_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [q, root, lid, status, delivery, gratuity, fee, at, superseded ? '2026-11-02T00:00:00Z' : null]);
  return q;
}
/** A confirmed house delivery lead with one accepted delivery quote. */
async function houseLead(db, { shop = A, gratuity = 0, stage = 'confirmed' } = {}) {
  const lid = await lead(db, { shop, stage });
  const q = await quote(db, lid, { gratuity });
  return { lid, q };
}
const rec = async (db, actor, lid, shop, { label = 'Courier A', ref = null, via = 'manual', pickup = null, dropoff = null, cost = null, note = null } = {}) =>
  (await one(db, `select record_manual_delivery_job($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) r`, [actor, lid, shop, label, ref, via, pickup, dropoff, cost, note])).r;
const ev = async (db, actor, job, shop, expected, status, at = null, note = null) =>
  (await one(db, `select record_delivery_event($1, $2, $3, $4, $5, $6, $7) r`, [actor, job, shop, expected, status, at, note])).r;
const cost = async (db, actor, job, shop, component, cents, corrects = null, note = null) =>
  (await one(db, `select record_delivery_cost($1, $2, $3, $4, $5, $6, $7) r`, [actor, job, shop, component, cents, corrects, note])).r;
const keep = async (db, actor, job, shop, note = null) => (await one(db, `select keep_delivery_pickup($1, $2, $3, $4) r`, [actor, job, shop, note])).r;
const gsplit = async (db, actor, lid, shop, mode, head, reason) =>
  (await one(db, `select record_delivery_gratuity_split($1, $2, $3, $4, $5, $6) r`, [actor, lid, shop, mode, head, reason])).r;
const save = async (db, actor, shop, settings, expected = null) =>
  (await one(db, `select set_delivery_settings($1, $2, $3, $4) r`, [actor, shop, JSON.stringify(settings), expected])).r;
const head = async (db, lid) => one(db, `select s.id::text id, s.kind, s.job_id::text job_id, s.gratuity_cents g, s.driver_bps bps, s.driver_cents d, s.crew_cents c, s.supersedes_id::text prev
  from delivery_gratuity_splits s where s.pipeline_id = $1 and not exists (select 1 from delivery_gratuity_splits n where n.supersedes_id = s.id)`, [lid]);
const transfer = async (db, lid, to) => db.query(`update catering_pipeline set location_id = $2 where id = $1`, [lid, to]);
const SETTINGS = { enabled: true, manual_providers: ['Courier A', 'Courier B'], gratuity_driver_bps: 1000 };
const TABLES = ['delivery_settings', 'delivery_jobs', 'delivery_job_events', 'delivery_job_costs', 'delivery_gratuity_splits', 'delivery_pickup_decisions'];
const PUBLIC_FNS = ['delivery_gratuity_split', 'delivery_manual_move_allowed', 'delivery_order_quote', 'delivery_order_rejected', 'delivery_lead_is_ezcater',
  'set_delivery_settings', 'record_manual_delivery_job', 'record_delivery_event', 'record_delivery_cost', 'keep_delivery_pickup',
  'record_delivery_gratuity_split', 'delivery_ready'];
const INTERNAL_FNS = ['delivery_status_terminal', 'delivery_actor_role', 'delivery_lead_gate', 'delivery_job_gate', 'delivery_computed_split', 'delivery_write_split'];
const WRITERS = ['set_delivery_settings', 'record_manual_delivery_job', 'record_delivery_event', 'record_delivery_cost', 'keep_delivery_pickup', 'record_delivery_gratuity_split'];

async function main() {
  // A. Pre-flight.
  {
    const bare = new PGlite();
    await bare.exec(STUB.replace(/,\s+active boolean not null default true\);\n  create table catering_pipeline\(/, ');\n  create table catering_pipeline('));
    let error; try { await bare.exec(m0356); } catch (e) { error = e; }
    check(String(error?.message).includes('0356: public.user_locations.active is missing'), `a missing column is named: ${error?.message}`);
    const none = new PGlite();
    error = undefined; try { await none.exec(m0356); } catch (e) { error = e; }
    check(/0356: public\.\w+\.\w+ is missing/.test(String(error?.message)), `no schema at all: ${error?.message}`);
    const twice = await base();
    await twice.exec(m0356);
    error = undefined; try { await twice.exec(m0356); } catch (e) { error = e; }
    check(String(error?.message).includes('0356: public.delivery_settings already exists'), `applied twice: ${error?.message}`);
  }

  const db = await base();
  await db.exec(m0356);

  // B. Ceilings.
  for (const t of [...TABLES, 'delivery_job_current']) {
    const p = await one(db, `select has_table_privilege('service_role', 'public.${t}', 'select') s,
      (select bool_or(has_table_privilege('service_role', 'public.${t}', x)) from unnest(array['insert','update','delete','truncate','references','trigger']) x) w,
      (select bool_or(has_table_privilege(r, 'public.${t}', x)) from unnest(array['anon','authenticated']) r,
         unnest(array['select','insert','update','delete','truncate','references','trigger']) x) u`);
    check(p.s === true && p.w === false && p.u === false, `${t}: service_role SELECT only; no user role holds anything`);
  }
  for (const t of TABLES) {
    const r = await one(db, `select c.relrowsecurity rls, (select count(*) from pg_policies y where y.tablename = '${t}')::int n from pg_class c where c.oid = 'public.${t}'::regclass`);
    check(r.rls === true && r.n === 0, `${t}: RLS on, no policy (deny-all)`);
  }
  {
    const fns = (await db.query(`select p.proname, p.prosecdef, p.proconfig::text cfg,
        has_function_privilege('service_role', p.oid, 'execute') s, has_function_privilege('authenticated', p.oid, 'execute') a,
        has_function_privilege('anon', p.oid, 'execute') n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = any($1) order by 1`, [[...PUBLIC_FNS, ...INTERNAL_FNS]])).rows;
    check(fns.length === 18 && JSON.stringify(fns.map(f => f.proname).sort()) === JSON.stringify([...PUBLIC_FNS, ...INTERNAL_FNS].sort()), `the 18 functions of the file: ${fns.map(f => f.proname)}`);
    // The file applied although unrelated delivery_* objects exist that a user role may execute / that carry a policy:
    // its assertions name ITS objects explicitly and judge nothing else.
    const vendor = (await db.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') a from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = any($1) order by 1`, [VENDOR_FNS])).rows;
    check(vendor.length === 3 && vendor.every(f => f.a === true), 'pre-existing vendor delivery_* functions executable by authenticated did not make 0356 fail, and are untouched');
    check((await num(db, `select count(*) n from pg_policies where tablename = 'delivery_receipt_unlinks'`)) === 1
      && (await one(db, `select has_table_privilege('authenticated', 'public.delivery_receipt_unlinks', 'select') r`)).r === true, 'the pre-existing delivery_receipt_unlinks table keeps its policy and grants');
    const wide = await num(db, `select count(*) n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname like 'delivery\\_%'`);
    check(wide === 12 + 3, `a 'delivery_%' pattern is too wide: it matches ${wide} functions, 3 of them not 0356's`);
    const src = m0356.replace(/--[^\n]*/g, '');
    check(!/like\s+'delivery/.test(src) && !/like\s+'delivery/.test(m0356), 'the file matches no object by a delivery_% pattern, in code or in a comment');
    check(fns.every(f => !f.a && !f.n), 'no user role executes any delivery function');
    check(fns.filter(f => PUBLIC_FNS.includes(f.proname)).every(f => f.s), 'service_role executes the 12 public functions');
    check(fns.filter(f => INTERNAL_FNS.includes(f.proname)).every(f => !f.s), 'service_role executes no internal helper');
    check(fns.every(f => String(f.cfg).includes('search_path=pg_catalog, public')), 'every function pins search_path');
    check(fns.filter(f => WRITERS.includes(f.proname)).every(f => f.prosecdef), 'every writer is SECURITY DEFINER');
    const pub = await num(db, `select count(*) n from information_schema.routine_privileges g where g.routine_schema = 'public' and g.grantee = 'PUBLIC'
      and g.routine_name = any($1)`, [[...PUBLIC_FNS, ...INTERNAL_FNS]]);
    check(pub === 0, 'PUBLIC holds EXECUTE on none of them (routine_privileges)');
  }
  {
    // As the roles themselves.
    await db.exec(`set role service_role`);
    let error; try { await db.query(`insert into delivery_settings(location_id, updated_at) values ('${A}', now())`); } catch (e) { error = e; }
    check(/permission denied/.test(String(error?.message)), `service_role cannot insert a settings row directly: ${error?.message}`);
    error = undefined; try { await db.query(`update delivery_jobs set closed_at = now()`); } catch (e) { error = e; }
    check(/permission denied/.test(String(error?.message)), 'service_role cannot update a job directly');
    error = undefined; try { await db.query(`select public.delivery_write_split('${id('3000', 1)}', '${OWNER}', 'void', 'x')`); } catch (e) { error = e; }
    check(/permission denied/.test(String(error?.message)), 'service_role cannot call an internal helper');
    check((await num(db, `select count(*) n from delivery_job_current`)) === 0 && (await one(db, `select delivery_ready() r`)).r.ready === true,
      'service_role reads the view and the probe');
    await db.exec(`reset role; set role authenticated`);
    error = undefined; try { await db.query(`select count(*) from delivery_jobs`); } catch (e) { error = e; }
    check(/permission denied/.test(String(error?.message)), 'authenticated cannot read a delivery table');
    error = undefined; try { await db.query(`select delivery_ready()`); } catch (e) { error = e; }
    check(/permission denied/.test(String(error?.message)), 'authenticated cannot execute the probe');
    await db.exec(`reset role`);
  }
  check(JSON.stringify((await one(db, `select delivery_ready() r`)).r) === JSON.stringify({ ready: true, version: 1 }), 'delivery_ready: { ready: true, version: 1 }');

  // C. Settings.
  for (const [who, name] of [[GM_A, 'a GM'], [CM, 'the catering manager'], [AGM_A, 'an AGM'], [GONE, 'an inactive MoO'], [NOBODY, 'nobody']]) {
    await refuses(db, () => save(db, who, A, SETTINGS), 'forbidden', `settings: ${name} is refused`);
  }
  const { enabled: _drop, ...missing } = SETTINGS;
  const bad = [[missing, 'a missing key'], [{ ...SETTINGS, note: 'x' }, 'an unknown key'], [{ ...SETTINGS, enabled: 'true' }, 'a string switch'],
    [{ ...SETTINGS, manual_providers: 'Courier A' }, 'a string for the list'], [{ ...SETTINGS, manual_providers: [1] }, 'a number in the list'],
    [{ ...SETTINGS, manual_providers: [' Courier A'] }, 'an untrimmed label'], [{ ...SETTINGS, manual_providers: [''] }, 'an empty label'],
    [{ ...SETTINGS, manual_providers: ['x'.repeat(41)] }, 'a label over 40 characters'], [{ ...SETTINGS, manual_providers: ['Courier A', 'courier a'] }, 'a duplicate label'],
    [{ ...SETTINGS, manual_providers: Array.from({ length: 13 }, (_, i) => `C${i}`) }, 'thirteen labels'],
    [{ ...SETTINGS, gratuity_driver_bps: 10001 }, 'a share over 100%'], [{ ...SETTINGS, gratuity_driver_bps: -1 }, 'a negative share'],
    [{ ...SETTINGS, gratuity_driver_bps: 12.5 }, 'a fractional share'], [{ ...SETTINGS, gratuity_driver_bps: '1000' }, 'a string share'], [[], 'an array'], ['x', 'a string']];
  for (const [settings, name] of bad) await refuses(db, () => save(db, MOO, A, settings), 'invalid_settings', `settings: ${name} is refused`);
  await refuses(db, () => save(db, null, A, SETTINGS), 'invalid_settings', 'settings: no actor');
  await refuses(db, () => save(db, MOO, id('1000', 9), SETTINGS), 'location_not_found', 'settings: a shop that does not exist');
  await refuses(db, () => save(db, MOO, CLOSED, SETTINGS), 'location_not_found', 'settings: an inactive shop');
  check((await num(db, `select count(*) n from delivery_settings`)) === 0 && (await num(db, `select count(*) n from audit_log`)) === 0, 'a refused save writes nothing and audits nothing');
  const s1 = await save(db, MOO, A, SETTINGS);
  check(s1.enabled === true && s1.location_id === A && s1.updated_by === MOO && s1.gratuity_driver_bps === 1000 && s1.open_jobs === 0, 'the first save inserts the row (and answers the shop\'s open jobs: none)');
  await refuses(db, () => save(db, MOO, A, { ...SETTINGS, gratuity_driver_bps: 500 }), 'settings_moved', 'settings: a save that saw no row, after one exists');
  await refuses(db, () => save(db, MOO, A, { ...SETTINGS, gratuity_driver_bps: 500 }, '2020-01-01T00:00:00Z'), 'settings_moved', 'settings: a save that saw an older row');
  await refuses(db, () => save(db, OWNER, A, SETTINGS, s1.updated_at), 'no_change', 'settings: a save that changes nothing');
  const s2 = await save(db, CGS, A, { ...SETTINGS, manual_providers: ['Courier A', 'Courier B', 'Courier C'] }, s1.updated_at);
  check(s2.manual_providers.length === 3 && s2.updated_at !== s1.updated_at && (await num(db, `select count(*) n from delivery_settings`)) === 1, 'the next save updates the one row');
  check((await save(db, OWNER, C, { enabled: false, manual_providers: [], gratuity_driver_bps: 2500 })).enabled === false, 'a shop can be saved off with no courier');
  {
    const a = (await db.query(`select actor_id::text a, actor_role r, action, resource_table t, resource_id::text rid, destructive d, metadata m from audit_log order by id`)).rows;
    check(a.length === 3 && a.every(x => x.action === 'delivery.settings_update' && x.d === true && x.t === 'delivery_settings'), 'settings: one destructive audit row per save');
    check(a[0].a === MOO && a[0].r === 'moo' && a[0].rid === A && a[0].m.before === null && a[0].m.after.enabled === true
      && a[1].m.before.manual_providers.length === 2 && a[1].m.after.manual_providers.length === 3
      && JSON.stringify(Object.keys(a[1].m.after).sort()) === '["enabled","gratuity_driver_bps","manual_providers"]', 'settings audit: who, the shop, before and after, the three settings only');
  }
  // B is on with a 20% driver share (the snapshot proof below); C stays off.
  await save(db, MOO, B, { enabled: true, manual_providers: ['Courier B'], gratuity_driver_bps: 2000 });
  await db.exec(`delete from audit_log`);

  // D. The actor rule, role by role (lead at shop A).
  const d = await houseLead(db);
  for (const [who, name] of [[OWNER, 'owner'], [CGS, 'cgs'], [MOO, 'moo'], [CM, 'catering_mgr (not a member of A)'], [GM_A, 'gm, member'], [AGM_A, 'agm, member']]) {
    await allows(db, () => rec(db, who, d.lid, A), `actor rule: ${name} may record`);
  }
  for (const [who, name] of [[GM_B, 'gm of another shop'], [AGM_B, 'agm of another shop'], [GM_LEFT, 'gm whose membership is inactive'], [PREP, 'prep_mgr, member'],
    [SMM, 'social_media_mgr, member'], [KH, 'key_holder, member'], [SL, 'shift_lead, member'], [GONE, 'an inactive moo'], [NOBODY, 'an unknown user']]) {
    await refuses(db, () => rec(db, who, d.lid, A), 'forbidden', `actor rule: ${name} is refused`);
  }
  check((await num(db, `select count(*) n from delivery_jobs`)) === 0, 'probes and refusals left no job');

  // E. record_manual_delivery_job: every refusal.
  await refuses(db, () => rec(db, null, d.lid, A), 'invalid_request', 'record: no actor');
  await refuses(db, () => rec(db, GM_A, d.lid, A, { label: '   ' }), 'invalid_request', 'record: a blank courier');
  await refuses(db, () => rec(db, GM_A, d.lid, A, { label: 'x'.repeat(41) }), 'invalid_request', 'record: a courier over 40 characters');
  await refuses(db, () => rec(db, GM_A, d.lid, A, { ref: 'x'.repeat(81) }), 'invalid_request', 'record: a reference over 80 characters');
  await refuses(db, () => rec(db, GM_A, d.lid, A, { note: 'x'.repeat(501) }), 'invalid_request', 'record: a note over 500 characters');
  await refuses(db, () => rec(db, GM_A, d.lid, A, { via: 'carrier_pigeon' }), 'invalid_request', 'record: an unknown booked_via');
  await refuses(db, () => rec(db, GM_A, d.lid, A, { cost: -1 }), 'bad_amount', 'record: a negative cost');
  await refuses(db, () => rec(db, GM_A, id('3000', 999999), A), 'lead_not_found', 'record: no such lead');
  await refuses(db, () => rec(db, GM_A, d.lid, B), 'shop_moved', 'record: the person saw another shop');
  await refuses(db, () => rec(db, GM_B, d.lid, B), 'shop_moved', 'record: shop_moved is judged BEFORE the actor rule');
  for (const stage of ['inquiry', 'quote_sent', 'lost']) {
    const l = await lead(db, { stage }); await quote(db, l);
    await refuses(db, () => rec(db, GM_A, l, A), 'lead_not_confirmed', `record: a ${stage} lead`);
  }
  for (const stage of ['out', 'completed']) {
    const l = await lead(db, { stage }); await quote(db, l);
    await allows(db, () => rec(db, GM_A, l, A), `record: a ${stage} lead may take a job`);
  }
  {
    const l = await lead(db); await quote(db, l, { status: 'declined' });
    await refuses(db, () => rec(db, GM_A, l, A), 'order_rejected', 'record: every quote family declined');
    check((await one(db, `select delivery_order_rejected($1) r`, [l])).r === true, 'delivery_order_rejected: the same function says so');
    await quote(db, l, { status: 'sent', at: '2026-11-05T10:00:00Z' });
    await allows(db, () => rec(db, GM_A, l, A), 'record: a re-quote ends the rejection');
    check((await one(db, `select delivery_order_rejected($1) r`, [l])).r === false, 'delivery_order_rejected: no longer');
    const lost = await lead(db, { stage: 'lost' });
    check((await one(db, `select delivery_order_rejected($1) r`, [lost])).r === true, 'delivery_order_rejected: a lost lead');
  }
  {
    const l = await lead(db); await quote(db, l); await quote(db, l);
    await refuses(db, () => rec(db, GM_A, l, A), 'quote_ambiguous', 'record: two accepted quote families');
  }
  {
    const l = await lead(db, { shop: C }); await quote(db, l);
    await refuses(db, () => rec(db, MOO, l, C), 'delivery_off', 'record: the shop has a settings row that is off');
    const none = await lead(db, { shop: CLOSED }); await quote(db, none);
    await refuses(db, () => rec(db, MOO, none, CLOSED), 'delivery_off', 'record: the shop has no settings row');
  }
  await refuses(db, () => rec(db, GM_A, d.lid, A, { via: 'co_ops_api' }), 'api_booking_unavailable', 'record: an API booking cannot be written by this migration');
  await refuses(db, () => rec(db, GM_A, d.lid, A, { via: 'provider_native' }), 'not_ezcater', 'record: provider_native on a house lead');
  {
    const l = await lead(db); await quote(db, l, { delivery: false });
    await refuses(db, () => rec(db, GM_A, l, A), 'not_delivery', 'record: the accepted quote is a pickup');
    const p = await lead(db); await quote(db, p, { status: 'sent', delivery: false });
    await refuses(db, () => rec(db, GM_A, p, A), 'not_delivery', 'record: the pending quote is a pickup');
    const noQuote = await lead(db, { source: 'toast' });
    const r = await rec(db, GM_A, noQuote, A);
    const j = await one(db, `select quote_id, confirm_event_id, attempt_no, location_id::text shop from delivery_jobs where id = $1`, [r.job_id]);
    check(j.quote_id === null && j.confirm_event_id === null && j.attempt_no === 1 && j.shop === A, 'record: a lead with NO quote may take a job (quote_id and confirm_event_id null)');
  }
  await refuses(db, () => rec(db, GM_A, d.lid, A, { label: 'Courier Z' }), 'unknown_provider', 'record: a courier the shop does not list');
  await refuses(db, () => rec(db, GM_A, d.lid, A, { label: 'courier a' }), 'unknown_provider', 'record: the label is matched exactly');

  // The happy path: the job, its first event, the optional cost, ONE audit row.
  await db.exec(`insert into catering_pipeline_events(id, pipeline_id, from_stage, to_stage, created_at) values
    ('${id('5000', 1)}', '${d.lid}', 'quote_sent', 'confirmed', '2026-11-10T10:00:00Z'),
    ('${id('5000', 2)}', '${d.lid}', 'confirmed', 'quote_sent', '2026-11-11T10:00:00Z'),
    ('${id('5000', 3)}', '${d.lid}', 'quote_sent', 'confirmed', '2026-11-12T10:00:00Z'),
    ('${id('5000', 4)}', '${d.lid}', 'confirmed', 'confirmed', '2026-11-13T10:00:00Z')`);
  await db.exec(`delete from audit_log`);
  const j1 = await rec(db, AGM_A, d.lid, A, { label: '  Courier A ', ref: ' DT-123 ', pickup: '2026-11-22T15:00:00Z', dropoff: '2026-11-22T16:00:00Z', cost: 3000, note: 'gate code 4411' });
  {
    const j = await one(db, `select pipeline_id::text lid, location_id::text shop, quote_id::text q, confirm_event_id::text ce, booked_via, provider_label, external_ref,
      attempt_no, closed_at, created_by::text by, status, status_seq from delivery_job_current where id = $1`, [j1.job_id]);
    check(j.lid === d.lid && j.shop === A && j.q === d.q && j.booked_via === 'manual' && j.provider_label === 'Courier A' && j.external_ref === 'DT-123'
      && j.attempt_no === 1 && j.closed_at === null && j.by === AGM_A && j.status === 'accepted' && j.status_seq === 1, 'record: the job row, trimmed, with its first status accepted (seq 1)');
    check(j.ce === id('5000', 3), 'record: confirm_event_id = the LATEST confirming event, never a transfer\'s confirmed -> confirmed row');
    const c = await one(db, `select component, semantics, amount_cents, money_identity, source from delivery_job_costs where job_id = $1`, [j1.job_id]);
    check(c.component === 'base' && c.semantics === 'snapshot' && c.amount_cents === 3000 && c.money_identity === `${j1.job_id}:base` && c.source === 'manual', 'record: the optional first cost is a manual base snapshot');
    const e = await one(db, `select source, actor_id::text a, note from delivery_job_events where job_id = $1`, [j1.job_id]);
    check(e.source === 'manual' && e.a === AGM_A && e.note === 'gate code 4411', 'record: the note rides on the first event');
    const a = (await db.query(`select action, actor_role r, resource_table t, resource_id::text rid, destructive dd, metadata m from audit_log`)).rows;
    check(a.length === 1 && a[0].action === 'delivery.record' && a[0].r === 'agm' && a[0].t === 'delivery_jobs' && a[0].rid === j1.job_id && a[0].dd === true, 'record: ONE destructive audit row delivery.record');
    check(!JSON.stringify(a[0].m).includes('4411') && !JSON.stringify(a[0].m).includes('DT-123') && a[0].m.provider_label === 'Courier A' && a[0].m.has_note === true && a[0].m.has_cost === true,
      'record audit: ids and vocabulary, never the note or the confirmation number');
  }
  // The arbiter.
  await refuses(db, () => rec(db, GM_A, d.lid, A), 'delivery_job_open', 'record: one open job per lead');
  {
    let error; try { await db.query(`insert into delivery_jobs(pipeline_id, location_id, booked_via, provider_label, attempt_no, created_by) values ($1, $2, 'manual', 'X', 2, $3)`, [d.lid, A, GM_A]); } catch (e) { error = e; }
    check(/delivery_jobs_one_open_per_lead/.test(String(error?.message)), `the arbiter is the unique index itself: ${error?.message}`);
    const inserters = (await db.query(`select proname from pg_proc where prosrc ~* 'insert into public\\.delivery_jobs\\M' order by 1`)).rows.map(r => r.proname);
    check(inserters.join() === 'record_manual_delivery_job', `ONE function inserts a job, and it refuses co_ops_api: ${inserters}`);
  }

  // F. Statuses.
  for (const c of moveCases) {
    const r = await one(db, `select delivery_manual_move_allowed($1, $2) r`, [c.from, c.to]);
    if (r.r !== c.allowed) check(false, `manual move ${c.from} -> ${c.to}: expected ${c.allowed}`);
  }
  check(moveCases.length >= 146, `the manual move table equals the shared case file (${moveCases.length} cases)`);
  check((await one(db, `select delivery_manual_move_allowed(null, 'delivered') a, delivery_manual_move_allowed('accepted', null) b`)).a === false, 'a NULL status is never a legal move');
  await refuses(db, () => ev(db, GM_A, id('6000', 1), A, 'accepted', 'picked_up'), 'job_not_found', 'event: no such job');
  await refuses(db, () => ev(db, GM_A, j1.job_id, A, null, 'picked_up'), 'invalid_request', 'event: the status the person saw is required');
  await refuses(db, () => ev(db, GM_B, j1.job_id, A, 'accepted', 'picked_up'), 'forbidden', 'event: a GM of another shop');
  await refuses(db, () => ev(db, PREP, j1.job_id, A, 'accepted', 'picked_up'), 'forbidden', 'event: the prep manager');
  await refuses(db, () => ev(db, GM_A, j1.job_id, A, 'picked_up', 'delivered'), 'status_moved', 'event: the person saw another status');
  for (const to of ['accepted', 'requested', 'driver_assigned', 'en_route_pickup', 'returned', 'nonsense']) {
    await refuses(db, () => ev(db, GM_A, j1.job_id, A, 'accepted', to), 'illegal_move', `event: accepted -> ${to} is not a manual move`);
  }
  await refuses(db, () => ev(db, GM_A, j1.job_id, A, 'accepted', 'picked_up', new Date(Date.now() + 10 * 60_000).toISOString()), 'bad_occurred_at', 'event: a time more than five minutes ahead');
  // Backdated: "picked up at 10:40", recorded now, on a job booked later than 10:40.
  const picked = await ev(db, GM_A, j1.job_id, A, 'accepted', 'picked_up', '2020-01-01T10:40:00Z', 'driver was early');
  {
    const cur = await one(db, `select status, status_seq, status_at, closed_at from delivery_job_current where id = $1`, [j1.job_id]);
    check(picked.status === 'picked_up' && picked.status_seq === 2 && picked.closed === false && cur.status === 'picked_up' && cur.status_seq === 2 && cur.closed_at === null
      && new Date(cur.status_at).toISOString() === '2020-01-01T10:40:00.000Z', 'status = the HIGHEST seq, even when its time is earlier than the booking');
  }
  for (const to of ['accepted', 'picked_up', 'at_dropoff']) await refuses(db, () => ev(db, GM_A, j1.job_id, A, 'picked_up', to), 'illegal_move', `event: picked_up -> ${to}`);
  await db.exec(`delete from audit_log`);
  const delivered = await ev(db, CM, j1.job_id, A, 'picked_up', 'delivered');
  {
    const cur = await one(db, `select status, status_seq, closed_at from delivery_job_current where id = $1`, [j1.job_id]);
    check(delivered.closed === true && cur.status === 'delivered' && cur.status_seq === 3 && cur.closed_at !== null, 'a terminal status stamps closed_at');
    for (const to of ['cancelled', 'failed', 'delivered', 'picked_up']) await refuses(db, () => ev(db, GM_A, j1.job_id, A, 'delivered', to), 'job_closed', `nothing follows a terminal status (-> ${to})`);
    const a = (await db.query(`select action, destructive dd, metadata m from audit_log`)).rows;
    check(a.length === 1 && a[0].action === 'delivery.status' && a[0].dd === true && a[0].m.from === 'picked_up' && a[0].m.to === 'delivered' && a[0].m.closed === true, 'event: ONE destructive audit row delivery.status');
    check(delivered.split_id === null && (await num(db, `select count(*) n from delivery_gratuity_splits`)) === 0, 'delivered with no gratuity on the quote writes no split row');
    const seqs = (await db.query(`select seq, status from delivery_job_events where job_id = $1 order by seq`, [j1.job_id])).rows;
    check(JSON.stringify(seqs) === JSON.stringify([{ seq: 1, status: 'accepted' }, { seq: 2, status: 'picked_up' }, { seq: 3, status: 'delivered' }]), 'seq is 1, 2, 3 per job');
  }
  // A new job after the first closed: attempt 2. Each terminal manual status closes.
  const j2 = await rec(db, GM_A, d.lid, A, { label: 'Courier B' });
  check(j2.attempt_no === 2, 'a new job after a closed one is attempt 2');
  for (const [path, name] of [[['cancelled'], 'accepted -> cancelled'], [['failed'], 'accepted -> failed'], [['delivered'], 'accepted -> delivered'],
    [['picked_up', 'failed'], 'picked_up -> failed'], [['picked_up', 'cancelled'], 'picked_up -> cancelled']]) {
    await db.exec('begin');
    let cur = 'accepted', last;
    for (const to of path) { last = await ev(db, GM_A, j2.job_id, A, cur, to); cur = to; }
    const closedAt = (await one(db, `select closed_at from delivery_jobs where id = $1`, [j2.job_id])).closed_at;
    await db.exec('rollback');
    check(last.closed === true && closedAt !== null, `manual path ${name} closes the job`);
  }
  {
    // Cancelling is allowed in every lead stage: a lost lead's job must be closable.
    await db.exec('begin');
    await db.query(`update catering_pipeline set stage = 'lost' where id = $1`, [d.lid]);
    const r = await ev(db, GM_A, j2.job_id, A, 'accepted', 'cancelled');
    let error; try { await rec(db, GM_A, d.lid, A); } catch (e) { error = e; }
    await db.exec('rollback');
    check(r.closed === true && error?.message === 'lead_not_confirmed', 'a lost lead: its job can be cancelled; no new job can be recorded');
  }
  {
    // closed_at is a one-time stamp even if a terminal event were appended by hand.
    const before = (await one(db, `select closed_at from delivery_jobs where id = $1`, [j1.job_id])).closed_at;
    const src = (await one(db, `select prosrc from pg_proc where proname = 'record_delivery_event'`)).prosrc;
    check(src.includes('update public.delivery_jobs set closed_at = v_now where id = p_job_id and closed_at is null;') && before !== null, 'closed_at is stamped by ONE guarded update');
    const updaters = (await db.query(`select proname from pg_proc where prosrc ~* 'update public\\.delivery_(jobs|job_events|job_costs|gratuity_splits|pickup_decisions)\\M' order by 1`)).rows.map(r => r.proname);
    check(updaters.join() === 'record_delivery_event', `nothing else updates a ledger row: ${updaters}`);
    const deleters = await num(db, `select count(*) n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.prosrc ~* 'delete from public\\.delivery_'`);
    check(deleters === 0, 'no function deletes a delivery row');
  }

  // G. Costs (allowed on a closed job: j1 is delivered).
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'tip', 100), 'invalid_request', 'cost: there is no tip component');
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'base', null), 'invalid_request', 'cost: an amount is required');
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'adjustment', -1), 'bad_amount', 'cost: a negative adjustment');
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'credit', 1), 'bad_amount', 'cost: a positive credit');
  await refuses(db, () => cost(db, GM_A, id('6000', 1), A, 'base', 100), 'job_not_found', 'cost: no such job');
  await refuses(db, () => cost(db, KH, j1.job_id, A, 'wait_time', 100), 'forbidden', 'cost: a key holder');
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'base', 3100), 'cost_exists', 'cost: a first observation of a figure that already has one');
  const baseId = (await one(db, `select id::text id from delivery_job_costs where job_id = $1 and component = 'base'`, [j1.job_id])).id;
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'base', 3100, baseId), 'reason_required', 'cost: a correction needs a note');
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'base', 3100, baseId, '   '), 'reason_required', 'cost: a blank note is no reason');
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'base', 3000, baseId, 'same figure'), 'no_change', 'cost: a correction to the same figure');
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'wait_time', 500, baseId, 'wrong chain'), 'not_current_head', 'cost: a correction that names another figure\'s row');
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'base', 3100, id('7000', 1), 'no such row'), 'not_current_head', 'cost: a correction that names no row');
  await db.exec(`delete from audit_log`);
  const c2 = await cost(db, GM_A, j1.job_id, A, 'base', 3500, baseId, 'invoice said 35');
  await refuses(db, () => cost(db, GM_A, j1.job_id, A, 'base', 3600, baseId, 'stale'), 'not_current_head', 'cost: a correction must name the CURRENT head');
  const c3 = await cost(db, AGM_A, j1.job_id, A, 'base', 3600, c2.cost_id, 'plus the bridge toll');
  const wait = await cost(db, GM_A, j1.job_id, A, 'wait_time', 800);
  const credit = await cost(db, GM_A, j1.job_id, A, 'credit', -200);
  const zero = await cost(db, GM_A, j2.job_id, A, 'base', 0);
  {
    const chain = (await db.query(`select id::text id, amount_cents a, corrects_id::text prev, semantics s, source o, money_identity mi from delivery_job_costs where job_id = $1 and component = 'base' order by observed_at`, [j1.job_id])).rows;
    check(chain.length === 3 && chain[1].prev === baseId && chain[2].prev === c2.cost_id && chain[2].id === c3.cost_id && chain.every(r => r.s === 'snapshot' && r.o === 'manual' && r.mi === `${j1.job_id}:base`),
      'cost: the correction chain 3000 -> 3500 -> 3600, one identity');
    check(wait.amount_cents === 800 && credit.amount_cents === -200 && zero.amount_cents === 0, 'cost: other components, a credit <= 0, and an explicit zero ("no charge") are records');
    const a = (await db.query(`select action, destructive dd, metadata m from audit_log order by id`)).rows;
    check(a.map(x => x.action).join() === 'delivery.cost_correct,delivery.cost_correct,delivery.cost,delivery.cost,delivery.cost' && a.every(x => x.dd === true)
      && a[0].m.before_cents === 3000 && a[0].m.amount_cents === 3500 && !JSON.stringify(a).includes('bridge'), 'cost audit: delivery.cost / delivery.cost_correct, destructive, figures and ids, never the note');
    let error; try { await db.query(`insert into delivery_job_costs(job_id, component, semantics, amount_cents, money_identity, source, corrects_id) values ($1, 'base', 'snapshot', 1, $2, 'manual', $3)`, [j1.job_id, `${j1.job_id}:base`, baseId]); } catch (e) { error = e; }
    check(/delivery_job_costs_one_successor/.test(String(error?.message)), 'cost: one successor per row is the index itself');
    error = undefined; try { await db.query(`insert into delivery_job_costs(job_id, component, semantics, amount_cents, money_identity, source) values ($1, 'base', 'snapshot', 1, $2, 'manual')`, [j1.job_id, `${j1.job_id}:base`]); } catch (e) { error = e; }
    check(/delivery_job_costs_one_manual_root/.test(String(error?.message)), 'cost: one manual root per identity is the index itself');
    await db.exec('begin');
    await db.query(`insert into delivery_job_costs(job_id, component, semantics, amount_cents, money_identity, source) values ($1, 'base', 'delta', 100, 'p:1', 'provider')`, [j1.job_id]);
    error = undefined; try { await db.query(`insert into delivery_job_costs(job_id, component, semantics, amount_cents, money_identity, source) values ($1, 'base', 'delta', 100, 'p:1', 'provider')`, [j1.job_id]); } catch (e) { error = e; }
    await db.exec('rollback');
    check(/delivery_job_costs_provider_once/.test(String(error?.message)), 'cost: a provider observation is recorded once (the index exists for D5)');
    const writers = (await db.query(`select proname from pg_proc where prosrc ~* 'insert into public\\.delivery_job_costs\\M' order by 1`)).rows.map(r => r.proname);
    check(writers.join() === 'record_delivery_cost,record_manual_delivery_job' && !(await one(db, `select bool_or(prosrc ~ '''provider''\\s*,') r from pg_proc where proname = any($1)`, [writers])).r,
      'cost: two inserting functions, neither writes source = provider');
  }

  // H. The gratuity rule and the split chain.
  for (const c of gratuityCases) {
    if (c.invalid) {
      let error; try { await db.query(`select * from delivery_gratuity_split($1, $2)`, [c.gratuityCents, c.driverBps]); } catch (e) { error = e; }
      if (error?.message !== 'bad_gratuity') check(false, `gratuity ${c.gratuityCents} @ ${c.driverBps}: expected bad_gratuity, got ${error?.message}`);
    } else {
      const r = await one(db, `select driver_cents d, crew_cents c from delivery_gratuity_split($1, $2)`, [c.gratuityCents, c.driverBps]);
      if (r.d !== c.driverCents || r.c !== c.crewCents || r.d + r.c !== c.gratuityCents) check(false, `gratuity ${c.gratuityCents} @ ${c.driverBps}: got ${r.d} / ${r.c}`);
    }
  }
  check(gratuityCases.length >= 27, `delivery_gratuity_split equals the shared case file (${gratuityCases.length} cases)`);

  const g = await houseLead(db, { gratuity: 10000 });
  const gj1 = await rec(db, GM_A, g.lid, A);
  check((await head(db, g.lid)) === undefined, 'no split before delivery');
  const gd1 = await ev(db, GM_A, gj1.job_id, A, 'accepted', 'delivered');
  let h = await head(db, g.lid);
  check(gd1.split_id === h.id && h.kind === 'split' && h.job_id === gj1.job_id && h.g === 10000 && h.bps === 1000 && h.d === 1000 && h.c === 9000 && h.prev === null,
    'delivered: the root split, $100 at 10% = $10 driver / $90 crew, credited to that job');
  check((await one(db, `select quote_id::text q, recorded_by::text by, reason from delivery_gratuity_splits where id = $1`, [h.id])).q === g.q, 'the split names the accepted quote');
  // A mistaken "Delivered" on job 1, then the real delivery on job 2: the ONE allocation moves.
  const gj2 = await rec(db, GM_A, g.lid, A, { label: 'Courier B' });
  const gd2 = await ev(db, GM_A, gj2.job_id, A, 'accepted', 'delivered');
  const h1 = h; h = await head(db, g.lid);
  check(gd2.split_id === h.id && h.prev === h1.id && h.job_id === gj2.job_id && h.g === 10000 && h.d === 1000, 'a second delivered job MOVES the allocation: the new head supersedes the old and credits job 2');
  check((await num(db, `select count(*) n from delivery_gratuity_splits s where s.pipeline_id = $1 and not exists (select 1 from delivery_gratuity_splits n where n.supersedes_id = s.id)`, [g.lid])) === 1
    && (await num(db, `select coalesce(sum(s.gratuity_cents), 0) n from delivery_gratuity_splits s where s.pipeline_id = $1 and not exists (select 1 from delivery_gratuity_splits n where n.supersedes_id = s.id)`, [g.lid])) === 10000,
    'ONE head per lead: the order still allocates $100, not $200');
  // The gated correction.
  await refuses(db, () => gsplit(db, GM_A, g.lid, A, 'recompute', h.id, '  '), 'reason_required', 'split: a reason is required');
  await refuses(db, () => gsplit(db, GM_A, g.lid, A, 'refund', h.id, 'x'), 'invalid_request', 'split: an unknown mode');
  await refuses(db, () => gsplit(db, GM_A, id('3000', 999999), A, 'recompute', null, 'x'), 'lead_not_found', 'split: no such lead');
  await refuses(db, () => gsplit(db, AGM_B, g.lid, A, 'recompute', h.id, 'x'), 'forbidden', 'split: an AGM of another shop');
  await refuses(db, () => gsplit(db, SMM, g.lid, A, 'void', h.id, 'x'), 'forbidden', 'split: the social media manager');
  await refuses(db, () => gsplit(db, GM_A, g.lid, A, 'recompute', h1.id, 'x'), 'split_moved', 'split: the head the person saw is no longer the head');
  await refuses(db, () => gsplit(db, GM_A, g.lid, A, 'recompute', null, 'x'), 'split_moved', 'split: "I saw none" while a head exists');
  await refuses(db, () => gsplit(db, GM_A, g.lid, A, 'recompute', h.id, 'nothing changed'), 'no_change', 'split: recompute when the head already says it');
  // The quote is revised after delivery to ZERO gratuity (a new live revision of the same family).
  await db.query(`update catering_quotes set superseded_at = now() where id = $1`, [g.q]);
  const gq2 = await quote(db, g.lid, { gratuity: 0, root: g.q, at: '2026-11-20T10:00:00Z' });
  await db.exec(`delete from audit_log`);
  const zeroed = await gsplit(db, GM_A, g.lid, A, 'recompute', h.id, 'customer removed the gratuity');
  const h2 = h; h = await head(db, g.lid);
  check(zeroed.split_id === h.id && h.kind === 'split' && h.g === 0 && h.d === 0 && h.c === 0 && h.prev === h2.id && h.job_id === gj2.job_id, 'recompute to ZERO appends a 0-cent split that reverses the earlier one');
  {
    const a = (await db.query(`select action, destructive dd, resource_table t, metadata m from audit_log`)).rows;
    check(a.length === 1 && a[0].action === 'delivery.gratuity_split' && a[0].dd === true && a[0].t === 'delivery_gratuity_splits' && a[0].m.mode === 'recompute'
      && a[0].m.gratuity_cents === 0 && a[0].m.supersedes_id === h2.id && !JSON.stringify(a[0].m).includes('customer'), 'split audit: ONE destructive row, figures and ids, never the reason');
    check((await one(db, `select reason, recorded_by::text by from delivery_gratuity_splits where id = $1`, [h.id])).reason === 'customer removed the gratuity', 'the reason is on the row');
  }
  // ... and revised again to $50 at a new accepted revision: recompute follows the order quote.
  await db.query(`update catering_quotes set superseded_at = now() where id = $1`, [gq2]);
  await quote(db, g.lid, { gratuity: 5000, root: g.q, at: '2026-11-21T10:00:00Z' });
  const re = await gsplit(db, CM, g.lid, A, 'recompute', h.id, 'gratuity restored');
  h = await head(db, g.lid);
  check(re.gratuity_cents === 5000 && h.d === 500 && h.c === 4500, 'recompute follows the order quote ($50 -> $5 / $45)');
  // Void.
  const voided = await gsplit(db, GM_A, g.lid, A, 'void', h.id, 'never delivered');
  const h3 = h; h = await head(db, g.lid);
  check(voided.kind === 'void' && h.kind === 'void' && h.g === 0 && h.job_id === null && h.prev === h3.id, 'void appends a void head: nothing is allocated');
  await refuses(db, () => gsplit(db, GM_A, g.lid, A, 'void', h.id, 'again'), 'no_change', 'split: voiding a void');
  const back = await gsplit(db, GM_A, g.lid, A, 'recompute', h.id, 'it was delivered after all');
  check(back.kind === 'split' && back.gratuity_cents === 5000 && back.job_id === gj2.job_id, 'recompute after a void restores the computed allocation');
  check((await num(db, `select count(*) n from delivery_gratuity_splits where pipeline_id = $1`, [g.lid])) === 6
    && (await num(db, `select count(*) n from delivery_gratuity_splits where pipeline_id = $1 and supersedes_id is null`, [g.lid])) === 1, 'the chain is append-only: six rows, ONE root');
  {
    let error; try { await db.query(`insert into delivery_gratuity_splits(pipeline_id, job_id, kind, gratuity_cents, driver_bps, driver_cents, crew_cents) values ($1, $2, 'split', 0, 1000, 0, 0)`, [g.lid, gj1.job_id]); } catch (e) { error = e; }
    check(/delivery_gratuity_splits_one_root/.test(String(error?.message)), 'ONE root per order is the index itself');
    error = undefined; try { await db.query(`insert into delivery_gratuity_splits(pipeline_id, job_id, kind, gratuity_cents, driver_bps, driver_cents, crew_cents, supersedes_id) values ($1, $2, 'split', 100, 1000, 10, 80, $3)`, [g.lid, gj1.job_id, h.id]); } catch (e) { error = e; }
    check(/check/.test(String(error?.message)), 'the parts must sum to the whole (CHECK)');
  }
  {
    // No split yet + nothing to void / nothing to recompute.
    const n = await houseLead(db, { gratuity: 0 });
    const nj = await rec(db, GM_A, n.lid, A);
    await refuses(db, () => gsplit(db, GM_A, n.lid, A, 'void', null, 'x'), 'no_change', 'split: nothing to void');
    await refuses(db, () => gsplit(db, GM_A, n.lid, A, 'recompute', null, 'x'), 'no_change', 'split: no delivered job, nothing to compute');
    await ev(db, GM_A, nj.job_id, A, 'accepted', 'delivered');
    await refuses(db, () => gsplit(db, GM_A, n.lid, A, 'recompute', null, 'x'), 'no_change', 'split: delivered with no gratuity and no head is still nothing');
  }
  {
    // The driver share is the lead's CURRENT shop's, snapshotted on the row (B = 20%).
    const b = await houseLead(db, { shop: B, gratuity: 10000 });
    const bj = await rec(db, GM_B, b.lid, B, { label: 'Courier B' });
    await ev(db, GM_B, bj.job_id, B, 'accepted', 'delivered');
    const hb = await head(db, b.lid);
    check(hb.bps === 2000 && hb.d === 2000 && hb.c === 8000, 'the driver share is the shop setting (20% at B)');
    const sb = await one(db, `select updated_at from delivery_settings where location_id = $1`, [B]);
    await save(db, MOO, B, { enabled: true, manual_providers: ['Courier B'], gratuity_driver_bps: 0 }, sb.updated_at);
    check((await head(db, b.lid)).bps === 2000, 'a later change of the setting never rewrites a recorded split');
  }
  {
    // Ambiguity: a delivered job on an order with two accepted families writes NO split; recompute refuses.
    const m = await houseLead(db, { gratuity: 4000 });
    const mj = await rec(db, GM_A, m.lid, A);
    await quote(db, m.lid, { gratuity: 6000 });
    const r = await ev(db, GM_A, mj.job_id, A, 'accepted', 'delivered');
    check(r.split_id === null && (await head(db, m.lid)) === undefined, 'delivered on an AMBIGUOUS order writes no split');
    await refuses(db, () => gsplit(db, GM_A, m.lid, A, 'recompute', null, 'x'), 'quote_ambiguous', 'split: recompute on an ambiguous order');
  }
  {
    // Pending (nothing accepted): gratuity 0, so no row.
    const p = await lead(db); await quote(db, p, { status: 'sent', gratuity: 7000 });
    const pj = await rec(db, GM_A, p, A);
    const r = await ev(db, GM_A, pj.job_id, A, 'accepted', 'delivered');
    check(r.split_id === null, 'delivered with no ACCEPTED quote allocates nothing');
  }

  // I. The order-quote selection vs the shared case file.
  for (const c of quoteCases) {
    const l = await lead(db, { source: 'website' });
    const ids = new Map();
    for (const q of c.quotes) ids.set(q.n, id('4100', ++quoteN));
    for (const q of c.quotes) {
      await quote(db, l, { qid: ids.get(q.n), status: q.status, delivery: q.isDelivery, gratuity: q.gratuityCents, fee: q.deliveryFeeCents, at: q.createdAt,
        superseded: q.superseded, root: q.rootN ? ids.get(q.rootN) : null });
    }
    const r = (await one(db, `select delivery_order_quote($1) r, delivery_order_rejected($1) x`, [l]));
    const want = c.expect, got = r.r;
    const wantQuote = want.quote === null ? null : ids.get(want.quote);
    const picked = c.quotes.find(q => q.n === want.quote);
    check(got.kind === want.kind && got.quote_id === wantQuote && got.is_delivery === want.isDelivery && r.x === want.rejected
      && (want.kind === 'accepted' ? got.gratuity_cents === picked.gratuityCents && got.delivery_fee_cents === picked.deliveryFeeCents : got.gratuity_cents === null && got.delivery_fee_cents === null),
      `order quote "${c.name}": got ${JSON.stringify(got)} rejected=${r.x}`);
  }
  check(quoteCases.length >= 17, 'the order-quote case file has the accepted / sibling / ambiguous / rejected / pending / none rows');
  check((await one(db, `select delivery_order_rejected($1) r`, [id('3000', 999999)])).r === null, 'delivery_order_rejected: NULL for no lead');

  // J. ezCater: never booked by us.
  {
    const ez = await lead(db, { source: 'ezcater' });
    await refuses(db, () => rec(db, GM_A, ez, A), 'ezcater_never_booked', 'ezCater lead: a manual booking');
    await refuses(db, () => rec(db, GM_A, ez, A, { via: 'co_ops_api' }), 'api_booking_unavailable', 'ezCater lead: an API booking');
    // lead_source was edited away, but an ezcater_orders row still names the lead.
    const edited = await lead(db, { source: 'phone' });
    await db.query(`insert into ezcater_orders(lead_id) values ($1)`, [edited]);
    await quote(db, edited);
    check((await one(db, `select delivery_lead_is_ezcater($1) a, delivery_lead_is_ezcater($2) b, delivery_lead_is_ezcater($3) c`, [ez, edited, d.lid])).b === true, 'ezCater-ness survives an edited lead_source');
    await refuses(db, () => rec(db, GM_A, edited, A), 'ezcater_never_booked', 'ezCater lead with lead_source edited away: still never booked');
    const native = await rec(db, GM_A, ez, A, { via: 'provider_native', label: 'ezCater courier' });
    const nj = await one(db, `select booked_via, provider_label from delivery_jobs where id = $1`, [native.job_id]);
    check(nj.booked_via === 'provider_native' && nj.provider_label === 'ezCater courier', 'ezCater lead: a provider_native RECORD is allowed, with a courier the shop does not list');
    // An ezCater lead is exempt from not_delivery, and its job never takes a split.
    await quote(db, ez, { delivery: false, gratuity: 9000 });
    const r = await ev(db, GM_A, native.job_id, A, 'accepted', 'delivered');
    check(r.split_id === null && (await head(db, ez)) === undefined, 'a provider_native job never takes a gratuity split');
    await allows(db, () => rec(db, GM_A, ez, A, { via: 'provider_native', label: 'X' }), 'ezCater lead: exempt from not_delivery');
  }

  // K. shop_moved on EVERY writer after a transfer (A -> B), nothing written.
  const t = await houseLead(db, { gratuity: 3000 });
  const tj = await rec(db, GM_A, t.lid, A, { cost: 2000 });
  const t2 = await houseLead(db, { gratuity: 3000 });
  const t2j = await rec(db, GM_A, t2.lid, A);
  await ev(db, GM_A, t2j.job_id, A, 'accepted', 'delivered');
  const t2head = await head(db, t2.lid);
  const t3 = await houseLead(db);
  const counts = async () => JSON.stringify(await one(db, `select (select count(*) from delivery_jobs)::int j, (select count(*) from delivery_job_events)::int e,
    (select count(*) from delivery_job_costs)::int c, (select count(*) from delivery_gratuity_splits)::int s, (select count(*) from delivery_pickup_decisions)::int p, (select count(*) from audit_log)::int a`));
  await transfer(db, t.lid, B); await transfer(db, t2.lid, B); await transfer(db, t3.lid, B);
  const beforeStale = await counts();
  const tCost = (await one(db, `select id::text id from delivery_job_costs where job_id = $1`, [tj.job_id])).id;
  await refuses(db, () => rec(db, CM, t3.lid, A), 'shop_moved', 'after a transfer: record_manual_delivery_job');
  await refuses(db, () => ev(db, CM, tj.job_id, A, 'accepted', 'picked_up'), 'shop_moved', 'after a transfer: record_delivery_event');
  await refuses(db, () => cost(db, CM, tj.job_id, A, 'wait_time', 100), 'shop_moved', 'after a transfer: record_delivery_cost (first)');
  await refuses(db, () => cost(db, CM, tj.job_id, A, 'base', 2100, tCost, 'x'), 'shop_moved', 'after a transfer: record_delivery_cost (correction)');
  await refuses(db, () => keep(db, CM, tj.job_id, A), 'shop_moved', 'after a transfer: keep_delivery_pickup');
  await refuses(db, () => gsplit(db, CM, t2.lid, A, 'void', t2head.id, 'x'), 'shop_moved', 'after a transfer: record_delivery_gratuity_split');
  await refuses(db, () => ev(db, GM_A, tj.job_id, A, 'accepted', 'picked_up'), 'shop_moved', 'after a transfer: the old shop\'s GM with the old shop');
  await refuses(db, () => ev(db, GM_A, tj.job_id, B, 'accepted', 'picked_up'), 'forbidden', 'after a transfer: the old shop\'s GM is not a member of the new shop');
  check((await counts()) === beforeStale, 'a stale request wrote nothing anywhere');

  // L. The pickup decision is bound to the destination shop.
  const mismatch = async job => (await one(db, `select j.location_id is distinct from l.location_id and not exists (select 1 from delivery_pickup_decisions x
      where x.job_id = j.id and x.lead_location_id = l.location_id) r from delivery_jobs j join catering_pipeline l on l.id = j.pipeline_id where j.id = $1`, [job])).r;
  check((await mismatch(tj.job_id)) === true, 'a transferred lead with an open job is a pickup mismatch');
  await refuses(db, () => keep(db, GM_A, id('6000', 1), B), 'job_not_found', 'keep: no such job');
  await refuses(db, () => keep(db, AGM_A, tj.job_id, B), 'forbidden', 'keep: the gate binds to the lead\'s CURRENT shop (the old shop\'s AGM is refused)');
  await refuses(db, () => keep(db, GM_A, j2.job_id, A), 'no_mismatch', 'keep: the lead is at the job\'s pickup shop');
  await db.exec(`delete from audit_log`);
  const kept = await keep(db, GM_B, tj.job_id, B, 'A still sends it');
  check(kept.lead_location_id === B && (await mismatch(tj.job_id)) === false, 'keep: the decision is recorded for the shop the LOCK saw; the mismatch is resolved');
  await refuses(db, () => keep(db, GM_B, tj.job_id, B), 'already_kept', 'keep: already acknowledged for this shop');
  {
    const a = (await db.query(`select action, destructive dd, metadata m from audit_log`)).rows;
    check(a.length === 1 && a[0].action === 'delivery.pickup_kept' && a[0].dd === true && a[0].m.pickup_location_id === A && a[0].m.lead_location_id === B && !JSON.stringify(a[0].m).includes('still'),
      'keep: ONE destructive audit row delivery.pickup_kept, never the note');
  }
  await transfer(db, t.lid, C);
  check((await mismatch(tj.job_id)) === true, 'another transfer (-> C) raises the mismatch again: no decision exists for C');
  await refuses(db, () => keep(db, CM, tj.job_id, C), 'delivery_off', 'keep: the destination shop is off (C): off means off');
  {
    const c = await one(db, `select updated_at from delivery_settings where location_id = $1`, [C]);
    await save(db, MOO, C, { enabled: true, manual_providers: [], gratuity_driver_bps: 2500 }, c.updated_at);
  }
  await refuses(db, () => keep(db, CM, tj.job_id, B), 'shop_moved', 'keep: a tap that raced the second transfer');
  const keptC = await keep(db, CM, tj.job_id, C);
  check(keptC.lead_location_id === C && (await mismatch(tj.job_id)) === false && (await num(db, `select count(*) n from delivery_pickup_decisions where job_id = $1`, [tj.job_id])) === 2, 'keep at C: a second decision, append-only');
  await transfer(db, t.lid, B);
  check((await mismatch(tj.job_id)) === false, 'back at B: the earlier decision for B still answers');
  await transfer(db, t.lid, A);
  check((await mismatch(tj.job_id)) === false, 'back at the pickup shop: no mismatch at all');
  await refuses(db, () => keep(db, GM_A, tj.job_id, A), 'no_mismatch', 'keep: nothing to acknowledge at the pickup shop');
  {
    // A closed job has no mismatch to keep; the job keeps its pickup shop as history.
    await transfer(db, t2.lid, C);
    await refuses(db, () => keep(db, CM, t2j.job_id, C), 'job_closed', 'keep: a closed job');
    check((await one(db, `select location_id::text s from delivery_jobs where id = $1`, [t2j.job_id])).s === A, 'the job keeps the PICKUP shop it was recorded for');
    // The split of a transferred order recomputes at the lead's CURRENT shop's share (C: 25%).
    const r = await gsplit(db, CM, t2.lid, C, 'recompute', t2head.id, 'moved shops');
    check(r.driver_bps === 2500 && r.driver_cents === 750 && r.crew_cents === 2250, 'recompute uses the lead\'s CURRENT shop\'s driver share');
    // A shop with NO settings row is off: nothing is recomputed there.
    await transfer(db, t2.lid, CLOSED);
    await refuses(db, () => gsplit(db, CM, t2.lid, CLOSED, 'recompute', r.split_id, 'moved again'), 'delivery_off', 'a shop with NO settings row is off: no split is recomputed there');
    await transfer(db, t2.lid, C);
  }

  // P. OFF MEANS OFF: every writer refuses `delivery_off` while the lead's CURRENT shop is off; open jobs wait.
  {
    const o = await houseLead(db, { gratuity: 3000 });
    const oj = await rec(db, GM_A, o.lid, A, { cost: 1000 });
    const oCost = (await one(db, `select id::text id from delivery_job_costs where job_id = $1`, [oj.job_id])).id;
    const o2 = await houseLead(db, { gratuity: 3000 });
    const o2j = await rec(db, GM_A, o2.lid, A);
    await ev(db, GM_A, o2j.job_id, A, 'accepted', 'delivered');
    const o2h = await head(db, o2.lid);
    const o3 = await houseLead(db);
    const o3j = await rec(db, GM_A, o3.lid, A);
    await transfer(db, o3.lid, B);
    const o4 = await houseLead(db);
    const row = async shop => one(db, `select enabled, manual_providers mp, gratuity_driver_bps bps, updated_at from delivery_settings where location_id = $1`, [shop]);
    const flip = async (shop, enabled) => { const r = await row(shop); return save(db, MOO, shop, { enabled, manual_providers: r.mp, gratuity_driver_bps: r.bps }, r.updated_at); };
    const openAt = async shop => num(db, `select count(*) n from delivery_jobs j join catering_pipeline l on l.id = j.pipeline_id where j.closed_at is null and l.location_id = $1`, [shop]);
    const offA = await flip(A, false), offB = await flip(B, false);
    check(offA.enabled === false && offA.open_jobs === (await openAt(A)) && offA.open_jobs >= 1 && offB.open_jobs === (await openAt(B)) && offB.open_jobs >= 1,
      `turning a shop off answers its open jobs (A ${offA.open_jobs}, B ${offB.open_jobs}): they wait`);
    const before = await counts();
    await refuses(db, () => rec(db, GM_A, o4.lid, A), 'delivery_off', 'shop off: record_manual_delivery_job');
    await refuses(db, () => ev(db, GM_A, oj.job_id, A, 'accepted', 'picked_up'), 'delivery_off', 'shop off: record_delivery_event');
    await refuses(db, () => ev(db, GM_A, oj.job_id, A, 'accepted', 'cancelled'), 'delivery_off', 'shop off: not even a cancellation (no exception)');
    await refuses(db, () => cost(db, GM_A, oj.job_id, A, 'wait_time', 100), 'delivery_off', 'shop off: record_delivery_cost (first)');
    await refuses(db, () => cost(db, GM_A, oj.job_id, A, 'base', 1100, oCost, 'fix'), 'delivery_off', 'shop off: record_delivery_cost (correction)');
    await refuses(db, () => keep(db, GM_B, o3j.job_id, B), 'delivery_off', 'shop off: keep_delivery_pickup (the lead\'s CURRENT shop, B)');
    await refuses(db, () => gsplit(db, GM_A, o2.lid, A, 'void', o2h.id, 'x'), 'delivery_off', 'shop off: record_delivery_gratuity_split');
    // ONE order everywhere: shop_moved, then delivery_off, then the actor rule.
    await refuses(db, () => ev(db, GM_B, oj.job_id, A, 'accepted', 'picked_up'), 'delivery_off', 'shop off is judged BEFORE the actor rule (job-level)');
    await refuses(db, () => gsplit(db, PREP, o2.lid, A, 'void', o2h.id, 'x'), 'delivery_off', 'shop off is judged BEFORE the actor rule (lead-level)');
    await refuses(db, () => ev(db, GM_A, oj.job_id, B, 'accepted', 'picked_up'), 'shop_moved', 'shop_moved is judged BEFORE the switch (job-level)');
    await refuses(db, () => gsplit(db, GM_A, o2.lid, B, 'void', o2h.id, 'x'), 'shop_moved', 'shop_moved is judged BEFORE the switch (lead-level)');
    check((await counts()) === before, 'while a shop is off no writer wrote anything');
    check((await one(db, `select closed_at from delivery_jobs where id = $1`, [oj.job_id])).closed_at === null, 'the open job is still open: it waits');
    const onA = await flip(A, true); await flip(B, true);
    check(onA.enabled === true && onA.open_jobs === offA.open_jobs, 'turning the shop on again: the same jobs are still there');
    check((await ev(db, GM_A, oj.job_id, A, 'accepted', 'picked_up')).status === 'picked_up', 'shop on again: record_delivery_event works');
    check((await cost(db, GM_A, oj.job_id, A, 'base', 1100, oCost, 'fix')).amount_cents === 1100, 'shop on again: record_delivery_cost works');
    check((await keep(db, GM_B, o3j.job_id, B)).lead_location_id === B, 'shop on again: keep_delivery_pickup works');
    check((await gsplit(db, GM_A, o2.lid, A, 'void', o2h.id, 'never delivered')).kind === 'void', 'shop on again: record_delivery_gratuity_split works');
    check((await rec(db, GM_A, o4.lid, A)).attempt_no === 1, 'shop on again: record_manual_delivery_job works');
  }

  // M. Lock order, on the sources.
  {
    const src = async name => (await one(db, `select prosrc from pg_proc where proname = $1`, [name])).prosrc;
    const leadGate = await src('delivery_lead_gate'), jobGate = await src('delivery_job_gate');
    const lg = [leadGate.indexOf('for no key update'), leadGate.indexOf("raise exception 'shop_moved'"), leadGate.indexOf('public.delivery_actor_role(')];
    check(lg[0] > 0 && lg[0] < lg[1] && lg[1] < lg[2] && !/for update/.test(leadGate), 'lead gate: the lead FOR NO KEY UPDATE, then shop_moved, then the actor rule');
    for (const [name, gate] of [['lead', leadGate], ['job', jobGate]]) {
      const off = gate.indexOf("raise exception 'delivery_off'");
      check(off > gate.indexOf("raise exception 'shop_moved'") && off < gate.indexOf('public.delivery_actor_role(')
        && gate.includes('from public.delivery_settings s where s.location_id = o_shop and s.enabled'),
        `${name} gate: shop_moved, then delivery_off (the lead's CURRENT shop), then the actor rule`);
    }
    const jg = [jobGate.indexOf('from public.catering_pipeline l where l.id = o_lead for no key update'), jobGate.indexOf('from public.delivery_jobs j where j.id = p_job_id for update'),
      jobGate.indexOf("raise exception 'shop_moved'"), jobGate.indexOf('public.delivery_actor_role(')];
    check(jg[0] > 0 && jg[0] < jg[1] && jg[1] < jg[2] && jg[2] < jg[3], 'job gate: (1) the lead FOR NO KEY UPDATE -> (2) the job FOR UPDATE, then shop_moved, then the actor rule');
    check((await src('delivery_actor_role')).includes('from public.users u where u.id = p_actor_id and u.active for share'), 'the actor rule reads the LOCKED users row (FOR SHARE, active)');
    for (const [name, gate] of [['record_manual_delivery_job', 'delivery_lead_gate'], ['record_delivery_gratuity_split', 'delivery_lead_gate'], ['record_delivery_event', 'delivery_job_gate'],
      ['record_delivery_cost', 'delivery_job_gate'], ['keep_delivery_pickup', 'delivery_job_gate']]) {
      const s = await src(name);
      const at = s.indexOf(`public.${gate}(p_actor_id, `);
      const firstWrite = Math.min(...['insert into public.', 'update public.', 'public.delivery_write_split('].map(x => s.indexOf(x)).filter(i => i >= 0));
      check(at > 0 && at < firstWrite && !/for (no key )?update of|for no key update|\bfor update;/.test(s.replace(/for update of s;/, '')) && /p_expected_shop/.test(s),
        `${name}: takes its locks through ${gate} only, before any write, with the shop the person saw`);
    }
    const lockers = (await db.query(`select proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public'
      and p.prosrc ~* 'from public\\.catering_pipeline[^;]*for (no key )?update' order by 1`)).rows.map(r => r.proname);
    check(lockers.join() === 'delivery_job_gate,delivery_lead_gate', `only the two gates lock a lead: ${lockers}`);
    const touches = await num(db, `select count(*) n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public'
      and p.proname = any($1)
      and p.prosrc ~* '(insert into|update|delete from)\\s+public\\.(catering_|ezcater_|users|user_locations|locations)'`, [[...PUBLIC_FNS, ...INTERNAL_FNS]]);
    check(touches === 0, 'no delivery function writes a catering, ezCater, user or shop table');
  }

  // N. Every action a writer can emit is one of the seven registered names.
  {
    const names = new Set();
    for (const w of WRITERS) {
      const s = (await one(db, `select prosrc from pg_proc where proname = $1`, [w])).prosrc;
      for (const m of s.matchAll(/'(delivery\.[a-z_]+)'/g)) names.add(m[1]);
      check((s.match(/insert into public\.audit_log/g) ?? []).length === 1 && /, true\);/.test(s), `${w}: exactly one audit insert, destructive literally true`);
    }
    check(JSON.stringify([...names].sort()) === JSON.stringify(['delivery.cost', 'delivery.cost_correct', 'delivery.gratuity_split', 'delivery.pickup_kept', 'delivery.record', 'delivery.settings_update', 'delivery.status']),
      `the seven audit names: ${[...names].sort()}`);
  }

  // O. Every refusal the file can raise was raised here, by name (bad_gratuity is the pure rule's, section H).
  {
    const named = new Set([...m0356.replace(/--[^\n]*/g, '').matchAll(/raise exception '(\w+)' using errcode = 'P0001'/g)].map(m => m[1]));
    refused.add('bad_gratuity');
    const missing = [...named].filter(n => !refused.has(n)), extra = [...refused].filter(n => !named.has(n));
    check(missing.length === 0 && extra.length === 0 && named.size === 31, `every named refusal is exercised: missing ${missing}, unknown ${extra}, ${named.size} names`);
  }

  console.log(`sql-harness-0356: ${checks} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.stack ?? e.message); process.exit(1); });
