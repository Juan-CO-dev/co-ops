-- 0297: vendor mail ledger, archive and human action contracts.
-- MERGE GATE: apply + verify 0297 in prod first; this code stores application/json assets and writes 0297 columns
-- AUTHORED 2026-11-11. NOT APPLIED. CC review + sim proof, then Juan's approval.
-- Sources: 0170 receipts, 0294 transport, 0296 session/replay/ACL pattern.
-- No new bucket, storage policies, sends, recovery jobs or production data operation.
-- 40 MiB fallback: receiving ceiling could not be verified in provider docs.
-- Lock order for human actions: inbound parent, then receipt. Machine receipt
-- triggers append observations without taking an inbound parent lock.
-- Rollback: revert app; retain all evidence and schema. Never delete history.
begin;
update storage.buckets set allowed_mime_types=null, file_size_limit=41943040 where id='receipts' and public=false;
do $$ begin
  assert (select count(*) from storage.buckets where id='receipts' and public=false
    and allowed_mime_types is null and file_size_limit=41943040)=1,
    'vendor mail requires exactly one private receipts bucket with the archive limits';
end $$;

create sequence public.vendor_mail_reference_seq;
revoke all on sequence public.vendor_mail_reference_seq from public,anon,authenticated,service_role;
alter table public.inbound_messages
  add column reference_code text unique,
  add column revision integer not null default 0 check(revision>=0),
  add column handled_by uuid references public.users(id),
  add column handled_at timestamptz,
  add column handled_reason text check(length(btrim(handled_reason)) between 1 and 2000),
  add column manual_location_id uuid references public.locations(id),
  add column manual_vendor_id uuid references public.vendors(id),
  add column attachment_manifest jsonb not null default '[]' check(jsonb_typeof(attachment_manifest)='array'),
  add column archive_state text not null default 'pending' check(archive_state in ('pending','complete','incomplete')),
  add column archive_error text check(archive_error in ('size','unavailable')),
  add constraint vendor_mail_handled_pair check((handled_by is null)=(handled_at is null) and (handled_at is null)=(handled_reason is null));
-- Only vendor rows require references. Catering/noise remain outside this ledger.
do $$ declare m record; begin
  for m in select id from public.inbound_messages where lane='vendor_receipt' order by received_at,id loop
    update public.inbound_messages set reference_code='VM-'||nextval('public.vendor_mail_reference_seq') where id=m.id;
  end loop;
end $$;
alter table public.inbound_messages add constraint vendor_mail_reference_required
  check(lane <> 'vendor_receipt' or reference_code is not null);
create index vendor_mail_receipt_link on public.inbound_messages(email_receipt_id) where lane='vendor_receipt';

create table public.vendor_mail_events (
  id uuid primary key default gen_random_uuid(),
  inbound_message_id uuid not null references public.inbound_messages(id),
  event_type text not null check(event_type in ('baseline','received','transport','receipt','handle','assign','redrive','forward_claim','forward_result')),
  actor_id uuid references public.users(id), -- NULL = System
  request_id uuid unique,
  payload_fingerprint text,
  revision integer not null check(revision>=0),
  data jsonb not null default '{}' check(jsonb_typeof(data)='object' and octet_length(data::text)<=262144),
  created_at timestamptz not null default clock_timestamp(),
  check((request_id is null)=(payload_fingerprint is null)),
  check((event_type in ('handle','assign','redrive','forward_claim','forward_result'))=(actor_id is not null))
);
create index vendor_mail_events_message on public.vendor_mail_events(inbound_message_id,created_at,id);
create unique index vendor_mail_forward_one_result on public.vendor_mail_events((data->>'claim_request_id')) where event_type='forward_result';
insert into public.vendor_mail_events(inbound_message_id,event_type,revision,data)
select id,'baseline',revision,jsonb_build_object('historical_baseline',true,'content_state',content_state,'last_error',last_error,'email_receipt_id',email_receipt_id)
from public.inbound_messages where lane='vendor_receipt';

create function public.vendor_mail_reference() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
  if TG_OP='INSERT' then
    new.reference_code:=null; new.revision:=0; new.handled_by:=null;
    new.handled_at:=null; new.handled_reason:=null;
    new.manual_location_id:=null; new.manual_vendor_id:=null;
  end if;
  if TG_OP='UPDATE' and old.reference_code is not null then new.reference_code:=old.reference_code; end if;
  if new.lane='vendor_receipt' and new.reference_code is null then
    new.reference_code:='VM-'||nextval('public.vendor_mail_reference_seq');
  end if;
  return new;
end $$;
create trigger vendor_mail_reference before insert or update on public.inbound_messages
for each row execute function public.vendor_mail_reference();

-- A transport-only manual assignment must survive the later receipt INSERT.
-- Active worker leases prevent human assignment while ingest is in flight.
create function public.vendor_mail_receipt_override() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.inbound_messages%rowtype;
begin
 select * into m from public.inbound_messages where id=new.inbound_message_id and lane='vendor_receipt';
 if found and (m.manual_location_id is not null or m.manual_vendor_id is not null) then
   new.location_id:=coalesce(m.manual_location_id,new.location_id);
   new.vendor_guess_id:=coalesce(m.manual_vendor_id,new.vendor_guess_id);
   new.attributed_by:='manual'; new.attribution_conflict:=false;
 end if;
 return new;
end $$;
create trigger vendor_mail_receipt_override before insert on public.email_receipts
for each row execute function public.vendor_mail_receipt_override();

create function public.vendor_mail_transport_event() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare before_data jsonb; after_data jsonb;
begin
  if new.lane<>'vendor_receipt' and (TG_OP='INSERT' or old.lane<>'vendor_receipt') then return new; end if;
  -- Catering is never recorded, even if a mistaken vendor route is corrected.
  if new.lane='catering' then return new; end if;
  after_data:=jsonb_build_object('content_state',new.content_state,'last_error',new.last_error,'lane',new.lane,'location_id',new.location_id,'email_receipt_id',new.email_receipt_id);
  if TG_OP='UPDATE' then
    before_data:=jsonb_build_object('content_state',old.content_state,'last_error',old.last_error,'lane',old.lane,'location_id',old.location_id,'email_receipt_id',old.email_receipt_id);
    if before_data=after_data then return new; end if;
  end if;
  insert into public.vendor_mail_events(inbound_message_id,event_type,revision,data)
  values(new.id,case when TG_OP='INSERT' then 'received' else 'transport' end,new.revision,jsonb_build_object('before',before_data,'after',after_data));
  return new;
end $$;
create trigger vendor_mail_transport_event after insert or update on public.inbound_messages
for each row execute function public.vendor_mail_transport_event();

create function public.vendor_mail_receipt_event() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m record; before_data jsonb; after_data jsonb;
begin
  after_data:=jsonb_build_object('parse_state',new.parse_state,'location_id',new.location_id,'linked_po_id',new.linked_po_id,'linked_delivery_id',new.linked_delivery_id,'attribution_conflict',new.attribution_conflict);
  if TG_OP='UPDATE' then
    before_data:=jsonb_build_object('parse_state',old.parse_state,'location_id',old.location_id,'linked_po_id',old.linked_po_id,'linked_delivery_id',old.linked_delivery_id,'attribution_conflict',old.attribution_conflict);
    if before_data=after_data then return new; end if;
  end if;
  for m in select id,revision from public.inbound_messages where lane='vendor_receipt'
    and (id=new.inbound_message_id or email_receipt_id=new.id) loop
    insert into public.vendor_mail_events(inbound_message_id,event_type,revision,data)
    values(m.id,'receipt',m.revision,jsonb_build_object('receipt_id',new.id,'before',before_data,'after',after_data));
  end loop;
  return new;
end $$;
create trigger vendor_mail_receipt_event after insert or update on public.email_receipts
for each row execute function public.vendor_mail_receipt_event();

create view public.vendor_mail_read with (security_invoker=true) as
select m.*,
 case when r.id is not null then r.location_id else coalesce(m.manual_location_id,m.location_id) end as effective_location_id,
 case when r.id is not null then r.vendor_guess_id else m.manual_vendor_id end as effective_vendor_id,
 case when r.id is not null then to_jsonb(r) else null end as receipt,
 case when m.handled_at is not null then 'handled'
      when r.linked_delivery_id is not null then 'matched_delivery'
      when r.linked_po_id is not null then 'matched_po'
      when m.content_state='failed' or r.parse_state='failed' then 'failed'
      when m.content_state='blocked_config' or coalesce(r.attribution_conflict,false) then 'needs_person'
      when r.parse_state='parsed' then 'parsed'
      when m.content_state='fetched' then 'fetched' else 'received' end as display_status,
 (m.handled_at is null and r.linked_po_id is null and r.linked_delivery_id is null
   and m.received_at < statement_timestamp() - interval '24 hours') as is_stale,
 concat_ws(' ',m.subject,m.from_address,m.reference_code,r.parsed_json #>> '{extraction,invoiceNumber}',
   case when jsonb_typeof(r.parsed_json #> '{extraction,totalCents}')='number'
     and (r.parsed_json #>> '{extraction,totalCents}') ~ '^[0-9]{1,15}$'
     then ((r.parsed_json #>> '{extraction,totalCents}')::numeric / 100)::numeric(18,2)::text else null end) as search_text
from public.inbound_messages m left join public.email_receipts r on r.id=m.email_receipt_id
where m.lane='vendor_receipt';

create function public.vendor_mail_can_access(p_user uuid,p_location uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
select exists(select 1 from public.users u where u.id=p_user and u.active and
 (u.role in ('moo','owner','cgs') or (u.role='gm' and p_location is not null and exists
 (select 1 from public.user_locations ul where ul.user_id=u.id and ul.location_id=p_location and ul.active))));
$$;

-- Private shared engine. Wrappers below are the only executable entry points.
create function public.vendor_mail_mutate(p_message_id uuid,p_expected_revision integer,p_request_id uuid,
 p_actor_id uuid,p_session_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.inbound_messages%rowtype; r public.email_receipts%rowtype; e public.vendor_mail_events%rowtype;
 claim public.vendor_mail_events%rowtype; loc uuid; dest uuid; vendor uuid;
 fingerprint text:=md5(jsonb_build_array(p_message_id,p_expected_revision,p_actor_id,p_session_id,p_action,p_payload)::text);
begin
 select * into m from public.inbound_messages where id=p_message_id and lane='vendor_receipt' for update;
 if not found then raise exception 'not_found'; end if;
 if m.email_receipt_id is not null then select * into r from public.email_receipts where id=m.email_receipt_id for update; end if;
 loc:=case when r.id is not null then r.location_id else coalesce(m.manual_location_id,m.location_id) end;
 if not public.vendor_mail_can_access(p_actor_id,loc) or not exists(select 1 from public.sessions s
   where s.id=p_session_id and s.user_id=p_actor_id and s.revoked_at is null and s.expires_at>clock_timestamp()) then raise exception 'forbidden'; end if;
 if p_request_id is null or p_expected_revision is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
   or p_action is null or p_action not in ('handle','assign','redrive','forward_claim','forward_result') then raise exception 'invalid_input'; end if;
 select * into e from public.vendor_mail_events where request_id=p_request_id;
 if found then
   if e.inbound_message_id<>m.id or e.event_type<>p_action or e.payload_fingerprint<>fingerprint then raise exception 'request_conflict'; end if;
   return jsonb_build_object('message_id',m.id,'revision',e.revision,'request_id',p_request_id,'replayed',true,'data',e.data);
 end if;
 if m.revision<>p_expected_revision then raise exception 'stale_revision'; end if;
 if p_action='handle' then
   if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'reason') or jsonb_typeof(p_payload->'reason') is distinct from 'string'
     or length(btrim(p_payload->>'reason')) not between 1 and 2000 then raise exception 'invalid_input'; end if;
   if m.handled_at is not null then raise exception 'invalid_state'; end if;
   update public.inbound_messages set handled_by=p_actor_id,handled_at=clock_timestamp(),handled_reason=btrim(p_payload->>'reason') where id=m.id;
 elsif p_action='assign' then
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('location_id','vendor_id')) or not (p_payload ? 'location_id' or p_payload ? 'vendor_id') then raise exception 'invalid_input'; end if;
   if exists(select 1 from jsonb_each(p_payload) kv where kv.value<>'null'::jsonb and
     (jsonb_typeof(kv.value)<>'string' or (kv.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then raise exception 'invalid_input'; end if;
   dest:=case when p_payload ? 'location_id' then (p_payload->>'location_id')::uuid else loc end;
   vendor:=case when p_payload ? 'vendor_id' then (p_payload->>'vendor_id')::uuid when r.id is not null then r.vendor_guess_id else m.manual_vendor_id end;
   if not public.vendor_mail_can_access(p_actor_id,dest) then raise exception 'forbidden'; end if;
   if dest is not null and not exists(select 1 from public.locations where id=dest and active) then raise exception 'invalid_location'; end if;
   if vendor is not null and not exists(select 1 from public.vendors where id=vendor and active) then raise exception 'invalid_vendor'; end if;
   if m.lease_token is not null and m.next_attempt_at > clock_timestamp() then raise exception 'worker_busy'; end if;
   if r.linked_po_id is not null or r.linked_delivery_id is not null then raise exception 'linked_evidence'; end if;
   -- This is unattributed assignment, not a cross-shop conflict-move bypass.
   if loc is not null and dest is distinct from loc then raise exception 'already_attributed'; end if;
   if r.id is not null then
     update public.email_receipts set location_id=dest,vendor_guess_id=vendor,attributed_by='manual',attribution_conflict=false where id=r.id;
   end if;
   update public.inbound_messages set manual_location_id=dest,manual_vendor_id=vendor where id=m.id;
 elsif p_action='redrive' then
   if p_payload<>'{}'::jsonb then raise exception 'invalid_input'; end if;
   if m.lease_token is not null and m.next_attempt_at > clock_timestamp() then raise exception 'worker_busy'; end if;
   if m.content_state not in ('failed','blocked_config') then raise exception 'invalid_state'; end if;
   update public.inbound_messages set content_state='pending',fetch_attempts=0,next_attempt_at=clock_timestamp(),last_error=null,lease_token=null where id=m.id;
 elsif p_action='forward_claim' then
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('recipient','sender','note','body','attachments'))
     or jsonb_typeof(p_payload->'recipient') is distinct from 'string' or jsonb_typeof(p_payload->'sender') is distinct from 'string'
     or p_payload->>'recipient' !~ '^[^@[:space:]<>,;]+@[^@[:space:]<>,;]+\.[^@[:space:]<>,;]+$'
     or p_payload->>'sender' !~ '^[^@[:space:]<>,;]+@[^@[:space:]<>,;]+\.[^@[:space:]<>,;]+$'
     or length(p_payload->>'recipient')>254 or length(p_payload->>'sender')>254
     or jsonb_typeof(p_payload->'note') is distinct from 'string' or length(p_payload->>'note')>4000
     or jsonb_typeof(p_payload->'body') is distinct from 'string' or octet_length(p_payload->>'body')>131072
     or jsonb_typeof(p_payload->'attachments') is distinct from 'array' then raise exception 'invalid_input'; end if;
   if jsonb_array_length(p_payload->'attachments')>25 or octet_length(p_payload::text)>200000 then raise exception 'invalid_input'; end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'attachments') a where jsonb_typeof(a)<>'object'
     or jsonb_typeof(a->'sha256') is distinct from 'string' or a->>'sha256' !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(a->'path') is distinct from 'string' or length(a->>'path') not between 1 and 1000
     or jsonb_typeof(a->'filename') is distinct from 'string' or length(a->>'filename') not between 1 and 255
     or exists(select 1 from jsonb_object_keys(a) k where k not in ('path','filename','sha256'))) then raise exception 'invalid_input'; end if;
 elsif p_action='forward_result' then
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('claim_request_id','outcome','provider_id','error'))
     or p_payload->>'outcome' is null or p_payload->>'outcome' not in ('accepted','failed','unknown')
     or jsonb_typeof(p_payload->'claim_request_id') is distinct from 'string'
     or p_payload->>'claim_request_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_input'; end if;
   select * into claim from public.vendor_mail_events where request_id=(p_payload->>'claim_request_id')::uuid
     and event_type='forward_claim' and inbound_message_id=m.id and actor_id=p_actor_id;
   if not found then raise exception 'invalid_claim'; end if;
   -- UUID input is case-insensitive; the durable unique JSON key must be canonical.
   p_payload:=jsonb_set(p_payload,'{claim_request_id}',to_jsonb(claim.request_id::text));
   if exists(select 1 from public.vendor_mail_events where event_type='forward_result' and data->>'claim_request_id'=claim.request_id::text) then raise exception 'already_resulted'; end if;
   if p_payload->>'outcome'='accepted' and (jsonb_typeof(p_payload->'provider_id') is distinct from 'string' or coalesce(length(p_payload->>'provider_id'),0) not between 1 and 200 or p_payload->>'error' is not null)
     or p_payload->>'outcome'<>'accepted' and (p_payload->>'provider_id' is not null or p_payload->>'error' is null or p_payload->>'error' not in ('provider_error','timeout','unknown')) then raise exception 'invalid_input'; end if;
 end if;
 update public.inbound_messages set revision=revision+1 where id=m.id;
 insert into public.vendor_mail_events(inbound_message_id,event_type,actor_id,request_id,payload_fingerprint,revision,data)
 values(m.id,p_action,p_actor_id,p_request_id,fingerprint,m.revision+1,p_payload);
 return jsonb_build_object('message_id',m.id,'revision',m.revision+1,'request_id',p_request_id,'replayed',false,'data',p_payload);
end $$;

create function public.vendor_mail_act(p_message_id uuid,p_expected_revision integer,p_request_id uuid,p_actor_id uuid,p_session_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if p_action is null or p_action not in ('handle','assign','redrive') then raise exception 'invalid_input'; end if;
 return public.vendor_mail_mutate(p_message_id,p_expected_revision,p_request_id,p_actor_id,p_session_id,p_action,p_payload);
end $$;
create function public.vendor_mail_forward_claim(p_message_id uuid,p_expected_revision integer,p_request_id uuid,p_actor_id uuid,p_session_id uuid,p_payload jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select public.vendor_mail_mutate(p_message_id,p_expected_revision,p_request_id,p_actor_id,p_session_id,'forward_claim',p_payload);
$$;
create function public.vendor_mail_forward_result(p_message_id uuid,p_expected_revision integer,p_request_id uuid,p_actor_id uuid,p_session_id uuid,p_payload jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select public.vendor_mail_mutate(p_message_id,p_expected_revision,p_request_id,p_actor_id,p_session_id,'forward_result',p_payload);
$$;

grant update(attachment_manifest,archive_state,archive_error) on public.inbound_messages to service_role;
-- SELECT-only evidence and projection, including default ACL assertions.
alter table public.vendor_mail_events enable row level security;
create policy vendor_mail_events_no_user_delete on public.vendor_mail_events for delete using(false);
do $$ declare t text; r text; privilege text; f regprocedure; executable boolean; begin
 foreach t in array array['vendor_mail_events','vendor_mail_read'] loop
   execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
   execute format('grant select on public.%I to service_role',t);
   foreach r in array array['anon','authenticated','service_role'] loop
     foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
       assert has_table_privilege(r,'public.'||t,privilege)=(r='service_role' and privilege='SELECT'),'vendor mail table privilege escape';
     end loop;
   end loop;
   assert not exists(select 1 from pg_class c,lateral aclexplode(c.relacl) a where c.oid=('public.'||t)::regclass and a.grantee=0),'vendor mail PUBLIC escape';
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
 ('vendor_mail_reference','vendor_mail_receipt_override','vendor_mail_transport_event','vendor_mail_receipt_event','vendor_mail_can_access','vendor_mail_mutate','vendor_mail_act','vendor_mail_forward_claim','vendor_mail_forward_result') loop
   executable:=split_part(f::text,'(',1) in ('vendor_mail_act','vendor_mail_forward_claim','vendor_mail_forward_result','public.vendor_mail_act','public.vendor_mail_forward_claim','public.vendor_mail_forward_result');
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
   if executable then execute format('grant execute on function %s to service_role',f); end if;
   assert not has_function_privilege('anon',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE'),'vendor mail RPC escape';
   assert has_function_privilege('service_role',f,'EXECUTE')=executable,'vendor mail helper escape';
   assert not exists(select 1 from pg_proc p,lateral aclexplode(p.proacl) a where p.oid=f and a.grantee=0),'vendor mail PUBLIC RPC escape';
 end loop;
end $$;
commit;
