-- CC SIM ONLY after 0225: psql -v ON_ERROR_STOP=1 -f scripts/test-catering-transfers.sql
begin;
set local plpgsql.check_asserts = on;
do $$
declare a uuid; b uuid; lead uuid; manager uuid; denied uuid; q uuid; item uuid;
  provider text := '0225-sim-' || gen_random_uuid(); body jsonb; n bigint;
begin
  if not exists(select 1 from public.users where email = 'maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
  select (array_agg(id order by id))[1],(array_agg(id order by id))[2] into a,b from public.locations where active;
  select id into manager from public.users where active and role = 'catering_mgr' limit 1;
  select id into denied from public.users where active and role not in ('catering_mgr','moo','owner','cgs') limit 1;
  select id into item from public.items limit 1;
  assert a is not null and b is not null and manager is not null and denied is not null and item is not null, 'sim fixtures required';
  update public.locations set ezcater_caterer_uuid = 'sim-transfer-a' where id = a;
  update public.locations set ezcater_caterer_uuid = 'sim-transfer-b' where id = b;
  body := '{"orderNumber":"SIM225","eventTimestamp":"2026-10-09T12:00:00Z","items":[],"enrichmentFields":[]}'::jsonb;
  lead := (public.apply_ezcater_order(provider,'sim-transfer-a',body,'sim-a','accepted')->>'lead_id')::uuid;
  insert into public.catering_quotes(pipeline_id,location_id,event_date) values(lead,a,'2026-10-09') returning id into q;
  insert into public.catering_prep_demand(pipeline_id,quote_id,location_id,need_date,item_id,qty,status)
    values(lead,q,a,'2026-10-09',item,2,'reserved'),(lead,q,a,'2026-10-09',item,1,'consumed');
  select count(*) into n from public.productions;
  -- Migration rollout: old snapshot has no provider observation timestamp yet.
  update public.ezcater_orders set provider_location_observed_at = null where provider_uuid = provider;
  begin
    perform public.transfer_catering_lead(lead,b,denied,'capacity');
    raise exception 'unauthorized transfer succeeded';
  exception when raise_exception then if sqlerrm <> 'transfer_forbidden' then raise; end if; end;
  perform public.transfer_catering_lead(lead,b,manager,'capacity');
  assert (select provider_location_observed_at is not null from public.ezcater_orders where provider_uuid = provider), 'manual transfer pins prior provider evidence';
  assert (select location_id = b from public.catering_pipeline where id = lead);
  assert (select location_id = b from public.catering_quotes where id = q), 'quote attribution';
  assert (select count(*) = 1 from public.catering_prep_demand where pipeline_id = lead and location_id = b and status = 'reserved'), 'W4a/W4b follows';
  assert (select count(*) = 1 from public.catering_prep_demand where pipeline_id = lead and location_id = a and status = 'consumed'), 'history preserved';
  assert (select count(*) = n from public.productions), 'production untouched';
  assert exists(select 1 from public.catering_pipeline_events where pipeline_id = lead and actor_id = manager and note like 'Shop transfer:%');
  -- Simulate reserve writer completing with an old quote/location after the transfer.
  insert into public.catering_prep_demand(pipeline_id,quote_id,location_id,need_date,item_id,qty,status)
    values(lead,q,a,'2026-10-09',item,3,'reserved');
  assert not exists(select 1 from public.catering_prep_demand where pipeline_id = lead and location_id = a and status = 'reserved'), 'stale writer stranded demand';
  perform public.apply_ezcater_order(provider,'sim-transfer-a',body,'sim-repeat','updated');
  assert (select location_id = b from public.catering_pipeline where id = lead), 'recent manual assignment lost';
  assert not (select location_conflict from public.ezcater_orders where provider_uuid = provider), 'manual choice is not a conflict';
  assert (select location_manual_override from public.ezcater_orders where provider_uuid = provider), 'manual choice information missing';
  -- Stable provider refreshes must not append the same informational event forever.
  select count(*) into n from public.catering_pipeline_events where pipeline_id = lead and note like 'ezCater lists %';
  perform public.apply_ezcater_order(provider,'sim-transfer-a',body,'sim-repeat-2','updated');
  assert (select count(*) = n from public.catering_pipeline_events where pipeline_id = lead and note like 'ezCater lists %'), 'repeat informational event';
  update public.catering_pipeline set location_manually_moved_at = null, stage = 'completed' where id = lead;
  perform public.apply_ezcater_order(provider,'sim-transfer-a',body,'sim-reassigned','updated');
  assert (select location_id = a and stage = 'completed' from public.catering_pipeline where id = lead), 'completed transfer';
  assert not (select location_conflict from public.ezcater_orders where provider_uuid = provider);
  assert exists(select 1 from public.audit_log where resource_id = lead and action = 'ezcater.location_reassigned' and actor_id is null and not destructive);
  -- Keith's catering_mgr role may correct revenue attribution after completion or loss.
  perform public.transfer_catering_lead(lead,b,manager,'capacity');
  assert (select stage = 'completed' and location_id = b from public.catering_pipeline where id = lead), 'manager completed correction';
  assert (select location_id = b from public.catering_quotes where id = q), 'completed revenue follows';
  update public.catering_pipeline set stage = 'lost' where id = lead;
  perform public.transfer_catering_lead(lead,a,manager,'capacity');
  assert (select stage = 'lost' and location_id = a from public.catering_pipeline where id = lead), 'manager lost correction';
  assert (select location_id = a from public.catering_quotes where id = q), 'lost revenue follows';
end $$;
set local role authenticated;
do $$ begin
  begin
    perform public.transfer_catering_lead(gen_random_uuid(),gen_random_uuid(),null,'ezCater reassignment');
    raise exception 'authenticated transfer allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
