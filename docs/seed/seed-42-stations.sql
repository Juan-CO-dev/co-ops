-- Management API: send BEGIN; SET LOCAL seed42.target = 'sim'; followed by this
-- file's body, then COMMIT as ONE SQL query. For production use 'prod' explicitly.
-- Apply 0219_stations_optional_spanish.sql first. Idempotent; no deletions.
do $seed42$
declare
  v_target text := current_setting('seed42.target', true);
  v_template record;
  v_section record;
  v_old record;
  v_id uuid;
begin
  if v_target not in ('sim', 'prod') or v_target is null then
    raise exception 'set seed42.target explicitly to sim or prod';
  end if;
  lock table public.stations in share row exclusive mode;
  for v_template in
    select distinct on (location_id) id, location_id
    from public.checklist_templates
    where type = 'closing' and active
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
end $seed42$;

select l.name as location, s.name as station, s.name_es, s.sort, s.active
from public.stations s join public.locations l on l.id = s.location_id
order by l.name, s.sort, s.name;
