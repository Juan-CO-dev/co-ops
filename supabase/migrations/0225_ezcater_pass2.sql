-- 0225 ezCater PASS 2 + catering shop transfers. AUTHORED 2026-10-08; NOT APPLIED -- GATE CC/Juan.
-- 0224 is reserved for digest v2. Apply in sim and run the supplied harness first.
begin;
alter table public.catering_pipeline add column location_manually_moved_at timestamptz;
alter table public.ezcater_orders add column provider_location_observed_at timestamptz;
alter table public.ezcater_orders add column location_conflict boolean not null default false;

-- Existing service writers can finish an insert after reading a pre-transfer quote.
-- Serialize insertion on the parent and bind outstanding obligations to its current shop.
create function public.bind_catering_insert_location() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_location uuid;
begin
  if new.pipeline_id is null then return new; end if;
  if tg_table_name = 'catering_prep_demand' then
    if new.status <> 'reserved' then return new; end if;
  end if;
  select location_id into v_location from public.catering_pipeline where id = new.pipeline_id for update;
  if v_location is not null then new.location_id := v_location; end if;
  return new;
end $$;
revoke all on function public.bind_catering_insert_location() from public,anon,authenticated,service_role;
create trigger catering_prep_demand_bind_location before insert on public.catering_prep_demand
  for each row execute function public.bind_catering_insert_location();
create trigger catering_quotes_bind_location before insert on public.catering_quotes
  for each row execute function public.bind_catering_insert_location();
create trigger catering_orders_bind_location before insert on public.catering_orders
  for each row execute function public.bind_catering_insert_location();

-- Internal atomic writer shared by human transfers and provider reassignment.
create function public.transfer_catering_lead(p_lead_id uuid, p_location_id uuid,
  p_actor_id uuid, p_reason text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_lead public.catering_pipeline%rowtype; v_role text; v_from text; v_to text; v_provider text;
begin
  -- Same lock order as apply_ezcater_order: provider advisory, lead, snapshot.
  select external_ref into v_provider from public.catering_pipeline where id = p_lead_id and lead_source = 'ezcater';
  if v_provider is not null then perform pg_advisory_xact_lock(hashtext(v_provider)); end if;
  if p_actor_id is not null then
    select role into v_role from public.users where id = p_actor_id and active;
    if v_role is null or v_role not in ('catering_mgr','moo','owner','cgs') then raise exception 'transfer_forbidden'; end if;
    if p_reason is null or p_reason not in ('capacity','customer_pickup_preference','closer_delivery','other')
      or (p_reason = 'other' and nullif(btrim(p_note),'') is null) or length(coalesce(p_note,'')) > 1000 then
      raise exception 'transfer_invalid_reason';
    end if;
  elsif p_reason is distinct from 'ezCater reassignment' then raise exception 'transfer_forbidden'; end if;
  select * into v_lead from public.catering_pipeline where id = p_lead_id for update;
  if not found then raise exception 'transfer_lead_not_found'; end if;
  select name into v_to from public.locations where id = p_location_id and active;
  if not found then raise exception 'transfer_invalid_location'; end if;
  if v_lead.location_id = p_location_id then
    return jsonb_build_object('result','unchanged','from_location_id',v_lead.location_id,'to_location_id',p_location_id,'prep_preserved',true);
  end if;
  select name into v_from from public.locations where id = v_lead.location_id;
  update public.catering_pipeline set location_id = p_location_id, updated_at = clock_timestamp(),
    location_manually_moved_at = case when p_actor_id is not null then clock_timestamp() else location_manually_moved_at end
    where id = p_lead_id;
  -- Quotes attribute revenue; W4b is computed from the W4a reserved rows below.
  update public.catering_quotes set location_id = p_location_id where pipeline_id = p_lead_id;
  update public.catering_orders set location_id = p_location_id where pipeline_id = p_lead_id;
  -- Retire and append reserved obligations; consumed/released rows and productions stay historical.
  with retired as (
    update public.catering_prep_demand set status = 'released', released_at = clock_timestamp()
      where pipeline_id = p_lead_id and status = 'reserved' returning *
  ) insert into public.catering_prep_demand(pipeline_id,quote_id,location_id,need_date,item_id,menu_item_id,
      choice_package_item_id,portion,qty,created_by)
    select pipeline_id,quote_id,p_location_id,need_date,item_id,menu_item_id,choice_package_item_id,portion,qty,p_actor_id from retired;
  update public.ezcater_orders o set location_id = p_location_id,
    provider_location_observed_at = coalesce(o.provider_location_observed_at,o.fetched_at,o.created_at),
    location_conflict = not exists(select 1 from public.locations l where l.id = p_location_id and l.ezcater_caterer_uuid = o.caterer_uuid)
    where lead_id = p_lead_id;
  -- Retire comparison artifacts; the next shadow run recomputes at the new shop.
  update public.ezcater_toast_links set is_current = false
    where order_id in (select id from public.ezcater_orders where lead_id = p_lead_id) and is_current;
  update public.ezcater_shadow_depletion set is_current = false
    where order_id in (select id from public.ezcater_orders where lead_id = p_lead_id) and is_current;
  insert into public.catering_pipeline_events(pipeline_id,from_stage,to_stage,note,actor_id)
    values(p_lead_id,v_lead.stage,v_lead.stage,
      'Shop transfer: ' || coalesce(v_from,'Unassigned') || ' -> ' || v_to || '; ' || p_reason ||
      case when nullif(btrim(p_note),'') is null then '' else '; ' || btrim(p_note) end ||
      '. Prep already logged remains at its original shop.',p_actor_id);
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
    values(p_actor_id,v_role,case when p_actor_id is null then 'ezcater.location_reassigned' else 'catering.pipeline.transfer_location' end,
      'catering_pipeline',p_lead_id,jsonb_build_object('from_location_id',v_lead.location_id,'to_location_id',p_location_id,
      'reason',p_reason,'prep_preserved',true),p_actor_id is not null);
  return jsonb_build_object('result','moved','from_location_id',v_lead.location_id,'to_location_id',p_location_id,'prep_preserved',true);
end $$;
revoke all on function public.transfer_catering_lead(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.transfer_catering_lead(uuid,uuid,uuid,text,text) to service_role;

-- Re-emitted 0223 apply body; transfer arbitration is inside the snapshot transaction.
create or replace function public.apply_ezcater_order(
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
  v_evidence timestamptz;
  v_conflict boolean := false;
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
  if v_lead.id is not null and v_lead.lead_source is distinct from 'ezcater' then
    raise exception 'location_mismatch';
  end if;
  -- A repeated refresh is not new provider reassignment evidence. Use signed receipt
  -- time when available; first observed identity changes use fetch-start time.
  select max(received_at) into v_evidence from public.ezcater_events
    where entity_id = p_provider_uuid and parent_id = p_caterer_uuid and signature_valid
      and raw->>'entity_type' = 'Order';
  if v_order.caterer_uuid = p_caterer_uuid then
    v_evidence := coalesce(v_order.provider_location_observed_at,v_evidence,v_order.fetched_at,v_order.created_at);
  else
    v_evidence := coalesce(v_evidence, nullif(p_snapshot->>'locationObservedAt','')::timestamptz, clock_timestamp());
  end if;
  if v_lead.id is not null and v_lead.location_id is distinct from v_location then
    if v_lead.location_manually_moved_at is not null and v_lead.location_manually_moved_at >= v_evidence then
      v_conflict := true;
      if not coalesce(v_order.location_conflict,false) then
        insert into public.catering_pipeline_events(pipeline_id,from_stage,to_stage,note,actor_id)
          values(v_lead.id,v_lead.stage,v_lead.stage,'ezCater shop reassignment conflicts with a newer manual transfer; review required.',null);
        insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
          values(null,null,'ezcater.location_reassigned','catering_pipeline',v_lead.id,
            jsonb_build_object('result','manual_location_conflict','kept_location_id',v_lead.location_id,'provider_location_id',v_location),false);
      end if;
      v_location := v_lead.location_id;
    elsif p_error is null then
      perform public.transfer_catering_lead(v_lead.id,v_location,null,'ezCater reassignment',null);
      v_lead.location_id := v_location;
    else
      -- An unsuccessful provider fetch cannot reverse a manual or provider move.
      v_location := v_lead.location_id;
    end if;
  end if;
  if v_order.id is not null then
    update public.ezcater_orders set location_conflict = v_conflict where id = v_order.id;
    if p_error is null then
      update public.ezcater_orders set location_id = v_location, caterer_uuid = p_caterer_uuid,
        provider_location_observed_at = v_evidence where id = v_order.id;
    end if;
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
  update public.ezcater_orders set location_id = v_location, caterer_uuid = p_caterer_uuid,
    provider_location_observed_at = v_evidence, location_conflict = v_conflict where id = v_order.id;
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

-- Included verbatim in 0225. Derived SHADOW rows never feed operational depletion.
create table public.ezcater_toast_links (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.ezcater_orders(id),
 snapshot_id uuid not null, location_id uuid not null references public.locations(id),
 toast_snapshot_id uuid not null references public.toast_orders(id), order_guid text not null,
 check_guid text not null, selection_guid text not null, business_date date not null,
 evidence text not null check(evidence='normalized_code'), is_current boolean not null default true,
 created_at timestamptz not null default now(),
 foreign key(order_id,snapshot_id) references public.ezcater_order_snapshots(order_id,id)
);
create unique index ezcater_toast_links_selection on public.ezcater_toast_links(location_id,check_guid,selection_guid) where is_current;
create index ezcater_toast_links_order on public.ezcater_toast_links(order_id) where is_current;
create table public.ezcater_item_map (
 location_id uuid not null references public.locations(id), identity_key text not null,
 provider_item_uuid text not null, menu_item_size_id text, pos_item_id text,
 toast_item_guid text, item_id uuid references public.items(id), menu_item_id uuid references public.menu_items(id),
 status text not null check(status in ('confirmed','review')), evidence text check(evidence='pos_guid'),
 candidates jsonb not null default '[]'::jsonb check(jsonb_typeof(candidates)='array'),
 updated_at timestamptz not null default now(), primary key(location_id,identity_key),
 check(status <> 'confirmed' or (evidence='pos_guid' and toast_item_guid is not null and
   (item_id is not null)::int+(menu_item_id is not null)::int=1))
);
create table public.ezcater_review_queue (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.ezcater_orders(id),
 snapshot_id uuid not null, location_id uuid not null references public.locations(id),
 source text not null check(source in ('ezcater','toast')), code text not null, identity_key text not null,
 candidates jsonb not null default '[]'::jsonb check(jsonb_typeof(candidates)='array'),
 created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), resolved_at timestamptz,
 unique(order_id,source,code,identity_key),
 foreign key(order_id,snapshot_id) references public.ezcater_order_snapshots(order_id,id)
);
create table public.ezcater_shadow_depletion (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.ezcater_orders(id),
 snapshot_id uuid not null, location_id uuid not null references public.locations(id), event_date date not null,
 ordinal integer not null, sku_id uuid not null references public.vendor_items(id),
 sales_oz numeric not null check(sales_oz>=0), suppressed_oz numeric not null check(suppressed_oz>=0),
 shadow_oz numeric not null check(shadow_oz>=0), current_day_sales_oz numeric, is_current boolean not null default true,
 computed_at timestamptz not null default now(), check(abs(sales_oz-suppressed_oz-shadow_oz)<0.000001),
 foreign key(order_id,snapshot_id) references public.ezcater_order_snapshots(order_id,id)
);
create index ezcater_shadow_order on public.ezcater_shadow_depletion(order_id) where is_current;
do $$ declare t text; begin
 foreach t in array array['ezcater_toast_links','ezcater_item_map','ezcater_review_queue','ezcater_shadow_depletion'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for select using(false)',t||'_no_user_select',t);
  execute format('create policy %I on public.%I for insert with check(false)',t||'_no_user_insert',t);
  execute format('create policy %I on public.%I for update using(false)',t||'_no_user_update',t);
  execute format('create policy %I on public.%I for delete using(false)',t||'_no_user_delete',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;

create function public.publish_ezcater_shadow(p_order_id uuid,p_snapshot_id uuid,p_location_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.ezcater_orders%rowtype; l public.catering_pipeline%rowtype; r jsonb;
begin
 -- Share apply/transfer's provider lock before any row locks; snapshot/shop fence stale work.
 select * into o from public.ezcater_orders where id=p_order_id;
 if o.id is null then raise exception 'ezcater_shadow_source_changed'; end if;
 perform pg_advisory_xact_lock(hashtext(o.provider_uuid));
 select * into l from public.catering_pipeline where id=o.lead_id for update;
 select * into o from public.ezcater_orders where id=p_order_id for update;
 if o.id is null or o.snapshot_id is distinct from p_snapshot_id or l.location_id is distinct from p_location_id then
  raise exception 'ezcater_shadow_source_changed';
 end if;
 update public.ezcater_toast_links set is_current=false where order_id=o.id and is_current;
 update public.ezcater_shadow_depletion set is_current=false where order_id=o.id and is_current;
 update public.ezcater_review_queue set resolved_at=clock_timestamp() where order_id=o.id and resolved_at is null;
 for r in select value from jsonb_array_elements(p_payload->'links') loop
  if not exists(select 1 from public.toast_order_latest_pointers p join public.toast_orders t on t.id=p.snapshot_id
   where p.snapshot_id=(r->>'toast_snapshot_id')::uuid and p.location_id=p_location_id
    and t.order_guid=r->>'order_guid' and abs(t.business_date-o.event_date)<=1
    and not t.voided and not t.deleted and not t.excess_food
    and exists(select 1 from jsonb_array_elements(t.selection_units) s
      where s->>'check_guid'=r->>'check_guid' and s->>'selection_guid'=r->>'selection_guid'
       and not (s->>'voided')::boolean and not (s->>'deleted')::boolean)) then
   raise exception 'ezcater_shadow_toast_changed';
  end if;
  insert into public.ezcater_toast_links(order_id,snapshot_id,location_id,toast_snapshot_id,order_guid,check_guid,selection_guid,business_date,evidence)
  values(o.id,o.snapshot_id,p_location_id,(r->>'toast_snapshot_id')::uuid,r->>'order_guid',r->>'check_guid',r->>'selection_guid',(r->>'business_date')::date,'normalized_code');
 end loop;
 for r in select value from jsonb_array_elements(p_payload->'maps') loop
  insert into public.ezcater_item_map(location_id,identity_key,provider_item_uuid,menu_item_size_id,pos_item_id,toast_item_guid,item_id,menu_item_id,status,evidence,candidates)
  values(p_location_id,r->>'identity_key',r->>'provider_item_uuid',r->>'menu_item_size_id',r->>'pos_item_id',r->>'toast_item_guid',(r->>'item_id')::uuid,(r->>'menu_item_id')::uuid,r->>'status',r->>'evidence',r->'candidates')
  on conflict(location_id,identity_key) do update set pos_item_id=excluded.pos_item_id,toast_item_guid=excluded.toast_item_guid,
   item_id=excluded.item_id,menu_item_id=excluded.menu_item_id,status=excluded.status,evidence=excluded.evidence,candidates=excluded.candidates,updated_at=clock_timestamp();
 end loop;
 for r in select value from jsonb_array_elements(p_payload->'reviews') loop
  insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key,candidates)
  values(o.id,o.snapshot_id,p_location_id,r->>'source',r->>'code',r->>'identity_key',r->'candidates')
  on conflict(order_id,source,code,identity_key) do update set snapshot_id=excluded.snapshot_id,location_id=excluded.location_id,
   candidates=excluded.candidates,last_seen_at=clock_timestamp(),resolved_at=null;
 end loop;
 for r in select value from jsonb_array_elements(p_payload->'shadow') loop
  insert into public.ezcater_shadow_depletion(order_id,snapshot_id,location_id,event_date,ordinal,sku_id,sales_oz,suppressed_oz,shadow_oz,current_day_sales_oz)
  values(o.id,o.snapshot_id,p_location_id,o.event_date,(r->>'ordinal')::int,(r->>'sku_id')::uuid,
   (r->>'sales_oz')::numeric,(r->>'suppressed_oz')::numeric,(r->>'shadow_oz')::numeric,(r->>'current_day_sales_oz')::numeric);
 end loop;
end $$;
revoke all on function public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb) to service_role;
do $$ declare t text; r text; begin
 foreach t in array array['ezcater_toast_links','ezcater_item_map','ezcater_review_queue','ezcater_shadow_depletion'] loop
  foreach r in array array['anon','authenticated'] loop
   if has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'ezcater_pass2_acl'; end if;
  end loop;
  if not has_table_privilege('service_role','public.'||t,'SELECT') or has_table_privilege('service_role','public.'||t,'INSERT,UPDATE,DELETE') then raise exception 'ezcater_pass2_service_acl'; end if;
 end loop;
 if has_function_privilege('anon','public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb)','EXECUTE') or
 has_function_privilege('authenticated','public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb)','EXECUTE') or
 not has_function_privilege('service_role','public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb)','EXECUTE') then raise exception 'ezcater_pass2_function_acl'; end if;
end $$;

-- Effective ACL check includes PUBLIC and column-level grants, not just table ACLs.
do $$
declare f regprocedure; t text; r text;
begin
  f := 'public.bind_catering_insert_location()'::regprocedure;
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
    or has_function_privilege('service_role',f,'EXECUTE')
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=f and a.grantee=0) then raise exception '0225: trigger function callable'; end if;
  foreach f in array array['public.transfer_catering_lead(uuid,uuid,uuid,text,text)'::regprocedure,
    'public.apply_ezcater_order(text,text,jsonb,text,text,text)'::regprocedure,
    'public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb)'::regprocedure] loop
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
      or not has_function_privilege('service_role',f,'EXECUTE')
      or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=f and a.grantee=0) then raise exception '0225: unexpected effective function grant'; end if;
  end loop;
  foreach t in array array['ezcater_toast_links','ezcater_item_map','ezcater_review_queue','ezcater_shadow_depletion'] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(r,'public.'||t,'INSERT,UPDATE,REFERENCES')
        or (r <> 'service_role' and has_any_column_privilege(r,'public.'||t,'SELECT')) then
        raise exception '0225: unexpected effective table or column grant';
      end if;
    end loop;
    if exists(select 1 from pg_class c,lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid=('public.'||t)::regclass and a.grantee=0)
      or exists(select 1 from pg_attribute c,lateral aclexplode(c.attacl) a
        where c.attrelid=('public.'||t)::regclass and a.grantee=0) then raise exception '0225: PUBLIC table or column grant'; end if;
  end loop;
end $$;
commit;
