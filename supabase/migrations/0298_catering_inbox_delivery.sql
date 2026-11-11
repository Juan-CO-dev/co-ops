-- 0298: catering inbox phase 1b — delivery (the sending side), shipping OFF.
-- AUTHORED 2026-11-11. NOT YET APPLIED (sim first with scripts/sql-harness-0298.mjs offline proof, then prod on Juan's word).
-- Sources: 0296 (the inbox tables and writers; lock order message → draft), 0243/0268/0275 (the cron lease).
-- 0297 is a parallel vendor-mail build: the lease preflight below refuses if its job set drifted.
--
-- WHAT THIS ADDS
--   1. Delivery state ON THE DRAFT ROW (claimed | sent | failed | ambiguous | cancelled | needs_review, fencing token, attempt
--      times, provider id, closed error code, recipient snapshot). `kind` admits 'escalation' (staff mail to the
--      assignee); one row per (message, kind).
--   2. catering_inbox_thread_limits: at most THREE customer replies per thread per UTC day, reserved transactionally
--      by the claim; a retry reuses its reservation.
--   3. claim_catering_inbox_delivery / finish_catering_inbox_delivery (SECURITY DEFINER, service_role only).
--      Lock order: settings FOR SHARE → message FOR UPDATE → draft FOR UPDATE → thread-limit row. The claim re-checks
--      live mode, draft eligibility, handled state, recipient, revalidation and the cap AT CLAIM TIME; a lost lease
--      cannot finish; sent never returns to draft; an expired lease is `ambiguous`, never auto-resent.
--   4. set_catering_inbox_mode (owner / CGS only, live session, revision-checked; the app audits
--      catering.inbox.delivery_mode_change). `live_since` makes activation never bulk-send old shadow drafts.
--   5. The cron lease job 'catering-inbox-delivery'.
-- Deny-all RLS stays; service_role keeps SELECT only (the 0296 ceiling, re-asserted here for the new table).
-- Nothing here sends. The ONLY sender is lib/catering/inbox-delivery.ts, behind settings mode `live` AND
-- CATERING_INBOX_DELIVERY_ENABLED=1 AND explicit sender configuration.
-- ROLLBACK: revert the application code; keep every table, draft, reservation and event. Mode `off` stops every claim.
begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
declare v_jobs text[];
begin
  if to_regclass('public.catering_inbox_drafts') is null or to_regclass('public.catering_inbox_settings') is null
     or to_regprocedure('public.act_on_catering_inbox(uuid,integer,uuid,uuid,uuid,text,uuid)') is null then
    raise exception '0298: 0296 must be applied first';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_inbox_drafts' and column_name = 'delivery_state') then
    raise exception '0298: already applied';
  end if;
  if to_regclass('public.cron_route_leases') is null or to_regprocedure('public.claim_cron_route(text)') is null
     or not exists (select 1 from pg_constraint where conrelid = 'public.cron_route_leases'::regclass
                     and conname = 'cron_route_leases_job_check' and contype = 'c') then
    raise exception '0298: the cron lease (0243, re-emitted by 0268 / 0275) must exist';
  end if;
  select array_agg(distinct m[1] order by m[1]) into v_jobs
    from pg_constraint c, lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z-]+)''', 'g') m
   where c.conrelid = 'public.cron_route_leases'::regclass and c.conname = 'cron_route_leases_job_check';
  -- Two parallel migrations (0298 here, 0300 meta-leads) each re-emit the lease with the UNION of both jobs, so either
  -- may apply first: accept 0275's set or 0300's set (the union), refuse anything else.
  if v_jobs is distinct from array['schedule-draft','sevenshifts-sync','toast-catering-scan','toast-sales-today']::text[]
     and v_jobs is distinct from array['catering-inbox-delivery','meta-leads','schedule-draft','sevenshifts-sync','toast-catering-scan','toast-sales-today']::text[] then
    raise exception '0298: cron_route_leases_job_check is neither 0275''s nor 0300''s set (%); re-sync 0298 before applying', v_jobs;
  end if;
end $$;

-- ── 1. DELIVERY STATE ON THE DRAFT ──────────────────────────────────────────────────────────────
alter table public.catering_inbox_drafts
  drop constraint catering_inbox_drafts_message_id_key,
  drop constraint catering_inbox_drafts_kind_check,
  drop constraint catering_inbox_drafts_template_key_check,
  add constraint catering_inbox_drafts_kind_check check (kind in ('reply','escalation')),
  add constraint catering_inbox_drafts_template_key_check check (
    (kind = 'reply' and template_key in ('intake','ours','third_party')) or (kind = 'escalation' and template_key = 'escalation')),
  add constraint catering_inbox_drafts_message_kind_key unique (message_id, kind),
  add column delivery_state text not null default 'draft'
    check (delivery_state in ('draft','claimed','sent','failed','ambiguous','cancelled','needs_review')),
  add column delivery_attempt integer not null default 0 check (delivery_attempt >= 0),
  add column delivery_token uuid,
  add column delivery_trigger text check (delivery_trigger in ('human','cron')),
  add column delivery_actor_id uuid references public.users(id),
  add column delivery_claimed_at timestamptz,
  add column delivery_attempted_at timestamptz,
  add column delivery_first_attempt_at timestamptz,
  add column delivery_sent_at timestamptz,
  add column delivery_recipient text check (length(delivery_recipient) <= 254),
  add column delivery_provider_id text check (length(delivery_provider_id) between 1 and 200),
  add column delivery_error_code text check (delivery_error_code in
    ('provider_rejected','provider_uncertain','idempotency_conflict','lease_expired','not_configured','invalid_recipient','send_failed','revalidation_failed','quote_revalidation_failed','own_address')),
  add column delivery_thread_day date,
  add constraint catering_inbox_drafts_claim_token check ((delivery_state = 'claimed') = (delivery_token is not null)),
  add constraint catering_inbox_drafts_attempted check ((delivery_attempt = 0) = (delivery_first_attempt_at is null)),
  add constraint catering_inbox_drafts_attempted_pair check ((delivery_attempt = 0) = (delivery_attempted_at is null)),
  add constraint catering_inbox_drafts_sent_proof check (delivery_state <> 'sent' or (delivery_provider_id is not null and delivery_sent_at is not null)),
  add constraint catering_inbox_drafts_failed_code check (delivery_state not in ('failed','ambiguous','needs_review') or delivery_error_code is not null),
  add constraint catering_inbox_drafts_state_attempt check (delivery_state in ('draft','needs_review') or delivery_attempt > 0),
  add constraint catering_inbox_drafts_trigger_pair check ((delivery_attempt = 0) = (delivery_trigger is null)),
  add constraint catering_inbox_drafts_actor_human check (delivery_actor_id is null or delivery_trigger = 'human'),
  add constraint catering_inbox_drafts_reply_slot check (kind <> 'reply' or (delivery_attempt = 0) = (delivery_thread_day is null)),
  add constraint catering_inbox_drafts_escalation_no_slot check (kind = 'reply' or delivery_thread_day is null);
create index catering_inbox_drafts_due on public.catering_inbox_drafts(delivery_state, created_at) where delivery_state in ('draft','failed','claimed');

alter table public.catering_inbox_events drop constraint catering_inbox_events_event_type_check,
  add constraint catering_inbox_events_event_type_check check (event_type in ('ingest','finalize','handle','reassign','claim','deliver'));

alter table public.catering_inbox_settings
  add column revision integer not null default 0 check (revision >= 0),
  add column changed_by uuid references public.users(id),
  add column changed_at timestamptz,
  add column live_since timestamptz,
  add constraint catering_inbox_settings_live_since check (mode <> 'live' or live_since is not null);

-- ── 2. THE PER-THREAD DAILY CAP ─────────────────────────────────────────────────────────────────
create table public.catering_inbox_thread_limits (
  thread_key text not null check (length(thread_key) between 1 and 1000),
  day_utc date not null,
  reserved integer not null check (reserved between 0 and 3),
  primary key (thread_key, day_utc)
);

-- ── 3. THE DELIVERY WRITERS ─────────────────────────────────────────────────────────────────────
-- Claim one delivery attempt. Returns the frozen content and the fencing token; the app sends with the
-- idempotency key `catering-inbox:<draft id>:<attempt>` and reports through finish_catering_inbox_delivery.
create function public.claim_catering_inbox_delivery(
  p_message_id uuid, p_kind text, p_trigger text, p_actor_id uuid, p_session_id uuid,
  p_expected_revision integer, p_request_id uuid, p_escalation jsonb default null, p_permanent_refusal text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare s public.catering_inbox_settings%rowtype; m public.catering_inbound_messages%rowtype;
  d public.catering_inbox_drafts%rowtype; e public.catering_inbox_events%rowtype; v_pair record;
  v_refusal text; v_recipient text; v_email text; v_day date := (clock_timestamp() at time zone 'utc')::date; v_reserved integer;
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
    -- Loop guards, again, on immutable evidence (the app checks its own addresses too).
    if (m.headers->>'auto-submitted') is not null and lower(m.headers->>'auto-submitted') <> 'no'
      or coalesce(m.headers->>'precedence','') ~* '\m(bulk|list|junk)\M' or m.headers ? 'list-id' or m.headers ? 'list-unsubscribe'
      or m.headers->>'return-path' = '<>' or coalesce(m.headers->>'content-type','') ~* 'delivery-status'
      or coalesce(m.sender_address,'') ~* '^(mailer-daemon|postmaster)@' then raise exception 'invalid_recipient'; end if;
    if p_kind = 'reply' then
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
          or (p_escalation->>'preview_text') ~ '(https?://[^\s]*[?#]|token=)'
          then raise exception 'invalid_escalation'; end if;
        insert into public.catering_inbox_drafts(message_id, kind, language, template_key, template_version, params, preview_text, lead_id, quote_id)
        values (m.id, 'escalation', v_language, 'escalation', '1', p_escalation->'params', p_escalation->>'preview_text', m.lead_id, m.quote_id) returning * into d;
      end if;
      update public.catering_inbox_drafts set delivery_state = 'claimed', delivery_attempt = delivery_attempt + 1, delivery_token = v_token,
        delivery_trigger = p_trigger, delivery_actor_id = null, delivery_claimed_at = clock_timestamp(), delivery_attempted_at = clock_timestamp(),
        delivery_first_attempt_at = coalesce(delivery_first_attempt_at, clock_timestamp()), delivery_recipient = v_recipient,
        delivery_error_code = null where id = d.id returning * into d;
    end if;
  exception when raise_exception then
    if sqlerrm not in ('invalid_recipient','revalidation_failed','quote_revalidation_failed','own_address') then raise; end if;
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

-- Report one attempt's outcome under the fencing token. A lost lease cannot finish; sent never returns to draft.
create function public.finish_catering_inbox_delivery(
  p_draft_id uuid, p_token uuid, p_outcome text, p_provider_id text default null, p_error_code text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare m public.catering_inbound_messages%rowtype; d public.catering_inbox_drafts%rowtype;
begin
  if p_draft_id is null or p_token is null or p_outcome is null or p_outcome not in ('sent','failed','ambiguous')
    or (p_outcome = 'sent') <> (p_provider_id is not null and length(p_provider_id) between 1 and 200)
    or (p_outcome <> 'sent' and (p_error_code is null or p_error_code not in ('provider_rejected','provider_uncertain','idempotency_conflict','not_configured','invalid_recipient','send_failed')))
    or (p_outcome = 'sent' and p_error_code is not null) then raise exception 'invalid_input'; end if;
  select * into m from public.catering_inbound_messages where id = (select message_id from public.catering_inbox_drafts where id = p_draft_id) for update;
  if not found then raise exception 'not_found'; end if;
  select * into d from public.catering_inbox_drafts where id = p_draft_id for update;
  if d.delivery_state <> 'claimed' or d.delivery_token is distinct from p_token then raise exception 'lease_lost'; end if;
  update public.catering_inbox_drafts set delivery_state = p_outcome, delivery_token = null,
    delivery_provider_id = case when p_outcome = 'sent' then p_provider_id else delivery_provider_id end,
    delivery_sent_at = case when p_outcome = 'sent' then clock_timestamp() else delivery_sent_at end,
    delivery_error_code = case when p_outcome = 'sent' then null else p_error_code end where id = d.id;
  update public.catering_inbound_messages set revision = revision + 1 where id = m.id;
  insert into public.catering_inbox_events(message_id,event_type,actor_id,request_id,request_fingerprint,before_revision,after_revision,before_disposition,after_disposition,before_assigned_to,after_assigned_to)
  values (m.id,'deliver',d.delivery_actor_id,gen_random_uuid(),md5(d.id::text || ':' || d.delivery_attempt::text || ':' || p_outcome),m.revision,m.revision+1,m.disposition,m.disposition,m.assigned_to,m.assigned_to);
  return jsonb_build_object('message_id', m.id, 'revision', m.revision + 1, 'draft_id', d.id, 'attempt', d.delivery_attempt, 'state', p_outcome);
end;
$$;

-- Bounded expiry sweep (the cron runs it before claiming): a claim whose holder never reported within 10 minutes is
-- an UNKNOWN provider outcome. Lock message → draft, fence the token seen at selection, mark ambiguous/lease_expired
-- with its event. Never resends; returns what it marked so the app can audit each row.
create function public.sweep_catering_inbox_delivery(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare r record; m public.catering_inbound_messages%rowtype; d public.catering_inbox_drafts%rowtype; v_out jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'invalid_input'; end if;
  for r in select x.id, x.message_id, x.delivery_token from public.catering_inbox_drafts x
    where x.delivery_state = 'claimed' and x.delivery_claimed_at <= clock_timestamp() - interval '10 minutes'
    order by x.delivery_claimed_at, x.id limit p_limit loop
    select * into m from public.catering_inbound_messages where id = r.message_id for update;
    select * into d from public.catering_inbox_drafts where id = r.id for update;
    -- Re-check under the locks: a finish or another sweep may have landed; a fresher claim holds a new token.
    if d.delivery_state <> 'claimed' or d.delivery_token is distinct from r.delivery_token
      or d.delivery_claimed_at > clock_timestamp() - interval '10 minutes' then continue; end if;
    update public.catering_inbox_drafts set delivery_state = 'ambiguous', delivery_token = null, delivery_error_code = 'lease_expired' where id = d.id;
    insert into public.catering_inbox_events(message_id,event_type,request_id,request_fingerprint,before_revision,after_revision,before_disposition,after_disposition,before_assigned_to,after_assigned_to)
    values (m.id,'deliver',gen_random_uuid(),md5(d.id::text || ':' || d.delivery_attempt::text || ':lease_expired'),m.revision,m.revision+1,m.disposition,m.disposition,m.assigned_to,m.assigned_to);
    update public.catering_inbound_messages set revision = revision + 1 where id = m.id;
    v_out := v_out || jsonb_build_object('draft_id', d.id, 'message_id', m.id, 'kind', d.kind, 'attempt', d.delivery_attempt, 'trigger', d.delivery_trigger);
  end loop;
  return v_out;
end;
$$;

-- The worker's queue, ELIGIBILITY-FILTERED BEFORE the limit (never a page walk over ineligible predecessors): the oldest
-- reply drafts and needs_human messages the cron may attempt now. Empty unless live. Read-only; the claim re-checks all.
create function public.catering_inbox_delivery_due(p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = pg_catalog, public
as $$
  with s as (select mode, live_since from public.catering_inbox_settings where singleton),
  replies as (
    select d.message_id, d.id as draft_id from public.catering_inbox_drafts d
    join public.catering_inbound_messages m on m.id = d.message_id, s
    where s.mode = 'live' and s.live_since is not null and d.kind = 'reply' and m.disposition = 'drafted' and d.created_at >= s.live_since
      and (d.delivery_state = 'draft' or (d.delivery_state = 'failed' and d.delivery_attempt < 3
        and d.delivery_attempted_at <= clock_timestamp() - interval '10 minutes'))
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

-- ── 4. THE MODE SWITCH ──────────────────────────────────────────────────────────────────────────
create function public.set_catering_inbox_mode(p_actor_id uuid, p_session_id uuid, p_mode text, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare s public.catering_inbox_settings%rowtype;
begin
  if p_actor_id is null or p_session_id is null or p_mode is null or p_mode not in ('off','shadow','live') or p_expected_revision is null
    then raise exception 'invalid_input'; end if;
  select * into s from public.catering_inbox_settings where singleton for update;
  if not exists (select 1 from public.users u where u.id = p_actor_id and u.active and u.role in ('owner','cgs'))
    or not exists (select 1 from public.sessions x where x.id = p_session_id and x.user_id = p_actor_id and x.revoked_at is null and x.expires_at > clock_timestamp())
    then raise exception 'forbidden'; end if;
  if s.revision <> p_expected_revision then raise exception 'stale_revision'; end if;
  if s.mode = p_mode then return jsonb_build_object('mode', s.mode, 'revision', s.revision, 'live_since', s.live_since, 'changed', false); end if;
  -- A fresh live window: drafts from before it are never auto-sent (humans may send them after revalidation).
  update public.catering_inbox_settings set mode = p_mode, revision = revision + 1, changed_by = p_actor_id, changed_at = clock_timestamp(),
    live_since = case when p_mode = 'live' then clock_timestamp() else live_since end where singleton returning * into s;
  return jsonb_build_object('mode', s.mode, 'revision', s.revision, 'live_since', s.live_since, 'changed', true);
end;
$$;

-- ── 5. THE CRON LEASE ───────────────────────────────────────────────────────────────────────────
alter table public.cron_route_leases drop constraint cron_route_leases_job_check,
  add constraint cron_route_leases_job_check check (job in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft', 'catering-inbox-delivery', 'meta-leads'));

create or replace function public.claim_cron_route(p_job text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare claimed text;
begin
  -- 'meta-leads' is 0300's job (parallel branch): the union is emitted by both migrations so neither drops the other's.
  if p_job is null or p_job not in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft', 'catering-inbox-delivery', 'meta-leads') then
    raise exception 'invalid_cron_route';
  end if;
  -- ON CONFLICT locks the single route row and rechecks the expiry under that lock.
  -- Use the database clock, never caller timestamps or a ten-minute fixed bucket.
  insert into public.cron_route_leases (job, lease_until)
    values (p_job, clock_timestamp() + interval '330 seconds')
  on conflict (job) do update
    set lease_until = clock_timestamp() + interval '330 seconds'
    where cron_route_leases.lease_until <= clock_timestamp()
  returning job into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_cron_route(text) from public, anon, authenticated;
grant execute on function public.claim_cron_route(text) to service_role;

-- ── CEILINGS (the 0296 pattern, re-asserted for every inbox table) ──────────────────────────────
do $$
declare t text; r text; privilege text; f regprocedure; allowed boolean;
begin
  alter table public.catering_inbox_thread_limits enable row level security;
  create policy catering_inbox_thread_limits_no_user_delete on public.catering_inbox_thread_limits for delete using (false);
  revoke all on public.catering_inbox_thread_limits from public, anon, authenticated, service_role;
  grant select on public.catering_inbox_thread_limits to service_role;
  foreach t in array array['catering_inbound_messages','catering_inbox_drafts','catering_inbox_events','catering_inbox_settings','catering_inbox_thread_limits'] loop
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
  end loop;
end;
$$;
commit;
