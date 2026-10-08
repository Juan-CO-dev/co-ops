-- Migration 0233_whos_here
-- AUTHORED ONLY 2026-10-08 (CO Claude builder, feat/whos-here). NOT APPLIED. GATE: CC sim + review, then Juan's apply gate.
-- 0232 is reserved for the parallel Sales build; nothing here touches it.
--
-- "Who's actually here" (Juan 2026-10-08: "we will have to keep in mind managers don't usually clock
-- in… so maybe we can pull that information from who is scheduled for that day from toast?"; Toast
-- has no schedules, so: links + CO-OPS activity; Juan: "Ok great.").
--
-- A. toast_employee_links: Toast employee guid -> CO-OPS user, per shop. Deny-all RLS; the definer
--    RPCs link_toast_employee / unlink_toast_employee are the only writers (service_role only). A link
--    is append-only: unlink flips active=false, a re-link is a new row. An auto link is an exact
--    full-name match at the same shop, decided in lib/toast/employee-links-shared.ts (never on a first
--    name alone); it stays reviewable and unlinkable.
--    toast_time_entries.user_id FOLLOWS the active link through a BEFORE trigger: the labor pull's
--    upserts fill it going forward, and a link/unlink backfills or clears every date for that employee.
--    Without an active link the written value stands (so an unlink's explicit NULL sticks and 0230's
--    sim harness, which writes user_id directly, keeps its meaning).
--    That makes 0230's clock-out releases fire and lets the digest labor section name people.
--    r1 (Astra P1-3): link/unlink take the GLOBAL 'toast-link' advisory lock exclusively; every
--    statement writing toast_time_entries takes it SHARED in a BEFORE STATEMENT trigger (before any row
--    lock, so no lock cycle). A labor write therefore sees a committed link state, and an unlink's clear
--    sees every committed labor row: attribution can never outlive its link.
--    r1 (Astra P1-2): an unlinked pair stays as inactive history and link_toast_employee REFUSES an auto
--    link for it ('link_rejected'); only a manager can link that pair again.
-- B. shift_ends: "End my shift" (self) / a KH+ ending someone else's shift (0228 reason rule when the
--    work was given by a higher level), and one shop-closed marker per shop/day. end_shift releases the
--    station and unassigns open tasks with the same trail shape as a Toast clock-out
--    (station_events / assignment_changes reason 'ended_shift').
--    r1 (Astra P1-4/P1-5/P2-8): there is NO trigger on checklist_instances. reconcile_shop_closed is
--    called by the APP, only when WHOS_HERE=1: right after a successful closer confirm (settled), and
--    from the 10-minute tick for today + yesterday (it covers opener release and system auto). It only
--    acts on a DURABLE finalize (a closer confirm counts once it is 2 minutes old or the caller says it
--    settled), only releases holds made before the close instant, never waits on a lock
--    (pg_try_advisory_xact_lock + a 2 s lock_timeout; lock_not_available / query_canceled return
--    'skipped'), and its caller is a separate request, so a finalize can never be blocked or undone.
-- Backward compatibility (0228/0230 discipline): NO existing RPC is re-emitted. Constraint changes only
-- ADD allowed values/branches; every row valid under 0230 stays valid (tests/whos-here-migration.test.ts).
begin;

do $$ declare entry text; tab text; col text; begin
  foreach entry in array array[
    'toast_time_entries.location_id','toast_time_entries.employee_guid','toast_time_entries.user_id',
    'station_events.reason_code','station_events.prior_position_id','station_events.effective_at',
    'station_break_events.reason_code','assignment_changes.subject_user_id','assignment_changes.effective_at',
    'report_assignments.assigner_id','report_assignments.operational_date','report_assignments.active',
    'checklist_instances.status','checklist_instances.template_id','checklist_instances.date','checklist_instances.location_id',
    'checklist_instances.confirmed_at','checklist_instances.dropped_at','checklist_instances.shift_start_at','checklist_instances.triggered_at',
    'checklist_templates.type','sessions.user_id','sessions.created_at','user_locations.user_id','user_locations.active'
  ] loop
    tab:=split_part(entry,'.',1); col:=split_part(entry,'.',2);
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=tab and column_name=col) then
      raise exception '0233: missing expected column %',entry;
    end if;
  end loop;
  foreach entry in array array['public.station_business_date(uuid)','public.assignment_user_level(uuid,uuid)',
    'public.assignment_author_level(uuid)','public.reconcile_station_lifecycle(uuid,date)'] loop
    if to_regprocedure(entry) is null then raise exception '0233: requires %',entry; end if;
  end loop;
  if to_regclass('public.toast_employee_links') is not null or to_regclass('public.shift_ends') is not null then
    raise exception '0233: already applied';
  end if;
end $$;

-- ── A. Links ─────────────────────────────────────────────────────────────────────────────────
create table public.toast_employee_links (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  employee_guid text not null check (char_length(btrim(employee_guid)) between 1 and 64),
  user_id uuid not null references public.users(id),
  source text not null check (source in ('auto','manual')),
  active boolean not null default true,
  linked_by uuid references public.users(id),
  linked_at timestamptz not null default clock_timestamp(),
  unlinked_by uuid references public.users(id),
  unlinked_at timestamptz,
  check ((source='auto') = (linked_by is null)),
  check (active = (unlinked_at is null)),
  check ((unlinked_at is null) = (unlinked_by is null))
);
create unique index toast_employee_links_one_active_employee on public.toast_employee_links(location_id,employee_guid) where active;
create unique index toast_employee_links_one_active_user on public.toast_employee_links(location_id,user_id) where active;
comment on table public.toast_employee_links is
  '0233: Toast employee guid -> CO-OPS user per shop. Append-only (unlink = active false). Written only by link_toast_employee / unlink_toast_employee. Deny-all RLS.';
alter table public.toast_employee_links enable row level security;
create policy toast_employee_links_no_user_select on public.toast_employee_links for select using (false);
create policy toast_employee_links_no_user_insert on public.toast_employee_links for insert with check (false);
create policy toast_employee_links_no_user_update on public.toast_employee_links for update using (false) with check (false);
create policy toast_employee_links_no_user_delete on public.toast_employee_links for delete using (false);
revoke all on public.toast_employee_links from public,anon,authenticated,service_role;
grant select on public.toast_employee_links to service_role;

-- user_id follows the active link on every write: the pull fills it going forward, and the RPCs'
-- updates below backfill / clear all dates. No active link: the written value stands. Never a name.
create function public.toast_time_entry_link_user()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  new.user_id := coalesce((select l.user_id from public.toast_employee_links l
    where l.location_id=new.location_id and l.employee_guid=new.employee_guid and l.active),new.user_id);
  return new;
end $$;
create trigger toast_time_entries_link_user before insert or update on public.toast_time_entries
  for each row execute function public.toast_time_entry_link_user();
-- r1 P1-3: one SHARED global link lock per writing statement, taken before any row is locked.
create function public.toast_time_entries_link_lock()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('toast-link',0));
  return null;
end $$;
create trigger toast_time_entries_link_lock before insert or update on public.toast_time_entries
  for each statement execute function public.toast_time_entries_link_lock();

-- GM (7) for a shop they belong to; level 8+ for every shop. Active accounts only.
create function public.toast_link_actor_level(p_actor_id uuid,p_location_id uuid)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_level integer;
begin
  if not exists(select 1 from public.users where id=p_actor_id and active) then raise exception 'role_insufficient'; end if;
  v_level:=public.assignment_author_level(p_actor_id);
  if v_level is null or v_level<7 then raise exception 'role_insufficient'; end if;
  if not exists(select 1 from public.locations where id=p_location_id and active) then raise exception 'location_access_denied'; end if;
  if v_level<8 and not exists(select 1 from public.user_locations where user_id=p_actor_id and location_id=p_location_id and active) then
    raise exception 'location_access_denied';
  end if;
  return v_level;
end $$;

create function public.link_toast_employee(p_actor_id uuid,p_location_id uuid,p_employee_guid text,p_user_id uuid,p_source text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor integer; v_target integer; v_existing public.toast_employee_links%rowtype; v_id uuid; v_rows integer;
begin
  if p_source is null or p_source not in ('auto','manual') or p_location_id is null or p_user_id is null
    or p_employee_guid is null or char_length(btrim(p_employee_guid)) not between 1 and 64
    or (p_source='auto') <> (p_actor_id is null) then
    raise exception 'invalid_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('toast-link',0));
  -- The linked person must belong to this shop (or be all-shops, level 9+), exactly like an assignee.
  v_target:=public.assignment_user_level(p_user_id,p_location_id);
  if p_source='manual' then
    v_actor:=public.toast_link_actor_level(p_actor_id,p_location_id);
    if v_target>v_actor then raise exception 'role_insufficient'; end if;
  end if;
  select * into v_existing from public.toast_employee_links
    where location_id=p_location_id and employee_guid=p_employee_guid and active;
  if found then
    if v_existing.user_id=p_user_id then return jsonb_build_object('id',v_existing.id,'changed',false,'backfilled',0); end if;
    raise exception 'employee_already_linked';
  end if;
  if exists(select 1 from public.toast_employee_links where location_id=p_location_id and user_id=p_user_id and active) then
    raise exception 'user_already_linked';
  end if;
  -- r1 P1-2: a pair a person unlinked is a rejection. The machine never re-links it; a manager may.
  if p_source='auto' and exists(select 1 from public.toast_employee_links where location_id=p_location_id
    and employee_guid=p_employee_guid and user_id=p_user_id and not active) then
    raise exception 'link_rejected';
  end if;
  insert into public.toast_employee_links(location_id,employee_guid,user_id,source,linked_by)
    values(p_location_id,p_employee_guid,p_user_id,p_source,p_actor_id) returning id into v_id;
  -- Backfill every date (the BEFORE trigger agrees: it reads the link just inserted).
  update public.toast_time_entries set user_id=p_user_id
    where location_id=p_location_id and employee_guid=p_employee_guid and user_id is distinct from p_user_id;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('id',v_id,'changed',true,'backfilled',v_rows);
end $$;

-- Unlinking is not acting up (like a retract): actor authority and the row's shop decide.
create function public.unlink_toast_employee(p_actor_id uuid,p_location_id uuid,p_link_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_link public.toast_employee_links%rowtype; v_rows integer;
begin
  if p_actor_id is null or p_location_id is null or p_link_id is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('toast-link',0));
  perform public.toast_link_actor_level(p_actor_id,p_location_id);
  select * into v_link from public.toast_employee_links where id=p_link_id and location_id=p_location_id for update;
  if not found then raise exception 'link_not_found'; end if;
  if not v_link.active then return jsonb_build_object('id',v_link.id,'changed',false,'cleared',0); end if;
  update public.toast_employee_links set active=false,unlinked_by=p_actor_id,unlinked_at=clock_timestamp() where id=v_link.id;
  update public.toast_time_entries set user_id=null
    where location_id=p_location_id and employee_guid=v_link.employee_guid and user_id is not null;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('id',v_link.id,'changed',true,'cleared',v_rows,'employee_guid',v_link.employee_guid,'user_id',v_link.user_id);
end $$;

-- ── B. Shift ends + the shop-closed safety net ────────────────────────────────────────────────
create table public.shift_ends (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  location_id uuid not null references public.locations(id),
  business_date date not null,
  user_id uuid references public.users(id),
  kind text not null check (kind in ('ended_shift','shop_closed')),
  actor_id uuid references public.users(id),
  reason_code text check (reason_code in ('coverage_change','unavailable','skill_fit','correction','other')),
  reason_note text check (length(reason_note)<=500),
  overridden_assigner_id uuid references public.users(id),
  at timestamptz not null default clock_timestamp(),
  check (reason_code is distinct from 'other' or coalesce(reason_note ~ '[^[:space:]]',false)),
  check (overridden_assigner_id is null or reason_code is not null),
  check ((kind='ended_shift' and user_id is not null and actor_id is not null)
    or (kind='shop_closed' and user_id is null and actor_id is null and reason_code is null and reason_note is null and overridden_assigner_id is null))
);
create index shift_ends_head on public.shift_ends(location_id,business_date,user_id,sequence desc);
create unique index shift_ends_one_shop_close on public.shift_ends(location_id,business_date) where kind='shop_closed';
comment on table public.shift_ends is
  '0233: append-only shift-end ledger (End my shift / KH+ ends a shift; one shop_closed marker per shop/day). Written only by end_shift / reconcile_shop_closed. Deny-all RLS.';
alter table public.shift_ends enable row level security;
create policy shift_ends_no_user_select on public.shift_ends for select using (false);
create policy shift_ends_no_user_insert on public.shift_ends for insert with check (false);
create policy shift_ends_no_user_update on public.shift_ends for update using (false) with check (false);
create policy shift_ends_no_user_delete on public.shift_ends for delete using (false);
revoke all on public.shift_ends from public,anon,authenticated,service_role;
grant select on public.shift_ends to service_role;
revoke all on sequence public.shift_ends_sequence_seq from public,anon,authenticated,service_role;

-- Constraint widening: ADDITIONS ONLY. Each new predicate is the 0230 predicate OR a new branch.
alter table public.station_events drop constraint station_events_reason_code_check;
alter table public.station_events add constraint station_events_reason_code_check check
  (reason_code in ('coverage_change','unavailable','skill_fit','correction','other','station_closed','clocked_out','on_break','ended_shift','shop_closed'));
alter table public.station_events drop constraint station_events_system_actor;
alter table public.station_events add constraint station_events_system_actor check (actor_id is not null or
  coalesce((kind='release' and reason_code in ('station_closed','clocked_out','shop_closed') and effective_at is not null),false));
alter table public.station_events drop constraint station_events_system_reason;
alter table public.station_events add constraint station_events_system_reason check
  (reason_code not in ('station_closed','clocked_out','on_break','ended_shift','shop_closed') or
    (kind='release' and station_id is null and position_id is null and source is null and overridden_assigner_id is null));

alter table public.assignment_changes drop constraint assignment_changes_reason_code_check;
alter table public.assignment_changes add constraint assignment_changes_reason_code_check check
  (reason_code in ('coverage_change','unavailable','skill_fit','correction','other','clocked_out','ended_shift','shop_closed'));
alter table public.assignment_changes drop constraint assignment_changes_system_actor;
alter table public.assignment_changes add constraint assignment_changes_system_actor check
  ((kind='auto_release' and actor_id is null and reason_code is not distinct from 'clocked_out' and subject_user_id is not null and effective_at is not null and overridden_assigner_id is null)
    or (kind<>'auto_release' and actor_id is not null and reason_code is distinct from 'clocked_out'
      and reason_code is distinct from 'ended_shift' and reason_code is distinct from 'shop_closed')
    or (kind='auto_release' and actor_id is null and reason_code is not distinct from 'shop_closed' and subject_user_id is not null and effective_at is not null and overridden_assigner_id is null)
    or (kind='auto_release' and actor_id is not null and reason_code is not distinct from 'ended_shift' and subject_user_id is not null and effective_at is not null));

-- 0230's break check is unnamed; find it by its definition (exactly one) and widen it.
do $$ declare v_name text; v_count integer; begin
  select count(*),min(conname) into v_count,v_name from pg_constraint
    where conrelid='public.station_break_events'::regclass and contype='c' and pg_get_constraintdef(oid) like '%clocked_out%';
  if v_count<>1 then raise exception '0233: expected exactly one station_break_events reason check, found %',v_count; end if;
  execute format('alter table public.station_break_events drop constraint %I',v_name);
end $$;
alter table public.station_break_events add constraint station_break_events_reason_check check
  ((actor_id is not null and reason_code is null) or
    (actor_id is null and not on_break and reason_code is not distinct from 'clocked_out') or
    (actor_id is null and not on_break and reason_code is not distinct from 'shop_closed'));

-- SQL observations, fail-open like lib/audit.ts and 0230's station_lifecycle_audit.
create function public.whos_here_audit(p_action text,p_table text,p_id uuid,p_metadata jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_action is distinct from 'shift.system_end' then raise exception 'invalid_payload'; end if;
  begin
    insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
      values(null,null,p_action,p_table,p_id,p_metadata,false);
  exception when others then raise warning 'whos-here audit failed'; end;
end $$;

-- "End my shift" (self) or a KH+ ends someone else's shift. Same authority as write_station_break;
-- the 0228 reason rule applies when the target holds work given by a higher level than the actor.
create function public.end_shift(p_actor_id uuid,p_user_id uuid,p_location_id uuid,p_reason_code text default null,p_reason_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_station_day date; v_day date:=(clock_timestamp() at time zone 'America/New_York')::date;
  v_actor integer; v_target integer; h public.station_events%rowtype; v_on_break boolean;
  v_overridden uuid; v_last public.shift_ends%rowtype; v_id uuid; v_at timestamptz;
  a record; v_tasks integer:=0; v_station boolean:=false; v_holds boolean;
begin
  if p_actor_id is null or p_user_id is null or p_location_id is null
    or (p_reason_code is not null and p_reason_code not in ('coverage_change','unavailable','skill_fit','correction','other'))
    or length(coalesce(p_reason_note,''))>500
    or (p_reason_code='other' and not coalesce(p_reason_note ~ '[^[:space:]]',false)) then
    raise exception 'invalid_payload';
  end if;
  v_station_day:=public.station_business_date(p_location_id);
  -- Chronological lock order, as reconcile_station_lifecycle takes it.
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_station_day::text,0));
  perform pg_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||v_day::text,0));
  v_actor:=public.assignment_user_level(p_actor_id,p_location_id);
  v_target:=public.assignment_user_level(p_user_id,p_location_id);
  if p_actor_id<>p_user_id and (v_actor<4 or v_target>v_actor) then raise exception 'role_insufficient'; end if;
  select * into h from public.station_events where location_id=p_location_id and business_date=v_station_day
    and user_id=p_user_id order by sequence desc limit 1;
  v_on_break:=coalesce((select b.on_break from public.station_break_events b where b.location_id=p_location_id
    and b.business_date=v_station_day and b.user_id=p_user_id order by b.sequence desc limit 1),false);
  if p_actor_id<>p_user_id then
    if h.station_id is not null and h.source='assigned' and public.assignment_author_level(h.actor_id)>v_actor then
      v_overridden:=h.actor_id;
    end if;
    if v_overridden is null then
      select r.assigner_id into v_overridden from public.report_assignments r where r.location_id=p_location_id
        and r.operational_date=v_day and r.assignee_id=p_user_id and r.active
        and public.assignment_author_level(r.assigner_id)>v_actor
        order by public.assignment_author_level(r.assigner_id) desc,r.created_at,r.id limit 1;
    end if;
    if v_overridden is not null and p_reason_code is null then raise exception 'override_reason_required'; end if;
  end if;
  v_holds:=h.station_id is not null or (h.reason_code='on_break' and h.prior_position_id is not null) or v_on_break
    or exists(select 1 from public.report_assignments where location_id=p_location_id and operational_date=v_day
      and assignee_id=p_user_id and active);
  -- A repeat tap with nothing held and no newer sign-in or station event changes nothing.
  select * into v_last from public.shift_ends where location_id=p_location_id and business_date=v_station_day
    and user_id=p_user_id and kind='ended_shift' order by sequence desc limit 1;
  if not v_holds and v_last.id is not null and v_last.at>=coalesce(h.at,'-infinity'::timestamptz)
    and v_last.at>=coalesce((select max(s.created_at) from public.sessions s where s.user_id=p_user_id),'-infinity'::timestamptz) then
    return jsonb_build_object('id',v_last.id,'changed',false,'released_station',false,'released_tasks',0);
  end if;
  v_at:=clock_timestamp();
  insert into public.shift_ends(location_id,business_date,user_id,kind,actor_id,reason_code,reason_note,overridden_assigner_id,at)
    values(p_location_id,v_station_day,p_user_id,'ended_shift',p_actor_id,p_reason_code,nullif(btrim(p_reason_note),''),v_overridden,v_at)
    returning id into v_id;
  if h.station_id is not null or (h.reason_code='on_break' and h.prior_position_id is not null) then
    -- Stamped with the shift end's own instant, so a repeat tap compares equal and stays a no-op.
    insert into public.station_events(location_id,business_date,user_id,kind,actor_id,reason_code,prior_position_id,effective_at,at)
      values(p_location_id,v_station_day,p_user_id,'release',p_actor_id,'ended_shift',coalesce(h.position_id,h.prior_position_id),v_at,v_at);
    v_station:=true;
  end if;
  -- Leaving ends a break, too.
  if v_on_break then
    insert into public.station_break_events(location_id,business_date,user_id,actor_id,on_break)
      values(p_location_id,v_station_day,p_user_id,p_actor_id,false);
  end if;
  for a in update public.report_assignments set active=false where location_id=p_location_id
    and operational_date=v_day and assignee_id=p_user_id and active returning * loop
    insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,actor_id,kind,reason_code,subject_user_id,effective_at,overridden_assigner_id)
      values(a.id,p_location_id,v_day,a.report_type,p_actor_id,'auto_release','ended_shift',p_user_id,v_at,
        case when p_actor_id<>p_user_id and public.assignment_author_level(a.assigner_id)>v_actor then a.assigner_id end);
    v_tasks:=v_tasks+1;
  end loop;
  return jsonb_build_object('id',v_id,'changed',true,'released_station',v_station,'released_tasks',v_tasks,
    'overridden_assigner_id',v_overridden,'reason_code',p_reason_code,'reason_note',nullif(btrim(p_reason_note),''));
end $$;

-- The safety net: nothing stays held overnight. Called by the app (WHOS_HERE=1 only), never by a
-- trigger, so it can neither block nor roll back a finalize. Idempotent: one marker per shop/day, and
-- only holds made at or before the close instant are released (work started after the close stays).
create function public.reconcile_shop_closed(p_location_id uuid,p_day date,p_settled boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; a record; v_inst record; v_close timestamptz; v_at timestamptz:=clock_timestamp();
  v_stations integer:=0; v_tasks integer:=0; v_breaks integer:=0; v_marker uuid;
begin
  if p_location_id is null or p_day is null or p_settled is null then raise exception 'invalid_payload'; end if;
  begin
    -- Never wait: a busy shop/day is retried by the next tick.
    perform set_config('lock_timeout','2000',true);
    if not pg_try_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||p_day::text,0)) then
      return jsonb_build_object('ok',false,'skipped','busy');
    end if;
    -- The same closing instance station_closures reads (0230).
    select i.id,i.status,i.confirmed_at into v_inst from public.checklist_instances i
      join public.checklist_templates t on t.id=i.template_id
      where i.location_id=p_location_id and i.date=p_day and t.type='closing' and i.dropped_at is null
      order by i.shift_start_at desc nulls last,i.triggered_at desc nulls last,i.id desc limit 1;
    if not found or v_inst.status='open' then return jsonb_build_object('ok',true,'closed',false); end if;
    -- A closer confirm can still be compensated back to 'open' inside its own request (dependent
    -- insert failure): act only once the caller says it settled, or once it is 2 minutes old.
    if v_inst.status in ('confirmed','incomplete_confirmed') and not p_settled
      and coalesce(v_inst.confirmed_at>clock_timestamp()-interval '2 minutes',true) then
      return jsonb_build_object('ok',true,'closed',true,'settled',false);
    end if;
    insert into public.shift_ends(location_id,business_date,user_id,kind,actor_id,at)
      values(p_location_id,p_day,null,'shop_closed',null,least(coalesce(v_inst.confirmed_at,v_at),v_at))
      on conflict (location_id,business_date) where kind='shop_closed' do nothing returning id into v_marker;
    select e.at into v_close from public.shift_ends e where e.location_id=p_location_id and e.business_date=p_day and e.kind='shop_closed';
    for r in select * from (select distinct on (e.user_id) e.* from public.station_events e
        where e.location_id=p_location_id and e.business_date=p_day order by e.user_id,e.sequence desc) h
      where h.at<=v_close and (h.station_id is not null or (h.reason_code='on_break' and h.prior_position_id is not null)) loop
      insert into public.station_events(location_id,business_date,user_id,kind,actor_id,reason_code,prior_position_id,effective_at)
        values(p_location_id,p_day,r.user_id,'release',null,'shop_closed',coalesce(r.position_id,r.prior_position_id),v_close);
      v_stations:=v_stations+1;
    end loop;
    for r in select * from (select distinct on (b.user_id) b.* from public.station_break_events b
        where b.location_id=p_location_id and b.business_date=p_day order by b.user_id,b.sequence desc) h
      where h.on_break and h.at<=v_close loop
      insert into public.station_break_events(location_id,business_date,user_id,actor_id,on_break,reason_code)
        values(p_location_id,p_day,r.user_id,null,false,'shop_closed');
      v_breaks:=v_breaks+1;
    end loop;
    for a in update public.report_assignments set active=false where location_id=p_location_id
      and operational_date=p_day and active and created_at<=v_close returning * loop
      insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,actor_id,kind,reason_code,subject_user_id,effective_at)
        values(a.id,p_location_id,p_day,a.report_type,null,'auto_release','shop_closed',a.assignee_id,v_close);
      v_tasks:=v_tasks+1;
    end loop;
    if v_marker is not null or v_stations>0 or v_tasks>0 or v_breaks>0 then
      perform public.whos_here_audit('shift.system_end','shift_ends',v_marker,jsonb_build_object('reason','shop_closed',
        'location_id',p_location_id,'business_date',p_day,'closed_at',v_close,'settled',p_settled,
        'stations_released',v_stations,'tasks_released',v_tasks,'breaks_ended',v_breaks));
    end if;
    return jsonb_build_object('ok',true,'closed',true,'settled',true,'closed_at',v_close,
      'stations_released',v_stations,'tasks_released',v_tasks,'breaks_ended',v_breaks);
  exception when lock_not_available or query_canceled then
    -- Fail-open by construction: everything above is undone, the next tick retries.
    return jsonb_build_object('ok',false,'skipped','lock');
  end;
end $$;

-- Definer helpers are private even on Supabase's default ACLs.
do $$ declare f regprocedure; r text; tab text; begin
  foreach f in array array[
    'public.toast_time_entry_link_user()'::regprocedure,
    'public.toast_time_entries_link_lock()'::regprocedure,
    'public.toast_link_actor_level(uuid,uuid)'::regprocedure,
    'public.link_toast_employee(uuid,uuid,text,uuid,text)'::regprocedure,
    'public.unlink_toast_employee(uuid,uuid,uuid)'::regprocedure,
    'public.whos_here_audit(text,text,uuid,jsonb)'::regprocedure,
    'public.end_shift(uuid,uuid,uuid,text,text)'::regprocedure,
    'public.reconcile_shop_closed(uuid,date,boolean)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
      or not has_function_privilege('service_role',f,'EXECUTE') then raise exception '0233: RPC grant escaped'; end if;
  end loop;
  foreach tab in array array['toast_employee_links','shift_ends'] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(r,'public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(r,'public.'||tab,'INSERT,UPDATE,REFERENCES')
        or (r<>'service_role' and has_any_column_privilege(r,'public.'||tab,'SELECT')) then
        raise exception '0233: whos-here ledger grant escaped';
      end if;
    end loop;
  end loop;
end $$;
commit;
