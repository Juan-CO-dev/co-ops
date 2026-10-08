-- 0227 ezCater direct entity approvals + Toast review dismissals.
-- APPLIED TO PROD 2026-10-08 (schema_migrations version 20261008171705, name '0227_ezcater_review_direct'; sim first, version 20261008171638;
-- sim harness scripts/test-ezcater-review-direct.sql PASS, rolled back). Requires 0226.
begin;

alter table public.ezcater_item_map drop constraint ezcater_item_map_evidence_check;
alter table public.ezcater_item_map add constraint ezcater_item_map_evidence_check
 check(evidence in ('pos_guid','reviewed','reviewed_direct'));
alter table public.ezcater_item_map drop constraint ezcater_item_map_check;
alter table public.ezcater_item_map add constraint ezcater_item_map_check check(
 (evidence is distinct from 'reviewed_direct' and
  (status <> 'confirmed' or (evidence is not null and evidence in ('pos_guid','reviewed') and toast_item_guid is not null and
   num_nonnulls(item_id,menu_item_id,package_id)=1 and (evidence <> 'reviewed' or toast_map_id is not null))))
 or (evidence is not null and evidence='reviewed_direct' and status='confirmed' and toast_map_id is null and num_nonnulls(item_id,menu_item_id,package_id)=1)
);
alter table public.ezcater_mapping_decisions drop constraint ezcater_mapping_decisions_decision_check;
alter table public.ezcater_mapping_decisions add constraint ezcater_mapping_decisions_decision_check
 check(decision in ('approve','ignore','approve_direct'));
-- The existing toast_map_id check remains: ONLY approve carries a Toast target.

create function public.decide_ezcater_mapping_direct(p_review_id uuid,p_entity_kind text,p_entity_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.ezcater_review_queue%rowtype; m public.ezcater_item_map%rowtype;
 v_role text; v_before jsonb; v_after jsonb; v_decision uuid;
begin
 select role into v_role from public.users where id=p_actor_id and active for share;
 if v_role is null or v_role not in ('catering_mgr','moo','owner','cgs') then raise exception 'ezcater_mapping_forbidden'; end if;
 if p_entity_kind is null or p_entity_kind not in ('menu_item','item','package') or p_entity_id is null then
  raise exception 'ezcater_mapping_invalid_decision'; end if;
 -- Same map-before-review order as 0225 and the publisher. Recheck after locking.
 select * into q from public.ezcater_review_queue where id=p_review_id;
 if not found or q.source<>'ezcater' then raise exception 'ezcater_mapping_review_not_found'; end if;
 select * into m from public.ezcater_item_map where location_id=q.location_id and identity_key=q.identity_key for update;
 if not found then raise exception 'ezcater_mapping_source_changed'; end if;
 perform 1 from public.ezcater_review_queue where id=p_review_id and source='ezcater'
  and location_id=m.location_id and identity_key=m.identity_key for update;
 if not found then raise exception 'ezcater_mapping_source_changed'; end if;
 -- Hold the entity against deactivation or package relocation until commit.
 if p_entity_kind='menu_item' then
  perform 1 from public.menu_items where id=p_entity_id and active for share;
 elsif p_entity_kind='item' then
  perform 1 from public.items where id=p_entity_id and active for share;
 else
  perform 1 from public.catering_packages where id=p_entity_id and active
   and (location_id is null or location_id=m.location_id) for share;
 end if;
 if not found then raise exception 'ezcater_mapping_target_invalid'; end if;
 v_before:=to_jsonb(m);
 update public.ezcater_item_map set status='confirmed',evidence='reviewed_direct',toast_map_id=null,toast_item_guid=null,
  item_id=case when p_entity_kind='item' then p_entity_id end,
  menu_item_id=case when p_entity_kind='menu_item' then p_entity_id end,
  package_id=case when p_entity_kind='package' then p_entity_id end,updated_at=clock_timestamp()
  where location_id=m.location_id and identity_key=m.identity_key returning to_jsonb(ezcater_item_map.*) into v_after;
 insert into public.ezcater_mapping_decisions(review_id,location_id,identity_key,decision,toast_map_id,actor_id,previous_mapping,resulting_mapping)
 values(p_review_id,m.location_id,m.identity_key,'approve_direct',null,p_actor_id,v_before,v_after) returning id into v_decision;
 update public.ezcater_review_queue set resolved_at=clock_timestamp()
  where location_id=m.location_id and identity_key=m.identity_key and source='ezcater' and resolved_at is null;
 insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
 values(p_actor_id,v_role,'ezcater.item_map.approve','ezcater_mapping_decisions',v_decision,
  jsonb_build_object('review_id',p_review_id,'location_id',m.location_id,'identity_key',m.identity_key,
   'evidence','reviewed_direct','entity_kind',p_entity_kind,'entity_id',p_entity_id),true);
 return jsonb_build_object('decision_id',v_decision,'status','confirmed');
end $$;
revoke all on function public.decide_ezcater_mapping_direct(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.decide_ezcater_mapping_direct(uuid,text,uuid,uuid) to service_role;

-- Immutable decision evidence; resolution only stamps the existing queue row.
create table public.ezcater_review_dismissals (
 id uuid primary key default gen_random_uuid(),
 review_id uuid not null unique references public.ezcater_review_queue(id),
 reason text not null check(reason in ('not_ezcater','duplicate','test','other')),
 note text check(length(note)<=500),
 actor_id uuid not null references public.users(id),
 created_at timestamptz not null default clock_timestamp(),
 check(reason<>'other' or nullif(btrim(note),'') is not null)
);
alter table public.ezcater_review_dismissals enable row level security;
create policy ezcater_review_dismissals_no_user_select on public.ezcater_review_dismissals for select using(false);
create policy ezcater_review_dismissals_no_user_insert on public.ezcater_review_dismissals for insert with check(false);
create policy ezcater_review_dismissals_no_user_update on public.ezcater_review_dismissals for update using(false);
create policy ezcater_review_dismissals_no_user_delete on public.ezcater_review_dismissals for delete using(false);
revoke all on public.ezcater_review_dismissals from public,anon,authenticated,service_role;
grant select on public.ezcater_review_dismissals to service_role;

create function public.dismiss_ezcater_toast_review(p_review_id uuid,p_reason text,p_note text,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.ezcater_review_queue%rowtype; v_role text; v_decision uuid;
begin
 select role into v_role from public.users where id=p_actor_id and active for share;
 if v_role is null or v_role not in ('catering_mgr','moo','owner','cgs') then raise exception 'ezcater_mapping_forbidden'; end if;
 if p_reason is null or p_reason not in ('not_ezcater','duplicate','test','other')
  or (p_reason='other' and nullif(btrim(p_note),'') is null) or length(coalesce(p_note,''))>500 then
  raise exception 'ezcater_mapping_invalid_decision'; end if;
 select * into q from public.ezcater_review_queue where id=p_review_id for update;
 if not found or q.source<>'toast' or q.code<>'unmatched_code' then raise exception 'ezcater_mapping_review_not_found'; end if;
 if q.resolved_at is not null then raise exception 'ezcater_mapping_source_changed'; end if;
 insert into public.ezcater_review_dismissals(review_id,reason,note,actor_id)
 values(q.id,p_reason,nullif(btrim(p_note),''),p_actor_id) returning id into v_decision;
 update public.ezcater_review_queue set resolved_at=clock_timestamp() where id=q.id;
 insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
 values(p_actor_id,v_role,'ezcater.review.dismiss','ezcater_review_dismissals',v_decision,
  jsonb_build_object('review_id',q.id,'location_id',q.location_id,'identity_key',q.identity_key,'reason',p_reason),true);
 return jsonb_build_object('decision_id',v_decision,'status','dismissed');
end $$;
revoke all on function public.dismiss_ezcater_toast_review(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.dismiss_ezcater_toast_review(uuid,text,text,uuid) to service_role;

-- Check effective grants, including inherited PUBLIC and column grants.
do $$ declare f regprocedure; r text; t regclass:='public.ezcater_review_dismissals'::regclass; begin
 foreach f in array array['public.decide_ezcater_mapping_direct(uuid,text,uuid,uuid)'::regprocedure,
  'public.dismiss_ezcater_toast_review(uuid,text,text,uuid)'::regprocedure] loop
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or not has_function_privilege('service_role',f,'EXECUTE')
   or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=f and a.grantee=0) then raise exception '0227: unexpected effective function grant'; end if;
 end loop;
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or has_any_column_privilege(r,t,'INSERT,UPDATE,REFERENCES')
   or (r<>'service_role' and has_any_column_privilege(r,t,'SELECT')) then
   raise exception '0227: unexpected effective table or column grant'; end if;
 end loop;
 if not has_table_privilege('service_role',t,'SELECT')
  or exists(select 1 from pg_class c,lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   where c.oid=t and a.grantee=0)
  or exists(select 1 from pg_attribute c,lateral aclexplode(c.attacl) a where c.attrelid=t and a.grantee=0) then
  raise exception '0227: missing service read or PUBLIC table/column grant'; end if;
end $$;
commit;
