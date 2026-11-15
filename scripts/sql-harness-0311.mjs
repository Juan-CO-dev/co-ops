/** 0311 proof: the real 0296 + 0298 + 0311 in isolated PGlite, synthetic fixtures, no network, no sender.
 *  Audit W11: B066 part a (per-recipient daily cap), B067 (loop guard on replies only), B068 (unsafe preview tombstones),
 *  B168 (capped drafts never fill the due page). The bugs are first reproduced on 0298, then fixed by 0311. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const base = read('0296_catering_inbox.sql');
const delivery = read('0298_catering_inbox_delivery.sql');
const migration = read('0311_catering_inbox_delivery_fixes.sql');
function table(file, name) {
  const match = read(file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'));
  assert.ok(match, `${name} source DDL found`);
  return match[0];
}
const externalRefDDL = read('0149_ezcater_intake.sql').match(/alter table public\.catering_pipeline add column external_ref text;\s*create unique index catering_pipeline_external_ref_uq[\s\S]*?;/i)?.[0];
assert.ok(externalRefDDL, '0149 external reference DDL found');
const JOBS = "'toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft'";
const leaseDDL = `
    create table public.cron_route_leases (job text primary key, lease_until timestamptz not null,
      constraint cron_route_leases_job_check check (job in (${JOBS})));
    create function public.claim_cron_route(p_job text) returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
    declare claimed text; begin
      if p_job is null or p_job not in (${JOBS}) then raise exception 'invalid_cron_route'; end if;
      insert into public.cron_route_leases (job, lease_until) values (p_job, clock_timestamp() + interval '330 seconds')
      on conflict (job) do update set lease_until = clock_timestamp() + interval '330 seconds' where cron_route_leases.lease_until <= clock_timestamp()
      returning job into claimed; return claimed is not null; end $$;`;
const stubs = `
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to public,anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to public,anon,authenticated,service_role;
    create table locations(id uuid primary key);
    create table users(id uuid primary key, role text not null, active boolean not null, email text, language text not null default 'en', created_at timestamptz not null default now());
    create table sessions(id uuid primary key,user_id uuid references users(id),revoked_at timestamptz,expires_at timestamptz not null);
    create table user_locations(user_id uuid references users(id),location_id uuid references locations(id),active boolean not null);
    create table catering_delivery_zones(id uuid primary key);
    create table email_receipts(id uuid primary key);
    ${table('0108_catering_scaffold_capture.sql', 'catering_customers')}
    ${table('0108_catering_scaffold_capture.sql', 'catering_pipeline')}
    ${read('0148_catering_lead_assignee.sql')}
    ${externalRefDDL}
    ${table('0120_catering_quotes.sql', 'catering_quotes')}
    ${table('0294_inbound_router.sql', 'inbound_messages')}
    ${leaseDDL}
  `;

let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log(`ok ${label}`); };
const db = new PGlite();
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await query(sql, args))[0];
const reject = async (fn, pattern, label) => { await assert.rejects(fn, pattern); check(true, label); };
const rpc = async (name, args) => (await one(`select public.${name}(${args.map((_, i) => `$${i+1}`).join(',')}) result`, args)).result;
const asService = async fn => { await db.exec('set role service_role'); try { return await fn(); } finally { await db.exec('reset role'); } };
const shop = randomUUID(), manager = randomUUID(), owner = randomUUID();
const sessions = new Map();
let senders = 0;
// Every arrival gets its own sender unless a test names one, so the recipient cap only binds where a test means it to.
const content = (extra = {}) => ({ sender_address: `guest${++senders}@example.test`, subject: 'Catering request', body_text: 'Need catering', body_original_bytes: 13, body_truncated: false, body_from_html: false, received_at: '2026-11-15T12:00:00Z', ...extra });
const result = (extra = {}) => ({ classification: 'intake', identity_status: 'new_sender', disposition: 'drafted', rule_version: '2', ...extra });
const draft = { language: 'en', template_key: 'intake', template_version: '1', params: { portalUrl: 'https://example.test/order/start', tenantName: 'Synthetic', channel: 'provider', status: 'received' }, preview_text: 'Start your catering request.' };
const urgent = result({ classification: 'unclassified', disposition: 'needs_human', reason: 'urgent' });
async function arrival(extra = {}, payload = result(), supplied = draft) {
  const inbound = randomUUID();
  await db.query('insert into inbound_messages(id,provider_email_id) values ($1,$2)', [inbound, inbound]);
  const { message_id } = await asService(() => rpc('record_catering_inbound', [inbound, 0, randomUUID(), content(extra)]));
  await asService(() => rpc('finalize_catering_inbound', [message_id, 0, randomUUID(), payload, supplied]));
  return message_id;
}
const claim = (message, { kind = 'reply', trigger = 'cron', actor = null, session = null, revision = null, request = randomUUID(), escalation = null } = {}) =>
  asService(() => rpc('claim_catering_inbox_delivery', [message, kind, trigger, actor, session, revision, request, escalation, null]));
const human = (message, actor, revision) => claim(message, { trigger: 'human', actor, session: sessions.get(actor), revision });
const finish = (draftId, token, outcome, provider = null, code = null) => asService(() => rpc('finish_catering_inbox_delivery', [draftId, token, outcome, provider, code]));
const due = () => asService(() => rpc('catering_inbox_delivery_due', [25]));
const revisionOf = async id => (await one('select revision from catering_inbound_messages where id=$1', [id])).revision;
const draftOf = (message, kind = 'reply') => one('select * from catering_inbox_drafts where message_id=$1 and kind=$2', [message, kind]);
const escalation = (extra = {}) => ({ language: 'es', params: { tenantName: 'Synthetic', reason: 'urgent', inboxUrl: 'https://staff.example.test/catering/inbox' }, preview_text: 'A catering message needs a person.', ...extra });
const unsafe = escalation({ preview_text: 'Subject: Urgent help with https://example.com/order?id=123' });
const today = "(clock_timestamp() at time zone 'utc')::date";
const recipientReserved = async address => (await one(`select reserved from catering_inbox_recipient_limits where recipient=$1 and day_utc=${today}`, [address]))?.reserved ?? 0;
const automated = { 'auto-submitted': 'auto-generated', 'list-unsubscribe': '<mailto:u@ezcater.test>' };

try {
  // ── preflight on separate databases ──
  {
    const bare = new PGlite();
    try {
      await bare.exec(stubs); await bare.exec(base);
      await assert.rejects(() => bare.exec(migration), /0298 must be applied first/);
      await bare.exec('rollback');
      check((await bare.query("select to_regclass('public.catering_inbox_recipient_limits') t")).rows[0].t === null, 'without 0298: refused, no partial schema');
    } finally { await bare.close(); }
    const drifted = new PGlite();
    try {
      await drifted.exec(stubs); await drifted.exec(base); await drifted.exec(delivery);
      const body = migration.match(/create or replace function public\.claim_catering_inbox_delivery\([\s\S]*?\n\$\$;\n/)[0];
      await drifted.exec(body);
      await assert.rejects(() => drifted.exec(migration), /drifted from 0298/);
      await drifted.exec('rollback');
      check((await drifted.query("select to_regclass('public.catering_inbox_recipient_limits') t")).rows[0].t === null, 'a claim body drifted from 0298 is refused before any DDL');
    } finally { await drifted.close(); }
  }

  // ── the 0298 state, with the bugs reproduced ──
  await db.exec(stubs); await db.exec(base); await db.exec(delivery);
  await db.query('insert into locations values ($1)', [shop]);
  for (const [id, role, email] of [[manager, 'catering_mgr', 'keith@example.test'], [owner, 'owner', 'pete@example.test']]) {
    await db.query('insert into users(id,role,active,email) values ($1,$2,true,$3)', [id, role, email]);
    const session = randomUUID(); sessions.set(id, session);
    await db.query("insert into sessions values ($1,$2,null,clock_timestamp()+interval '1 hour')", [session, id]);
  }
  await db.query("update users set language='es' where id=$1", [manager]);
  await db.query('insert into user_locations values ($1,$2,true)', [manager, shop]);
  await asService(() => rpc('set_catering_inbox_mode', [owner, sessions.get(owner), 'live', 0]));

  // B067 on 0298: the urgent platform notice with list headers is tombstoned invalid_recipient, the assignee never alerted.
  const legacyPlatform = await arrival({ sender_address: 'orders@ezcater.com', subject: 'Refund requested for order 123', headers: automated },
    result({ classification: 'platform_notification', disposition: 'needs_human', reason: 'urgent' }), null);
  const legacyRefusal = await claim(legacyPlatform, { kind: 'escalation', escalation: escalation() });
  check(legacyRefusal.refused === 'needs_review' && legacyRefusal.reason === 'invalid_recipient', '0298 reproduces B067: an urgent automated-header escalation is tombstoned invalid_recipient');
  // B068 on 0298: an unsafe preview raises invalid_escalation with no tombstone, so the message stays at the queue head.
  const legacyUnsafe = await arrival({ subject: 'Urgent help with https://example.com/order?id=123' }, urgent, null);
  await reject(() => claim(legacyUnsafe, { kind: 'escalation', escalation: unsafe }), /invalid_escalation/, '0298 reproduces B068: an unsafe preview raises invalid_escalation');
  check(!(await draftOf(legacyUnsafe, 'escalation')) && (await due()).escalations.some(r => r.message_id === legacyUnsafe), '0298 reproduces B068: no tombstone, the message is still due');
  // B168 on 0298: 30 drafts on one capped thread fill the page; a newer legitimate reply is not due.
  const flood = [];
  for (let i = 0; i < 30; i++) flood.push(await arrival({ thread_key: '<x@evil.test>' }));
  await db.query(`insert into catering_inbox_thread_limits values ('<x@evil.test>', ${today}, 3)`);
  const legit = await arrival({ sender_address: 'customer@example.test' });
  const floodDue = (await due()).replies.map(r => r.message_id);
  check(floodDue.length === 25 && floodDue.every(id => flood.includes(id)) && !floodDue.includes(legit), '0298 reproduces B168: capped drafts fill the page ahead of a newer reply');
  // B066 on 0298: a fresh thread key per message means unlimited replies to one address.
  const legacyVictim = [];
  for (let i = 0; i < 4; i++) {
    const m = await arrival({ sender_address: 'victim@example.test', thread_key: `<v${i}@forged.test>` });
    const c = await claim(m); legacyVictim.push(c);
    await finish(c.draft_id, c.token, 'sent', `p-legacy-${i}`);
  }
  check(legacyVictim.every(c => c.token), '0298 reproduces B066: four replies to one address on four forged threads in one day');
  // Backfill fixture: two attempts today to one address.
  for (let i = 0; i < 2; i++) {
    const c = await claim(await arrival({ sender_address: 'backfill@example.test' }));
    await finish(c.draft_id, c.token, i === 0 ? 'sent' : 'failed', i === 0 ? 'p-backfill' : null, i === 0 ? null : 'send_failed');
  }

  // ── apply 0311 ──
  await db.exec(migration);
  await reject(() => db.exec(migration), /already applied/, 'second application refused');
  await db.exec('rollback');
  for (const name of ['catering_inbound_messages', 'catering_inbox_drafts', 'catering_inbox_events', 'catering_inbox_settings', 'catering_inbox_thread_limits', 'catering_inbox_recipient_limits']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal((await one('select has_table_privilege($1,$2,$3) allowed', [role, name, privilege])).allowed, role === 'service_role' && privilege === 'SELECT', `${role} ${name} ${privilege}`);
      }
      for (const { column_name } of await query('select column_name from information_schema.columns where table_name=$1', [name])) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
          assert.equal((await one('select has_column_privilege($1,$2,$3,$4) allowed', [role, name, column_name, privilege])).allowed, role === 'service_role' && privilege === 'SELECT');
        }
      }
    }
    check((await one('select relrowsecurity enabled from pg_class where oid=$1::regclass', [name])).enabled, `${name}: complete table/column ACL and RLS`);
  }
  for (const { oid, proname, prosecdef, proconfig, prosrc } of await query("select oid,proname,prosecdef,proconfig,prosrc from pg_proc where proname in ('claim_catering_inbox_delivery','finish_catering_inbox_delivery','sweep_catering_inbox_delivery','catering_inbox_delivery_due','set_catering_inbox_mode')")) {
    assert.equal(prosecdef, true); assert.ok(proconfig.includes('search_path=pg_catalog, public'));
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await one("select has_function_privilege($1,$2::oid,'EXECUTE') allowed", [role, oid])).allowed, role === 'service_role');
    assert.doesNotMatch(prosrc, /(insert into|update|delete from)\s+public\.(catering_customers|catering_pipeline|catering_quotes)\b/i);
    check(true, `${proname}: definer/search_path/execution ceiling, no artifact writes`);
  }
  check((await one('select count(*)::int n from pg_proc where proname in ($1,$2)', ['claim_catering_inbox_delivery', 'catering_inbox_delivery_due'])).n === 2, 'the re-emitted functions keep one signature each');
  await reject(() => asService(() => db.query(`insert into catering_inbox_recipient_limits values ('a@b.test', ${today}, 1)`)), /permission denied/, 'service_role cannot write the recipient cap directly');
  await reject(() => db.query(`insert into catering_inbox_recipient_limits values ('a@b.test', ${today}, 4)`), /check constraint/, 'recipient reservation count bounded in SQL');
  check((await recipientReserved('backfill@example.test')) === 2, "backfill counts today's reply attempts");
  check((await recipientReserved('victim@example.test')) === 3, 'backfill caps a flooded address at three');

  // ── B066a: the per-recipient daily cap ──
  {
    const target = 'target@example.test';
    const claims = [];
    for (let i = 0; i < 3; i++) claims.push(await claim(await arrival({ sender_address: target, thread_key: `<t${i}@forged.test>` })));
    check(claims.every(c => c.token) && (await recipientReserved(target)) === 3, 'three replies to one address on three threads are claimed');
    const fourth = await arrival({ sender_address: target, thread_key: '<t3@forged.test>' });
    const before = await query('select * from catering_inbox_thread_limits order by thread_key, day_utc');
    const beforeRevision = await revisionOf(fourth);
    await reject(() => claim(fourth), /recipient_cap/, 'fourth reply to one recipient across fresh threads in a UTC day refused (recipient_cap)');
    check(JSON.stringify(await query('select * from catering_inbox_thread_limits order by thread_key, day_utc')) === JSON.stringify(before)
      && (await draftOf(fourth)).delivery_state === 'draft' && (await revisionOf(fourth)) === beforeRevision, 'a recipient_cap refusal rolls back: no thread slot, no state, no revision');
    await reject(() => human(fourth, manager, beforeRevision), /recipient_cap/, 'the recipient cap binds a staff Send too');
    await finish(claims[0].draft_id, claims[0].token, 'failed', null, 'send_failed');
    await db.query("update catering_inbox_drafts set delivery_attempted_at = clock_timestamp() - interval '11 minutes' where id=$1", [claims[0].draft_id]);
    const retry = await claim((await one('select message_id from catering_inbox_drafts where id=$1', [claims[0].draft_id])).message_id);
    check(retry.attempt === 2 && (await recipientReserved(target)) === 3, 'a same-day retry reuses both reservations');
    const backfilled = await claim(await arrival({ sender_address: 'backfill@example.test' }));
    check(!!backfilled.token && (await recipientReserved('backfill@example.test')) === 3, 'the backfilled address has one reply left today');
    const overBackfill = await arrival({ sender_address: 'backfill@example.test' });
    await reject(() => claim(overBackfill), /recipient_cap/, 'the backfilled address is then capped');
    check(!(await due()).replies.some(r => r.message_id === fourth), 'a recipient-capped draft is not due');
    await db.query(`update catering_inbox_recipient_limits set day_utc = day_utc - 1 where recipient=$1`, [target]);
    check((await due()).replies.some(r => r.message_id === fourth), 'the recipient-capped draft is due again the next UTC day');
    const nextDay = await claim(fourth);
    check(!!nextDay.token && (await recipientReserved(target)) === 1, "the next day's claim takes the new day's capacity");
    await finish(nextDay.draft_id, nextDay.token, 'sent', 'p-next-day');
  }

  // ── B067: the loop guard runs for replies only ──
  {
    const notice = await arrival({ sender_address: 'orders@ezcater.com', subject: 'Refund requested for order 456', headers: automated },
      result({ classification: 'platform_notification', disposition: 'needs_human', reason: 'urgent' }), null);
    check((await due()).escalations.some(r => r.message_id === notice), 'an urgent automated-header escalation is due');
    const esc = await claim(notice, { kind: 'escalation', escalation: escalation() });
    check(!!esc.token && esc.kind === 'escalation' && esc.recipient === 'keith@example.test', 'an escalation of an auto-submitted ezCater message is claimed for the assignee');
    await finish(esc.draft_id, esc.token, 'sent', 'p-esc');
    const auto = await arrival({ headers: automated });
    const refusal = await claim(auto);
    check(refusal.refused === 'needs_review' && refusal.reason === 'invalid_recipient' && (await draftOf(auto)).delivery_error_code === 'invalid_recipient', 'a reply to the same headers is still refused invalid_recipient');
    for (const headers of [{ precedence: 'bulk' }, { 'return-path': '<>' }, { 'list-id': '<l.example.test>' }]) {
      const r = await claim(await arrival({ headers }));
      assert.equal(r.reason, 'invalid_recipient');
    }
    check(true, 'every automated header still refuses a reply');
    const legacy = await draftOf(legacyPlatform, 'escalation');
    check(legacy.delivery_state === 'needs_review' && legacy.delivery_error_code === 'invalid_recipient', 'B067 tombstones made before 0311 are left as they are');
  }

  // ── B068: an unsafe preview is a permanent refusal ──
  {
    const legacyDue = (await due()).escalations.some(r => r.message_id === legacyUnsafe);
    const tomb = await claim(legacyUnsafe, { kind: 'escalation', escalation: unsafe });
    const row = await draftOf(legacyUnsafe, 'escalation');
    check(legacyDue && tomb.refused === 'needs_review' && tomb.reason === 'unsafe_preview' && row.delivery_state === 'needs_review' && row.delivery_error_code === 'unsafe_preview' && row.delivery_attempt === 0,
      'an unsafe preview tombstones once (needs_review / unsafe_preview, no attempt)');
    check(row.preview_text === 'unsafe_preview' && JSON.stringify(row.params) === '{}', 'the tombstone carries no customer text');
    check(!(await due()).escalations.some(r => r.message_id === legacyUnsafe), 'the tombstoned escalation leaves the queue');
    await reject(() => claim(legacyUnsafe, { kind: 'escalation', escalation: unsafe }), /needs_review/, 'a tombstoned escalation is never re-claimed');
    await reject(() => claim(legacyUnsafe, { kind: 'escalation', escalation: escalation({ preview_text: 'see https://x.test/a?token=abc' }) }), /needs_review/, 'a token-bearing preview cannot revive it');
    const mismatch = await arrival({}, urgent, null);
    await reject(() => claim(mismatch, { kind: 'escalation', escalation: escalation({ params: { tenantName: 'Synthetic', reason: 'payment_or_edit' } }) }), /invalid_escalation/, 'other envelope mismatches stay transient invalid_escalation');
    check(!(await draftOf(mismatch, 'escalation')), 'a transient mismatch leaves no tombstone');
    const wedge = [];
    for (let i = 0; i < 30; i++) wedge.push(await arrival({ subject: `Order https://example.com/o?n=${i}` }, urgent, null));
    const fresh = await arrival({}, urgent, null);
    const outcomes = new Map();
    for (let tick = 0; tick < 2 && !outcomes.get(fresh)?.token; tick++) {
      for (const { message_id } of (await due()).escalations) {
        outcomes.set(message_id, message_id === fresh || !wedge.includes(message_id)
          ? await claim(message_id, { kind: 'escalation', escalation: escalation() }).catch(e => ({ error: String(e) }))
          : await claim(message_id, { kind: 'escalation', escalation: unsafe }));
      }
    }
    check(!!outcomes.get(fresh)?.token, 'an unsafe preview tombstones once; a newer escalation is claimed within two ticks behind 30 of them');
    check(wedge.every(id => outcomes.get(id)?.reason === 'unsafe_preview'), 'all 30 unsafe previews terminalize exactly once');
  }

  // ── B168: capped drafts never fill the due page ──
  {
    const page = (await due()).replies.map(r => r.message_id);
    check(page.includes(legit) && !page.some(id => flood.includes(id)), '30 drafts on one capped thread: a newer legitimate reply is due on the first tick');
    const c = await claim(legit);
    check(!!c.token, 'and the legitimate reply is claimed');
    await finish(c.draft_id, c.token, 'sent', 'p-legit');
    const holder = await arrival({ thread_key: '<hold@example.test>' });
    const held = await claim(holder);
    await finish(held.draft_id, held.token, 'failed', null, 'send_failed');
    await db.query("update catering_inbox_drafts set delivery_attempted_at = clock_timestamp() - interval '11 minutes' where id=$1", [held.draft_id]);
    await db.query(`update catering_inbox_thread_limits set reserved = 3 where thread_key='<hold@example.test>' and day_utc=${today}`);
    check((await due()).replies.some(r => r.message_id === holder), "a draft holding today's reservation on a full thread stays due");
    const heldRetry = await claim(holder);
    check(heldRetry.attempt === 2, 'and its retry is claimed on that reservation');
    await finish(heldRetry.draft_id, heldRetry.token, 'sent', 'p-held');
    await db.query("update catering_inbox_thread_limits set day_utc = day_utc - 1 where thread_key='<x@evil.test>'");
    check((await due()).replies.filter(r => flood.includes(r.message_id)).length === 25, 'the capped drafts become due again the next UTC day');
    // Clear the flood out of the queue for the checks below (staff mark it handled).
    for (const id of flood) await asService(() => rpc('act_on_catering_inbox', [id, 1, randomUUID(), manager, sessions.get(manager), 'handle', null]));
  }

  // ── re-checked 0298 guarantees on the 0311 bodies ──
  {
    const key = `<thread-${randomUUID()}@example.test>`;
    const t = [];
    for (let i = 0; i < 4; i++) t.push(await arrival({ thread_key: key }));
    for (let i = 0; i < 3; i++) await claim(t[i]);
    await reject(() => claim(t[3]), /thread_cap/, 'fourth reply to one thread in a UTC day refused');
    const t3Revision = await revisionOf(t[3]);
    await reject(() => human(t[3], manager, t3Revision), /thread_cap/, 'the thread cap binds humans too');
    const tries = await arrival();
    for (let i = 0; i < 3; i++) {
      const c = await claim(tries);
      await finish(c.draft_id, c.token, 'failed', null, 'send_failed');
    }
    await reject(() => claim(tries), /attempts_exhausted/, 'cron stops after three attempts');
    const own = await arrival();
    const ownRefusal = await asService(() => rpc('claim_catering_inbox_delivery', [own, 'reply', 'cron', null, null, null, randomUUID(), null, 'own_address']));
    check(ownRefusal.reason === 'own_address', 'own address still terminalizes');
    const starve = [];
    for (let n = 0; n < 60; n++) {
      const m = await arrival();
      starve.push(m);
      if (n % 2) await asService(() => rpc('act_on_catering_inbox', [m, 1, randomUUID(), manager, sessions.get(manager), 'handle', null]));
      else { const c = await claim(m); await finish(c.draft_id, c.token, 'sent', `p-starve-${n}`); }
    }
    const eligible = await arrival();
    const page = await due();
    check(page.replies.some(r => r.message_id === eligible) && !page.replies.some(r => starve.includes(r.message_id)), 'a new eligible reply is due behind 60 handled / sent predecessors');
    const old = await arrival();
    await asService(() => rpc('set_catering_inbox_mode', [owner, sessions.get(owner), 'shadow', 1]));
    const shadow = await due();
    check(shadow.replies.length === 0 && shadow.escalations.length === 0, 'nothing is due unless live');
    await reject(() => claim(old), /delivery_off/, 'shadow: cron claim refused');
    await asService(() => rpc('set_catering_inbox_mode', [owner, sessions.get(owner), 'live', 2]));
    await reject(() => claim(old), /not_new/, 'a new live window never bulk-sends an old draft (not_new)');
  }
  console.log(`PASS 0311: ${checks} checks (single-session PGlite; concurrency requires separate sim proof)`);
} finally { await db.close(); }
