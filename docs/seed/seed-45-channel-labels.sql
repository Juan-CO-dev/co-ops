-- Reviewed CC labels, 2026-10-07. AUTHORED ONLY; no schema change.
-- Run BEGIN; SET LOCAL seed45.target = 'sim'; this body; COMMIT as one query.
-- For production explicitly select 'prod'. Idempotent; audit only changed rows.
-- 0221 disallows gift_card as a channel: online/provider=gift_card is the
-- reviewed non-food marker; capture readers expose it as effective gift_card.
do $seed45$
declare
  v_target text := current_setting('seed45.target', true);
  v_changed jsonb;
begin
  if v_target is null or v_target not in ('sim', 'prod') then
    raise exception 'set seed45.target explicitly to sim or prod';
  end if;
  if exists(select 1 from public.users where email='maya@sim.co-ops') is distinct from (v_target='sim') then
    raise exception 'seed45 target % does not match database sim persona marker', v_target;
  end if;
  lock table public.sales_channel_map in share row exclusive mode;
  with changed as (
    insert into public.sales_channel_map(dining_option_label,channel,provider,fulfillment,reviewed_at)
    values
      ('E-Gift Cards','online','gift_card',null,'2026-10-07T00:00:00Z'),
      ('App Catering','catering','CO app','takeout','2026-10-07T00:00:00Z'),
      ('App Catering Delivery','catering','CO app','delivery','2026-10-07T00:00:00Z'),
      ('Catering- Delivery','catering','house','delivery','2026-10-07T00:00:00Z'),
      ('Curbside','takeout','house',null,'2026-10-07T00:00:00Z'),
      ('Otter Order','third_party',null,'delivery','2026-10-07T00:00:00Z'),
      ('Online Ordering - Delivery','online','Toast Online','delivery','2026-10-07T00:00:00Z')
    on conflict(dining_option_label) do update set
      channel=excluded.channel,provider=excluded.provider,fulfillment=excluded.fulfillment,reviewed_at=excluded.reviewed_at
    where (sales_channel_map.channel,sales_channel_map.provider,sales_channel_map.fulfillment)
      is distinct from (excluded.channel,excluded.provider,excluded.fulfillment)
      or sales_channel_map.reviewed_at is null
    returning dining_option_label,channel,provider,fulfillment
  ) select jsonb_agg(to_jsonb(changed)) into v_changed from changed;
  if v_changed is not null then
    insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,metadata)
    values(null,null,'toast_map.confirm','sales_channel_map',null,true,
      jsonb_build_object('actor_context','seed_45','target',v_target,'labels',v_changed,
        'reason','CC reviewed channel labels; gift_card encoded as online/provider gift_card'));
  end if;
end $seed45$;

select dining_option_label,channel,provider,fulfillment,reviewed_at
from public.sales_channel_map where dining_option_label in ('E-Gift Cards','App Catering',
  'App Catering Delivery','Catering- Delivery','Curbside','Otter Order','Online Ordering - Delivery')
order by dining_option_label;
