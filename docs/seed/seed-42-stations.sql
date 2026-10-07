-- Management API: send BEGIN; SET LOCAL seed42.target = 'sim'; followed by this
-- file's body, then COMMIT as ONE SQL query. For production use 'prod' explicitly.
-- Apply 0219_stations_staffing_positions.sql first. Idempotent; no deletions.
do $seed42$
declare
  v_target text := current_setting('seed42.target', true);
  v_template record;
  v_section record;
  v_old record;
  v_id uuid;
  v_position record;
begin
  if v_target not in ('sim', 'prod') or v_target is null then
    raise exception 'set seed42.target explicitly to sim or prod';
  end if;
  if exists (select 1 from public.users where email='maya@sim.co-ops') is distinct from (v_target='sim') then
    raise exception 'seed42 target % does not match database sim persona marker', v_target;
  end if;
  lock table public.stations in share row exclusive mode;
  for v_template in
    select distinct on (location_id) id, location_id
    from public.checklist_templates
    where type = 'closing' and active
      and (effective_from is null or effective_from <= (now() at time zone 'America/New_York')::date)
    order by location_id, effective_from desc nulls last, created_at desc
  loop
    for v_section in
      select distinct on (i.station) i.station as name, i.display_order as sort,
        (select nullif(btrim(x.translations->'es'->>'station'), '')
         from public.checklist_template_items x where x.template_id=i.template_id
           and x.active and x.station=i.station
           and nullif(btrim(x.translations->'es'->>'station'), '') is not null
         order by x.display_order, x.id limit 1) as name_es
      from public.checklist_template_items i
      where i.template_id = v_template.id and i.active and nullif(btrim(i.station), '') is not null
      order by i.station, i.display_order, i.id
    loop
      select * into v_old from public.stations
      where location_id = v_template.location_id and name = v_section.name
      order by active desc, id limit 1;
      if v_old.id is null then
        insert into public.stations(location_id, name, name_es, sort, active)
        values(v_template.location_id, v_section.name, v_section.name_es, v_section.sort, true)
        returning id into v_id;
      elsif v_old.sort is distinct from v_section.sort or not v_old.active or
            (v_section.name_es is not null and v_old.name_es is distinct from v_section.name_es) then
        update public.stations set sort = v_section.sort, active = true,
          name_es = coalesce(v_section.name_es, v_old.name_es) where id = v_old.id;
        v_id := v_old.id;
      else
        v_id := null;
      end if;
      if v_id is not null then
        insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
        values(null, null, 'station.sync', 'stations', v_id, true,
          jsonb_build_object('actor_context','seed_42','target',v_target,'location_id',v_template.location_id,
            'template_id',v_template.id,'station',v_section.name));
      end if;
    end loop;
    for v_old in select * from public.stations s where s.location_id = v_template.location_id and s.active
      and not exists (select 1 from public.checklist_template_items i
        where i.template_id = v_template.id and i.active and i.station = s.name)
    loop
      update public.stations set active = false where id = v_old.id;
      insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
      values(null, null, 'station.sync', 'stations', v_old.id, true,
        jsonb_build_object('actor_context','seed_42','target',v_target,'location_id',v_template.location_id,
          'template_id',v_template.id,'station',v_old.name,'operation','deactivate'));
    end loop;
  end loop;
  -- Position 1 is the primary role. Default positions cover all other sections.
  for v_section in select s.id as station_id, s.location_id, s.name, s.name_es
    from public.stations s where s.active order by s.location_id, s.sort, s.name
  loop
    -- A rerun after a GM rename must not recreate the original named slot.
    if exists (select 1 from public.audit_log a
      where a.action='station.position_create' and a.resource_table='station_positions'
        and a.metadata->>'actor_context'='seed_42'
        and a.metadata->>'station_id'=v_section.station_id::text) then
      continue;
    end if;
    -- A page-load sync may already have made the generic default. The named
    -- Walk Ins / Expo slots replace it so their capacity is exactly two.
    if v_section.name in ('Walk Ins Station', 'Expo Station') then
      for v_old in select * from public.station_positions p
        where p.station_id=v_section.station_id and p.name=v_section.name and p.active
      loop
        update public.station_positions set active=false where id=v_old.id;
        insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,metadata)
        values(null,null,'station.position_update','station_positions',v_old.id,true,
          jsonb_build_object('actor_context','seed_42','target',v_target,
            'location_id',v_section.location_id,'station_id',v_section.station_id,
            'operation','deactivate_default'));
      end loop;
    end if;
    for v_position in select * from (values
      ('Walk Ins Station', 'Walk-ins', 'Pedidos en tienda',
        'Dedicated to walk-in orders; helps with online orders when there are no subs to make',
        'Dedicado a pedidos en tienda; ayuda con pedidos en línea cuando no hay subs que hacer', 1),
      ('Walk Ins Station', 'Walk-ins / Online', 'Tienda / En línea',
        'Half walk-ins, half online orders; leans toward walk-ins',
        'Mitad pedidos en tienda, mitad en línea; prioriza los de tienda', 2),
      ('Expo Station', 'Expeditor', 'Expedidor', 'Expedites the orders', 'Expedita los pedidos', 1),
      ('Expo Station', 'Register & Delivery', 'Caja y Delivery',
        'Runs the cash register and hands out delivery orders',
        'Atiende la caja y entrega los pedidos de delivery', 2)
    ) as p(station_name, name, name_es, duty, duty_es, sort)
    where p.station_name = v_section.name
    union all
    select v_section.name, v_section.name, v_section.name_es, null::text, null::text, 1
    where v_section.name not in ('Walk Ins Station', 'Expo Station')
  loop
    if not exists(select 1 from public.station_positions
      where station_id=v_section.station_id and name=v_position.name) then
      insert into public.station_positions(station_id,location_id,name,name_es,duty,duty_es,sort)
      values(v_section.station_id,v_section.location_id,v_position.name,v_position.name_es,
        v_position.duty,v_position.duty_es,v_position.sort) returning id into v_id;
      insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,metadata)
      values(null,null,'station.position_create','station_positions',v_id,true,
        jsonb_build_object('actor_context','seed_42','target',v_target,
          'location_id',v_section.location_id,'station_id',v_section.station_id,'name',v_position.name));
    end if;
  end loop;
  end loop;
end $seed42$;

select l.name as location, s.name as station, s.name_es, s.sort, s.active, s.staffed,
  p.name as position, p.name_es as position_es, p.duty, p.duty_es, p.sort as position_sort, p.active as position_active
from public.stations s join public.locations l on l.id = s.location_id
left join public.station_positions p on p.station_id=s.id
order by l.name, s.sort, s.name, p.sort, p.name;
