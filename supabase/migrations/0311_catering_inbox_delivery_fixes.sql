-- 0311: catering inbox delivery fixes (audit W11: B066 part a, B067, B068 backstop, B168).
-- AUTHORED 2026-11-15. NOT YET APPLIED — file only; apply via MCP after review (sim first, prod on Juan's word), AFTER 0298.
-- Sources: 0296 (the inbox tables), 0298 (claim_catering_inbox_delivery, catering_inbox_delivery_due, the thread cap, the
--   delivery_error_code check, the CEILINGS block). Both functions are re-emitted with the SAME signatures, 0298's bodies
--   verbatim except the lines marked "0311" (tests/catering-inbox-delivery-fixes-migration.test.ts pins that).
--
-- WHAT
--   1. catering_inbox_recipient_limits + the claim's per-RECIPIENT daily cap (B066a): at most THREE automatic-inbox replies
--      per customer address per UTC day, across every thread. The 0298 cap was per thread_key only, and the thread key comes
--      from a sender-chosen Message-ID, so forged mail could mint unlimited 3-a-day buckets aimed at one victim. The cap
--      binds a staff "Send draft" too (owner decision W11-1 a). `recipient_cap` is NOT a permanent refusal: like
--      thread_cap it rolls the claim back, the thread slot included; a same-day retry reuses both reservations.
--   2. The automated-mail loop guard runs for REPLIES only (B067): an escalation goes to the staff assignee, so an urgent
--      ezCater / Tripleseat notice with list or auto-submitted headers is no longer tombstoned invalid_recipient.
--   3. An escalation preview carrying a ?/# link or token= is refused `unsafe_preview`, a PERMANENT refusal (one
--      needs_review tombstone that leaves the queue) instead of a transient invalid_escalation that headed the queue on
--      every tick (B068 backstop; the app now strips links before building the preview). delivery_error_code admits it.
--   4. catering_inbox_delivery_due leaves out reply drafts the claim would refuse thread_cap / recipient_cap today, so a
--      flood on one thread or address cannot fill the 25-row page and starve newer replies (B168).
--
-- EXISTING ROWS: no draft or message is rewritten. Today's reply attempts are backfilled into the recipient cap (so the
--   apply day is not a free pass). Escalation tombstones left by the B067 bug are COUNTED (NOTICE) and left as they are
--   (owner decision W11-4 a: they stay visible in the inbox).
-- Nothing here sends. Delivery still needs settings mode `live` AND CATERING_INBOX_DELIVERY_ENABLED=1 (0298, unchanged).
-- Deny-all RLS stays; service_role keeps SELECT only on every inbox table, the new one included (the 0296/0298 ceiling).
-- APP COMPATIBILITY: the app works before and after this file. Before it, `recipient_cap` / `unsafe_preview` never occur.
-- ROLLBACK: revert the app code if wanted (it works with either body); the table and the widened check are harmless;
--   re-applying 0298's two function bodies restores the old behaviour.
begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  if to_regprocedure('public.claim_catering_inbox_delivery(uuid,text,text,uuid,uuid,integer,uuid,jsonb,text)') is null
     or to_regprocedure('public.catering_inbox_delivery_due(integer)') is null
     or to_regclass('public.catering_inbox_thread_limits') is null then
    raise exception '0311: 0298 must be applied first';
  end if;
  if to_regclass('public.catering_inbox_recipient_limits') is not null then
    raise exception '0311: already applied';
  end if;
  -- Drift guard: the live claim body is still 0298's (this file re-emits it whole).
  select prosrc into v_src from pg_proc where oid = 'public.claim_catering_inbox_delivery(uuid,text,text,uuid,uuid,integer,uuid,jsonb,text)'::regprocedure;
  if position('invalid_escalation' in v_src) = 0 or position('thread_cap' in v_src) = 0
     or position('recipient_cap' in v_src) > 0 or position('unsafe_preview' in v_src) > 0 then
    raise exception '0311: claim_catering_inbox_delivery drifted from 0298; re-sync 0311 before applying';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.catering_inbox_drafts'::regclass
                  and conname = 'catering_inbox_drafts_delivery_error_code_check' and contype = 'c') then
    raise exception '0311: catering_inbox_drafts_delivery_error_code_check not found; re-sync 0311 before applying';
  end if;
  raise notice '0311: % escalation tombstone(s) left by the automated-header guard (B067); kept as they are',
    (select count(*) from public.catering_inbox_drafts d join public.catering_inbound_messages m on m.id = d.message_id
      where d.kind = 'escalation' and d.delivery_state = 'needs_review' and d.delivery_error_code = 'invalid_recipient'
        and m.disposition = 'needs_human');
end $$;

-- ── 1. THE PER-RECIPIENT DAILY CAP ──────────────────────────────────────────────────────────────
create table public.catering_inbox_recipient_limits (
  recipient text not null check (length(recipient) between 3 and 254),
  day_utc date not null,
  reserved integer not null check (reserved between 0 and 3),
  primary key (recipient, day_utc)
);

-- ── 2. delivery_error_code admits unsafe_preview ────────────────────────────────────────────────
alter table public.catering_inbox_drafts
  drop constraint catering_inbox_drafts_delivery_error_code_check,
  add constraint catering_inbox_drafts_delivery_error_code_check check (delivery_error_code in
    ('provider_rejected','provider_uncertain','idempotency_conflict','lease_expired','not_configured','invalid_recipient','send_failed','revalidation_failed','quote_revalidation_failed','own_address','unsafe_preview'));

-- ── 3. THE CLAIM (0298 verbatim except the lines marked 0311) ───────────────────────────────────
create or replace function public.claim_catering_inbox_delivery(
  p_message_id uuid, p_kind text, p_trigger text, p_actor_id uuid, p_session_id uuid,
  p_expected_revision integer, p_request_id uuid, p_escalation jsonb default null, p_permanent_refusal text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare s public.catering_inbox_settings%rowtype; m public.catering_inbound_messages%rowtype;
  d public.catering_inbox_drafts%rowtype; e public.catering_inbox_events%rowtype; v_pair record;
  v_refusal text; v_recipient text; v_email text; v_day date := (clock_timestamp() at time zone 'utc')::date; v_reserved integer; v_recipient_reserved integer;
  v_thread text; v_token uuid := gen_random_uuid(); v_language text; v_assignee public.users%rowtype;
  v_fingerprint text := md5(jsonb_build_array(p_message_id,p_kind,p_trigger,p_actor_id,p_session_id,p_expected_revision)::text);
begin
  if p_request_id is null or p_kind is null or p_kind not in ('reply','escalation') or p_trigger is null or p_trigger not in ('human','cron')
    or (p_trigger = 'human') <> (p_actor_id is not null) or (p_trigger = 'human') <> (p_session_id is not null)
    or (p_trigger = 'human') <> (p_expected_revision is not null) or (p_kind = 'escalation' and p_trigger <> 'cron')
    or (p_permanent_refusal is not null and (p_permanent_refusal <> 'own_address' or p_kind <> 'reply'))
    then raise exception 'invalid_input'; end if;
  select * into s from public.catering_inbox_settings where singleton for share;
  if s.mode <> 'live' then raise exception 'delivery_off'; end if;
  select * into m from public.catering_inbound_messages where id = p_message_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_trigger = 'human' and (not public.catering_inbox_can_access(p_actor_id, m.location_id) or not exists
    (select 1 from public.sessions x where x.id = p_session_id and x.user_id = p_actor_id
      and x.revoked_at is null and x.expires_at > clock_timestamp())) then raise exception 'forbidden'; end if;
  select * into e from public.catering_inbox_events where request_id = p_request_id;
  if found then
    if e.message_id <> m.id or e.event_type not in ('claim','deliver') or e.request_fingerprint <> v_fingerprint then raise exception 'request_conflict'; end if;
    if e.event_type = 'deliver' then
      return jsonb_build_object('message_id',m.id,'revision',e.after_revision,'replayed',true,'refused','needs_review');
    end if;
    return jsonb_build_object('message_id', m.id, 'revision', e.after_revision, 'replayed', true);
  end if;
  if p_trigger = 'human' and m.revision <> p_expected_revision then raise exception 'stale_revision'; end if;
  if m.disposition = 'handled' or (p_kind = 'reply' and m.disposition <> 'drafted') or (p_kind = 'escalation' and m.disposition <> 'needs_human')
    then raise exception 'invalid_state'; end if;
  select * into d from public.catering_inbox_drafts where message_id = m.id and kind = p_kind for update;
  if p_kind = 'reply' and not found then raise exception 'no_draft'; end if;
  if found then
    if d.delivery_state = 'sent' then raise exception 'already_sent'; end if;
    if d.delivery_state in ('ambiguous','cancelled','needs_review') then raise exception 'needs_review'; end if;
    if d.delivery_state = 'claimed' then
      if d.delivery_claimed_at > clock_timestamp() - interval '10 minutes' then raise exception 'delivery_busy'; end if;
      -- The holder never reported: its provider outcome is unknown. Never resend on top of it. This transition
      -- must PERSIST, so it is RETURNED as a refusal rather than raised (a raise would roll it back).
      update public.catering_inbox_drafts set delivery_state = 'ambiguous', delivery_token = null, delivery_error_code = 'lease_expired' where id = d.id;
      insert into public.catering_inbox_events(message_id,event_type,request_id,request_fingerprint,before_revision,after_revision,before_disposition,after_disposition,before_assigned_to,after_assigned_to)
      values (m.id,'deliver',gen_random_uuid(),md5(d.id::text || ':' || d.delivery_attempt::text || ':lease_expired'),m.revision,m.revision+1,m.disposition,m.disposition,m.assigned_to,m.assigned_to);
      update public.catering_inbound_messages set revision = revision + 1 where id = m.id;
      return jsonb_build_object('message_id', m.id, 'revision', m.revision + 1, 'replayed', false, 'refused', 'needs_review', 'draft_id', d.id);
    end if;
    if p_trigger = 'cron' and d.delivery_attempt >= 3 then raise exception 'attempts_exhausted'; end if;
  end if;
  if p_trigger = 'cron' and (s.live_since is null or coalesce(d.created_at, m.recorded_at) < s.live_since) then raise exception 'not_new'; end if;
  begin -- Only the closed permanent refusal set is converted to durable review below.
    -- Service-only app evidence; resolve after auth, replay and state checks, before any reservation.
    if p_permanent_refusal = 'own_address' then raise exception 'own_address'; end if;
    if p_kind = 'reply' then
      -- Loop guards, again, on immutable evidence (the app checks its own addresses too). 0311 (audit W11/B067): REPLIES
      -- ONLY. An escalation goes to the staff assignee, never to the automated sender, so an urgent ezCater / Tripleseat
      -- notice carrying list or auto-submitted headers still alerts the assignee.
      if (m.headers->>'auto-submitted') is not null and lower(m.headers->>'auto-submitted') <> 'no'
        or coalesce(m.headers->>'precedence','') ~* '\m(bulk|list|junk)\M' or m.headers ? 'list-id' or m.headers ? 'list-unsubscribe'
        or m.headers->>'return-path' = '<>' or coalesce(m.headers->>'content-type','') ~* 'delivery-status'
        or coalesce(m.sender_address,'') ~* '^(mailer-daemon|postmaster)@' then raise exception 'invalid_recipient'; end if;
      v_email := lower(btrim(m.sender_address));
      if v_email is null or length(v_email) > 254 or v_email !~ '^[^<>@[:space:]]+@[^<>@[:space:]]+\.[^<>@[:space:]]+$' then raise exception 'invalid_recipient'; end if;
      -- Revalidate what the draft was written against: the customer and the open artifact.
      if m.catering_customer_id is not null and not exists (select 1 from public.catering_customers c where c.id = m.catering_customer_id and c.active
          and c.email ilike replace(replace(replace(v_email, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_')) then raise exception 'revalidation_failed'; end if;
      if m.lead_id is not null and not exists (select 1 from public.catering_pipeline p where p.id = m.lead_id
          and p.customer_id is not distinct from m.catering_customer_id and p.location_id is not distinct from m.location_id
          and p.stage in ('inquiry','quote_sent','confirmed','out')) then raise exception 'revalidation_failed'; end if;
      if d.lead_id is distinct from m.lead_id or d.quote_id is distinct from m.quote_id then raise exception 'revalidation_failed'; end if;
      -- The linked quote itself, as finalize_catering_inbound proved it: same owner, same lead, same shop, not superseded.
      if m.quote_id is not null and not exists (select 1 from public.catering_quotes q where q.id = m.quote_id
          and q.customer_id is not distinct from m.catering_customer_id and q.pipeline_id is not distinct from m.lead_id
          and q.location_id is not distinct from m.location_id and q.superseded_at is null) then raise exception 'quote_revalidation_failed'; end if;
      v_recipient := v_email;
      v_thread := coalesce(nullif(m.thread_key, '[invalid]'), m.id::text);
      -- A reservation is good for ITS UTC day only: a retry on a later day takes today's capacity, atomically.
      if d.delivery_thread_day is distinct from v_day then
        insert into public.catering_inbox_thread_limits(thread_key, day_utc, reserved) values (v_thread, v_day, 1)
        on conflict (thread_key, day_utc) do update set reserved = catering_inbox_thread_limits.reserved + 1
          where catering_inbox_thread_limits.reserved < 3
        returning reserved into v_reserved;
        if v_reserved is null then raise exception 'thread_cap'; end if;
        -- 0311 (audit W11/B066a): at most THREE automatic-inbox replies per recipient address per UTC day, across every
        -- thread (a forged Message-ID mints a fresh thread key). Humans included (owner decision W11-1 a). Not a permanent
        -- refusal: like thread_cap it rolls the whole claim back, the thread slot just taken included.
        insert into public.catering_inbox_recipient_limits(recipient, day_utc, reserved) values (v_recipient, v_day, 1)
        on conflict (recipient, day_utc) do update set reserved = catering_inbox_recipient_limits.reserved + 1
          where catering_inbox_recipient_limits.reserved < 3
        returning reserved into v_recipient_reserved;
        if v_recipient_reserved is null then raise exception 'recipient_cap'; end if;
      end if;
      update public.catering_inbox_drafts set delivery_state = 'claimed', delivery_attempt = delivery_attempt + 1, delivery_token = v_token,
        delivery_trigger = p_trigger, delivery_actor_id = p_actor_id, delivery_claimed_at = clock_timestamp(), delivery_attempted_at = clock_timestamp(),
        delivery_first_attempt_at = coalesce(delivery_first_attempt_at, clock_timestamp()), delivery_recipient = v_recipient,
        delivery_error_code = null, delivery_thread_day = v_day where id = d.id returning * into d;
    else
      if m.assigned_to is null or not public.catering_inbox_can_access(m.assigned_to, m.location_id) then raise exception 'assignee_unavailable'; end if;
      select * into v_assignee from public.users u where u.id = m.assigned_to;
      v_recipient := lower(btrim(v_assignee.email));
      if v_recipient is null or length(v_recipient) > 254 or v_recipient !~ '^[^<>@[:space:]]+@[^<>@[:space:]]+\.[^<>@[:space:]]+$' then raise exception 'assignee_unavailable'; end if;
      v_language := case when v_assignee.language = 'es' then 'es' else 'en' end;
      if d.id is null then
        -- Freeze the escalation body on the first attempt; the finalize p_draft envelope rules, narrowed.
        if p_escalation is null or jsonb_typeof(p_escalation) <> 'object'
          or exists (select 1 from jsonb_object_keys(p_escalation) k where k not in ('language','params','preview_text'))
          or p_escalation->>'language' is distinct from v_language or jsonb_typeof(p_escalation->'params') is distinct from 'object'
          or exists (select 1 from jsonb_each(p_escalation->'params') kv where kv.key not in ('tenantName','inboxUrl','reason') or jsonb_typeof(kv.value) <> 'string')
          or not (p_escalation->'params' ?& array['tenantName','reason'])
          or length(p_escalation->'params'->>'tenantName') not between 1 and 120
          or p_escalation->'params'->>'reason' is distinct from m.reason
          or (p_escalation->'params' ? 'inboxUrl' and p_escalation->'params'->>'inboxUrl' !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/catering/inbox$')
          or octet_length(coalesce(p_escalation->>'preview_text','')) not between 1 and 32768
          then raise exception 'invalid_escalation'; end if;
        -- 0311 (audit W11/B068): an unsafe preview is a PERMANENT refusal (one needs_review tombstone that leaves the
        -- queue), never a transient raise that heads the escalation queue on every tick.
        if (p_escalation->>'preview_text') ~ '(https?://[^\s]*[?#]|token=)' then raise exception 'unsafe_preview'; end if;
        insert into public.catering_inbox_drafts(message_id, kind, language, template_key, template_version, params, preview_text, lead_id, quote_id)
        values (m.id, 'escalation', v_language, 'escalation', '1', p_escalation->'params', p_escalation->>'preview_text', m.lead_id, m.quote_id) returning * into d;
      end if;
      update public.catering_inbox_drafts set delivery_state = 'claimed', delivery_attempt = delivery_attempt + 1, delivery_token = v_token,
        delivery_trigger = p_trigger, delivery_actor_id = null, delivery_claimed_at = clock_timestamp(), delivery_attempted_at = clock_timestamp(),
        delivery_first_attempt_at = coalesce(delivery_first_attempt_at, clock_timestamp()), delivery_recipient = v_recipient,
        delivery_error_code = null where id = d.id returning * into d;
    end if;
  exception when raise_exception then
    if sqlerrm not in ('invalid_recipient','revalidation_failed','quote_revalidation_failed','own_address','unsafe_preview') then raise; end if;
    v_refusal := sqlerrm;
  end;
  if v_refusal is not null then
    -- No provider attempt or cap reservation happened. A first escalation still needs a durable queue tombstone.
    -- Its internal placeholder is never a sendable body or a customer preview.
    if d.id is null then
      insert into public.catering_inbox_drafts(message_id,kind,language,template_key,template_version,params,preview_text,lead_id,quote_id)
      values (m.id,'escalation','en','escalation','1','{}',v_refusal,m.lead_id,m.quote_id) returning * into d;
    end if;
    update public.catering_inbox_drafts set delivery_state = 'needs_review', delivery_token = null,
      delivery_error_code = v_refusal where id = d.id;
    insert into public.catering_inbox_events(message_id,event_type,actor_id,request_id,request_fingerprint,before_revision,after_revision,before_disposition,after_disposition,before_assigned_to,after_assigned_to)
    values (m.id,'deliver',p_actor_id,p_request_id,v_fingerprint,m.revision,m.revision+1,m.disposition,m.disposition,m.assigned_to,m.assigned_to);
    update public.catering_inbound_messages set revision = revision + 1 where id = m.id;
    return jsonb_build_object('message_id',m.id,'revision',m.revision+1,'replayed',false,
      'refused','needs_review','reason',v_refusal,'draft_id',d.id);
  end if;
  update public.catering_inbound_messages set revision = revision + 1 where id = m.id;
  insert into public.catering_inbox_events(message_id,event_type,actor_id,request_id,request_fingerprint,before_revision,after_revision,before_disposition,after_disposition,before_assigned_to,after_assigned_to)
  values (m.id,'claim',p_actor_id,p_request_id,v_fingerprint,m.revision,m.revision+1,m.disposition,m.disposition,m.assigned_to,m.assigned_to);
  return jsonb_build_object('message_id', m.id, 'revision', m.revision + 1, 'replayed', false,
    'draft_id', d.id, 'kind', d.kind, 'attempt', d.delivery_attempt, 'token', v_token, 'recipient', v_recipient,
    'idempotency_key', 'catering-inbox:' || d.id::text || ':' || d.delivery_attempt::text,
    'language', d.language, 'template_key', d.template_key, 'params', d.params, 'preview_text', d.preview_text,
    'subject', m.subject, 'message_id_header', m.headers->>'message-id', 'references_header', m.headers->>'references');
end;
$$;

-- ── 4. THE QUEUE (0298 verbatim except the lines marked 0311) ───────────────────────────────────
create or replace function public.catering_inbox_delivery_due(p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = pg_catalog, public
as $$
  with s as (select mode, live_since from public.catering_inbox_settings where singleton),
  today as (select (clock_timestamp() at time zone 'utc')::date as day_utc),
  replies as (
    select d.message_id, d.id as draft_id from public.catering_inbox_drafts d
    join public.catering_inbound_messages m on m.id = d.message_id, s, today
    where s.mode = 'live' and s.live_since is not null and d.kind = 'reply' and m.disposition = 'drafted' and d.created_at >= s.live_since
      and (d.delivery_state = 'draft' or (d.delivery_state = 'failed' and d.delivery_attempt < 3
        and d.delivery_attempted_at <= clock_timestamp() - interval '10 minutes'))
      -- 0311 (audit W11/B168 + B066a): a draft the claim would refuse thread_cap / recipient_cap TODAY never occupies the
      -- page. A draft already holding today's reservation (a same-day retry) stays due. The keys are the claim's exactly.
      and (d.delivery_thread_day is not distinct from today.day_utc
        or (not exists (select 1 from public.catering_inbox_thread_limits t
                         where t.thread_key = coalesce(nullif(m.thread_key, '[invalid]'), m.id::text) and t.day_utc = today.day_utc and t.reserved >= 3)
          and not exists (select 1 from public.catering_inbox_recipient_limits r
                         where r.recipient = lower(btrim(m.sender_address)) and r.day_utc = today.day_utc and r.reserved >= 3)))
      -- Permanent recipient/customer/lead/quote refusals must reach the claim and leave the queue.
    order by d.created_at, d.id limit greatest(1, least(coalesce(p_limit, 25), 200))),
  escalations as (
    select m.id as message_id from public.catering_inbound_messages m, s
    where s.mode = 'live' and s.live_since is not null and m.disposition = 'needs_human' and m.recorded_at >= s.live_since
      and m.assigned_to is not null and m.reason is not null
      and public.catering_inbox_can_access(m.assigned_to,m.location_id)
      and exists (select 1 from public.users u where u.id = m.assigned_to and u.active
        and length(btrim(u.email)) <= 254 and btrim(u.email) ~ '^[^<>@[:space:]]+@[^<>@[:space:]]+\.[^<>@[:space:]]+$')
      and not exists (select 1 from public.catering_inbox_drafts d where d.message_id = m.id and d.kind = 'escalation'
        and not (d.delivery_state = 'failed' and d.delivery_attempt < 3 and d.delivery_attempted_at <= clock_timestamp() - interval '10 minutes'))
    order by m.recorded_at, m.id limit greatest(1, least(coalesce(p_limit, 25), 200)))
  select jsonb_build_object(
    'replies', coalesce((select jsonb_agg(jsonb_build_object('message_id', message_id, 'draft_id', draft_id)) from replies), '[]'::jsonb),
    'escalations', coalesce((select jsonb_agg(jsonb_build_object('message_id', message_id)) from escalations), '[]'::jsonb));
$$;


-- ── 5. BACKFILL: today's reply attempts already hold recipient capacity ─────────────────────────
insert into public.catering_inbox_recipient_limits(recipient, day_utc, reserved)
select d.delivery_recipient, d.delivery_thread_day, least(count(*), 3)::integer
  from public.catering_inbox_drafts d
 where d.kind = 'reply' and d.delivery_attempt > 0 and d.delivery_recipient is not null
   and length(d.delivery_recipient) between 3 and 254
   and d.delivery_thread_day = (clock_timestamp() at time zone 'utc')::date
 group by d.delivery_recipient, d.delivery_thread_day
on conflict do nothing;

-- ── CEILINGS (the 0296/0298 pattern, re-asserted for every inbox table and RPC) ─────────────────
do $$
declare t text; r text; privilege text; f regprocedure; allowed boolean;
begin
  alter table public.catering_inbox_recipient_limits enable row level security;
  create policy catering_inbox_recipient_limits_no_user_delete on public.catering_inbox_recipient_limits for delete using (false);
  revoke all on public.catering_inbox_recipient_limits from public, anon, authenticated, service_role;
  grant select on public.catering_inbox_recipient_limits to service_role;
  foreach t in array array['catering_inbound_messages','catering_inbox_drafts','catering_inbox_events','catering_inbox_settings','catering_inbox_thread_limits','catering_inbox_recipient_limits'] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        allowed := has_table_privilege(r,'public.'||t,privilege);
        assert allowed = (r='service_role' and privilege='SELECT'), 'inbox table privilege escape';
      end loop;
    end loop;
    assert not exists(select 1 from pg_class c, lateral aclexplode(c.relacl) a
      where c.oid=('public.'||t)::regclass and a.grantee=0), 'inbox PUBLIC table escape';
    assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass), 'inbox RLS off';
  end loop;
  foreach f in array array[
    'public.claim_catering_inbox_delivery(uuid,text,text,uuid,uuid,integer,uuid,jsonb,text)'::regprocedure,
    'public.finish_catering_inbox_delivery(uuid,uuid,text,text,text)'::regprocedure,
    'public.sweep_catering_inbox_delivery(integer)'::regprocedure,
    'public.catering_inbox_delivery_due(integer)'::regprocedure,
    'public.set_catering_inbox_mode(uuid,uuid,text,integer)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f);
    execute format('grant execute on function %s to service_role',f);
    assert not has_function_privilege('anon',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE'), 'inbox RPC escape';
    assert has_function_privilege('service_role',f,'EXECUTE'), 'inbox RPC service grant';
    assert not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid=f and a.grantee=0), 'inbox PUBLIC RPC escape';
    assert (select prosecdef from pg_proc where oid=f), 'inbox RPC definer';
  end loop;
  -- The re-emitted bodies are the 0311 ones.
  assert position('recipient_cap' in (select prosrc from pg_proc where oid='public.claim_catering_inbox_delivery(uuid,text,text,uuid,uuid,integer,uuid,jsonb,text)'::regprocedure)) > 0, '0311 claim body';
  assert position('catering_inbox_recipient_limits' in (select prosrc from pg_proc where oid='public.catering_inbox_delivery_due(integer)'::regprocedure)) > 0, '0311 due body';
end;
$$;
commit;
