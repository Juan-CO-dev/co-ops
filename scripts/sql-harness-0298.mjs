/** 0298 proof: the real 0296 + 0298 in isolated PGlite, synthetic fixtures, no network, no sender. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const base = read('0296_catering_inbox.sql');
const migration = read('0298_catering_inbox_delivery.sql');
function table(file, name) {
  const match = read(file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'));
  assert.ok(match, `${name} source DDL found`);
  return match[0];
}
const externalRefDDL = read('0149_ezcater_intake.sql').match(/alter table public\.catering_pipeline add column external_ref text;\s*create unique index catering_pipeline_external_ref_uq[\s\S]*?;/i)?.[0];
assert.ok(externalRefDDL, '0149 external reference DDL found');
const db = new PGlite();
const BASE_JOBS = "'toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft'";
const UNION_JOBS = BASE_JOBS + ", 'catering-inbox-delivery', 'meta-leads'";
/** The lease as 0243/0268/0275 left it (or as 0300 leaves it when `jobs` is the union). */
const leaseDDL = jobs => `
    create table public.cron_route_leases (job text primary key, lease_until timestamptz not null,
      constraint cron_route_leases_job_check check (job in (${jobs})));
    create function public.claim_cron_route(p_job text) returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
    declare claimed text; begin
      if p_job is null or p_job not in (${jobs}) then raise exception 'invalid_cron_route'; end if;
      insert into public.cron_route_leases (job, lease_until) values (p_job, clock_timestamp() + interval '330 seconds')
      on conflict (job) do update set lease_until = clock_timestamp() + interval '330 seconds' where cron_route_leases.lease_until <= clock_timestamp()
      returning job into claimed; return claimed is not null; end $$;`;
const leaseJobs = async database => (await database.query("select array_agg(distinct m[1] order by m[1]) jobs from pg_constraint c, lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z-]+)''', 'g') m where c.conrelid = 'public.cron_route_leases'::regclass and c.conname = 'cron_route_leases_job_check'")).rows[0].jobs;
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log(`ok ${label}`); };
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await query(sql, args))[0];
const reject = async (fn, pattern, label) => { await assert.rejects(fn, pattern); check(true, label); };
const rpc = async (name, args) => (await one(`select public.${name}(${args.map((_, i) => `$${i+1}`).join(',')}) result`, args)).result;
const asService = async fn => { await db.exec('set role service_role'); try { return await fn(); } finally { await db.exec('reset role'); } };
const shop = randomUUID(), manager = randomUUID(), owner = randomUUID(), cgs = randomUUID(), gm = randomUUID(), noMail = randomUUID();
const sessions = new Map();
const content = (extra = {}) => ({ sender_address: 'guest@example.test', subject: 'Catering request', body_text: 'Need catering', body_original_bytes: 13, body_truncated: false, body_from_html: false, received_at: '2026-11-11T12:00:00Z', ...extra });
const result = (extra = {}) => ({ classification: 'intake', identity_status: 'new_sender', disposition: 'drafted', rule_version: '1', ...extra });
const draft = { language: 'en', template_key: 'intake', template_version: '1', params: { portalUrl: 'https://example.test/order/start', tenantName: 'Synthetic', channel: 'provider', status: 'received' }, preview_text: 'Start your catering request.' };
async function record(extra = {}) {
  const inbound = randomUUID();
  await db.query('insert into inbound_messages(id,provider_email_id) values ($1,$2)', [inbound, inbound]);
  return asService(() => rpc('record_catering_inbound', [inbound, 0, randomUUID(), content(extra)]));
}
async function finalize(message, payload = result(), supplied = draft) {
  return asService(() => rpc('finalize_catering_inbound', [message, 0, randomUUID(), payload, supplied]));
}
/** A drafted (or escalated) message ready for delivery, finalized now. */
async function arrival(extra = {}, payload = result(), supplied = draft) {
  const { message_id } = await record(extra);
  await finalize(message_id, payload, supplied);
  return message_id;
}
const claim = (message, { kind = 'reply', trigger = 'cron', actor = null, session = null, revision = null, request = randomUUID(), escalation = null } = {}) =>
  asService(() => rpc('claim_catering_inbox_delivery', [message, kind, trigger, actor, session, revision, request, escalation]));
const human = (message, actor, revision, request = randomUUID()) => claim(message, { trigger: 'human', actor, session: sessions.get(actor), revision, request });
const finish = (draftId, token, outcome, provider = null, code = null) => asService(() => rpc('finish_catering_inbox_delivery', [draftId, token, outcome, provider, code]));
const setMode = (actor, mode, revision) => asService(() => rpc('set_catering_inbox_mode', [actor, sessions.get(actor), mode, revision]));
const draftRow = id => one('select * from catering_inbox_drafts where id=$1', [id]);
const revisionOf = async id => (await one('select revision from catering_inbound_messages where id=$1', [id])).revision;
const escalation = (reason, extra = {}) => ({ language: 'en', params: { tenantName: 'Synthetic', reason, inboxUrl: 'https://staff.example.test/catering/inbox' }, preview_text: 'A catering message needs a person.', ...extra });
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
  `;
try {
  await db.exec(stubs + leaseDDL(BASE_JOBS));
  await db.exec(base);
  // A drifted lease set (a parallel migration added a job) must refuse before any DDL.
  await db.exec("alter table cron_route_leases drop constraint cron_route_leases_job_check, add constraint cron_route_leases_job_check check (job in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft', 'vendor-mail'))");
  await reject(() => db.exec(migration), /neither 0275's nor 0300's set/, 'lease job set drift refused by preflight');
  await db.exec('rollback');
  check((await one("select count(*)::int n from information_schema.columns where table_name='catering_inbox_drafts' and column_name='delivery_state'")).n === 0, 'refused migration leaves no partial schema');
  await db.exec("alter table cron_route_leases drop constraint cron_route_leases_job_check, add constraint cron_route_leases_job_check check (job in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft'))");
  await db.exec(migration);
  await reject(() => db.exec(migration), /already applied/, 'second application refused');
  await db.exec('rollback');
  for (const name of ['catering_inbound_messages','catering_inbox_drafts','catering_inbox_events','catering_inbox_settings','catering_inbox_thread_limits']) {
    for (const role of ['anon','authenticated','service_role']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
        assert.equal((await one('select has_table_privilege($1,$2,$3) allowed', [role,name,privilege])).allowed, role === 'service_role' && privilege === 'SELECT', `${role} ${name} ${privilege}`);
      }
      const columns = await query('select column_name from information_schema.columns where table_name=$1', [name]);
      for (const { column_name } of columns) for (const privilege of ['SELECT','INSERT','UPDATE','REFERENCES']) {
        assert.equal((await one('select has_column_privilege($1,$2,$3,$4) allowed',[role,name,column_name,privilege])).allowed, role === 'service_role' && privilege === 'SELECT');
      }
    }
    check((await one('select relrowsecurity enabled from pg_class where oid=$1::regclass',[name])).enabled, `${name}: complete table/column ACL and RLS`);
  }
  for (const { oid, proname, prosecdef, proconfig } of await query("select oid,proname,prosecdef,proconfig from pg_proc where proname in ('claim_catering_inbox_delivery','finish_catering_inbox_delivery','sweep_catering_inbox_delivery','set_catering_inbox_mode','claim_cron_route')")) {
    assert.equal(prosecdef, true); assert.ok(proconfig.includes('search_path=pg_catalog, public'));
    for (const role of ['anon','authenticated','service_role']) assert.equal((await one('select has_function_privilege($1,$2::oid,\'EXECUTE\') allowed',[role,oid])).allowed, role === 'service_role');
    check(true, `${proname}: definer/search_path/execution ceiling`);
  }
  for (const { proname, prosrc } of await query("select proname,prosrc from pg_proc where proname in ('claim_catering_inbox_delivery','finish_catering_inbox_delivery','sweep_catering_inbox_delivery','set_catering_inbox_mode')")) {
    assert.doesNotMatch(prosrc, /(insert into|update|delete from)\s+public\.(catering_customers|catering_pipeline|catering_quotes)\b/i);
    check(true, `${proname}: source contains no artifact writes`);
  }
  check((await asService(() => rpc('claim_cron_route', ['catering-inbox-delivery']))) === true && (await asService(() => rpc('claim_cron_route', ['catering-inbox-delivery']))) === false, 'delivery cron lease claims once per window');
  check((await asService(() => rpc('claim_cron_route', ['schedule-draft']))) === true, 'existing lease jobs still claim');
  check((await asService(() => rpc('claim_cron_route', ['meta-leads']))) === true, "0300's meta-leads job is admitted by the union (0298 first)");
  check((await leaseJobs(db)).join(',') === 'catering-inbox-delivery,meta-leads,schedule-draft,sevenshifts-sync,toast-catering-scan,toast-sales-today', '0298 after 0275 leaves the UNION of both parallel jobs');
  {
    // The other order: 0300 (meta-leads) applied first leaves the union; 0298's preflight accepts it and re-emits the same union.
    const other = new PGlite();
    try {
      await other.exec(stubs + leaseDDL(UNION_JOBS));
      await other.exec(base);
      await other.exec(migration);
      check((await leaseJobs(other)).join(',') === 'catering-inbox-delivery,meta-leads,schedule-draft,sevenshifts-sync,toast-catering-scan,toast-sales-today', '0298 after 0300 keeps the UNION (neither job dropped)');
      await other.exec('set role service_role');
      check((await other.query("select public.claim_cron_route('meta-leads') ok")).rows[0].ok === true && (await other.query("select public.claim_cron_route('catering-inbox-delivery') ok")).rows[0].ok === true, 'both jobs claim after the reverse order');
      await other.exec('reset role');
    } finally { await other.close(); }
  }

  await db.query('insert into locations values ($1)', [shop]);
  for (const [id, role, email] of [[manager,'catering_mgr','keith@example.test'],[owner,'owner','pete@example.test'],[cgs,'cgs','juan@example.test'],[gm,'gm','gm@example.test'],[noMail,'catering_mgr',null]]) {
    await db.query('insert into users(id,role,active,email) values ($1,$2,true,$3)', [id, role, email]);
    const session = randomUUID(); sessions.set(id, session);
    await db.query("insert into sessions values ($1,$2,null,clock_timestamp()+interval '1 hour')", [session, id]);
  }
  await db.query("update users set language='es' where id=$1", [manager]);
  await db.query('insert into user_locations values ($1,$2,true),($3,$2,true)', [gm, shop, manager]);
  const customer = randomUUID(), lead = randomUUID();
  await db.query("insert into catering_customers(id,name,email) values ($1,'Synthetic','known@example.test')", [customer]);
  await db.query("insert into catering_pipeline(id,customer_id,contact_name,stage,location_id,assigned_to) values ($1,$2,'Synthetic','inquiry',$3,$4)", [lead, customer, shop, manager]);

  // ── mode switch ──
  const settings0 = await one('select mode,revision,live_since from catering_inbox_settings');
  check(settings0.mode === 'shadow' && settings0.revision === 0 && settings0.live_since === null, 'settings still shadow at revision 0 after 0298');
  await reject(() => setMode(manager, 'live', 0), /forbidden/, 'catering manager cannot change the mode');
  await reject(() => setMode(gm, 'live', 0), /forbidden/, 'GM cannot change the mode');
  await reject(() => setMode(owner, 'live', 1), /stale_revision/, 'mode change is revision-checked');
  await reject(() => setMode(owner, 'on', 0), /invalid_input/, 'mode vocabulary closed');
  await reject(() => db.query("update catering_inbox_settings set mode='live'"), /live_since/, 'live requires live_since by constraint');
  const shadowDraft = await arrival();
  await reject(() => claim(shadowDraft), /delivery_off/, 'shadow: cron claim refused');
  await reject(() => human(shadowDraft, manager, 1), /delivery_off/, 'shadow: human claim refused');
  check((await setMode(owner, 'off', 0)).mode === 'off', 'owner switches to off');
  await reject(() => claim(shadowDraft), /delivery_off/, 'off: cron claim refused');
  await reject(() => human(shadowDraft, manager, 1), /delivery_off/, 'off: human claim refused');
  check((await one("select count(*)::int n from catering_inbox_events where event_type in ('claim','deliver')")).n === 0, 'refused claims append no event');
  const live = await setMode(cgs, 'live', 1);
  check(live.mode === 'live' && live.revision === 2 && live.live_since !== null && (await one('select changed_by from catering_inbox_settings')).changed_by === cgs, 'CGS switches to live; live_since and actor stamped');
  check((await setMode(cgs, 'live', 2)).changed === false, 'same mode is a no-op');

  // ── old shadow drafts: never auto-sent, manually sendable ──
  await reject(() => claim(shadowDraft), /not_new/, 'activation never bulk-sends an old shadow draft (cron refuses not_new)');
  await reject(() => human(shadowDraft, manager, 0), /stale_revision/, 'human claim is revision-checked');
  await reject(() => human(shadowDraft, gm, 1), /forbidden/, 'GM without the null-location exception cannot send');
  const manual = await human(shadowDraft, manager, 1);
  check(manual.attempt === 1 && manual.token && manual.recipient === 'guest@example.test' && manual.idempotency_key === `catering-inbox:${manual.draft_id}:1` && manual.preview_text === draft.preview_text && manual.revision === 2, 'human claim of an old draft: token, server-selected recipient, idempotency key, frozen content');
  const claimed = await draftRow(manual.draft_id);
  check(claimed.delivery_state === 'claimed' && claimed.delivery_trigger === 'human' && claimed.delivery_actor_id === manager && claimed.delivery_thread_day !== null, 'claimed row carries trigger, actor and the reserved day');
  await reject(() => human(shadowDraft, manager, 2), /delivery_busy/, 'a live lease refuses a second claim');
  await reject(() => finish(manual.draft_id, randomUUID(), 'sent', 'provider-1'), /lease_lost/, 'a wrong fencing token cannot finish');
  await reject(() => finish(manual.draft_id, manual.token, 'sent', null), /invalid_input/, 'sent needs a provider id');
  await reject(() => finish(manual.draft_id, manual.token, 'failed', null, 'lease_expired'), /invalid_input/, 'finish error codes are closed');
  const sent = await finish(manual.draft_id, manual.token, 'sent', 'provider-1');
  const sentRow = await draftRow(manual.draft_id);
  check(sent.state === 'sent' && sentRow.delivery_state === 'sent' && sentRow.delivery_provider_id === 'provider-1' && sentRow.delivery_token === null && sentRow.delivery_sent_at !== null, 'finish sent persists provider id and clears the token');
  await reject(() => finish(manual.draft_id, manual.token, 'sent', 'provider-1'), /lease_lost/, 'a finished attempt cannot finish again');
  await reject(() => human(shadowDraft, manager, 3), /already_sent/, 'sent never returns to draft (claim refused)');
  await reject(() => asService(() => db.query("update catering_inbox_drafts set delivery_state='draft' where id=$1", [manual.draft_id])), /permission denied/, 'sent never returns to draft (service_role holds no UPDATE)');
  check((await revisionOf(shadowDraft)) === 3 && (await one("select array_agg(event_type order by created_at) kinds from catering_inbox_events where message_id=$1", [shadowDraft])).kinds.join(',') === 'ingest,finalize,claim,deliver', 'claim and finish each advance the revision with an event');
  // ── replay and conflict ──
  const fresh = await arrival();
  const request = randomUUID();
  const first = await claim(fresh, { request });
  const again = await claim(fresh, { request });
  check(again.replayed === true && again.revision === first.revision, 'identical claim request replays without a second attempt');
  check((await draftRow(first.draft_id)).delivery_attempt === 1, 'replay does not claim twice');
  await reject(() => claim(fresh, { request, trigger: 'human', actor: manager, session: sessions.get(manager), revision: 1 }), /request_conflict/, 'changed replay refused');
  // ── failed → retry reuses the reservation; cron gives up after three ──
  await finish(first.draft_id, first.token, 'failed', null, 'provider_rejected');
  check((await draftRow(first.draft_id)).delivery_error_code === 'provider_rejected', 'failed attempt records the closed error code');
  const thread = (await one('select thread_key from catering_inbound_messages where id=$1', [fresh])).thread_key ?? fresh;
  const reservedAfterFirst = (await one('select reserved from catering_inbox_thread_limits where thread_key=$1', [thread])).reserved;
  const second = await claim(fresh);
  check(second.attempt === 2 && second.idempotency_key.endsWith(':2') && (await one('select reserved from catering_inbox_thread_limits where thread_key=$1', [thread])).reserved === reservedAfterFirst, 'retry takes a new attempt but reuses its daily reservation');
  await finish(second.draft_id, second.token, 'failed', null, 'send_failed');
  const third = await claim(fresh);
  await finish(third.draft_id, third.token, 'failed', null, 'send_failed');
  await reject(() => claim(fresh), /attempts_exhausted/, 'cron stops after three attempts');
  const freshRevision = await revisionOf(fresh);
  const fourth = await human(fresh, manager, freshRevision);
  check(fourth.attempt === 4, 'a human may still retry an exhausted draft');
  await finish(fourth.draft_id, fourth.token, 'sent', 'provider-4');
  // ── the per-thread daily cap ──
  const key = `<thread-${randomUUID()}@example.test>`;
  const a = await arrival({ thread_key: key }), b = await arrival({ thread_key: key }), c = await arrival({ thread_key: key }), d = await arrival({ thread_key: key });
  const ca = await claim(a); const cb = await claim(b); const cc = await claim(c);
  await reject(() => claim(d), /thread_cap/, 'fourth reply to one thread in a UTC day refused');
  await reject(() => human(d, manager, 1), /thread_cap/, 'the cap binds humans too');
  await finish(ca.draft_id, ca.token, 'failed', null, 'send_failed');
  const retryA = await claim(a);
  check(retryA.attempt === 2 && (await one('select reserved from catering_inbox_thread_limits where thread_key=$1', [key])).reserved === 3, 'retry under a full cap reuses its reservation');
  await finish(retryA.draft_id, retryA.token, 'sent', 'p-a'); await finish(cb.draft_id, cb.token, 'sent', 'p-b'); await finish(cc.draft_id, cc.token, 'sent', 'p-c');
  await reject(() => claim(d), /thread_cap/, 'cap holds for the day after the three sends');
  await reject(() => db.query('update catering_inbox_thread_limits set reserved=4'), /check constraint/, 'reservation count bounded in SQL');
  // ── review round: a reservation is good for its UTC day only ──
  const dayKey = `<day-${randomUUID()}@example.test>`;
  const yesterday = await arrival({ thread_key: dayKey });
  const yClaim = await claim(yesterday);
  await finish(yClaim.draft_id, yClaim.token, 'failed', null, 'send_failed');
  await db.query("update catering_inbox_drafts set delivery_thread_day = delivery_thread_day - 1 where id=$1", [yClaim.draft_id]);
  await db.query("update catering_inbox_thread_limits set day_utc = day_utc - 1 where thread_key=$1", [dayKey]);
  const t1 = await claim(await arrival({ thread_key: dayKey })), t2 = await claim(await arrival({ thread_key: dayKey })), t3 = await claim(await arrival({ thread_key: dayKey }));
  for (const c of [t1, t2, t3]) await finish(c.draft_id, c.token, 'sent', 'p-' + c.attempt);
  await reject(() => claim(yesterday), /thread_cap/, "yesterday's failed retry needs today's capacity: fourth send refused");
  check((await one("select reserved from catering_inbox_thread_limits where thread_key=$1 and day_utc=(clock_timestamp() at time zone 'utc')::date", [dayKey])).reserved === 3, 'today stays at three reservations');
  const crossDay = await arrival({ thread_key: `<cross-${randomUUID()}@example.test>` });
  const cClaim = await claim(crossDay);
  await finish(cClaim.draft_id, cClaim.token, 'failed', null, 'send_failed');
  await db.query("update catering_inbox_drafts set delivery_thread_day = delivery_thread_day - 1 where id=$1", [cClaim.draft_id]);
  const cRetry = await claim(crossDay);
  check(cRetry.attempt === 2 && (await draftRow(cClaim.draft_id)).delivery_thread_day !== null && (await one("select count(*)::int n from catering_inbox_thread_limits where thread_key=(select thread_key from catering_inbound_messages where id=$1) and day_utc=(clock_timestamp() at time zone 'utc')::date", [crossDay])).n === 1, 'a cross-day retry reserves today atomically');
  await finish(cRetry.draft_id, cRetry.token, 'sent', 'p-cross');
  // ── review round: the linked quote is revalidated ──
  const qCustomer = randomUUID(), qLead = randomUUID(), qQuote = randomUUID();
  await db.query("insert into catering_customers(id,name,email) values ($1,'Quoted','quoted@example.test')", [qCustomer]);
  await db.query("insert into catering_pipeline(id,customer_id,contact_name,stage,location_id) values ($1,$2,'Quoted','quote_sent',$3)", [qLead, qCustomer, shop]);
  await db.query('insert into catering_quotes(id,customer_id,pipeline_id,location_id) values ($1,$2,$3,$4)', [qQuote, qCustomer, qLead, shop]);
  const quoted = await arrival({ sender_address: 'quoted@example.test' },
    result({ classification: 'troubleshoot_ours', identity_status: 'resolved', catering_customer_id: qCustomer, lead_id: qLead, quote_id: qQuote, location_id: shop }),
    { ...draft, template_key: 'ours' });
  await db.query('update catering_quotes set superseded_at = now() where id=$1', [qQuote]);
  await reject(() => claim(quoted), /quote_revalidation_failed/, 'quote superseded after drafting refuses the claim by name');
  await db.query('update catering_quotes set superseded_at = null, location_id = $2 where id=$1', [qQuote, randomUUID()]).catch(() => null);
  await db.query('update catering_quotes set superseded_at = null where id=$1', [qQuote]);
  await db.query('update catering_pipeline set location_id = null where id=$1', [qLead]);
  await reject(() => claim(quoted), /revalidation_failed/, 'lead moved off the shop refuses the claim');
  await db.query('update catering_pipeline set location_id = $2 where id=$1', [qLead, shop]);
  check((await claim(quoted)).recipient === 'quoted@example.test', 'intact quote and lead still send');
  // ── review round: the expiry sweep ──
  const swept = await arrival();
  const sLease = await claim(swept);
  const liveLease = await claim(await arrival());
  check((await asService(() => rpc('sweep_catering_inbox_delivery', [25]))).length === 0, 'sweep leaves live leases alone');
  await db.query("update catering_inbox_drafts set delivery_claimed_at = clock_timestamp() - interval '20 minutes' where id=$1", [sLease.draft_id]);
  const sweptRows = await asService(() => rpc('sweep_catering_inbox_delivery', [25]));
  const sweptRow = await draftRow(sLease.draft_id);
  check(sweptRows.length === 1 && sweptRows[0].draft_id === sLease.draft_id && sweptRows[0].kind === 'reply' && sweptRow.delivery_state === 'ambiguous' && sweptRow.delivery_error_code === 'lease_expired' && sweptRow.delivery_token === null, 'sweep marks the expired claim ambiguous/lease_expired');
  check((await one("select count(*)::int n from catering_inbox_events where message_id=$1 and event_type='deliver'", [swept])).n === 1 && (await revisionOf(swept)) === 3, 'sweep appends one deliver event and advances the revision');
  await reject(() => finish(sLease.draft_id, sLease.token, 'sent', 'late'), /lease_lost/, 'the swept holder cannot finish');
  await reject(() => claim(swept), /needs_review/, 'a swept draft is never auto-resent');
  check((await asService(() => rpc('sweep_catering_inbox_delivery', [25]))).length === 0, 'a second sweep finds nothing');
  check((await draftRow(liveLease.draft_id)).delivery_state === 'claimed', 'the live lease is untouched by the sweep');
  await finish(liveLease.draft_id, liveLease.token, 'sent', 'p-live');
  await reject(() => asService(() => rpc('sweep_catering_inbox_delivery', [0])), /invalid_input/, 'sweep limit is bounded');
  await reject(() => finish(liveLease.draft_id, liveLease.token, 'failed', null, 'idempotency_conflict'), /lease_lost/, 'idempotency_conflict is a legal finish code (refused here only because the attempt already finished)');
  // ── handled, needs_human, loop guards, revalidation ──
  const handled = await arrival();
  await asService(() => rpc('act_on_catering_inbox', [handled, 1, randomUUID(), manager, sessions.get(manager), 'handle', null]));
  await reject(() => claim(handled), /invalid_state/, 'handled message cannot be sent (cron)');
  await reject(() => human(handled, manager, 2), /invalid_state/, 'handled message cannot be sent (human)');
  const escalated = await arrival({ subject: 'Urgent allergy complaint' }, result({ classification: 'unclassified', disposition: 'needs_human', reason: 'urgent' }), null);
  await reject(() => claim(escalated), /invalid_state/, 'a needs_human message has no reply to send');
  await reject(() => claim(escalated, { kind: 'escalation', trigger: 'human', actor: manager, session: sessions.get(manager), revision: 1 }), /invalid_input/, 'escalations are cron-only');
  await reject(() => claim(escalated, { kind: 'escalation', escalation: escalation('urgent', { preview_text: 'see https://x.test/a?token=abc' }) }), /invalid_escalation/, 'escalation body may not carry a token-bearing link');
  await reject(() => claim(escalated, { kind: 'escalation', escalation: escalation('payment_or_edit') }), /invalid_escalation/, 'escalation reason must match the message');
  await reject(() => claim(escalated, { kind: 'escalation', escalation: escalation('urgent', { language: 'en', params: { tenantName: 'Synthetic', reason: 'urgent', inboxUrl: 'https://staff.example.test/catering/inbox?x=1' } }) }), /invalid_escalation/, 'escalation inbox link is the plain inbox page');
  await reject(() => claim(escalated, { kind: 'escalation', escalation: escalation('urgent') }), /invalid_escalation/, 'escalation language must match the assignee');
  const esc = await claim(escalated, { kind: 'escalation', escalation: { ...escalation('urgent'), language: 'es' } });
  check(esc.kind === 'escalation' && esc.recipient === 'keith@example.test' && esc.language === 'es' && esc.template_key === 'escalation', 'escalation goes to the assignee in the assignee language');
  check((await one("select count(*)::int n from catering_inbox_drafts where message_id=$1", [escalated])).n === 1 && (await one("select delivery_thread_day d from catering_inbox_drafts where message_id=$1", [escalated])).d === null, 'escalation freezes one row and takes no customer-thread slot');
  await finish(esc.draft_id, esc.token, 'failed', null, 'send_failed');
  const escRetry = await claim(escalated, { kind: 'escalation', escalation: { ...escalation('urgent'), language: 'es', preview_text: 'different text' } });
  check(escRetry.draft_id === esc.draft_id && escRetry.preview_text === 'A catering message needs a person.' && escRetry.attempt === 2, 'escalation retry reuses the frozen body, ignoring a new envelope');
  await finish(escRetry.draft_id, escRetry.token, 'sent', 'p-esc');
  await db.query('update catering_inbound_messages set assigned_to=$1 where id=$2', [noMail, escalated]);
  const unmailed = await arrival({ subject: 'Urgent allergy complaint' }, result({ classification: 'unclassified', disposition: 'needs_human', reason: 'urgent' }), null);
  await db.query('update catering_inbound_messages set assigned_to=$1 where id=$2', [noMail, unmailed]);
  await reject(() => claim(unmailed, { kind: 'escalation', escalation: escalation('urgent') }), /invalid_recipient/, 'assignee without an email address refused');
  await db.query('update catering_inbound_messages set assigned_to=null where id=$1', [unmailed]);
  await reject(() => claim(unmailed, { kind: 'escalation', escalation: escalation('urgent') }), /invalid_recipient/, 'unassigned escalation refused');
  const auto = await arrival({ headers: { 'auto-submitted': 'auto-replied' } });
  await db.query("update catering_inbound_messages set disposition='drafted' where id=$1", [auto]);
  await reject(() => claim(auto), /invalid_recipient|no_draft/, 'auto-submitted mail is never replied to');
  const known = await arrival({ sender_address: 'known@example.test' }, result({ identity_status: 'resolved', catering_customer_id: customer, lead_id: lead, location_id: shop }));
  await db.query('update catering_customers set active=false where id=$1', [customer]);
  await reject(() => claim(known), /revalidation_failed/, 'deactivated customer blocks the old draft');
  await db.query('update catering_customers set active=true where id=$1', [customer]);
  await db.query("update catering_pipeline set stage='lost' where id=$1", [lead]);
  await reject(() => claim(known), /revalidation_failed/, 'closed lead blocks the old draft');
  await db.query("update catering_pipeline set stage='inquiry' where id=$1", [lead]);
  check((await claim(known)).recipient === 'known@example.test', 'revalidated draft sends to the stored sender');
  // ── a lost lease becomes ambiguous, never resent ──
  const stale = await arrival();
  const lease = await claim(stale);
  await db.query("update catering_inbox_drafts set delivery_claimed_at = clock_timestamp() - interval '20 minutes' where id=$1", [lease.draft_id]);
  const refused = await claim(stale);
  const staleRow = await draftRow(lease.draft_id);
  check(refused.refused === 'needs_review' && staleRow.delivery_state === 'ambiguous' && staleRow.delivery_error_code === 'lease_expired' && staleRow.delivery_token === null, 'expired lease is marked ambiguous and refused, not reclaimed');
  await reject(() => finish(lease.draft_id, lease.token, 'sent', 'late'), /lease_lost/, 'the late holder cannot finish');
  await reject(() => claim(stale), /needs_review/, 'ambiguous is never auto-resent');
  const staleRevision = await revisionOf(stale);
  await reject(() => human(stale, manager, staleRevision), /needs_review/, 'ambiguous needs a person, not a Send button');
  check((await one("select count(*)::int n from catering_inbox_events where message_id=$1 and event_type='deliver'", [stale])).n === 1, 'the expiry transition is an event');
  // ── sessions and actors ──
  const guarded = await arrival();
  await db.query('update sessions set revoked_at=now() where id=$1', [sessions.get(manager)]);
  await reject(() => human(guarded, manager, 1), /forbidden/, 'revoked session cannot send');
  await db.query('update sessions set revoked_at=null where id=$1', [sessions.get(manager)]);
  await reject(() => claim(guarded, { trigger: 'human', actor: manager, session: null, revision: 1 }), /invalid_input/, 'human claim needs a session');
  await reject(() => claim(guarded, { trigger: 'cron', actor: manager }), /invalid_input/, 'cron claim carries no actor');
  await reject(() => claim(randomUUID()), /not_found/, 'unknown message refused');
  // ── the pane's reader contract: one reply draft per message ──
  await reject(() => db.query("insert into catering_inbox_drafts(message_id,language,template_key,template_version,params,preview_text) values ($1,'en','intake','1','{}','x')", [guarded]), /duplicate key/, 'one reply draft per message');
  await reject(() => db.query("insert into catering_inbox_drafts(message_id,kind,language,template_key,template_version,params,preview_text) values ($1,'escalation','en','intake','1','{}','x')", [guarded]), /check constraint/, 'escalation rows take the escalation template only');
  console.log(`PASS 0298: ${checks} checks (single-session PGlite; concurrency requires separate sim proof)`);
} finally { await db.close(); }
