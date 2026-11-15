/**
 * 0312 offline proof (PGlite, single session, synthetic fixtures only). FILE + LOCAL ONLY: no network,
 * no sim, no prod. It loads the REAL parents (0221's toast tables, 0234, 0249, 0250, and 0300's consent
 * pieces) and then, for every W12 bug, runs the same scenario twice:
 *   BEFORE — on the parents alone: the bug must reproduce (proves the scenario is a real red);
 *   AFTER  — with 0312 applied: the scenario must pass.
 * Regressions run on both and must pass on both. An UPGRADE database carries pre-0312 state through
 * the apply (the B174 acknowledgement gate, the B176 backfill, the B071 existing-state flip). Pre-flight
 * refusals and an ACL sabotage prove a refused apply leaves no partial DDL.
 * The B070 lock race needs two sessions: scripts/sim/customers-0312-retention-lock-check-management.mjs (sim only, CC).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8');
const migration = read('0312_customer_consent_retention_fixes.sql');
function table(file, name) {
  const m = read(file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'));
  assert.ok(m, name);
  return m[0];
}
const consent0300 = read('0300_meta_leads.sql').match(
  /alter table public\.customer_consent_events drop constraint customer_consent_events_source_check;[\s\S]*?create function public\.customer_consent_record_explicit[\s\S]*?end \$\$;/i)?.[0];
assert.ok(consent0300, '0300 consent block');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let checks = 0;
const check = (v, s) => { assert.ok(v, s); checks++; console.log(`ok ${s}`); };

async function fresh(with0312) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to public,anon,authenticated,service_role;
    create table public.locations(id uuid primary key, active boolean default true);
    create table public.users(id uuid primary key, role text, active boolean default true);
    create table public.catering_orders(id uuid primary key);
    create table public.ezcater_orders(id uuid primary key);
    ${table('0221_toast_order_capture.sql', 'toast_capture_runs')}
    ${table('0221_toast_order_capture.sql', 'toast_orders')}
    ${table('0221_toast_order_capture.sql', 'toast_order_latest_pointers')}`);
  await db.exec(read('0234_customer_profiles.sql'));
  await db.exec(read('0249_customer_list_v2.sql'));
  await db.exec(read('0250_customer_link_revoke.sql'));
  await db.exec(`begin; ${consent0300}
    revoke all on function public.customer_consent_record_explicit(text,text,text,timestamptz,text,text) from public, anon, authenticated, service_role;
    grant execute on function public.customer_consent_record_explicit(text,text,text,timestamptz,text,text) to service_role; commit;`);
  const actor = randomUUID();
  await db.query("insert into users(id, role) values($1,'owner')", [actor]);
  if (with0312) await db.exec(migration);
  return { db, actor };
}

const rows = async (db, s, a = []) => (await db.query(s, a)).rows;
const one = async (db, s, a = []) => (await rows(db, s, a))[0];
const call = async (db, fn, args, casts = []) =>
  (await one(db, `select public.${fn}(${args.map((_, i) => `$${i + 1}${casts[i] ?? ''}`).join(',')}) r`, args)).r;

async function importList({ db, actor }, list, date, { explicit = false, allow = false } = {}) {
  const key = sha(JSON.stringify([date, explicit, list, randomUUID()]));
  const begun = await call(db, 'customer_consent_import_begin', [actor, 'toast_csv_import', key, date, explicit, 1]);
  await call(db, 'customer_consent_import_chunk', [actor, begun.import_id, 0, JSON.stringify(list)], ['', '', '', '::jsonb']);
  return call(db, 'customer_consent_import_finish', [actor, begun.import_id, allow]);
}
const resolve = (db, email, phone = null, seen = null) => one(db,
  "select customer_id, created, suppressed from public.customer_resolve($1,$2,null,null,null,null,coalesce($3::timestamptz, now()),'toast_pos',null)",
  [email, phone, seen]);
const current = (db, email) => one(db, `select k.status, k.subject_sha256, k.customer_id from public.customer_consent_current k
  join public.customer_identifiers i on public.customer_root(i.customer_id) = k.customer_id
  where i.kind = 'email' and i.value = $1 and k.channel = 'email'`, [email]);
const exported = async (db) => (await rows(db, "select customer_id, value from public.customer_marketing_export('email')"));
const explicitConsent = (db, email, ref) => call(db, 'customer_consent_record_explicit',
  [email, 'email', 'meta_lead_form', new Date().toISOString(), `${ref}:email_marketing_opt_in`, 'meta-email-marketing-v3']);

// ── scenarios: { fixed } is true when the W12 behaviour holds ─────────────────────────────────────
async function b071(ctx) {
  const others = Array.from({ length: 30 }, (_, i) => ({ email: `p${String(i).padStart(2, '0')}@example.test` }));
  const alice = { email: 'alice@example.test' };
  await importList(ctx, [alice, ...others], '2026-10-10');
  const partial = await importList(ctx, others.slice(19), '2026-10-14'); // alice + 19 others absent = 20 (< 25)
  const corrected = await importList(ctx, [alice, ...others], '2026-10-14');
  const cur = await current(ctx.db, alice.email);
  const out = (await exported(ctx.db)).map((r) => r.value);
  return { fixed: cur.status === 'opted_in' && out.includes(alice.email) && out.length === 31,
    absent: partial.absent_opt_outs, newOptIns: corrected.new_opt_ins };
}
async function b173(ctx) {
  const P = '+12025550142', a = 'a@example.test', b = 'b@example.test';
  const c = (await resolve(ctx.db, a, P)).customer_id;
  check((await resolve(ctx.db, b, P)).customer_id === c, 'fixture: one person owns both addresses through the shared phone');
  const i1 = await importList(ctx, [{ email: a }, { email: b }], '2026-10-01');
  const s1 = (await current(ctx.db, a)).subject_sha256;
  const i2 = await importList(ctx, [{ email: a }, { email: b }], '2026-10-05');
  const s2 = (await current(ctx.db, a)).subject_sha256;
  const i2Events = (await one(ctx.db, 'select count(*)::int n from customer_consent_events where import_run_id = $1 and customer_id = $2', [i2.import_id, c])).n;
  const newly = (await rows(ctx.db, "select customer_id from public.customer_newly_opted_in('2026-10-04T00:00:00Z'::timestamptz, 200)")).map((r) => r.customer_id);
  const keep = i2.new_opt_ins === 0 && s1 === s2 && i2Events === 0 && !newly.includes(c);
  // The address in use leaves the list: the subject moves to the still-listed one, no new opt-in.
  const other = s2 === sha(a) ? b : a;
  const i3 = await importList(ctx, [{ email: other }], '2026-10-09');
  const s3 = (await current(ctx.db, a)).subject_sha256;
  const mine = (await exported(ctx.db)).filter((r) => r.customer_id === c).map((r) => r.value);
  const move = i3.new_opt_ins === 0 && s3 === sha(other) && mine.length === 1 && mine[0] === other;
  return { fixed: keep && move, keep, move, baselineNewOptIns: i1.new_opt_ins, i2NewOptIns: i2.new_opt_ins, i3NewOptIns: i3.new_opt_ins };
}
async function b174(ctx) {
  const x = 'xavier@example.test';
  const erased = (await resolve(ctx.db, x, null, new Date(Date.now() - 37 * 31 * 86_400_000).toISOString())).customer_id;
  const sweep = (await one(ctx.db, "select public.customer_retention_sweep($1, now() - interval '36 months', 200) r", [ctx.actor])).r;
  const supp = (await one(ctx.db, "select count(*)::int n from customer_suppressions where value_sha256 = $1", [sha(x)])).n;
  let recorded;
  try { recorded = await explicitConsent(ctx.db, x, '1'); } catch (e) { recorded = { error: String(e.message) }; }
  const cur = await current(ctx.db, x);
  const out = (await exported(ctx.db)).map((r) => r.value);
  return { fixed: sweep.erased === 1 && supp === 0 && recorded.recorded === true && cur?.customer_id !== erased && out.includes(x),
    sweep, supp, recorded };
}
async function b070Recheck(ctx) {
  // A test-only trigger makes the person the sweep reaches SECOND active while the first is erased —
  // after the cursor's snapshot was taken. That is the race, in one session.
  const p1 = (await resolve(ctx.db, 'old1@example.test', null, new Date(Date.now() - 40 * 31 * 86_400_000).toISOString())).customer_id;
  const p2 = (await resolve(ctx.db, 'old2@example.test', null, new Date(Date.now() - 38 * 31 * 86_400_000).toISOString())).customer_id;
  await ctx.db.exec(`create table w12_touch_target(id uuid);
    create function w12_touch() returns trigger language plpgsql as $t$ begin
      if new.erased_at is not null and old.erased_at is null then
        update public.customers set last_seen_at = now() where id in (select id from w12_touch_target) and erased_at is null;
      end if; return new; end $t$;
    create trigger w12_touch after update on public.customers for each row execute function w12_touch();`);
  await ctx.db.query('insert into w12_touch_target values($1)', [p2]);
  const sweep = (await one(ctx.db, "select public.customer_retention_sweep($1, now() - interval '36 months', 200) r", [ctx.actor])).r;
  const two = await one(ctx.db, 'select erased_at, last_seen_at > now() - interval \'1 day\' as active from customers where id = $1', [p2]);
  const idents = (await one(ctx.db, 'select count(*)::int n from customer_identifiers where customer_id = $1', [p2])).n;
  return { fixed: sweep.erased === 1 && sweep.skipped === 1 && two.erased_at === null && two.active && idents === 1, sweep, p1 };
}
async function seedToast(db) {
  const shop = randomUUID();
  await db.query('insert into locations(id) values($1)', [shop]);
  const run = (await one(db, "insert into toast_capture_runs(location_id,business_date) values($1,'2026-11-01') returning id", [shop])).id;
  const snap = async (voided, n) => (await one(db, `insert into toast_orders(location_id,order_guid,business_date,content_hash,deleted,voided,excess_food)
    values($1,'O1','2026-11-01',$2,false,$3,false) returning id`, [shop, sha(`O1-${n}`), voided])).id;
  const live = await snap(false, 1);
  await db.query("insert into toast_order_latest_pointers(location_id,order_guid,snapshot_id,business_date,run_started_at,run_id) values($1,'O1',$2,'2026-11-01',now(),$3)", [shop, live, run]);
  const ingest = await call(db, 'customer_ingest_orders', [shop, JSON.stringify([{ order_guid: 'O1', business_date: '2026-11-01', email: 'guest@example.test',
    full_name: 'Guest One', channel: 'online', total_cents: 2500, source: 'toast_online', items: [] }])], ['', '::jsonb']);
  const voided = await snap(true, 2);
  return { shop, live, voided, ingest, repoint: (id) => db.query("update toast_order_latest_pointers set snapshot_id = $1 where location_id = $2 and order_guid = 'O1'", [id, shop]) };
}
const listRow = (db) => one(db, "select r.visits::int, r.spend_cents::int as spend, r.last_order::text from public.customer_list_rows(null) r join customer_identifiers i on i.customer_id = r.customer_id where i.value = 'guest@example.test'");
async function b176(ctx) {
  const t = await seedToast(ctx.db);
  check(t.ingest.linked === 1, 'fixture: the guest order links once');
  const before = await listRow(ctx.db);
  await t.repoint(t.voided);
  let sync = null;
  if (ctx.with0312) sync = await call(ctx.db, 'customer_orders_sync_voided', [t.shop, '2026-11-01']);
  const after = await listRow(ctx.db);
  const fixed = before.visits === 1 && before.spend === 2500 && after?.visits === 0 && after?.spend === 0 && after?.last_order === '2026-11-01';
  if (!ctx.with0312) return { fixed, after };
  const marked = await one(ctx.db, 'select voided_at is not null as v from customer_orders where toast_order_guid = $1', ['O1']);
  await t.repoint(t.live);
  const back = await call(ctx.db, 'customer_orders_sync_voided', [t.shop, '2026-11-01']);
  const restored = await listRow(ctx.db);
  const again = await call(ctx.db, 'customer_ingest_orders', [t.shop, JSON.stringify([{ order_guid: 'O1', business_date: '2026-11-01', email: 'guest@example.test',
    full_name: 'Guest One', channel: 'online', total_cents: 2500, source: 'toast_online', items: [] }])], ['', '::jsonb']);
  await t.repoint(t.voided);
  await call(ctx.db, 'customer_orders_sync_voided', [t.shop, '2026-11-01']);
  await call(ctx.db, 'customer_ingest_orders', [t.shop, JSON.stringify([{ order_guid: 'O1', business_date: '2026-11-01', email: 'guest@example.test',
    full_name: 'Guest One', channel: 'online', total_cents: 2500, source: 'toast_online', items: [] }])], ['', '::jsonb']);
  const stillVoid = await one(ctx.db, 'select voided_at is not null as v from customer_orders where toast_order_guid = $1', ['O1']);
  return { fixed: fixed && sync.voided === 1 && sync.restored === 0 && marked.v && back.restored === 1 && restored.visits === 1
    && restored.spend === 2500 && again.linked === 1 && stillVoid.v, sync, back };
}
async function b177(ctx) {
  const A = randomUUID(), B = randomUUID();
  await ctx.db.query('insert into locations(id) values($1),($2)', [A, B]);
  const people = (await rows(ctx.db, 'insert into customers(full_name) select \'P\' || g from generate_series(1,120) g returning id')).map((r) => r.id).sort();
  for (let i = 0; i < 60; i++) {
    const shop = i < 50 ? B : A;
    for (const id of [people[2 * i], people[2 * i + 1]]) {
      const order = randomUUID();
      await ctx.db.query('insert into catering_orders(id) values($1)', [order]);
      await ctx.db.query("insert into customer_orders(customer_id,location_id,source_kind,catering_order_id,business_date,channel) values($1,$2,'catering',$3,'2026-11-01','catering')", [id, shop, order]);
    }
    await ctx.db.query("insert into customer_merge_suggestions(customer_a,customer_b,confidence,reasons) values($1,$2,$3,array['same_full_name'])",
      [people[2 * i], people[2 * i + 1], i < 50 ? 0.95 : 0.5]);
  }
  // The pre-0312 app read: top 50 by confidence, THEN the shop filter (assertInScope's rule).
  const oldPath = (await one(ctx.db, `with top as (select * from customer_merge_suggestions where status='open' order by confidence desc limit 50)
    select count(*)::int n from top s where exists(select 1 from customer_orders o join customers m on m.id=o.customer_id where (m.id=s.customer_a or m.merged_into=s.customer_a) and o.location_id=$1)
      and exists(select 1 from customer_orders o join customers m on m.id=o.customer_id where (m.id=s.customer_b or m.merged_into=s.customer_b) and o.location_id=$1)`, [A])).n;
  if (!ctx.with0312) return { fixed: oldPath === 10, oldPath };
  const n = async (scope) => (await one(ctx.db, 'select count(*)::int n from public.customer_merge_suggestions_open($1::uuid[], 50)', [scope])).n;
  const forA = await n([A]), all = await n(null), forB = await n([B]);
  const order = (await rows(ctx.db, 'select confidence::text from public.customer_merge_suggestions_open(null, 200)')).map((r) => r.confidence);
  return { fixed: forA === 10 && all === 50 && forB === 50 && order.length === 60 && order[0] === '0.95' && order[59] === '0.50', forA, all, forB };
}

// ── regressions: true before AND after ────────────────────────────────────────────────────────────
async function regressions(ctx, label) {
  const P = '+12025550199';
  await resolve(ctx.db, 'r1@example.test', P); await resolve(ctx.db, 'r2@example.test', P);
  await importList(ctx, [{ email: 'r1@example.test', status: 'opted_in' }, { email: 'r2@example.test', status: 'opted_out' }], '2026-10-01', { explicit: true });
  check((await current(ctx.db, 'r1@example.test')).status === 'opted_out', `${label}: inside one import an opt-out still wins the tie`);

  const r = await fresh(ctx.with0312);
  await importList(r, [{ email: 'n@example.test' }], '2026-10-01');
  const root = (await current(r.db, 'n@example.test')).customer_id;
  await r.db.query("insert into customer_consent_events(customer_id,channel,status,source,effective_at) values($1,'email','opted_out','toast_order',('2026-10-08'::timestamp at time zone 'America/New_York'))", [root]);
  await importList(r, [{ email: 'n@example.test' }], '2026-10-08');
  check((await current(r.db, 'n@example.test')).status === 'opted_out', `${label}: a non-import opt-out still beats an import at the same instant`);
  const replayKey = sha('replay');
  const first = await call(r.db, 'customer_consent_import_begin', [r.actor, 'toast_csv_import', replayKey, '2026-10-09', false, 1]);
  await call(r.db, 'customer_consent_import_chunk', [r.actor, first.import_id, 0, JSON.stringify([{ email: 'n@example.test' }])], ['', '', '', '::jsonb']);
  await call(r.db, 'customer_consent_import_finish', [r.actor, first.import_id, false]);
  check((await call(r.db, 'customer_consent_import_begin', [r.actor, 'toast_csv_import', replayKey, '2026-10-09', false, 1])).state === 'completed', `${label}: the latest identical snapshot replays`);
  const run = await call(r.db, 'customer_consent_import_begin', [r.actor, 'toast_csv_import', sha('cancel'), '2026-10-10', false, 1]);
  await call(r.db, 'customer_consent_import_chunk', [r.actor, run.import_id, 0, JSON.stringify([{ email: 'cancelled@example.test' }])], ['', '', '', '::jsonb']);
  await call(r.db, 'customer_consent_import_cancel', [r.actor, run.import_id]);
  check(!(await current(r.db, 'cancelled@example.test')), `${label}: a cancelled import's events never count`);
  await r.db.close();

  const e = await fresh(ctx.with0312);
  await importList(e, [{ email: 'ana@example.test' }], '2026-10-01');
  const empty = await importList(e, [], '2026-10-08', { allow: true });
  check(empty.absent_opt_outs === 1 && !(await exported(e.db)).some((x) => x.value === 'ana@example.test'), `${label}: an empty snapshot opts out the remaining subscriber`);
  const y = 'y@example.test';
  const yId = (await resolve(e.db, y)).customer_id;
  await call(e.db, 'customer_erase', [e.actor, yId, 'delete_request']);
  await assert.rejects(() => explicitConsent(e.db, y, '7'), /consent_suppressed/);
  check((await resolve(e.db, y)).suppressed === true, `${label}: a delete request still suppresses for good`);
  await e.db.close();
}

// ── pre-flight refusals: a refused apply leaves no partial DDL ────────────────────────────────────
async function refused(prep, re, label, sql = migration) {
  const { db } = await fresh(false);
  if (prep) await db.exec(prep);
  await assert.rejects(() => db.exec(sql), re);
  await db.exec('rollback').catch(() => {});
  const col = await one(db, "select count(*)::int n from information_schema.columns where table_name='customer_orders' and column_name='voided_at'");
  const fn = await one(db, "select to_regprocedure('public.customer_merge_suggestions_open(uuid[],integer)') is null as gone");
  check(col.n === 0 && fn.gone, `${label}: no partial DDL`);
  await db.close();
}

try {
  const results = {};
  for (const [name, run] of Object.entries({ b071, b173, b174, b070Recheck, b176, b177 })) {
    const before = await fresh(false); before.with0312 = false;
    const after = await fresh(true); after.with0312 = true;
    results[name] = { before: await run(before), after: await run(after) };
    await before.db.close(); await after.db.close();
  }
  check(!results.b071.before.fixed, 'B071 reproduced before 0312: the corrected same-date re-import leaves alice opted out');
  check(results.b071.before.newOptIns === 20, 'B071 reproduced before 0312: the summary still claimed 20 new opt-ins');
  check(results.b071.after.fixed && results.b071.after.newOptIns === 20 && results.b071.after.absent === 20,
    'same-date corrected re-import restores the people a partial file dropped');
  check(!results.b173.before.fixed && results.b173.before.i2NewOptIns === 1, 'B173 reproduced before 0312: the subject flips and counts as a new opt-in');
  check(results.b173.after.keep, 'a person with two listed addresses keeps one subject and is not a new opt-in');
  check(results.b173.after.move, 'when the address in use leaves the list, the subject moves to a still-listed address');
  check(results.b173.after.baselineNewOptIns === 1 && results.b173.before.baselineNewOptIns === 2, 'one person with two listed addresses counts as one opt-in in the baseline');
  check(!results.b174.before.fixed && /consent_suppressed/.test(results.b174.before.recorded.error ?? ''), 'B174 reproduced before 0312: a returning guest is refused for good');
  check(results.b174.after.fixed, 'retention erasure leaves no suppression; a returning guest can opt in again as a new customer');
  check(!results.b070Recheck.before.fixed && results.b070Recheck.before.sweep.erased === 2, 'B070 reproduced before 0312: the sweep erased a person who had just become active');
  check(results.b070Recheck.after.fixed, 'a person made active after the candidate snapshot is skipped, not erased');
  check(!results.b176.before.fixed, 'B176 reproduced before 0312: a voided order still counts as a visit and spend');
  check(results.b176.after.fixed, 'a voided order leaves visits and spend but stays listed; an un-void brings it back; a re-capture never un-voids');
  check(!results.b177.before.fixed && results.b177.before.oldPath === 0, 'B177 reproduced before 0312: other shops fill the top 50 and the GM sees none');
  check(results.b177.after.fixed, "a GM sees their shop's suggestions even when other shops fill the top 50");

  // B070: the lock is taken before the candidate query (the two-session proof is the sim script's).
  {
    const { db } = await fresh(true);
    const def = (await one(db, "select pg_get_functiondef('public.customer_retention_sweep(uuid,timestamptz,integer)'::regprocedure) d")).d;
    check(def.indexOf('customer_identity_lock()') > 0 && def.indexOf('customer_identity_lock()') < def.indexOf('for v_id in'),
      'retention sweep takes the identity lock before reading candidates');
    const p = await resolve(db, 'recent@example.test', null, new Date(Date.now() - 2 * 86_400_000).toISOString());
    const q = await resolve(db, 'stale-opted@example.test', null, new Date(Date.now() - 40 * 31 * 86_400_000).toISOString());
    await explicitConsent(db, 'stale-opted@example.test', '3');
    await db.query("update customers set last_seen_at = now() - interval '40 months' where id = $1", [q.customer_id]);
    const sweep = (await one(db, "select public.customer_retention_sweep($1, now() - interval '36 months', 200) r", [randomUUID()])).r;
    check(sweep.erased === 0 && sweep.skipped === 0 && p.customer_id, 'a recently seen or opted-in person is never a retention candidate');
    // Privilege ceilings on every re-emitted / new function.
    for (const [sig, svc] of [
      ['customer_consent_latest(uuid,text)', false], ['customer_resolve(text,text,text,text,text,uuid,timestamptz,text,text)', false],
      ['customer_list_rows(uuid[])', false], ['customer_consent_import_chunk(uuid,uuid,integer,jsonb)', true],
      ['customer_consent_import_finish(uuid,uuid,boolean)', true], ['customer_newly_opted_in(timestamptz,integer)', true],
      ['customer_erase(uuid,uuid,text)', true], ['customer_marketing_export(text)', true],
      ['customer_consent_record_explicit(text,text,text,timestamptz,text,text)', true], ['customer_retention_sweep(uuid,timestamptz,integer)', true],
      ['customer_orders_sync_voided(uuid,date)', true], ['customer_merge_suggestions_open(uuid[],integer)', true]]) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const x = (await one(db, "select has_function_privilege($1, $2::regprocedure, 'EXECUTE') x", [role, `public.${sig}`])).x;
        check(x === (role === 'service_role' && svc), `${sig} ${role} execute ceiling`);
      }
      const p2 = await one(db, "select prosecdef, proconfig from pg_proc where oid = $1::regprocedure", [`public.${sig}`]);
      check(p2.prosecdef && p2.proconfig.some((c) => c.replace(/\s/g, '') === 'search_path=pg_catalog,public'), `${sig} definer + pinned search_path`);
    }
    for (const role of ['anon', 'authenticated', 'service_role']) for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      for (const t of ['customer_orders', 'customer_consent_import_members', 'customer_suppressions', 'customer_consent_current']) {
        const x = (await one(db, 'select has_table_privilege($1,$2,$3) x', [role, `public.${t}`, priv])).x;
        check(x === (role === 'service_role' && priv === 'SELECT'), `${t} ${role} ${priv} ceiling`);
      }
    }
    await db.exec('set role service_role');
    check((await one(db, "select count(*)::int n from public.customer_merge_suggestions_open(null, 50)")).n === 0, 'service_role can call the new suggestions read');
    await db.exec('reset role');
    await db.close();
  }

  for (const ctx of [{ with0312: false, label: 'before 0312' }, { with0312: true, label: 'after 0312' }]) {
    const f = await fresh(ctx.with0312);
    await regressions({ ...f, with0312: ctx.with0312 }, ctx.label);
    await f.db.close();
  }

  // ── UPGRADE: pre-0312 state carried through the apply ──────────────────────────────────────────
  {
    const up = await fresh(false); up.with0312 = false;
    await b071(up);
    check((await current(up.db, 'alice@example.test')).status === 'opted_out', 'upgrade fixture: alice is wrongly opted out before 0312');
    const t = await seedToast(up.db); await t.repoint(t.voided);
    const z = 'z@example.test';
    await resolve(up.db, z, null, new Date(Date.now() - 37 * 31 * 86_400_000).toISOString());
    await one(up.db, "select public.customer_retention_sweep($1, now() - interval '36 months', 200) r", [up.actor]);
    check((await one(up.db, "select count(*)::int n from customer_suppressions where reason = 'retention'")).n === 1, 'upgrade fixture: one retention suppression exists');
    const events = (await one(up.db, 'select count(*)::int n from customer_consent_events')).n;
    await assert.rejects(() => up.db.exec(migration), /1 retention suppression row\(s\) would stop blocking/);
    await up.db.exec('rollback').catch(() => {});
    check((await one(up.db, "select count(*)::int n from information_schema.columns where table_name='customer_orders' and column_name='voided_at'")).n === 0,
      'unacknowledged retention unblock is refused with its count and leaves no partial DDL');
    await up.db.exec("select set_config('co_ops.w12_retention_unblock', '2', false)");
    await assert.rejects(() => up.db.exec(migration), /would stop blocking/);
    await up.db.exec('rollback').catch(() => {});
    check(true, 'a wrong acknowledged count is refused too');
    await up.db.exec("select set_config('co_ops.w12_retention_unblock', '1', false)");
    await up.db.exec(migration);
    check(true, 'the acknowledged exact count applies');
    check((await current(up.db, 'alice@example.test')).status === 'opted_in'
      && (await one(up.db, 'select count(*)::int n from customer_consent_events')).n === events, 'existing wrongly opted-out people read opted_in after apply, with no row written');
    check((await listRow(up.db)).visits === 0, 'backfill marks an already-voided order');
    const back = await resolve(up.db, z);
    check(back.customer_id && back.created && !back.suppressed, 'an old retention suppression no longer blocks a returning person');
    await call(up.db, 'customer_erase', [up.actor, back.customer_id, 'delete_request']);
    check((await one(up.db, "select count(*)::int n from customer_suppressions where value_sha256 = $1 and reason = 'delete_request'", [sha(z)])).n === 1,
      'a later delete request is still recorded beside the old retention row');
    await assert.rejects(() => explicitConsent(up.db, z, '9'), /consent_suppressed/);
    check(true, 'after that delete request the person is suppressed for good');
    await up.db.close();
  }

  await refused('alter function public.customer_list_rows(uuid[]) rename to missing_rows', /0312: missing customer_list_rows/, 'missing parent function refused');
  await refused('alter table public.customer_suppressions drop constraint customer_suppressions_kind_value_sha256_key', /customer_suppressions_kind_value_sha256_key drift/, 'suppression key drift refused');
  await refused('alter table public.customer_consent_events drop column evidence_ref', /missing 0300/, 'missing 0300 refused');
  await refused(null, /0312: RPC grant escaped/, 'permissive ACL sabotage caught',
    migration.replace('  public.customer_merge_suggestions_open(uuid[],integer)\n  to service_role;', '  public.customer_merge_suggestions_open(uuid[],integer)\n  to service_role, authenticated;'));
  {
    const { db } = await fresh(true);
    await assert.rejects(() => db.exec(migration), /0312: already applied/);
    await db.exec('rollback').catch(() => {});
    check(true, 'a second apply is refused as already applied');
    await db.close();
  }
  console.log(`PASS ${checks} checks. Offline single-session proof; two-session sim proof remains required before apply.`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
