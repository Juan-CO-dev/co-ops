-- CC: run ONLY on the sim after 0223. psql -v ON_ERROR_STOP=1 -f scripts/test-ezcater-enrichment.sql
-- Requires two active sim locations. All fixture writes roll back; no real contacts.
begin;
set local plpgsql.check_asserts = on;
do $$ begin
  if not exists(select 1 from public.users where email = 'maya@sim.co-ops') then
    raise exception 'SIM ONLY: maya@sim.co-ops sentinel missing';
  end if;
end $$;
create temporary table ez_test(location_id uuid, other_location_id uuid, provider_uuid text, caterer_uuid text, body jsonb);
insert into ez_test
select (array_agg(id order by id))[1], (array_agg(id order by id))[2],
  '0223-sim-' || gen_random_uuid()::text, '0223-caterer-' || gen_random_uuid()::text,
  '{"enrichmentFields":["contact","itemUnitPrice"],"orderNumber":"SIM0223","eventTimestamp":"2026-10-09T00:01:00Z","handoffTime":"2026-10-08T23:45:00Z","headcount":4,"orderType":"delivery","subtotalCents":1000,"tipCents":100,"totalDueCents":1100,"contact":{"name":"Synthetic sim contact"},"items":[{"name":"Synthetic item","quantity":2,"posItemId":"unverified-raw-id","unitPriceCents":500,"customizations":[]}]}'::jsonb
from public.locations where active;
do $$ begin
  assert (select other_location_id is not null from ez_test), 'requires two active sim locations';
end $$;
update public.locations set ezcater_caterer_uuid = t.caterer_uuid from ez_test t where id = t.location_id;
grant select on ez_test to service_role, authenticated;

-- Even a highest-role staff JWT cannot invoke the RPC or read any contact table.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","role_level":10,"app_role":"owner"}',true);
do $$ begin
  begin
    perform public.apply_ezcater_order('denied','denied','{}','denied');
    raise exception 'authenticated RPC unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.ezcater_order_contacts;
    raise exception 'authenticated contact read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
do $$
declare t record; r jsonb; s uuid; n bigint; lead uuid; event_key text; cancelled_lead uuid;
begin
  select * into t from ez_test;
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'digest-1','submitted');
  lead := (r->>'lead_id')::uuid;
  assert r->>'result' = 'created_lead';
  assert r->>'created' = 'true' and r->>'to_stage' = 'inquiry', 'create audit contract';
  assert (select contact_name = 'Synthetic sim contact' from public.catering_pipeline where id = lead), 'customer name projection';
  assert (select event_date = date '2026-10-08' and subtotal_cents = 1000 and tip_cents = 100
    from public.ezcater_orders where provider_uuid = t.provider_uuid), 'ET date or money';
  select snapshot_id into s from public.ezcater_orders where provider_uuid = t.provider_uuid;
  assert (select c.snapshot_id = s and c.contact->>'name' = 'Synthetic sim contact'
    from public.ezcater_order_contacts c join public.ezcater_orders o on o.id = c.order_id
    where o.provider_uuid = t.provider_uuid), 'contact snapshot';
  select count(*) into n from public.catering_pipeline_events where pipeline_id = lead;
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'digest-1','submitted');
  assert r->>'result' = 'duplicate';
  assert (select snapshot_id = s from public.ezcater_orders where provider_uuid = t.provider_uuid);
  assert (select count(*) = n from public.catering_pipeline_events where pipeline_id = lead), 'duplicate event';
  -- Failure is a retry marker, never a destructive replacement of the last good snapshot.
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,null,null,'accepted','raw personal payload');
  assert r->>'result' = 'stage_moved' and r->>'from_stage' = 'inquiry' and r->>'to_stage' = 'confirmed', 'accept despite fetch failure';
  assert (select snapshot_id = s and last_sync_error = 'sync_failed' and pending_event_key = 'accepted'
    from public.ezcater_orders where provider_uuid = t.provider_uuid), 'safe retry marker';
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'digest-2','accepted');
  assert r->>'result' = 'refreshed';
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body || '{"eventTimestamp":null}'::jsonb,'null-date','updated');
  assert r->>'code' = 'timestamp_unparsed', 'null date diagnostic';
  assert (select event_date = date '2026-10-08' from public.catering_pipeline where id = lead), 'null date erased lead date';
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body || '{"eventTimestamp":"bad-date"}'::jsonb,'invalid-date','updated');
  assert r->>'code' = 'timestamp_unparsed', 'invalid date diagnostic';
  assert (select count(*) = 1 from public.ezcater_order_items where order_id =
    (select id from public.ezcater_orders where provider_uuid = t.provider_uuid) and is_current);
  assert (select count(*) = 1 from public.ezcater_order_items where snapshot_id = s and not is_current);
  select snapshot_id into s from public.ezcater_orders where provider_uuid = t.provider_uuid;
  -- Item constraint fails AFTER lead and snapshot updates; the entire RPC must roll back.
  begin
    perform public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,
      jsonb_set(t.body,'{items,0,name}','""'::jsonb),'bad-digest','cancelled');
    raise exception 'invalid item unexpectedly applied';
  exception when check_violation then null; end;
  assert (select snapshot_id = s from public.ezcater_orders where provider_uuid = t.provider_uuid), 'snapshot atomicity';
  assert (select stage = 'confirmed' from public.catering_pipeline where id = lead), 'lead atomicity';
  begin
    perform public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,
      t.body || '{"catererUuid":"different-shop"}'::jsonb,'wrong-shop','updated');
    raise exception 'location mismatch unexpectedly applied';
  exception when raise_exception then
    if sqlerrm <> 'location_mismatch' then raise; end if;
  end;
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,null,null,'cancelled','network_error');
  assert r->>'result' = 'stage_moved' and r->>'from_stage' = 'confirmed' and r->>'to_stage' = 'lost', 'cancel despite fetch failure';
  assert (select stage = 'lost' from public.catering_pipeline where id = lead);
  assert (select snapshot_id = s and last_sync_error = 'network_error' and pending_event_key = 'cancelled'
    from public.ezcater_orders where provider_uuid = t.provider_uuid), 'cancel preserves snapshot and retry marker';
  assert exists(select 1 from public.catering_pipeline_events where pipeline_id = lead and from_stage = 'confirmed' and to_stage = 'lost'), 'cancel missing trail';
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'digest-cancel','cancelled');
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'digest-reaccept','accepted');
  assert r->>'result' = 'illegal_transition', 'refused transition lost its diagnostic';
  assert (select stage = 'lost' from public.catering_pipeline where id = lead), 'terminal resurrected';
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'digest-uncancel','uncancelled');
  assert r->>'result' = 'uncancelled_needs_human', 'uncancelled lost its diagnostic';
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'digest-advisory','succeeded');
  assert r->>'result' = 'noted', 'advisory lost its diagnostic';
  perform public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,
    (t.body - 'contact') || '{"enrichmentFields":[]}'::jsonb,'base-fallback','updated');
  assert (select c.snapshot_id = o.snapshot_id and c.contact->>'name' = 'Synthetic sim contact'
    from public.ezcater_order_contacts c join public.ezcater_orders o on o.id = c.order_id
    where o.provider_uuid = t.provider_uuid), 'base fallback erased contact or snapshot coherence';
  r := public.apply_ezcater_order(t.provider_uuid || '-unmatched',t.caterer_uuid,t.body,'unmatched','cancelled');
  assert r->>'result' = 'unmatched' and r->>'lead_id' is null;
  assert exists(select 1 from public.ezcater_orders where provider_uuid = t.provider_uuid || '-unmatched'), 'unmatched snapshot missing';
  r := public.apply_ezcater_order(t.provider_uuid || '-fetch-failure',t.caterer_uuid,null,null,'cancelled','timeout');
  assert r->>'lead_id' is null and r->>'result' = 'sync_error', 'fetch failure created a lead';
  assert (select last_sync_error = 'timeout' from public.ezcater_orders where provider_uuid = t.provider_uuid || '-fetch-failure'), 'timeout lost';
  -- The nightly read has no notification key: current provider cancellation must
  -- still move a confirmed lead to lost before the generic completion selection.
  r := public.apply_ezcater_order(t.provider_uuid || '-nightly',t.caterer_uuid,t.body,'nightly-before','accepted');
  perform public.apply_ezcater_order(t.provider_uuid || '-nightly',t.caterer_uuid,
    t.body || '{"status":"CANCELLED","enrichmentFields":["status","contact","itemUnitPrice"]}'::jsonb,'nightly-cancel',null);
  assert (select stage = 'lost' from public.catering_pipeline where id = (r->>'lead_id')::uuid), 'nightly cancellation missed';
  foreach event_key in array array['rejected','failed'] loop
    r := public.apply_ezcater_order(t.provider_uuid || '-' || event_key,t.caterer_uuid,t.body,'before-failure','accepted');
    cancelled_lead := (r->>'lead_id')::uuid;
    r := public.apply_ezcater_order(t.provider_uuid || '-' || event_key,t.caterer_uuid,null,null,event_key,'graphql_error');
    assert r->>'result' = 'stage_moved', 'terminal lifecycle fetch failure not applied';
    assert (select stage = 'lost' from public.catering_pipeline where id = cancelled_lead), 'terminal lifecycle lead not lost';
  end loop;
  -- BYPASSRLS is not a grant: direct writes still fail for service_role.
  begin
    update public.ezcater_orders set last_sync_error = 'bypass' where provider_uuid = t.provider_uuid;
    raise exception 'direct service write unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Prove existing-lead location binding and human-field preservation as the sim owner.
do $$
declare t record; lead uuid; r jsonb; other_order uuid; s uuid;
begin
  select * into t from ez_test;
  select lead_id into lead from public.ezcater_orders where provider_uuid = t.provider_uuid;
  update public.catering_pipeline set notes = 'Synthetic human note', location_id = t.other_location_id where id = lead;
  begin
    perform public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'wrong-lead-shop','updated');
    raise exception 'lead location mismatch unexpectedly applied';
  exception when raise_exception then
    if sqlerrm <> 'location_mismatch' then raise; end if;
  end;
  update public.catering_pipeline set location_id = t.location_id where id = lead;
  perform public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'human-preserved','updated');
  assert (select notes = 'Synthetic human note' from public.catering_pipeline where id = lead), 'human note erased';
  perform public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,
    jsonb_set(t.body,'{contact,name}','"Synthetic renamed customer"'::jsonb),'rename-contact','updated');
  assert (select contact_name = 'Synthetic renamed customer' from public.catering_pipeline where id = lead), 'existing placeholder not replaced';
  -- Existing completed/out leads treat behind-stage acceptance as a refresh, including
  -- the fetch-error path. Cancellation after completion is still a real conflict.
  update public.catering_pipeline set stage = 'completed' where id = lead;
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'completed-accept','accepted');
  assert r->>'result' = 'refreshed', 'old acceptance incorrectly flagged';
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,null,null,'accepted','timeout');
  assert r->>'result' = 'refreshed', 'failed old acceptance incorrectly flagged';
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,null,null,'cancelled','graphql_error');
  assert r->>'result' = 'illegal_transition', 'cancellation after completion not flagged';
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'completed-cancel','cancelled');
  assert r->>'result' = 'illegal_transition', 'fetched cancellation after completion not flagged';
  assert (select stage = 'completed' from public.catering_pipeline where id = lead), 'completed lead changed';
  update public.catering_pipeline set stage = 'out' where id = lead;
  r := public.apply_ezcater_order(t.provider_uuid,t.caterer_uuid,t.body,'out-accept','accepted');
  assert r->>'result' = 'refreshed', 'out lead acceptance incorrectly flagged';
  assert (select stage = 'out' from public.catering_pipeline where id = lead), 'out lead regressed';
  -- Composite FK rejects an otherwise valid item whose snapshot belongs to another order.
  select snapshot_id into s from public.ezcater_orders where provider_uuid = t.provider_uuid;
  select id into other_order from public.ezcater_orders where provider_uuid = t.provider_uuid || '-unmatched';
  begin
    insert into public.ezcater_order_items(order_id,snapshot_id,ordinal,name,quantity)
      values(other_order,s,99,'Synthetic forged owner',1);
    raise exception 'cross-order snapshot unexpectedly allowed';
  exception when foreign_key_violation then null; end;
end $$;
-- Force the deferred current-snapshot ownership check before rolling fixtures back.
set constraints all immediate;
rollback;
