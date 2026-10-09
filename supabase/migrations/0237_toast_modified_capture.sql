-- Migration 0237: bounded modified-order discovery.
-- AUTHORED 2026-10-08. APPLIED TO PROD 2026-10-09 (20261009023642; sim 20261009023450, harness pass).
-- Function timeout configuration is defense in depth, not a fresh statement timer:
-- callers must also abort below eight seconds; measure on sim before deployment.
begin;
create table public.toast_modified_cursors (
 location_id uuid primary key references public.locations(id),
 coverage_start timestamptz not null, watermark timestamptz,
 pending_start timestamptz, pending_end timestamptz,
 check(watermark is null or watermark >= coverage_start),
 check((pending_start is null) = (pending_end is null)),
 check(pending_start is null or (pending_start >= coverage_start and pending_end > pending_start
   and pending_end <= pending_start + interval '1 hour'
   and (watermark is null or pending_end > watermark)))
);
alter table public.toast_modified_cursors enable row level security;
create policy toast_modified_cursors_no_user_select on public.toast_modified_cursors for select using(false);
create policy toast_modified_cursors_no_user_insert on public.toast_modified_cursors for insert with check(false);
create policy toast_modified_cursors_no_user_update on public.toast_modified_cursors for update using(false);
create policy toast_modified_cursors_no_user_delete on public.toast_modified_cursors for delete using(false);
revoke all on public.toast_modified_cursors from public,anon,authenticated,service_role;
grant select on public.toast_modified_cursors to service_role;

alter table public.toast_capture_runs drop constraint toast_capture_runs_status_check;
alter table public.toast_capture_runs add constraint toast_capture_runs_status_check
 check(status in ('running','completed','failed','modified_completed'));

create function public.toast_modified_begin(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
 set statement_timeout='5s' set lock_timeout='1s' as $$
declare c public.toast_modified_cursors%rowtype; t timestamptz:=clock_timestamp(); s timestamptz; e timestamptz;
begin
 insert into public.toast_modified_cursors(location_id,coverage_start)
 values(p_location_id,t-interval '24 hours') on conflict do nothing;
 select * into strict c from public.toast_modified_cursors where location_id=p_location_id for update;
 if c.pending_end is not null then return to_jsonb(c); end if;
 s:=greatest(c.coverage_start,coalesce(c.watermark-interval '1 minute',c.coverage_start));
 e:=least(s+interval '1 hour',t-interval '2 minutes');
 if e > coalesce(c.watermark,c.coverage_start) then
  update public.toast_modified_cursors set pending_start=s,pending_end=e
  where location_id=p_location_id returning * into c;
 end if;
 return to_jsonb(c);
end $$;

create function public.toast_modified_complete(p_location_id uuid,p_start timestamptz,p_end timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog,public
 set statement_timeout='5s' set lock_timeout='1s' as $$
begin
 update public.toast_modified_cursors set watermark=p_end,pending_start=null,pending_end=null
 where location_id=p_location_id and pending_start=p_start and pending_end=p_end
   and (watermark is null or watermark<p_end);
 return found;
end $$;

create function public.toast_modified_save(p_location_id uuid,p_orders jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public
 set statement_timeout='5s' set lock_timeout='1s' as $$
declare entry jsonb; incoming jsonb; previous jsonb; pointer public.toast_order_latest_pointers%rowtype;
 run_id uuid; day date; modified timestamptz; changed integer:=0;
begin
 if p_orders is null or jsonb_typeof(p_orders)<>'array' or jsonb_array_length(p_orders)>20 then
  raise exception 'toast_modified_invalid_batch';
 end if;
 -- Serialize discovery workers per shop, including missing pointers. Full-day writers
 -- retain 0221's atomic pointer precedence; no long-lived lease is held over HTTP.
 perform 1 from public.toast_modified_cursors where location_id=p_location_id for update;
 if not found then raise exception 'toast_modified_cursor_missing'; end if;
 if exists(select 1 from jsonb_array_elements(p_orders) x group by x->'order'->>'order_guid' having count(*)>1) then
  raise exception 'toast_modified_duplicate_order';
 end if;
 for entry in select value from jsonb_array_elements(p_orders) order by value->'order'->>'order_guid' loop
  if jsonb_typeof(entry->'payments') is distinct from 'array' then raise exception 'toast_modified_invalid_payments'; end if;
  day:=(entry->'order'->>'business_date')::date;
  modified:=(entry->'order'->>'modified_at')::timestamptz;
  select * into pointer from public.toast_order_latest_pointers
   where location_id=p_location_id and order_guid=entry->'order'->>'order_guid' for update;
  if found and pointer.modified_at is not null and (modified is null or modified<pointer.modified_at) then continue; end if;
  -- Cast using the storage schema so missing optional fields normalize to NULL.
  select coalesce(jsonb_agg(to_jsonb(p)-'snapshot_id' order by p.payment_guid),'[]'::jsonb) into incoming
   from jsonb_populate_recordset(null::public.toast_payments,entry->'payments') p;
  select coalesce(jsonb_agg(to_jsonb(p)-'snapshot_id' order by p.payment_guid),'[]'::jsonb) into previous
   from public.toast_payments p where p.snapshot_id=pointer.snapshot_id;
  if incoming=previous then continue; end if;
  run_id:=gen_random_uuid();
  insert into public.toast_capture_runs(id,location_id,business_date,started_at)
   values(run_id,p_location_id,day,clock_timestamp());
  perform public.toast_capture_page(run_id,p_location_id,day,1,jsonb_build_array(entry));
  perform public.toast_capture_finish(run_id,p_location_id,day,1);
  -- Transactional: no reader can observe this as completed full-day coverage.
  update public.toast_capture_runs set status='modified_completed' where id=run_id;
  changed:=changed+1;
 end loop;
 return changed;
end $$;

-- 0222 claim, unchanged except exclusion of terminal modified-discovery manifests.
create or replace function public.toast_capture_claim(p_run_id uuid,p_location_id uuid,p_business_date date,p_min_interval interval default interval '5 minutes')
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_min_interval is null or p_min_interval < interval '5 minutes' then raise exception 'toast_capture_invalid_interval'; end if;
 insert into public.toast_capture_debounce(location_id,business_date)
 values(p_location_id,p_business_date) on conflict do nothing;
 perform 1 from public.toast_capture_debounce where location_id=p_location_id and business_date=p_business_date for update;
 -- Serialized with other claims; non-backfill captures have a 60-second maximum.
 update public.toast_capture_runs set status='failed',error_code='capture_stale',finished_at=clock_timestamp()
 where location_id=p_location_id and business_date=p_business_date and status='running'
   and started_at < clock_timestamp()-interval '2 minutes';
 if exists(select 1 from public.toast_capture_runs where location_id=p_location_id and business_date=p_business_date
   and status<>'modified_completed'
   and (status='running' or (error_code is distinct from 'capture_stale' and finished_at > clock_timestamp()-p_min_interval))) then
   return false;
 end if;
 insert into public.toast_capture_runs(id,location_id,business_date,status)
 values(p_run_id,p_location_id,p_business_date,'running');
 update public.toast_capture_debounce set last_claimed_at=clock_timestamp()
 where location_id=p_location_id and business_date=p_business_date;
 return true;
end $$;

revoke all on function public.toast_modified_begin(uuid),public.toast_modified_complete(uuid,timestamptz,timestamptz),
 public.toast_modified_save(uuid,jsonb),public.toast_capture_claim(uuid,uuid,date,interval) from public,anon,authenticated,service_role;
grant execute on function public.toast_modified_begin(uuid),public.toast_modified_complete(uuid,timestamptz,timestamptz),
 public.toast_modified_save(uuid,jsonb),public.toast_capture_claim(uuid,uuid,date,interval) to service_role;
do $$ declare f regprocedure; r text; begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(r,'public.toast_modified_cursors','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege(r,'public.toast_modified_cursors','INSERT,UPDATE,REFERENCES')
    or (r<>'service_role' and has_any_column_privilege(r,'public.toast_modified_cursors','SELECT')) then
   raise exception '0237 unexpected cursor grant';
  end if;
 end loop;
 foreach f in array array['public.toast_modified_begin(uuid)'::regprocedure,
  'public.toast_modified_complete(uuid,timestamptz,timestamptz)'::regprocedure,
  'public.toast_modified_save(uuid,jsonb)'::regprocedure,'public.toast_capture_claim(uuid,uuid,date,interval)'::regprocedure] loop
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or not has_function_privilege('service_role',f,'EXECUTE')
   or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     where p.oid=f and a.grantee=0) then raise exception '0237 unexpected RPC grant'; end if;
 end loop;
end $$;
commit;
