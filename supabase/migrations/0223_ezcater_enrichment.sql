-- 0223 ezCater enrichment PASS 1. AUTHORED 2026-10-08; NOT APPLIED -- GATE CC/Juan.
-- APPLIED TO PROD 2026-10-08 (schema_migrations version 20261008065145, name '0223_ezcater_enrichment'; sim first, version 20261008064956). The line(s) above/below describing the authoring gate are kept as history.
-- Current provider snapshot; historical item snapshots; contacts read only through the
-- existing catering authorization policy in the server loader. No Toast identity claim.
-- Column lineage checked: 0108/0109/0129/0148/0149 pipeline; 0110/0113/0191 events.
-- 0113 removed events.location_id: every event binds through pipeline_id only.
begin;

create table public.ezcater_orders (
  id uuid primary key default gen_random_uuid(),
  provider_uuid text not null unique,
  caterer_uuid text not null,
  location_id uuid not null references public.locations(id),
  lead_id uuid references public.catering_pipeline(id),
  snapshot_id uuid,
  snapshot_digest text,
  fetched_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  last_sync_error text,
  pending_event_key text,
  order_number text,
  event_date date,
  event_timestamp timestamptz,
  handoff_time text,
  status text,
  headcount integer check (headcount >= 0),
  fulfillment text,
  subtotal_cents bigint,
  tax_cents bigint,
  tip_cents bigint,
  fees_cents bigint,
  discounts_cents bigint,
  total_cents bigint,
  payment_status text,
  created_at timestamptz not null default now(),
  check ((snapshot_id is null) = (snapshot_digest is null))
);
create index ezcater_orders_refresh on public.ezcater_orders(event_date);
create index ezcater_orders_retry on public.ezcater_orders(provider_uuid) where last_sync_error is not null;
create index ezcater_orders_lead on public.ezcater_orders(lead_id);

-- Keep historical snapshot ownership independently of the order's current pointer.
create table public.ezcater_order_snapshots (
  id uuid primary key,
  order_id uuid not null references public.ezcater_orders(id),
  unique(order_id, id)
);
alter table public.ezcater_orders add constraint ezcater_orders_snapshot_owner
  foreign key(id, snapshot_id) references public.ezcater_order_snapshots(order_id, id)
  deferrable initially deferred;

create table public.ezcater_order_items (
  order_id uuid not null references public.ezcater_orders(id),
  snapshot_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  is_current boolean not null default true,
  provider_item_uuid text,
  name text not null check (length(name) > 0),
  quantity numeric not null check (quantity >= 0),
  unit_price_cents bigint,
  total_cents bigint,
  pos_item_id text,
  menu_item_size_id text,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  special_instructions text,
  note_to_caterer text,
  primary key (snapshot_id, ordinal),
  foreign key(order_id, snapshot_id) references public.ezcater_order_snapshots(order_id, id)
);
create unique index ezcater_order_items_current on public.ezcater_order_items(order_id, ordinal) where is_current;
create table public.ezcater_order_contacts (
  order_id uuid primary key references public.ezcater_orders(id),
  snapshot_id uuid not null,
  contact jsonb not null check (jsonb_typeof(contact) = 'object'),
  foreign key(order_id, snapshot_id) references public.ezcater_order_snapshots(order_id, id)
);

alter table public.ezcater_order_snapshots enable row level security;
create policy ezcater_order_snapshots_no_user_insert on public.ezcater_order_snapshots for insert with check(false);
create policy ezcater_order_snapshots_no_user_update on public.ezcater_order_snapshots for update using(false);
create policy ezcater_order_snapshots_no_user_delete on public.ezcater_order_snapshots for delete using(false);
alter table public.ezcater_orders enable row level security;
alter table public.ezcater_order_items enable row level security;
alter table public.ezcater_order_contacts enable row level security;
create policy ezcater_orders_no_user_insert on public.ezcater_orders for insert with check(false);
create policy ezcater_orders_no_user_update on public.ezcater_orders for update using(false);
create policy ezcater_orders_no_user_delete on public.ezcater_orders for delete using(false);
create policy ezcater_order_items_no_user_insert on public.ezcater_order_items for insert with check(false);
create policy ezcater_order_items_no_user_update on public.ezcater_order_items for update using(false);
create policy ezcater_order_items_no_user_delete on public.ezcater_order_items for delete using(false);
create policy ezcater_order_contacts_no_user_insert on public.ezcater_order_contacts for insert with check(false);
create policy ezcater_order_contacts_no_user_update on public.ezcater_order_contacts for update using(false);
create policy ezcater_order_contacts_no_user_delete on public.ezcater_order_contacts for delete using(false);
revoke all on public.ezcater_orders, public.ezcater_order_items, public.ezcater_order_contacts, public.ezcater_order_snapshots from public, anon, authenticated, service_role;
grant select on public.ezcater_orders, public.ezcater_order_items, public.ezcater_order_contacts, public.ezcater_order_snapshots to service_role;

create function public.apply_ezcater_order(
  p_provider_uuid text, p_caterer_uuid text, p_snapshot jsonb, p_digest text,
  p_event_key text default null, p_error text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_location uuid;
  v_order public.ezcater_orders%rowtype;
  v_lead public.catering_pipeline%rowtype;
  v_manager uuid;
  v_snapshot uuid := gen_random_uuid();
  v_previous_snapshot uuid;
  v_date date;
  v_target text;
  v_result text;
  v_created boolean := false;
  v_illegal boolean := false;
  v_timestamp timestamptz;
  v_code text;
begin
  if nullif(btrim(p_provider_uuid), '') is null then raise exception 'invalid_provider_uuid'; end if;
  perform pg_advisory_xact_lock(hashtext(p_provider_uuid));
  if (select count(*) from public.locations where active and ezcater_caterer_uuid = p_caterer_uuid) <> 1 then
    raise exception 'unmapped_location';
  end if;
  select id into v_location from public.locations where active and ezcater_caterer_uuid = p_caterer_uuid;
  select * into v_order from public.ezcater_orders where provider_uuid = p_provider_uuid for update;
  v_previous_snapshot := v_order.snapshot_id;
  select * into v_lead from public.catering_pipeline where external_ref = p_provider_uuid for update;
  if (v_order.id is not null and (v_order.location_id <> v_location or v_order.caterer_uuid <> p_caterer_uuid))
    or (v_lead.id is not null and (v_lead.location_id is distinct from v_location or v_lead.lead_source is distinct from 'ezcater')) then
    raise exception 'location_mismatch';
  end if;
  -- A signed lifecycle notification is actionable even when the provider fetch failed.
  v_target := case
    when p_event_key in ('cancelled','rejected','failed') then 'lost'
    when p_error is null and lower(coalesce(p_snapshot->>'status','')) in ('cancelled','canceled','rejected','failed') then 'lost'
    when p_event_key = 'accepted' then 'confirmed'
    when p_error is null and lower(coalesce(p_snapshot->>'status','')) = 'accepted' then 'confirmed'
    else null end;
  -- Same guard for fetched snapshots and fetch failures. Old acceptance is a refresh;
  -- resurrection of a lost lead and cancellation after completion remain real conflicts.
  if v_target = 'confirmed' and v_lead.stage in ('out','completed') then
    v_target := null;
  elsif v_target is not null and v_target <> v_lead.stage and v_lead.stage in ('completed','lost') then
    v_illegal := true;
    v_target := null;
  end if;
  if p_error is not null then
    -- Code only: never store an upstream error message, payload, contact or SQL detail.
    if p_error not in ('auth_failed','graphql_error','bad_payload','deadline_exceeded','timeout','network_error','ezcater_disabled','location_mismatch','apply_failed','identity_invalid','sync_failed') then
      p_error := 'sync_failed';
    end if;
    insert into public.ezcater_orders(provider_uuid,caterer_uuid,location_id,lead_id,last_sync_error,pending_event_key)
      values(p_provider_uuid,p_caterer_uuid,v_location,v_lead.id,p_error,p_event_key)
      on conflict(provider_uuid) do update set lead_id = excluded.lead_id,last_sync_error = excluded.last_sync_error,last_attempt_at = clock_timestamp(),
        pending_event_key = coalesce(excluded.pending_event_key,ezcater_orders.pending_event_key);
    v_result := case when v_illegal then 'illegal_transition'
      when v_target is not null and v_target <> v_lead.stage then 'stage_moved'
      when v_lead.id is not null and p_event_key = 'accepted' then 'refreshed'
      else 'sync_error' end;
    if v_result = 'stage_moved' then
      update public.catering_pipeline set stage = v_target, updated_at = clock_timestamp() where id = v_lead.id;
    end if;
    if v_lead.id is not null and v_result in ('stage_moved','illegal_transition') then
      insert into public.catering_pipeline_events(pipeline_id,from_stage,to_stage,note,actor_id)
        values(v_lead.id,v_lead.stage,coalesce(v_target,v_lead.stage),
          'EZCater lifecycle after fetch failure: ' || v_result,null);
    end if;
    return jsonb_build_object('lead_id',v_lead.id,'result',v_result,'sync_error',p_error,
      'created',false,'from_stage',v_lead.stage,'to_stage',coalesce(v_target,v_lead.stage),'location_id',v_location);
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or nullif(p_snapshot->>'orderNumber','') is null
    or nullif(p_digest,'') is null or jsonb_typeof(p_snapshot->'items') is distinct from 'array' then
    raise exception 'invalid_order';
  end if;
  if p_snapshot->>'catererUuid' is not null and p_snapshot->>'catererUuid' <> p_caterer_uuid then
    raise exception 'location_mismatch';
  end if;
  if v_order.snapshot_digest = p_digest then
    update public.ezcater_orders set fetched_at = clock_timestamp(),last_attempt_at = clock_timestamp(), last_sync_error = null, pending_event_key = null where id = v_order.id;
    return jsonb_build_object('lead_id',v_order.lead_id,'result','duplicate');
  end if;
  -- Derive the business date from the instant again at the transaction boundary.
  begin
    v_timestamp := nullif(p_snapshot->>'eventTimestamp','')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    v_timestamp := null;
  end;
  v_date := (v_timestamp at time zone 'America/New_York')::date;
  if v_date is null then v_code := 'timestamp_unparsed'; end if;
  if v_lead.id is null and (p_event_key is null or p_event_key in ('submitted','accepted','modified','updated')) then
    select u.id into v_manager from public.users u where u.active and u.role = 'catering_mgr'
      order by exists(select 1 from public.user_locations ul where ul.user_id = u.id and ul.location_id = v_location and ul.active) desc,
        u.created_at, u.id limit 1;
    insert into public.catering_pipeline(contact_name,stage,lead_source,external_ref,location_id,assigned_to,created_by)
      values(coalesce(nullif(btrim(p_snapshot#>>'{contact,name}'),''),'EZCater order ' || (p_snapshot->>'orderNumber')),coalesce(v_target,'inquiry'),'ezcater',p_provider_uuid,v_location,v_manager,null)
      returning * into v_lead;
    v_created := true;
  end if;
  update public.catering_pipeline set
    contact_name = coalesce(nullif(btrim(p_snapshot#>>'{contact,name}'),''),v_lead.contact_name),
    headcount = (p_snapshot->>'headcount')::integer,
    event_date = coalesce(v_date, v_lead.event_date),
    time_window = case when p_snapshot->>'handoffTime' is null then null
      else to_char((p_snapshot->>'handoffTime')::timestamptz at time zone 'America/New_York','FMHH12:MI AM') end,
    estimated_revenue_cents = (p_snapshot->>'totalDueCents')::integer,
    stage = coalesce(v_target,v_lead.stage), updated_at = clock_timestamp()
    where id = v_lead.id;
  -- Existing human notes and assignee are deliberately never written by this RPC.
  insert into public.ezcater_orders(provider_uuid,caterer_uuid,location_id,lead_id,snapshot_id,snapshot_digest,fetched_at,
      order_number,event_date,event_timestamp,handoff_time,status,headcount,fulfillment,
      subtotal_cents,tax_cents,tip_cents,fees_cents,discounts_cents,total_cents,payment_status)
    values(p_provider_uuid,p_caterer_uuid,v_location,v_lead.id,v_snapshot,p_digest,clock_timestamp(),
      p_snapshot->>'orderNumber',coalesce(v_date,v_lead.event_date),v_timestamp,p_snapshot->>'handoffTime',
      p_snapshot->>'status',(p_snapshot->>'headcount')::integer,p_snapshot->>'orderType',
      (p_snapshot->>'subtotalCents')::bigint,(p_snapshot->>'taxCents')::bigint,(p_snapshot->>'tipCents')::bigint,
      (p_snapshot->>'feesCents')::bigint,(p_snapshot->>'discountsCents')::bigint,(p_snapshot->>'totalDueCents')::bigint,p_snapshot->>'paymentStatus')
    on conflict(provider_uuid) do update set snapshot_id = excluded.snapshot_id,snapshot_digest = excluded.snapshot_digest,
      lead_id = excluded.lead_id,fetched_at = excluded.fetched_at,last_attempt_at = clock_timestamp(),last_sync_error = null,pending_event_key = null,order_number = excluded.order_number,
      event_date = excluded.event_date,event_timestamp = excluded.event_timestamp,handoff_time = excluded.handoff_time,
      status = case when p_snapshot->'enrichmentFields' ? 'status' then excluded.status else ezcater_orders.status end,
      headcount = excluded.headcount,fulfillment = excluded.fulfillment,
      subtotal_cents = excluded.subtotal_cents,
      tax_cents = case when p_snapshot->'enrichmentFields' ? 'taxCents' then excluded.tax_cents else ezcater_orders.tax_cents end,
      tip_cents = excluded.tip_cents,
      fees_cents = case when p_snapshot->'enrichmentFields' ? 'feesCents' then excluded.fees_cents else ezcater_orders.fees_cents end,
      discounts_cents = case when p_snapshot->'enrichmentFields' ? 'discountsCents' then excluded.discounts_cents else ezcater_orders.discounts_cents end,
      total_cents = excluded.total_cents,
      payment_status = case when p_snapshot->'enrichmentFields' ? 'paymentStatus' then excluded.payment_status else ezcater_orders.payment_status end
      returning * into v_order;
  insert into public.ezcater_order_snapshots(id,order_id) values(v_snapshot,v_order.id);
  update public.ezcater_order_items set is_current = false where order_id = v_order.id and is_current;
  insert into public.ezcater_order_items(order_id,snapshot_id,ordinal,provider_item_uuid,name,quantity,
      unit_price_cents,total_cents,pos_item_id,menu_item_size_id,options,special_instructions,note_to_caterer)
    select v_order.id,v_snapshot,n::integer,it->>'uuid',it->>'name',(it->>'quantity')::numeric,
      case when p_snapshot->'enrichmentFields' ? 'itemUnitPrice' then (it->>'unitPriceCents')::bigint
        else (select old.unit_price_cents from public.ezcater_order_items old
          where old.snapshot_id = v_previous_snapshot and old.provider_item_uuid = it->>'uuid'
            and old.name = it->>'name' and old.quantity = (it->>'quantity')::numeric
            and old.total_cents is not distinct from (it->>'totalCents')::bigint
            and old.pos_item_id is not distinct from it->>'posItemId'
            and old.menu_item_size_id is not distinct from it->>'menuItemSizeId'
            and old.options = coalesce(it->'customizations','[]'::jsonb)
          order by old.ordinal limit 1) end,
      (it->>'totalCents')::bigint,it->>'posItemId',it->>'menuItemSizeId',
      coalesce(it->'customizations','[]'::jsonb),it->>'specialInstructions',it->>'noteToCaterer'
      from jsonb_array_elements(p_snapshot->'items') with ordinality as x(it,n);
  -- A base-query fallback must not erase a contact learned by a successful enriched read.
  if p_snapshot->'enrichmentFields' ? 'contact' then
    insert into public.ezcater_order_contacts(order_id,snapshot_id,contact)
      values(v_order.id,v_snapshot,case when jsonb_typeof(p_snapshot->'contact') = 'object' then p_snapshot->'contact' else '{}'::jsonb end)
      on conflict(order_id) do update set contact = excluded.contact,snapshot_id = excluded.snapshot_id;
  else
    update public.ezcater_order_contacts set snapshot_id = v_snapshot where order_id = v_order.id;
  end if;
  if v_lead.id is null then return jsonb_build_object('lead_id',null,'result','unmatched','code',v_code); end if;
  v_result := case when v_created and coalesce(v_target,v_lead.stage) = 'confirmed' then 'created_lead_confirmed'
    when v_created then 'created_lead'
    when p_event_key = 'uncancelled' then 'uncancelled_needs_human'
    when v_illegal then 'illegal_transition'
    when v_target is not null and v_target <> v_lead.stage then 'stage_moved'
    when p_event_key in ('succeeded','succeeded_with_warnings','relish_finalized') then 'noted'
    else 'refreshed' end;
  insert into public.catering_pipeline_events(pipeline_id,from_stage,to_stage,note,actor_id)
    values(v_lead.id,case when v_created then null else v_lead.stage end,coalesce(v_target,v_lead.stage),
      'EZCater snapshot synchronized: ' || v_result,null);
  return jsonb_build_object('lead_id',v_lead.id,'result',v_result,'code',v_code,'created',v_created,
    'from_stage',case when v_created then null else v_lead.stage end,'to_stage',coalesce(v_target,v_lead.stage),'location_id',v_location);
end $$;
revoke all on function public.apply_ezcater_order(text,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_ezcater_order(text,text,jsonb,text,text,text) to service_role;

do $$
declare v_role text; v_table text;
  v_function regprocedure := 'public.apply_ezcater_order(text,text,jsonb,text,text,text)'::regprocedure;
begin
  foreach v_table in array array['ezcater_orders','ezcater_order_items','ezcater_order_contacts','ezcater_order_snapshots'] loop
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(v_role,'public.' || v_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(v_role,'public.' || v_table,'INSERT,UPDATE,REFERENCES')
        or (v_role <> 'service_role' and has_any_column_privilege(v_role,'public.' || v_table,'SELECT'))
        or (v_role = 'service_role' and not has_table_privilege(v_role,'public.' || v_table,'SELECT')) then
        raise exception '0223: unexpected effective table or column grant';
      end if;
    end loop;
    if exists(select 1 from pg_class c,
      lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid = ('public.' || v_table)::regclass and a.grantee = 0)
      or exists(select 1 from pg_attribute c, lateral aclexplode(c.attacl) a
        where c.attrelid = ('public.' || v_table)::regclass and a.grantee = 0) then
      raise exception '0223: PUBLIC table or column grant';
    end if;
  end loop;
  if has_function_privilege('anon',v_function,'EXECUTE')
    or has_function_privilege('authenticated',v_function,'EXECUTE')
    or not has_function_privilege('service_role',v_function,'EXECUTE')
    or exists(select 1 from pg_proc p,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid = v_function and a.grantee = 0) then
    raise exception '0223: unexpected effective function grant';
  end if;
end $$;
commit;
