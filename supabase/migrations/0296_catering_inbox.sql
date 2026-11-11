-- 0296: catering inbox phase 1, round 1 (schema and pure-core contract).
-- AUTHORED 2026-11-11; NOT APPLIED
-- Sources: 0108 customers/pipeline, 0120 quotes, 0148 assignee, 0149 external ref, 0294 transport.
-- CC-cleared plan amended by J1/J2 and A1-A11: attach-only, no delivery or tokens.
-- Apply only after CC's schema verification and sim concurrency proof, then Juan's approval.
-- Lock order: message FOR UPDATE, then its draft rows. No artifact/customer writes.
-- ROLLBACK: revert application integration; preserve all four tables and their history.
-- No delivery exists to disable. Settings remain read-only shadow. A later reviewed
-- migration may retire schema; never drop evidence or reset transport rows wholesale.
-- FOLLOW-UP: body retention/erase policy; no retention writer in this phase.
begin;

create table public.catering_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  inbound_message_id uuid not null unique references public.inbound_messages(id),
  channel text not null default 'email' check (channel in ('email','ezcater','tripleseat','toast','portal')),
  direction text not null default 'inbound' check (direction in ('inbound','outbound')),
  sender_address text check (length(sender_address) <= 254),
  recipient_addresses text[] not null default '{}',
  subject text not null check (length(subject) <= 2000),
  body_text text not null check (octet_length(body_text) <= 262144),
  body_original_bytes integer not null check (body_original_bytes >= 0),
  body_truncated boolean not null,
  body_from_html boolean not null,
  headers jsonb not null default '{}' check (jsonb_typeof(headers) = 'object' and octet_length(headers::text) <= 32768),
  attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 100 and octet_length(attachments::text) <= 65536),
  external_ref text check (length(external_ref) <= 500),
  thread_key text check (length(thread_key) <= 1000),
  received_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  catering_customer_id uuid references public.catering_customers(id),
  lead_id uuid references public.catering_pipeline(id),
  quote_id uuid references public.catering_quotes(id),
  location_id uuid references public.locations(id),
  classification text check (classification in ('intake','troubleshoot_ours','troubleshoot_third_party','platform_notification','noise','unclassified')),
  identity_status text check (identity_status in ('resolved','new_sender','ambiguous','masked','missing')),
  disposition text not null default 'recorded' check (disposition in ('recorded','drafted','needs_human','notification','noise','handled')),
  reason text check (reason in ('thread_followup','identity_unresolved','ambiguous_artifact','urgent','payment_or_edit','conflicting_intent','insufficient_content','quoted_history','own_address','automated_message','solicitation')),
  rule_version text check (length(rule_version) between 1 and 100),
  assigned_to uuid references public.users(id),
  handled_by uuid references public.users(id),
  handled_at timestamptz,
  revision integer not null default 0 check (revision >= 0),
  check (body_original_bytes >= octet_length(body_text)),
  check (body_truncated = (body_original_bytes > octet_length(body_text))),
  check (cardinality(recipient_addresses) <= 100),
  check ((handled_by is null) = (handled_at is null)),
  check ((disposition = 'handled') = (handled_at is not null)),
  check (disposition <> 'needs_human' or reason is not null),
  check (identity_status is null or (identity_status = 'resolved') = (catering_customer_id is not null))
);
create index catering_inbound_thread on public.catering_inbound_messages(thread_key);
create index catering_inbound_queue on public.catering_inbound_messages(assigned_to,disposition,received_at);

create table public.catering_inbox_drafts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.catering_inbound_messages(id),
  kind text not null default 'reply' check (kind = 'reply'),
  language text not null check (language in ('en','es')),
  template_key text not null check (template_key in ('intake','ours','third_party')),
  template_version text not null check (length(template_version) between 1 and 100),
  params jsonb not null check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 8192),
  preview_text text not null check (octet_length(preview_text) between 1 and 32768),
  lead_id uuid references public.catering_pipeline(id),
  quote_id uuid references public.catering_quotes(id),
  created_at timestamptz not null default clock_timestamp()
);
create table public.catering_inbox_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.catering_inbound_messages(id),
  event_type text not null check (event_type in ('ingest','finalize','handle','reassign')),
  actor_id uuid references public.users(id),
  request_id uuid not null unique,
  request_fingerprint text not null,
  before_revision integer,
  after_revision integer not null,
  before_disposition text,
  after_disposition text not null,
  before_assigned_to uuid references public.users(id),
  after_assigned_to uuid references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  check (before_revision is null or after_revision = before_revision + 1),
  check (after_revision >= 0),
  check (before_disposition is null or before_disposition in ('recorded','drafted','needs_human','notification','noise','handled')),
  check (after_disposition in ('recorded','drafted','needs_human','notification','noise','handled'))
);
create table public.catering_inbox_settings (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'shadow' check (mode in ('off','shadow','live'))
);
insert into public.catering_inbox_settings(singleton) values(true);

-- Private read-only authorization helper. Exact roles pin J2 independently of old
-- catering level floors. The null-location exception never applies to a GM.
create function public.catering_inbox_can_access(p_user uuid, p_location uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists(select 1 from public.users u where u.id = p_user and u.active
    and (u.role in ('catering_mgr','moo','owner','cgs') or
      (u.role = 'gm' and p_location is not null and exists
        (select 1 from public.user_locations ul where ul.user_id = u.id
         and ul.location_id = p_location and ul.active))));
$$;

-- Content is immutable after insertion. Explicit JSON keys are a bounded input
-- envelope, not an arbitrary update facility. Replay never replaces evidence.
create function public.record_catering_inbound(
  p_inbound_message_id uuid, p_expected_revision integer, p_request_id uuid, p_content jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_id uuid; v_event public.catering_inbox_events%rowtype; v_pair record;
  v_revision integer := 0; v_disposition text := 'recorded'; v_replayed boolean := false;
  v_fingerprint text := md5(jsonb_build_array(p_inbound_message_id,p_expected_revision,p_content)::text);
begin
  if p_request_id is null or p_expected_revision is distinct from 0 or p_content is null
    or jsonb_typeof(p_content) <> 'object' then raise exception 'invalid_input'; end if;
  select * into v_event from public.catering_inbox_events where request_id=p_request_id;
  if found then
    if v_event.event_type <> 'ingest' or v_event.request_fingerprint <> v_fingerprint then raise exception 'request_conflict'; end if;
    return jsonb_build_object('message_id',v_event.message_id,'revision',v_event.after_revision,'replayed',true);
  end if;
  if exists(select 1 from jsonb_object_keys(p_content) k where k not in
    ('sender_address','recipient_addresses','subject','body_text','body_original_bytes','body_truncated','body_from_html','headers','attachments','external_ref','thread_key','received_at'))
    then raise exception 'invalid_input'; end if;
  if jsonb_typeof(coalesce(p_content->'headers','{}')) <> 'object'
    or jsonb_typeof(coalesce(p_content->'recipient_addresses','[]')) <> 'array'
    then raise exception 'invalid_input'; end if;
  for v_pair in select key,value from jsonb_each(coalesce(p_content->'headers','{}')) loop
    if v_pair.key not in ('message-id','in-reply-to','references','auto-submitted','precedence','list-id','list-unsubscribe','return-path','content-type','x-auto-response-suppress')
      or jsonb_typeof(v_pair.value) <> 'string' or length(v_pair.value #>> '{}') > 2000
      or (v_pair.value #>> '{}') ~ E'[\r\n]' then raise exception 'invalid_headers'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(coalesce(p_content->'recipient_addresses','[]')) a
    where jsonb_typeof(a) <> 'string' or length(a #>> '{}') > 254)
    then raise exception 'invalid_recipients'; end if;
  if jsonb_typeof(coalesce(p_content->'attachments','[]')) <> 'array' then raise exception 'invalid_attachments'; end if;
  for v_pair in select value from jsonb_array_elements(coalesce(p_content->'attachments','[]')) loop
    if jsonb_typeof(v_pair.value) <> 'object' then raise exception 'invalid_attachments'; end if;
    if exists(select 1 from jsonb_object_keys(v_pair.value) k where k not in ('filename','content_type','size','omission_reason'))
      or length(v_pair.value->>'filename') > 255 or length(v_pair.value->>'content_type') > 100
      or (v_pair.value->>'size' is not null and (jsonb_typeof(v_pair.value->'size') <> 'number' or (v_pair.value->>'size')::numeric < 0))
      or (v_pair.value ? 'omission_reason' and v_pair.value->>'omission_reason' not in ('unsupported','too_large','too_many','not_fetched'))
      then raise exception 'invalid_attachments'; end if;
  end loop;
  insert into public.catering_inbound_messages(inbound_message_id,sender_address,recipient_addresses,subject,
    body_text,body_original_bytes,body_truncated,body_from_html,headers,attachments,external_ref,thread_key,received_at)
  values(p_inbound_message_id,p_content->>'sender_address',
    array(select jsonb_array_elements_text(coalesce(p_content->'recipient_addresses','[]'))),p_content->>'subject',
    p_content->>'body_text',(p_content->>'body_original_bytes')::integer,(p_content->>'body_truncated')::boolean,
    (p_content->>'body_from_html')::boolean,coalesce(p_content->'headers','{}'),coalesce(p_content->'attachments','[]'),
    p_content->>'external_ref',p_content->>'thread_key',(p_content->>'received_at')::timestamptz)
  on conflict(inbound_message_id) do nothing returning id into v_id;
  if v_id is null then
    select id,revision,disposition into v_id,v_revision,v_disposition from public.catering_inbound_messages where inbound_message_id=p_inbound_message_id;
    v_replayed := true;
  end if;
  insert into public.catering_inbox_events(message_id,event_type,request_id,request_fingerprint,after_revision,after_disposition)
    values(v_id,'ingest',p_request_id,v_fingerprint,v_revision,v_disposition);
  return jsonb_build_object('message_id',v_id,'revision',v_revision,'replayed',v_replayed);
end;
$$;

create function public.finalize_catering_inbound(
  p_message_id uuid, p_expected_revision integer, p_request_id uuid, p_result jsonb, p_draft jsonb default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare m public.catering_inbound_messages%rowtype; e public.catering_inbox_events%rowtype;
  v_customer uuid := (p_result->>'catering_customer_id')::uuid;
  v_lead uuid := (p_result->>'lead_id')::uuid; v_quote uuid := (p_result->>'quote_id')::uuid;
  v_location uuid := (p_result->>'location_id')::uuid; v_assignee uuid;
  v_email text; v_domain text; v_masked boolean; v_platform text; v_external_link boolean := false;
  v_disposition text := p_result->>'disposition'; v_reason text := p_result->>'reason';
  v_fingerprint text := md5(jsonb_build_array(p_message_id,p_expected_revision,p_result,p_draft)::text);
begin
  select * into m from public.catering_inbound_messages where id=p_message_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_request_id is null or p_expected_revision is null or p_result is null or jsonb_typeof(p_result) <> 'object'
    then raise exception 'invalid_input'; end if;
  select * into e from public.catering_inbox_events where request_id=p_request_id;
  if found then
    if e.message_id <> m.id or e.event_type <> 'finalize' or e.request_fingerprint <> v_fingerprint then raise exception 'request_conflict'; end if;
    return jsonb_build_object('message_id',m.id,'revision',e.after_revision,'replayed',true);
  end if;
  if m.revision <> p_expected_revision then raise exception 'stale_revision'; end if;
  if m.disposition <> 'recorded' then raise exception 'already_finalized'; end if;
  v_email := lower(btrim(m.sender_address)); v_domain := split_part(v_email,'@',2);
  v_platform := case when v_domain ~ '(^|\.)ezcater\.com$' then 'ezcater'
    when v_domain ~ '(^|\.)tripleseat\.com$' then 'tripleseat' else null end;
  -- Defense in depth for the existing classifyEmail relay vocabulary. These are
  -- platform domains, never tenant identities; the pure classifier remains the
  -- language/intent authority. A relay cannot be attached as a direct identity.
  v_masked := coalesce(v_domain ~ '(^|\.)(doordash\.com|ubereats\.com|uber\.com|grubhub\.com|seamless\.com|postmates\.com|caviar\.com|ezcater\.com|marketplace\.amazon\.com|toasttab\.com)$'
    or v_domain ~ '(^|\.)(relay|masked|anonymi[sz]ed|proxy)\.'
    or split_part(v_email,'@',1) ~ '^(dd\.toast\.orders(\+|$)|(relay|masked)[+.-])',false);
  if exists(select 1 from jsonb_object_keys(p_result) k where k not in
    ('classification','identity_status','catering_customer_id','lead_id','quote_id','location_id','disposition','reason','rule_version'))
    or p_result->>'classification' is null or p_result->>'identity_status' is null
    or p_result->>'rule_version' is null or v_disposition is null
    or v_disposition not in ('drafted','needs_human','notification','noise') then raise exception 'invalid_input'; end if;
  -- Attach-only identity: an active, unique literal email match. No pattern matching,
  -- create, revive, profile-store read or profile-store write exists in this function.
  if v_customer is not null and (v_masked or v_platform is not null or p_result->>'identity_status' <> 'resolved' or not exists
    (select 1 from public.catering_customers c where c.id=v_customer and c.active
      and lower(btrim(c.email))=lower(btrim(m.sender_address))) or
    (select count(*) from public.catering_customers c where lower(btrim(c.email))=lower(btrim(m.sender_address))) <> 1)
    then raise exception 'identity_mismatch'; end if;
  if v_lead is not null then
    -- Platform mail may attach a proven external order without fabricating a
    -- direct sender identity. The external reference AND platform must agree.
    v_external_link := v_customer is null and v_platform is not null and p_result->>'classification'='platform_notification'
      and exists(select 1 from public.catering_pipeline p where p.id=v_lead
        and p.external_ref=m.external_ref and p.lead_source=v_platform
        and p.location_id is not distinct from v_location);
    select p.assigned_to into v_assignee from public.catering_pipeline p where p.id=v_lead
      and (p.customer_id is not distinct from v_customer or v_external_link) and p.location_id is not distinct from v_location;
    if not found or (v_customer is null and not v_external_link) then raise exception 'artifact_mismatch'; end if;
  end if;
  if v_quote is not null and ((v_customer is null and not v_external_link) or not exists
    (select 1 from public.catering_quotes q where q.id=v_quote and (q.customer_id=v_customer or
      (v_external_link and q.customer_id is not distinct from (select p.customer_id from public.catering_pipeline p where p.id=v_lead)))
      and q.pipeline_id is not distinct from v_lead and q.location_id is not distinct from v_location
      and q.superseded_at is null)) then raise exception 'artifact_mismatch'; end if;
  -- Snapshot the lead's eligible assignee; otherwise A1.3 scoped manager, global
  -- manager, null. A retired/ineligible lead assignee must not enter this queue.
  if v_assignee is not null and not public.catering_inbox_can_access(v_assignee,v_location) then v_assignee := null; end if;
  if v_assignee is null then
    select u.id into v_assignee from public.users u where u.active and u.role='catering_mgr'
    order by exists(select 1 from public.user_locations ul where ul.user_id=u.id and ul.location_id=v_location and ul.active) desc,
      u.created_at,u.id limit 1;
  end if;
  -- Derive followup from immutable evidence, never trust the classifier's boolean.
  if nullif(btrim(m.headers->>'in-reply-to'),'') is not null or nullif(btrim(m.headers->>'references'),'') is not null
    or m.subject ~* '^\s*(re|fw|fwd|rv)\s*:' then
    v_disposition := 'needs_human'; v_reason := 'thread_followup'; p_draft := null;
  end if;
  if v_disposition='drafted' then
    if p_draft is null or jsonb_typeof(p_draft) <> 'object' or v_reason is not null
      or v_masked or v_platform is not null
      or v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      or p_result->>'classification' not in ('intake','troubleshoot_ours','troubleshoot_third_party')
      or p_result->>'identity_status' not in ('resolved','new_sender')
      or (p_result->>'classification'='troubleshoot_ours' and (v_customer is null or (v_lead is null and v_quote is null)))
      then raise exception 'draft_ineligible'; end if;
    if exists(select 1 from jsonb_object_keys(p_draft) k where k not in ('language','template_key','template_version','params','preview_text'))
      or p_draft->>'template_key' is distinct from (case p_result->>'classification'
        when 'intake' then 'intake' when 'troubleshoot_ours' then 'ours' else 'third_party' end)
      then raise exception 'invalid_draft'; end if;
    if jsonb_typeof(p_draft->'params') is distinct from 'object' then raise exception 'invalid_draft'; end if;
    if exists(select 1 from jsonb_each(p_draft->'params') kv where kv.key not in ('portalUrl','tenantName','channel','status') or jsonb_typeof(kv.value)<>'string')
      or not (p_draft->'params' ?& array['portalUrl','tenantName','channel','status'])
      or p_draft->'params'->>'portalUrl' !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/order(/start)?/?$'
      or length(p_draft->'params'->>'tenantName') not between 1 and 120
      or p_draft->'params'->>'channel' not in ('ezCater','Tripleseat','Toast','provider')
      or p_draft->'params'->>'status' not in ('received','reviewing','scheduled','on_the_way','closed')
      then raise exception 'invalid_draft'; end if;
  elsif p_draft is not null then raise exception 'draft_ineligible'; end if;
  if (v_disposition='notification' and p_result->>'classification'<>'platform_notification')
    or (v_disposition='noise' and p_result->>'classification'<>'noise') then raise exception 'invalid_disposition'; end if;
  update public.catering_inbound_messages set catering_customer_id=v_customer,lead_id=v_lead,quote_id=v_quote,
    location_id=v_location,classification=p_result->>'classification',identity_status=p_result->>'identity_status',
    disposition=v_disposition,reason=v_reason,rule_version=p_result->>'rule_version',assigned_to=v_assignee,revision=revision+1 where id=m.id;
  if p_draft is not null then
    insert into public.catering_inbox_drafts(message_id,language,template_key,template_version,params,preview_text,lead_id,quote_id)
    values(m.id,p_draft->>'language',p_draft->>'template_key',p_draft->>'template_version',p_draft->'params',p_draft->>'preview_text',v_lead,v_quote);
  end if;
  insert into public.catering_inbox_events(message_id,event_type,request_id,request_fingerprint,before_revision,after_revision,
    before_disposition,after_disposition,before_assigned_to,after_assigned_to)
  values(m.id,'finalize',p_request_id,v_fingerprint,m.revision,m.revision+1,m.disposition,v_disposition,m.assigned_to,v_assignee);
  return jsonb_build_object('message_id',m.id,'revision',m.revision+1,'replayed',false);
end;
$$;

create function public.act_on_catering_inbox(
  p_message_id uuid, p_expected_revision integer, p_request_id uuid, p_actor_id uuid,
  p_session_id uuid, p_action text, p_assigned_to uuid default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare m public.catering_inbound_messages%rowtype; e public.catering_inbox_events%rowtype;
  v_disposition text; v_assignee uuid;
  v_fingerprint text := md5(jsonb_build_array(p_message_id,p_expected_revision,p_actor_id,p_session_id,p_action,p_assigned_to)::text);
begin
  select * into m from public.catering_inbound_messages where id=p_message_id for update;
  if not found then raise exception 'not_found'; end if;
  -- Evaluate session expiry after the parent lock. No step-up tier in this phase.
  if not public.catering_inbox_can_access(p_actor_id,m.location_id) or not exists
    (select 1 from public.sessions s where s.id=p_session_id and s.user_id=p_actor_id
      and s.revoked_at is null and s.expires_at > clock_timestamp()) then raise exception 'forbidden'; end if;
  if p_request_id is null or p_expected_revision is null or p_action is null or p_action not in ('handle','reassign')
    or (p_action='handle' and p_assigned_to is not null) then raise exception 'invalid_input'; end if;
  select * into e from public.catering_inbox_events where request_id=p_request_id;
  if found then
    if e.message_id<>m.id or e.event_type<>p_action or e.request_fingerprint<>v_fingerprint then raise exception 'request_conflict'; end if;
    return jsonb_build_object('message_id',m.id,'revision',e.after_revision,'replayed',true);
  end if;
  if m.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
  if m.disposition in ('recorded','handled') then raise exception 'invalid_state'; end if;
  if p_action='reassign' and p_assigned_to is not null and not public.catering_inbox_can_access(p_assigned_to,m.location_id)
    then raise exception 'invalid_assignee'; end if;
  v_disposition := case when p_action='handle' then 'handled' else m.disposition end;
  v_assignee := case when p_action='reassign' then p_assigned_to else m.assigned_to end;
  update public.catering_inbound_messages set disposition=v_disposition,assigned_to=v_assignee,revision=revision+1,
    handled_by=case when p_action='handle' then p_actor_id else handled_by end,
    handled_at=case when p_action='handle' then clock_timestamp() else handled_at end where id=m.id;
  -- Drafts remain immutable evidence; the handled parent excludes them from the
  -- draft queue. This phase has no delivery state or send path to cancel.
  insert into public.catering_inbox_events(message_id,event_type,actor_id,request_id,request_fingerprint,before_revision,after_revision,
    before_disposition,after_disposition,before_assigned_to,after_assigned_to)
  values(m.id,p_action,p_actor_id,p_request_id,v_fingerprint,m.revision,m.revision+1,m.disposition,v_disposition,m.assigned_to,v_assignee);
  return jsonb_build_object('message_id',m.id,'revision',m.revision+1,'replayed',false);
end;
$$;

-- Reset Supabase's permissive defaults, including service_role direct writes.
do $$
declare t text; r text; privilege text; f regprocedure; allowed boolean;
begin
  foreach t in array array['catering_inbound_messages','catering_inbox_drafts','catering_inbox_events','catering_inbox_settings'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I on public.%I for delete using (false)',t||'_no_user_delete',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
    execute format('grant select on public.%I to service_role',t);
    foreach r in array array['anon','authenticated','service_role'] loop
      foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        allowed := has_table_privilege(r,'public.'||t,privilege);
        assert allowed = (r='service_role' and privilege='SELECT'), 'inbox table privilege escape';
      end loop;
    end loop;
    assert not exists(select 1 from pg_class c, lateral aclexplode(c.relacl) a
      where c.oid=('public.'||t)::regclass and a.grantee=0), 'inbox PUBLIC table escape';
  end loop;
  foreach f in array array[
    'public.catering_inbox_can_access(uuid,uuid)'::regprocedure,
    'public.record_catering_inbound(uuid,integer,uuid,jsonb)'::regprocedure,
    'public.finalize_catering_inbound(uuid,integer,uuid,jsonb,jsonb)'::regprocedure,
    'public.act_on_catering_inbox(uuid,integer,uuid,uuid,uuid,text,uuid)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f);
    if f <> 'public.catering_inbox_can_access(uuid,uuid)'::regprocedure then
      execute format('grant execute on function %s to service_role',f);
    end if;
    assert not has_function_privilege('anon',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE'), 'inbox RPC escape';
    assert has_function_privilege('service_role',f,'EXECUTE') = (f <> 'public.catering_inbox_can_access(uuid,uuid)'::regprocedure), 'inbox helper escape';
    assert not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid=f and a.grantee=0), 'inbox PUBLIC RPC escape';
  end loop;
end;
$$;
commit;
