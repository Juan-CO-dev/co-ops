-- SIM ONLY. Reverts the original SIM 0225 so the revised migration can be re-applied.
-- DESTRUCTIVE to SIM-derived PASS 2 rows only. Never run on production.
-- psql -v ON_ERROR_STOP=1 -f scripts/sim-revert-0225.sql
begin;
do $$ begin
 if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY: maya@sim.co-ops missing'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261008073152') then
  raise exception 'SIM ONLY: expected original 0225 version 20261008073152 missing'; end if;
end $$;
-- Restore the exact 0223 writer before removing columns it no longer needs.
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

drop trigger catering_prep_demand_bind_location on public.catering_prep_demand;
drop trigger catering_quotes_bind_location on public.catering_quotes;
drop trigger catering_orders_bind_location on public.catering_orders;
drop function public.bind_catering_insert_location();
drop function public.transfer_catering_lead(uuid,uuid,uuid,text,text);
drop function public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb);
drop function if exists public.decide_ezcater_mapping(uuid,uuid,text,uuid);
drop table if exists public.ezcater_mapping_decisions;
drop table public.ezcater_toast_links;
drop table public.ezcater_item_map;
drop table public.ezcater_review_queue;
drop table public.ezcater_shadow_depletion;
drop index if exists public.ezcater_events_entity_id;
alter table public.catering_pipeline drop column location_manually_moved_at;
alter table public.ezcater_orders drop column provider_location_observed_at;
alter table public.ezcater_orders drop column location_conflict;
alter table public.ezcater_orders drop column if exists location_manual_override;
-- Preserve every other lineage row, notably applied 0223 and reserved 0224.
delete from supabase_migrations.schema_migrations where version='20261008073152';
commit;
