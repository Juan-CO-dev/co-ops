-- CC SIM ONLY: run after 0226 + SEED-FLIP-45.sql. Entire harness rolls back.
-- This verifies DB contracts and the data flip; npm test verifies consumption math.
-- To verify flip idempotence, execute the flip again in a NEW transaction first:
-- BEGIN; SET LOCAL seed45.target='sim'; <SEED-FLIP-45.sql>; COMMIT;
-- It must emit zero new seed_45 audit rows. Do not reapply migration 0226.
begin;
do $harness$
declare
  t text; r text; v_n integer; v_map uuid; v_item uuid; v_location uuid;
  v_line uuid; v_failed boolean;
begin
  if not exists(select 1 from public.users where email='maya@sim.co-ops') then
    raise exception '0226 harness refuses non-sim database';
  end if;
  foreach t in array array['toast_map_effects','toast_open_item_aliases'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=t and c.relrowsecurity) then
      raise exception 'missing RLS: %',t;
    end if;
    if (select count(*) from pg_policies where schemaname='public' and tablename=t
      and ((cmd='SELECT' and qual='false') or (cmd='INSERT' and with_check='false')
        or (cmd='UPDATE' and qual='false' and with_check='false') or (cmd='DELETE' and qual='false')))<>4 then
      raise exception 'explicit deny policy mismatch: %',t;
    end if;
    foreach r in array array['anon','authenticated'] loop
      if has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'unexpected user grant: % %',r,t;
      end if;
    end loop;
    if not has_table_privilege('service_role','public.'||t,'SELECT')
       or not has_table_privilege('service_role','public.'||t,'INSERT')
       or not has_table_privilege('service_role','public.'||t,'UPDATE')
       or has_table_privilege('service_role','public.'||t,'DELETE,TRUNCATE') then
      raise exception 'incorrect service grants: %',t;
    end if;
  end loop;

  select count(*) into v_n from public.toast_menu_map m where m.active and m.match_status='confirmed'
    and m.is_modifier and m.disposition='deplete' and m.portion_qty=1 and m.portion_unit='each'
    and exists(select 1 from public.audit_log a where a.resource_id=m.id and a.action='toast_map.manual_map'
      and a.metadata->>'actor_context'='seed_43' and a.metadata->>'rule_group'='mod_gf_staged');
  if v_n<>11 then raise exception 'GF primary count % != 11',v_n; end if;
  select count(*) into v_n from public.toast_map_effects e join public.toast_menu_map m on m.id=e.map_id
    join public.vendor_items vi on vi.id=e.sku_id where m.active and e.active and e.parent_only and e.disposition='remove'
    and vi.name='Sub Roll' and e.portion_qty=1 and e.portion_unit='each' and exists(select 1 from public.audit_log a where a.resource_id=m.id
      and a.action='toast_map.manual_map' and a.metadata->>'actor_context'='seed_43' and a.metadata->>'rule_group'='mod_gf_staged');
  if v_n<>11 then raise exception 'GF Sub Roll effects % != 11',v_n; end if;
  select count(*) into v_n from public.toast_menu_map m where m.active and m.match_status='confirmed'
    and m.is_modifier and m.disposition='remove' and m.parent_only
    and exists(select 1 from public.audit_log a where a.resource_id=m.id and a.action='toast_map.manual_map'
      and a.metadata->>'actor_context'='seed_43' and a.metadata->>'rule_name' in ('no mayo','no peppers'));
  if v_n<>6 then raise exception 'mixed removal count % != 6',v_n; end if;
  select count(*) into v_n from public.toast_menu_map m where m.active and m.match_status='confirmed'
    and lower(m.toast_item_name)='no cheese' and m.is_modifier and m.parent_only and m.disposition='remove';
  if v_n<>18 then raise exception 'No Cheese primary count % != 18',v_n; end if;
  if exists(
    with targets as (
      select m.id as map_id,m.item_id from public.toast_menu_map m where m.active and m.match_status='confirmed' and lower(m.toast_item_name)='no cheese'
      union all
      select m.id,e.item_id from public.toast_menu_map m join public.toast_map_effects e on e.map_id=m.id and e.active
        where m.active and m.match_status='confirmed' and lower(m.toast_item_name)='no cheese'
    ) select map_id from targets group by map_id having count(*)<>4 or count(distinct item_id)<>4
  ) then raise exception 'No Cheese must contain four distinct targets exactly once'; end if;
  if exists(select 1 from public.toast_menu_map m join public.toast_map_effects e on e.map_id=m.id and e.active
    where m.active and m.match_status='confirmed' and lower(m.toast_item_name)='no cheese'
      and (not e.parent_only or e.disposition<>'remove')) then raise exception 'No Cheese extra effect not parent-only'; end if;
  select count(*) into v_n from public.toast_menu_map m where m.active and m.match_status='confirmed'
    and m.disposition='deplete' and m.portion_qty is null and m.menu_item_id is not null
    and exists(select 1 from public.audit_log a where a.resource_id=m.id and a.action='toast_map.manual_map'
      and a.metadata->>'actor_context'='seed_43' and a.metadata->>'rule_group'='mod_pick_staged');
  if v_n<>7 then raise exception 'named lunch pick count % != 7',v_n; end if;
  select count(*) into v_n from public.toast_menu_map m join public.catering_packages p on p.id=m.package_id
    where m.active and m.match_status='confirmed' and not m.is_modifier and p.slug='light-lunch' and p.active
      and exists(select 1 from public.catering_package_items l where l.package_id=p.id and l.active
        and l.slot_type='choice' and l.quantity=1 and l.depletion_qty=0.5);
  if v_n<>2 then raise exception 'Light Lunch mapping count % != 2',v_n; end if;
  if exists(select 1 from public.audit_log a where a.metadata->>'actor_context'='seed_45'
    and (lower(coalesce(a.after_state->>'toast_item_name','')) like '3 foot %'
      or lower(coalesce(a.before_state->>'toast_item_name','')) like '3 foot %'
      or a.resource_id in (select l.id from public.catering_package_items l join public.catering_packages p on p.id=l.package_id
        where p.slug='three-footer'))) then raise exception 'seed45 unexpectedly touched Three Footer'; end if;
  select count(*) into v_n from public.toast_menu_map where active and match_status='confirmed' and disposition='open_item'
    and toast_item_guid in ('2c3c26f1-87ef-4d86-b760-67c96ddd2ca2','398bbb87-223f-414c-a2b1-960edaf3fa6b');
  if v_n<>2 then raise exception 'open-item marks % != 2',v_n; end if;
  select count(*) into v_n from public.toast_open_item_aliases a where a.active and a.location_id is null
    and exists(select 1 from public.audit_log x where x.resource_id=a.id and x.metadata->>'actor_context'='seed_45');
  if v_n<>18 then raise exception 'alias count % != 18',v_n; end if;

  -- Real constraint attempts inside PL/pgSQL exception subtransactions.
  select id,item_id,location_id into v_map,v_item,v_location from public.toast_menu_map
    where active and match_status='confirmed' and lower(toast_item_name)='no cheese' limit 1;
  v_failed:=false;
  begin insert into public.toast_map_effects(map_id,ordinal,disposition) values(v_map,9999,'remove');
    exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'effect accepted no entity'; end if;
  v_failed:=false;
  begin insert into public.toast_map_effects(map_id,ordinal,item_id,disposition,portion_qty) values(v_map,9999,v_item,'remove',0);
    exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'effect accepted zero portion'; end if;
  v_failed:=false;
  begin insert into public.toast_map_effects(map_id,ordinal,item_id,disposition) values(v_map,0,v_item,'remove');
    exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'effect accepted ordinal zero'; end if;
  v_failed:=false;
  begin insert into public.toast_map_effects(map_id,ordinal,item_id,disposition) values(v_map,1,v_item,'remove');
    exception when unique_violation then v_failed:=true; end;
  if not v_failed then raise exception 'effect accepted duplicate active ordinal'; end if;
  select l.id into v_line from public.catering_package_items l join public.catering_packages p on p.id=l.package_id
    where p.slug='light-lunch' and p.active and l.active and l.slot_type='choice' limit 1;
  v_failed:=false;
  begin update public.catering_package_items set depletion_qty=0 where id=v_line;
    exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'depletion_qty accepted zero'; end if;
  update public.catering_package_items set depletion_qty=null where id=v_line;
  update public.catering_package_items set depletion_qty=0.5 where id=v_line;
  v_failed:=false;
  begin insert into public.toast_menu_map(location_id,toast_item_guid,toast_item_name,match_status,disposition,item_id)
    values(v_location,'harness-invalid-open-item','Harness','candidate','open_item',v_item);
    exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'open_item accepted entity'; end if;
  v_failed:=false;
  begin insert into public.toast_menu_map(location_id,toast_item_guid,toast_item_name,match_status,disposition,is_modifier)
    values(v_location,'harness-invalid-open-mod','Harness','candidate','open_item',true);
    exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'open_item accepted modifier'; end if;
  v_failed:=false;
  begin insert into public.toast_open_item_aliases(normalized_text) values('harness empty');
    exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'alias accepted no entity'; end if;
  v_failed:=false;
  begin insert into public.toast_open_item_aliases(normalized_text,item_id,qty_multiplier) values('harness zero',v_item,0);
    exception when check_violation then v_failed:=true; end;
  if not v_failed then raise exception 'alias accepted zero multiplier'; end if;
  v_failed:=false;
  begin insert into public.toast_open_item_aliases(normalized_text,item_id) values('chip',v_item);
    exception when unique_violation then v_failed:=true; end;
  if not v_failed then raise exception 'alias accepted duplicate global key'; end if;
  -- Same text at a specific location is valid and outranks the global alias.
  insert into public.toast_open_item_aliases(location_id,normalized_text,item_id) values(v_location,'harness scoped',v_item);
  insert into public.toast_open_item_aliases(normalized_text,item_id) values('harness scoped',v_item);
  raise notice 'PASS: 0226 schema, grants, constraints and seed45 data assertions (all rolled back)';
end $harness$;
rollback;
