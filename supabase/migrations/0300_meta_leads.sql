-- 0300 Meta lead intake, build 1. AUTHORED 2026-11-11; NOT APPLIED -- GATE CC/Juan.
-- No database access during authoring. Sim proof and schema check precede any apply.
-- Only leads are created: no quote, portal token or email writer in this build.
-- lead_source is unconstrained text in 0108; its application vocabulary is extended separately.
begin;
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
  error_code text check (error_code in ('configuration','graph_auth','graph_rate_limit','graph_timeout','graph_unavailable','graph_not_found','invalid_payload','database','invalid_location','consent_refused','identity_unresolved','ambiguous_leads','closed_lead','attempts_exhausted')),
  raw_keys text[] not null default '{}' check (cardinality(raw_keys)<=100 and octet_length(raw_keys::text)<=70000),
  customer_id uuid references public.catering_customers(id),
  pipeline_id uuid references public.catering_pipeline(id),
  intake_snapshot jsonb check (jsonb_typeof(intake_snapshot)='object' and octet_length(intake_snapshot::text)<=32768),
  email_sha256 text check (email_sha256 ~ '^[0-9a-f]{64}$'),
  email_state text not null default 'pending' check (email_state in ('pending','not_applicable','sent','failed','unknown')),
  email_attempted_at timestamptz,
  portal_token_id uuid,
  completed_at timestamptz,
  check ((lease_id is null)=(lease_until is null)),
  check ((state='processing')=(lease_id is not null)),
  check (portal_token_id is null or intake_snapshot is null)
);
-- Build 2 must atomically set portal_token_id and clear intake_snapshot; this CHECK
-- makes A9 mandatory. Build 1 retains a newly-created lead's continuation until then.
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
  -- Same customer lock namespace as the portal-intake contract. Customer resolution
  -- is done first in JS; no nested customer identity lock is taken in this RPC.
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
    values(v_pipeline,v_stage,v_stage,'Meta lead form '||p_leadgen_id||': '||coalesce(p_intake->>'notes','')||E'\nSubmitted intake: '||(p_intake-'email')::text);
  else
    v_state:='created';
    insert into public.catering_pipeline(customer_id,contact_name,company,event_date,headcount,contact_phone,stage,lead_source,location_id,assigned_to,notes)
    values(p_customer_id,p_intake->>'contact_name',p_intake->>'company',nullif(p_intake->>'event_date','')::date,
      nullif(p_intake->>'headcount','')::integer,p_intake->>'contact_phone','inquiry','meta_lead_form',p_location_id,p_assigned_to,
      concat_ws(E'\n',p_intake->>'notes','Fulfillment: '||(p_intake->>'fulfillment')))
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
    or p_text_version is distinct from 'meta-email-marketing-v1'
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

-- The 0275 house lease body, adding only the retry backstop identity.
alter table public.cron_route_leases drop constraint cron_route_leases_job_check,
  add constraint cron_route_leases_job_check check(job in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','meta-leads'));
create or replace function public.claim_cron_route(p_job text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare claimed text;
begin
  if p_job is null or p_job not in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','meta-leads') then raise exception 'invalid_cron_route'; end if;
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
    'public.claim_cron_route(text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f);
    execute format('grant execute on function %s to service_role',f);
    assert not has_function_privilege('anon',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE') and has_function_privilege('service_role',f,'EXECUTE'),'meta RPC escape';
    assert not exists(select 1 from pg_proc p,lateral aclexplode(p.proacl) a where p.oid=f and a.grantee=0),'meta PUBLIC RPC escape';
  end loop;
end $$;
commit;
