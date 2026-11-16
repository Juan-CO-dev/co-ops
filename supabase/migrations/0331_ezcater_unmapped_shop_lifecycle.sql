-- Migration 0331_ezcater_unmapped_shop_lifecycle
-- AUTHORED 2026-11-15. NOT YET APPLIED - sim first; PROD APPLY ONLY ON JUAN'S WORD (owner decision W23-5 b).
-- Provenance: bug-audit wave W23 "ezCater orders and catering customer records" (found at 7494f738),
--   owner decision W23-5 b on bug B125: fix orders linked to a shop whose ezCater mapping was cleared,
--   as a SEPARATE migration from 0330. Reviewed plan: audit/plans/W23.md (B125 "Owner/CC decision").
-- WHAT: apply_ezcater_order(text,text,jsonb,text,text,text) <- 0225, ONE change. When no single
--   active shop carries the order's caterer UUID (a shop's ezCater mapping was cleared on the admin
--   ezCater tab, or the shop was deactivated) the function raised `unmapped_location` for EVERY
--   order, so an order that already had a lead stopped receiving its cancellation, acceptance and
--   refreshes (W23/B125's app fix parks such an order; it does not apply it). Now:
--     - an order whose ezCater lead already exists keeps applying at the LEAD'S OWN shop: the lead
--       is never moved (its shop IS the location, so no transfer runs), the ezcater_orders row keeps
--       that shop, and the result carries code `unmapped_location_kept` (the app's
--       ezcater.order_synced audit row records it);
--     - an order with no lead is still refused `unmapped_location` (parked by the app, as before);
--     - a mapped caterer behaves exactly as before.
--   Every other line is 0225's (pinned by tests/ezcater-w23-0331-migration.test.ts).
-- WHO SEES IT: a catering manager whose shop's ezCater mapping was cleared sees that shop's existing
--   ezCater leads move to Lost / Confirmed again when ezCater says so (they froze before).
-- LOCK ORDER: unchanged. The provider advisory lock is still first; the added lead read is a plain
--   read, and the order / lead FOR UPDATE reads that follow keep their order.
-- ROLLOUT: independent of 0330 and of the app (the app parks unmapped_location the same either way).
--   Read-only check before apply (the leads this un-freezes):
--     select p.id, p.stage, p.location_id from public.catering_pipeline p
--       join public.ezcater_orders o on o.provider_uuid = p.external_ref
--      where p.lead_source = 'ezcater'
--        and (select count(*) from public.locations l where l.active and l.ezcater_caterer_uuid = o.caterer_uuid) <> 1;
-- VERIFY AFTER APPLY:
--   select strpos(pg_get_functiondef('public.apply_ezcater_order(text,text,jsonb,text,text,text)'::regprocedure),
--     'unmapped_location_kept') > 0; -- t
-- PROOF: scripts/sql-harness-0331.mjs (PGlite, offline).
-- ROLLBACK: forward-only. Re-emit 0225's body in a NEW migration; never rewrite history.
begin;

do $$
declare v_def text;
begin
  if to_regprocedure('public.apply_ezcater_order(text,text,jsonb,text,text,text)') is null then
    raise exception '0331: expected apply_ezcater_order(text,text,jsonb,text,text,text)';
  end if;
  v_def := pg_get_functiondef('public.apply_ezcater_order(text,text,jsonb,text,text,text)'::regprocedure);
  if strpos(v_def, 'unmapped_location_kept') > 0 then raise exception '0331: already applied'; end if;
  if strpos(v_def, 'perform public.transfer_catering_lead(v_lead.id,v_location,null,''ezCater reassignment'',null);') = 0
     or strpos(v_def, 'raise exception ''unmapped_location'';') = 0
     or strpos(v_def, 'v_manual_override boolean := false;') = 0 then
    raise exception '0331: apply_ezcater_order drifted from 0225';
  end if;
end $$;

-- apply_ezcater_order <- 0225 (W23-5 b: an order with a lead keeps applying at the lead's own shop).
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
  v_manual_override boolean := false;
  v_unmapped boolean := false;
begin
  if nullif(btrim(p_provider_uuid), '') is null then raise exception 'invalid_provider_uuid'; end if;
  perform pg_advisory_xact_lock(hashtext(p_provider_uuid));
  if (select count(*) from public.locations where active and ezcater_caterer_uuid = p_caterer_uuid) = 1 then
    select id into v_location from public.locations where active and ezcater_caterer_uuid = p_caterer_uuid;
  else
    -- W23-5 b: no single active shop carries this caterer (its mapping was cleared or the shop was
    -- deactivated). An order that already has its lead keeps applying cancellations / acceptances
    -- at the LEAD'S OWN shop (never moved); a new order is still parked (unmapped_location, W23/B125).
    select location_id into v_location from public.catering_pipeline
      where external_ref = p_provider_uuid and lead_source = 'ezcater' and location_id is not null;
    if v_location is null then raise exception 'unmapped_location'; end if;
    v_unmapped := true;
    v_code := 'unmapped_location_kept';
  end if;
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
      v_manual_override := true;
      if not coalesce(v_order.location_manual_override,false) or v_order.caterer_uuid is distinct from p_caterer_uuid then
        insert into public.catering_pipeline_events(pipeline_id,from_stage,to_stage,note,actor_id)
          values(v_lead.id,v_lead.stage,v_lead.stage,'ezCater lists ' || (select name from public.locations where id=v_location) || '; kept at ' ||
            (select name from public.locations where id=v_lead.location_id) || ' by manual move',null);
        insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
          values(null,null,'ezcater.location_reassigned','catering_pipeline',v_lead.id,
            jsonb_build_object('result','manual_location_kept','kept_location_id',v_lead.location_id,'provider_location_id',v_location),false);
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
    update public.ezcater_orders set location_conflict = v_conflict, location_manual_override = v_manual_override where id = v_order.id;
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
      'created',false,'from_stage',v_lead.stage,'to_stage',coalesce(v_target,v_lead.stage),'location_id',v_location,
      'code',case when v_unmapped then 'unmapped_location_kept' end);
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
    provider_location_observed_at = v_evidence, location_conflict = v_conflict, location_manual_override = v_manual_override where id = v_order.id;
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
            and nullif(btrim(old.pos_item_id),'') is not distinct from nullif(btrim(it->>'posItemId'),'')
            and old.menu_item_size_id is not distinct from it->>'menuItemSizeId'
            and old.options = coalesce(it->'customizations','[]'::jsonb)
          order by old.ordinal limit 1) end,
      (it->>'totalCents')::bigint,nullif(btrim(it->>'posItemId'),''),it->>'menuItemSizeId',
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
declare f regprocedure := 'public.apply_ezcater_order(text,text,jsonb,text,text,text)'::regprocedure;
begin
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
    or not has_function_privilege('service_role', f, 'EXECUTE')
    or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = f and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '0331: RPC execution grant escaped for %', f;
  end if;
  if exists (select 1 from pg_proc where oid = f and (not prosecdef or
    not ('search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))))) then
    raise exception '0331: RPC execution context escaped for %', f;
  end if;
end $$;

INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
VALUES (NULL, NULL, 'security.grants_change', 'ezcater_orders', NULL, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0331_ezcater_unmapped_shop_lifecycle',
    'change', 'an ezCater order whose lead exists keeps applying lifecycle at the lead''s shop when its caterer mapping is cleared',
    'decision', 'W23-5 b', 'bugs', jsonb_build_array('B125')));
commit;
