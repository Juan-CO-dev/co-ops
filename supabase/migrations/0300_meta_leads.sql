-- 0300 Meta lead intake, builds 1 + 2. AUTHORED 2026-11-11; APPLIED: SIM 20261111210158 (2026-11-11, from 8a71ae73; dry run + verify clean; CC two-session cap proof on sim: same email hash → one claimed, one capped). PROD: NOT YET (Juan-gated).
-- No database access during authoring. Sim proof and schema check precede any apply.
-- Build 1: the ledger, the lead-only intake RPC and the explicit consent writer.
-- Build 2 (edited in place while still an unapplied file): the continuation-email ledger states
-- (meta_lead_email_claim / meta_lead_email_result, A3 + A6 + A9) and portal_intake_attach, the
-- Meta continuation's attach-only draft writer, which takes the SAME customer intake lock as
-- meta_lead_intake_apply (A1). The plain portal path (no pipelineId) is deliberately untouched —
-- today's three JS inserts, byte for byte (review ruling, 2026-11-11) — so it takes no lock.
-- lead_source is unconstrained text in 0108; its application vocabulary is extended separately.
begin;

-- Refuse prerequisite drift before any persistent DDL. 0298 and 0300 may apply in either order.
do $$
declare v_jobs text[]; v_helper text; v_constraint text; v_table text; v_expected text; v_actual text;
begin
  if to_regclass('public.meta_lead_events') is not null then raise exception '0300: already applied'; end if;
  foreach v_helper in array array['customer_identity_lock()', 'customer_resolve(text,text,text,text,text,uuid,timestamptz,text,text)', 'customer_email_is_relay(text)', 'customer_sha256(text)'] loop
    if to_regprocedure('public.' || v_helper) is null then raise exception '0300: missing 0234 helper %', v_helper; end if;
  end loop;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='role') then
    raise exception '0300: missing users.role'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='catering_pipeline' and column_name='contact_phone') then
    raise exception '0300: missing catering_pipeline.contact_phone'; end if;
  -- Let PostgreSQL canonicalize the exact 0234 expressions, then compare full definitions
  -- (extracting literals alone would miss an OR true or an altered operator).
  create temporary table meta_0300_expected_checks (
    source text constraint customer_consent_events_source_check check(source in ('toast_marketing_api','toast_csv_import','toast_order','catering_portal','delete_request','retention')),
    sources text[] constraint customers_sources_check check(sources <@ array['toast_pos','toast_online','toast_app','toast_third_party','catering','ezcater','toast_csv_import','toast_marketing_api']::text[])
  ) on commit drop;
  foreach v_constraint in array array['customer_consent_events_source_check','customers_sources_check'] loop
    v_table := case when v_constraint='customers_sources_check' then 'customers' else 'customer_consent_events' end;
    select pg_get_constraintdef(oid) into v_expected from pg_constraint where conrelid='pg_temp.meta_0300_expected_checks'::regclass and conname=v_constraint;
    select pg_get_constraintdef(oid) into v_actual from pg_constraint where conrelid=to_regclass('public.'||v_table) and conname=v_constraint and contype='c' and convalidated;
    if v_actual is distinct from v_expected then raise exception '0300: % drift from 0234', v_constraint; end if;
  end loop;
  drop table pg_temp.meta_0300_expected_checks;
  if to_regclass('public.cron_route_leases') is null or to_regprocedure('public.claim_cron_route(text)') is null then
    raise exception '0300: missing cron_route_leases / claim_cron_route'; end if;
  select array_agg(distinct m[1] order by m[1]) into v_jobs
    from pg_constraint c, lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z-]+)''', 'g') m
    where c.conrelid='public.cron_route_leases'::regclass and c.conname='cron_route_leases_job_check' and c.contype='c' and c.convalidated;
  if v_jobs is distinct from array['schedule-draft','sevenshifts-sync','toast-catering-scan','toast-sales-today']::text[]
    and v_jobs is distinct from array['catering-inbox-delivery','meta-leads','schedule-draft','sevenshifts-sync','toast-catering-scan','toast-sales-today']::text[] then
    raise exception '0300: cron_route_leases_job_check is neither 0275 four-set nor 0298 six-set union (%)', v_jobs;
  end if;
end $$;
create table public.meta_lead_events (
  leadgen_id text primary key check (leadgen_id ~ '^[0-9]{1,100}$'),
  page_id text not null check (page_id ~ '^[0-9]{1,100}$'),
  form_id text not null check (form_id ~ '^[0-9]{1,100}$'),
  provider_created_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  state text not null check (state in ('disabled','received','processing','retry','created','attached','needs_human')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  lease_id uuid, lease_until timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  error_code text check (error_code in ('configuration','graph_auth','graph_rate_limit','graph_timeout','graph_unavailable','graph_not_found','invalid_payload','database','invalid_location','consent_refused','identity_unresolved','invalid_assignee','ambiguous_leads','closed_lead','attempts_exhausted','email_failed','email_unknown','email_capped')),
  raw_keys text[] not null default '{}' check (cardinality(raw_keys)<=100 and octet_length(raw_keys::text)<=70000),
  customer_id uuid references public.catering_customers(id),
  pipeline_id uuid references public.catering_pipeline(id),
  intake_snapshot jsonb check (jsonb_typeof(intake_snapshot)='object' and octet_length(intake_snapshot::text)<=32768),
  email_sha256 text check (email_sha256 ~ '^[0-9a-f]{64}$'),
  -- sent = a confirmed provider id; failed = the provider refused; unknown = timeout / network /
  -- 5xx / concurrent idempotent request (it MAY have landed); capped = a per-address cap refused the
  -- send before any token was minted; suppressed = allowlist / portal identity / sender config
  -- deliberately off. Every state but sent and not_applicable parks the lead as needs_human (A3).
  email_state text not null default 'pending' check (email_state in ('pending','not_applicable','sent','failed','unknown','capped','suppressed')),
  email_attempted_at timestamptz,
  email_provider_id text check (length(email_provider_id) between 1 and 200),
  portal_token_id uuid,
  completed_at timestamptz,
  check ((lease_id is null)=(lease_until is null)),
  check ((state='processing')=(lease_id is not null)),
  check (portal_token_id is null or intake_snapshot is null),
  check (email_state<>'sent' or (portal_token_id is not null and email_provider_id is not null))
);
-- A9: meta_lead_email_result sets portal_token_id and clears intake_snapshot in ONE update; the
-- CHECK makes the pairing mandatory. A created lead keeps its snapshot only until that result.
create index meta_lead_events_retry on public.meta_lead_events(next_attempt_at) where state in ('received','retry','processing');
create index meta_lead_events_email_cap on public.meta_lead_events(email_sha256,email_attempted_at);

create function public.meta_lead_record(p_leadgen_id text,p_page_id text,p_form_id text,p_created_at timestamptz,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id text;
begin
  insert into public.meta_lead_events(leadgen_id,page_id,form_id,provider_created_at,state)
  values(p_leadgen_id,p_page_id,p_form_id,p_created_at,case when p_enabled is true then 'received' else 'disabled' end)
  on conflict(leadgen_id) do nothing returning leadgen_id into v_id;
  return jsonb_build_object('inserted',v_id is not null);
end $$;

create function public.meta_lead_claim(p_leadgen_id text,p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.meta_lead_events%rowtype;
begin
  if p_lease_id is null then raise exception 'invalid_lease'; end if;
  select * into e from public.meta_lead_events where leadgen_id=p_leadgen_id for update;
  if not found or e.state not in ('received','retry','processing') or e.next_attempt_at>clock_timestamp()
    or e.lease_until>clock_timestamp() then return jsonb_build_object('claimed',false); end if;
  if e.attempts>=5 then
    update public.meta_lead_events set state='needs_human',error_code='attempts_exhausted',lease_id=null,lease_until=null,completed_at=clock_timestamp() where leadgen_id=p_leadgen_id;
    return jsonb_build_object('claimed',false);
  end if;
  update public.meta_lead_events set state='processing',attempts=attempts+1,lease_id=p_lease_id,lease_until=clock_timestamp()+interval '5 minutes' where leadgen_id=p_leadgen_id;
  return jsonb_build_object('claimed',true,'attempts',e.attempts+1,'page_id',e.page_id,'form_id',e.form_id,'provider_created_at',e.provider_created_at);
end $$;

create function public.meta_lead_fail(p_leadgen_id text,p_lease_id uuid,p_error_code text,p_retryable boolean,p_raw_keys text[] default '{}')
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.meta_lead_events%rowtype;
begin
  select * into e from public.meta_lead_events where leadgen_id=p_leadgen_id for update;
  if not found or e.state<>'processing' or e.lease_id is distinct from p_lease_id or e.lease_until<=clock_timestamp() then return false; end if;
  if p_error_code is null then raise exception 'invalid_error_code'; end if;
  update public.meta_lead_events set state=case when p_retryable is true and attempts<5 then 'retry' else 'needs_human' end,
    error_code=p_error_code,raw_keys=p_raw_keys,lease_id=null,lease_until=null,
    next_attempt_at=clock_timestamp()+interval '10 minutes',
    completed_at=case when p_retryable is true and attempts<5 then null else clock_timestamp() end
  where leadgen_id=p_leadgen_id;
  return true;
end $$;

create function public.meta_lead_intake_apply(p_leadgen_id text,p_lease_id uuid,p_customer_id uuid,p_location_id uuid,p_assigned_to uuid,p_intake jsonb,p_raw_keys text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.meta_lead_events%rowtype; v_count integer; v_closed integer; v_pipeline uuid; v_stage text; v_state text; v_error text;
begin
  -- The Meta continuation's draft attach (portal_intake_attach, below) takes this SAME customer lock,
  -- so a continuation and a second Meta lead for one customer serialize. The plain portal intake
  -- (no pipelineId) stays on today's lock-free JS inserts by ruling. Customer resolution is done
  -- first in JS (the existing resolver handles the insert race); no nested identity lock here.
  if p_customer_id is null then raise exception 'invalid_customer'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catering_customer_intake:'||p_customer_id,0));
  select * into e from public.meta_lead_events where leadgen_id=p_leadgen_id for update;
  if not found then raise exception 'not_found'; end if;
  if e.state in ('created','attached','needs_human') then
    return jsonb_build_object('state',e.state,'pipeline_id',e.pipeline_id,'error_code',e.error_code);
  end if;
  if e.state<>'processing' or e.lease_id is distinct from p_lease_id or e.lease_until<=clock_timestamp() then raise exception 'stale_lease'; end if;
  if p_intake is null or jsonb_typeof(p_intake)<>'object' or octet_length(p_intake::text)>32768
    or nullif(btrim(p_intake->>'contact_name'),'') is null or length(p_intake->>'contact_name')>200
    or nullif(btrim(p_intake->>'email'),'') is null then raise exception 'invalid_intake'; end if;
  if not exists(select 1 from public.catering_customers c where c.id=p_customer_id and c.active and lower(btrim(c.email))=lower(btrim(p_intake->>'email'))) then raise exception 'invalid_customer'; end if;
  if p_location_id is null or not exists(select 1 from public.locations where id=p_location_id and active) then raise exception 'invalid_location'; end if;
  if p_assigned_to is not null and not exists(select 1 from public.users where id=p_assigned_to and active and role='catering_mgr') then raise exception 'invalid_assignee'; end if;
  -- Lock candidate parents before counting, so their stage cannot change mid-attach.
  perform 1 from public.catering_pipeline where customer_id=p_customer_id and stage in ('inquiry','quote_sent','confirmed','out') order by id for update;
  select count(*) filter(where stage in ('inquiry','quote_sent')),count(*) filter(where stage in ('confirmed','out'))
    into v_count,v_closed from public.catering_pipeline where customer_id=p_customer_id;
  if v_closed>0 or v_count>1 then
    v_state:='needs_human'; v_error:=case when v_closed>0 then 'closed_lead' else 'ambiguous_leads' end;
  elsif v_count=1 then
    select id,stage into v_pipeline,v_stage from public.catering_pipeline where customer_id=p_customer_id and stage in ('inquiry','quote_sent');
    v_state:='attached';
    insert into public.catering_pipeline_events(pipeline_id,from_stage,to_stage,note)
    values(v_pipeline,v_stage,v_stage,concat_ws(E'\n',
      'Meta lead form '||p_leadgen_id||' - additional submission (no stage change)',
      'Name: '||coalesce(p_intake->>'contact_name','Not provided'),
      'Phone: '||coalesce(p_intake->>'contact_phone','Not provided'),
      'Event date: '||coalesce(p_intake->>'event_date','Not provided'),
      'Headcount: '||coalesce(p_intake->>'headcount','Not provided'),
      'Fulfillment: '||coalesce(p_intake->>'fulfillment','Not provided'),
      'Notes: '||coalesce(p_intake->>'notes','Not provided'),
      -- Double capture (Juan 2026-11-11): the Meta profile address is a secondary contact NOTE,
      -- never an identity. Present only when it differs from the order email.
      'Secondary email (Meta profile): '||nullif(btrim(p_intake->>'secondary_email'),'')));
  else
    v_state:='created';
    insert into public.catering_pipeline(customer_id,contact_name,company,event_date,headcount,contact_phone,stage,lead_source,location_id,assigned_to,notes)
    values(p_customer_id,p_intake->>'contact_name',p_intake->>'company',nullif(p_intake->>'event_date','')::date,
      nullif(p_intake->>'headcount','')::integer,p_intake->>'contact_phone','inquiry','meta_lead_form',p_location_id,p_assigned_to,
      concat_ws(E'\n',p_intake->>'notes','Fulfillment: '||(p_intake->>'fulfillment'),
        'Secondary email (Meta profile): '||nullif(btrim(p_intake->>'secondary_email'),'')))
    returning id into v_pipeline;
    insert into public.catering_pipeline_events(pipeline_id,from_stage,to_stage,note)
    values(v_pipeline,null,'inquiry','Meta lead form '||p_leadgen_id);
  end if;
  update public.meta_lead_events set state=v_state,error_code=v_error,customer_id=p_customer_id,pipeline_id=v_pipeline,
    raw_keys=p_raw_keys,intake_snapshot=case when v_state in ('created','needs_human') then p_intake else null end,
    email_sha256=public.customer_sha256(lower(btrim(p_intake->>'email'))),
    email_state=case when v_state='created' then 'pending' else 'not_applicable' end,
    lease_id=null,lease_until=null,completed_at=clock_timestamp() where leadgen_id=p_leadgen_id;
  return jsonb_build_object('state',v_state,'pipeline_id',v_pipeline,'error_code',v_error);
end $$;

-- Explicit checkbox only. Absent/unticked input NEVER invokes this RPC.
alter table public.customer_consent_events drop constraint customer_consent_events_source_check;
alter table public.customer_consent_events add constraint customer_consent_events_source_check
  check(source in ('toast_marketing_api','toast_csv_import','toast_order','catering_portal','delete_request','retention','meta_lead_form'));
alter table public.customers drop constraint customers_sources_check;
alter table public.customers add constraint customers_sources_check check(sources <@ array['toast_pos','toast_online','toast_app','toast_third_party','catering','ezcater','toast_csv_import','toast_marketing_api','meta_lead_form']::text[]);
alter table public.customer_consent_events add column evidence_ref text, add column text_version text;
create unique index customer_consent_explicit_evidence on public.customer_consent_events(source,evidence_ref) where evidence_ref is not null;
create function public.customer_consent_record_explicit(p_email text,p_channel text,p_source text,p_effective_at timestamptz,p_evidence_ref text,p_text_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_email text:=lower(btrim(p_email)); v_resolved record; v_event public.customer_consent_events%rowtype; v_id uuid;
begin
  perform public.customer_identity_lock();
  if p_channel is distinct from 'email' or p_source is distinct from 'meta_lead_form'
    or p_effective_at is null or p_effective_at>clock_timestamp()+interval '5 minutes'
    or p_evidence_ref is null or p_evidence_ref !~ '^[0-9]{1,100}:[A-Za-z0-9_ -]{1,200}$'
    or p_text_version is distinct from 'meta-email-marketing-v3'
    or v_email is null or length(v_email)>254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'consent_invalid'; end if;
  if public.customer_email_is_relay(v_email) then raise exception 'consent_relay'; end if;
  if exists(select 1 from public.customer_suppressions where kind='email' and value_sha256=public.customer_sha256(v_email)) then raise exception 'consent_suppressed'; end if;
  select * into v_event from public.customer_consent_events where source=p_source and evidence_ref=p_evidence_ref;
  if found then
    if v_event.subject_sha256<>public.customer_sha256(v_email) or v_event.channel<>p_channel or v_event.effective_at<>p_effective_at or v_event.text_version<>p_text_version then raise exception 'consent_evidence_conflict'; end if;
    return jsonb_build_object('event_id',v_event.id,'recorded',false);
  end if;
  select * into v_resolved from public.customer_resolve(v_email,null,null,null,null,null,p_effective_at,p_source,null);
  if v_resolved.customer_id is null or v_resolved.suppressed then raise exception 'consent_suppressed'; end if;
  insert into public.customer_consent_events(customer_id,channel,status,source,subject_sha256,effective_at,evidence_ref,text_version)
  values(v_resolved.customer_id,p_channel,'opted_in',p_source,public.customer_sha256(v_email),p_effective_at,p_evidence_ref,p_text_version) returning id into v_id;
  return jsonb_build_object('event_id',v_id,'recorded',true);
end $$;

-- Build 2, A3 + A6: the ONE continuation email per created lead. The claim runs BEFORE any token is
-- minted or any provider call: it parks the row as needs_human/email_unknown (a crash between claim
-- and result is then an honest unknown, never a silent pending) and refuses a second email to the
-- same address inside 24 h (the per-address cap; the magic_link_email rate limit is applied by the
-- JS sender on top). Nothing here re-mints or resends; the runbook owns the manual requeue.
-- LOCK ORDER (review P2-3): (1) the per-address advisory lock 'meta_lead_email:'||email_sha256,
-- taken from an unlocked read of the hash, THEN (2) the receipt row FOR UPDATE (the hash is
-- re-read under the row lock and must match). Two receipts sharing an address therefore serialize
-- their cap check + attempt stamp; no function holds a receipt row while waiting for an advisory
-- lock (meta_lead_intake_apply takes its customer lock before its row lock too), so no cycle.
-- Offline harness = sequential proof; the two-session proof is CC's sim step.
create function public.meta_lead_email_claim(p_leadgen_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.meta_lead_events%rowtype; v_hash text;
begin
  select email_sha256 into v_hash from public.meta_lead_events where leadgen_id=p_leadgen_id;
  if not found or v_hash is null then return jsonb_build_object('claimed',false,'reason','not_claimable'); end if;
  perform pg_advisory_xact_lock(hashtextextended('meta_lead_email:'||v_hash,0));
  select * into e from public.meta_lead_events where leadgen_id=p_leadgen_id for update;
  if not found or e.state<>'created' or e.email_state<>'pending' or e.pipeline_id is null or e.email_sha256 is distinct from v_hash then
    return jsonb_build_object('claimed',false,'reason','not_claimable');
  end if;
  if exists(select 1 from public.meta_lead_events o
      where o.email_sha256=e.email_sha256 and o.leadgen_id<>e.leadgen_id
        and o.email_attempted_at>clock_timestamp()-interval '24 hours') then
    update public.meta_lead_events set state='needs_human',error_code='email_capped',email_state='capped',
      intake_snapshot=null,completed_at=clock_timestamp() where leadgen_id=p_leadgen_id;
    return jsonb_build_object('claimed',false,'reason','capped');
  end if;
  update public.meta_lead_events set state='needs_human',error_code='email_unknown',email_state='unknown',
    email_attempted_at=clock_timestamp() where leadgen_id=p_leadgen_id;
  return jsonb_build_object('claimed',true,'reason',null);
end $$;

-- The single result write for a claimed send. sent needs the confirmed provider id and the token;
-- unknown keeps the token (the link may have landed); failed/capped/suppressed record why. Every
-- branch clears the intake snapshot in the SAME update that records the token (A9).
create function public.meta_lead_email_result(p_leadgen_id text,p_email_state text,p_portal_token_id uuid,p_provider_id text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.meta_lead_events%rowtype;
begin
  select * into e from public.meta_lead_events where leadgen_id=p_leadgen_id for update;
  if not found or e.state<>'needs_human' or e.email_state<>'unknown' or e.error_code<>'email_unknown' or e.portal_token_id is not null then return false; end if;
  if p_email_state='sent' then
    if p_portal_token_id is null or nullif(btrim(p_provider_id),'') is null then raise exception 'invalid_email_result'; end if;
    update public.meta_lead_events set state='created',error_code=null,email_state='sent',portal_token_id=p_portal_token_id,
      email_provider_id=btrim(p_provider_id),intake_snapshot=null where leadgen_id=p_leadgen_id;
  elsif p_email_state='unknown' then
    update public.meta_lead_events set portal_token_id=p_portal_token_id,intake_snapshot=null,completed_at=clock_timestamp() where leadgen_id=p_leadgen_id;
  elsif p_email_state='failed' then
    update public.meta_lead_events set email_state='failed',error_code='email_failed',portal_token_id=p_portal_token_id,
      intake_snapshot=null,completed_at=clock_timestamp() where leadgen_id=p_leadgen_id;
  elsif p_email_state='capped' then
    update public.meta_lead_events set email_state='capped',error_code='email_capped',email_attempted_at=null,
      intake_snapshot=null,completed_at=clock_timestamp() where leadgen_id=p_leadgen_id;
  elsif p_email_state='suppressed' then
    update public.meta_lead_events set email_state='suppressed',error_code='configuration',email_attempted_at=null,
      intake_snapshot=null,completed_at=clock_timestamp() where leadgen_id=p_leadgen_id;
  else raise exception 'invalid_email_result'; end if;
  return true;
end $$;

-- Build 2, A1: the Meta continuation's ATTACH-ONLY draft writer, called by createDraftFromIntake
-- AFTER email verification when the token carries a pipelineId. Same customer intake lock as
-- meta_lead_intake_apply. The lead must be owned by the customer, in inquiry/quote_sent and carry
-- no live quote — then ONLY the draft quote is inserted on it (a null lead location_id is filled).
-- Anything else answers attached=false and writes NOTHING: the JS caller then runs today's portal
-- create path unchanged (review ruling 2026-11-11: the plain portal path is byte-identical).
create function public.portal_intake_attach(p_customer_id uuid,p_pipeline_id uuid,p_intake jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_lead public.catering_pipeline%rowtype; v_location uuid; v_quote uuid;
begin
  if p_customer_id is null or p_pipeline_id is null then raise exception 'invalid_customer'; end if;
  if p_intake is null or jsonb_typeof(p_intake)<>'object' or octet_length(p_intake::text)>32768
    or nullif(btrim(p_intake->>'contact_name'),'') is null then raise exception 'invalid_intake'; end if;
  v_location:=nullif(p_intake->>'location_id','')::uuid;
  if v_location is null or not exists(select 1 from public.locations where id=v_location and active) then raise exception 'invalid_location'; end if;
  if not exists(select 1 from public.catering_customers where id=p_customer_id and active) then raise exception 'invalid_customer'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catering_customer_intake:'||p_customer_id,0));
  select * into v_lead from public.catering_pipeline where id=p_pipeline_id for update;
  if not found or v_lead.customer_id is distinct from p_customer_id or v_lead.stage not in ('inquiry','quote_sent')
    or exists(select 1 from public.catering_quotes q where q.pipeline_id=v_lead.id and q.superseded_at is null) then
    return jsonb_build_object('attached',false,'quote_id',null,'pipeline_id',null);
  end if;
  if v_lead.location_id is null then
    update public.catering_pipeline set location_id=v_location where id=v_lead.id;
    v_lead.location_id:=v_location;
  end if;
  insert into public.catering_quotes(root_id,version,pipeline_id,customer_id,location_id,status,origin,event_date,headcount,is_delivery,created_by)
  values(null,1,v_lead.id,p_customer_id,v_lead.location_id,'draft','self_serve',
    coalesce(nullif(p_intake->>'event_date','')::date,v_lead.event_date),coalesce(nullif(p_intake->>'headcount','')::integer,v_lead.headcount),
    coalesce((p_intake->>'is_delivery')::boolean,false),null)
  returning id into v_quote;
  return jsonb_build_object('attached',true,'quote_id',v_quote,'pipeline_id',v_lead.id);
end $$;

-- The 0275 house lease body with the 0298/0300 union; neither migration drops the other job.
alter table public.cron_route_leases drop constraint cron_route_leases_job_check,
  add constraint cron_route_leases_job_check check(job in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads'));
create or replace function public.claim_cron_route(p_job text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare claimed text;
begin
  if p_job is null or p_job not in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads') then raise exception 'invalid_cron_route'; end if;
  insert into public.cron_route_leases(job,lease_until) values(p_job,clock_timestamp()+interval '330 seconds')
  on conflict(job) do update set lease_until=clock_timestamp()+interval '330 seconds'
    where cron_route_leases.lease_until<=clock_timestamp() returning job into claimed;
  return claimed is not null;
end $$;

-- 0296 privilege-reset loop + assertions, including inherited PUBLIC grants.
do $$ declare t text; r text; privilege text; f regprocedure; begin
  foreach t in array array['meta_lead_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I on public.%I for delete using(false)',t||'_no_user_delete',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
    execute format('grant select on public.%I to service_role',t);
    foreach r in array array['anon','authenticated','service_role'] loop
      foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        assert has_table_privilege(r,'public.'||t,privilege)=(r='service_role' and privilege='SELECT'),'meta table privilege escape';
      end loop;
    end loop;
    assert not exists(select 1 from pg_class c,lateral aclexplode(c.relacl) a where c.oid=('public.'||t)::regclass and a.grantee=0),'meta PUBLIC table escape';
  end loop;
  foreach f in array array[
    'public.meta_lead_record(text,text,text,timestamptz,boolean)'::regprocedure,
    'public.meta_lead_claim(text,uuid)'::regprocedure,
    'public.meta_lead_fail(text,uuid,text,boolean,text[])'::regprocedure,
    'public.meta_lead_intake_apply(text,uuid,uuid,uuid,uuid,jsonb,text[])'::regprocedure,
    'public.customer_consent_record_explicit(text,text,text,timestamptz,text,text)'::regprocedure,
    'public.meta_lead_email_claim(text)'::regprocedure,
    'public.meta_lead_email_result(text,text,uuid,text)'::regprocedure,
    'public.portal_intake_attach(uuid,uuid,jsonb)'::regprocedure,
    'public.claim_cron_route(text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f);
    execute format('grant execute on function %s to service_role',f);
    assert not has_function_privilege('anon',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE') and has_function_privilege('service_role',f,'EXECUTE'),'meta RPC escape';
    assert not exists(select 1 from pg_proc p,lateral aclexplode(p.proacl) a where p.oid=f and a.grantee=0),'meta PUBLIC RPC escape';
  end loop;
end $$;
commit;
