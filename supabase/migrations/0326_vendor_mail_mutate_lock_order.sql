-- Migration 0326_vendor_mail_mutate_lock_order
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).
-- Provenance: CO-OPS bug audit wave W20, bug B196 (found at 7494f738): "Receipt event insertion can deadlock
--   vendor mail actions".
--
-- WHAT: vendor_mail_mutate is RE-EMITTED from 0299 (the only migration whose body is live; 0299 itself re-emitted
--   0297's). The body is byte-identical to 0299 except ONE lock clause, on the first statement:
--       select * into m from public.inbound_messages where id=p_message_id and lane='vendor_receipt'
--         for update;            -- 0297 / 0299
--         for no key update;     -- 0326
--   tests/vendor-mail-mutate-lock-migration.test.ts pins that as the only difference.
--
-- WHY (the deadlock): a human action (handle / assign / redrive / forward) locked the inbound message M
--   FOR UPDATE, then its receipt R FOR UPDATE. The parser (and every other machine writer of email_receipts)
--   runs an autocommit UPDATE of R; its AFTER trigger vendor_mail_receipt_event (0297) inserts a
--   vendor_mail_events row, whose foreign key to inbound_messages takes FOR KEY SHARE on M. FOR KEY SHARE
--   conflicts with FOR UPDATE, so: the action holds M and waits for R, the parser holds R and waits for M, and
--   Postgres aborts one of them after deadlock_timeout (40P01). The person saw 503 vendor_mail_unavailable, or
--   the parse write failed and the receipt was recorded as a write_error.
--   FOR NO KEY UPDATE does not conflict with FOR KEY SHARE. It is the lock a plain UPDATE of non-key columns
--   takes anyway, and this function never changes inbound_messages.id (its own UPDATEs of M set revision,
--   handled_*, manual_*, content_state ... : none is a key column). Every OTHER writer of M (the transport
--   worker's lease and content_state updates, a second human action) still queues behind it, so the revision
--   compare-and-set keeps its order.
--
-- LOCK ORDER (corrects the note in 0297's header, which is an applied file and is not edited):
--   human actions: inbound message FOR NO KEY UPDATE, then its receipt FOR UPDATE.
--   machine receipt writers: the receipt row, then (through the event row's foreign key) FOR KEY SHARE on the
--   inbound message, which never waits on a human action's lock.
--   House rule (AGENTS.md, checklist corrections): new parent locks use FOR NO KEY UPDATE.
--
-- SIDE EFFECT (accepted): a 'receipt' event row inserted while a human action is in flight may record the
--   message's previous revision. Those rows are observations; nothing reads their revision as a decision.
--
-- EXISTING ROWS: none are read or written. No table, column, index, trigger, grant or policy changes.
-- APP: no app change depends on this file. It can be applied on its own, before or after the W20 PR merges.
--
-- DEPENDS ON: 0297 (vendor mail) and 0299 (the body re-emitted here). Refuses by name when 0299's body is not
--   the one installed, so it can never roll the body-hash contract back.
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select to_regprocedure('public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb)') is not null as present,
--          position('body_sha256' in pg_get_functiondef('public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb)'::regprocedure)) > 0 as is_0299;
--   select grantee, privilege_type from information_schema.routine_privileges
--    where routine_schema='public' and routine_name='vendor_mail_mutate';        -- postgres only (no service_role)
--
-- VERIFY AFTER APPLY:
--   select position('for no key update' in prosrc) > 0 as fixed from pg_proc
--    where oid='public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb)'::regprocedure;            -- t
--   select has_function_privilege(r,'public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb)','EXECUTE')
--     from unnest(array['anon','authenticated','service_role']) r;                                           -- f, f, f
--   Two-session proof (sim only, CC runs it): scripts/sim/receiving-0326-0327-lock-check-management.mjs
--
-- ROLLBACK: re-apply the function body from 0299 (create or replace). Nothing else to undo.
-- PROOF: scripts/sql-harness-0326.mjs (PGlite: every 0299 scenario re-run on this body, the refusal guard, the
--   privilege ceiling, idempotent re-apply), pinned by tests/vendor-mail-mutate-lock-migration.test.ts.
begin;

-- PRE-FLIGHT: 0299's body is the one installed (never re-emit over an older or unknown body).
do $$
declare f regprocedure := to_regprocedure('public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb)');
begin
  if f is null or to_regclass('public.vendor_mail_events') is null then
    raise exception '0326: 0297 (vendor mail) must be applied first';
  end if;
  if position('body_sha256' in (select prosrc from pg_proc where oid = f)) = 0 then
    raise exception '0326: 0299 (vendor mail body hash) must be applied first';
  end if;
end $$;

create or replace function public.vendor_mail_mutate(p_message_id uuid,p_expected_revision integer,p_request_id uuid,
 p_actor_id uuid,p_session_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.inbound_messages%rowtype; r public.email_receipts%rowtype; e public.vendor_mail_events%rowtype;
 claim public.vendor_mail_events%rowtype; loc uuid; dest uuid; vendor uuid;
 fingerprint text:=md5(jsonb_build_array(p_message_id,p_expected_revision,p_actor_id,p_session_id,p_action,p_payload)::text);
begin
 select * into m from public.inbound_messages where id=p_message_id and lane='vendor_receipt' for no key update;
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
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('recipient','sender','note','body','body_sha256','attachments'))
     or jsonb_typeof(p_payload->'recipient') is distinct from 'string' or jsonb_typeof(p_payload->'sender') is distinct from 'string'
     or p_payload->>'recipient' !~ '^[^@[:space:]<>,;]+@[^@[:space:]<>,;]+\.[^@[:space:]<>,;]+$'
     or p_payload->>'sender' !~ '^[^@[:space:]<>,;]+@[^@[:space:]<>,;]+\.[^@[:space:]<>,;]+$'
     or length(p_payload->>'recipient')>254 or length(p_payload->>'sender')>254
     or jsonb_typeof(p_payload->'note') is distinct from 'string' or length(p_payload->>'note')>4000
     or jsonb_typeof(p_payload->'body') is distinct from 'string' or octet_length(p_payload->>'body')>131072
     or jsonb_typeof(p_payload->'body_sha256') is distinct from 'string' or p_payload->>'body_sha256' !~ '^[a-f0-9]{64}$'
     or p_payload->>'body_sha256' is distinct from encode(sha256(convert_to(p_payload->>'body','UTF8')),'hex')
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

-- PRIVILEGE CEILING: unchanged from 0297. vendor_mail_mutate is the PRIVATE engine: nobody but its owner may
-- execute it (the three wrappers are the only entry points, service_role only). CREATE OR REPLACE keeps the
-- ACL; this restates it and refuses to commit otherwise.
revoke all on function public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
do $$
declare f regprocedure := 'public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb)'::regprocedure; w text;
begin
  assert not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
    and not has_function_privilege('service_role', f, 'EXECUTE'), '0326: vendor_mail_mutate must stay private';
  assert not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = f and a.grantee = 0),
    '0326: vendor_mail_mutate PUBLIC escape';
  assert (select prosecdef from pg_proc where oid = f)
    and (select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'],
    '0326: vendor_mail_mutate must stay security definer with the pinned search_path';
  assert position('for no key update' in (select prosrc from pg_proc where oid = f)) > 0, '0326: lock clause not installed';
  foreach w in array array['vendor_mail_act(uuid,integer,uuid,uuid,uuid,text,jsonb)',
      'vendor_mail_forward_claim(uuid,integer,uuid,uuid,uuid,jsonb)', 'vendor_mail_forward_result(uuid,integer,uuid,uuid,uuid,jsonb)'] loop
    assert has_function_privilege('service_role', ('public.' || w)::regprocedure, 'EXECUTE')
      and not has_function_privilege('anon', ('public.' || w)::regprocedure, 'EXECUTE')
      and not has_function_privilege('authenticated', ('public.' || w)::regprocedure, 'EXECUTE'), '0326: wrapper grants changed';
  end loop;
end $$;
commit;
