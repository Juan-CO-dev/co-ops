-- 0236 ezCater customization effects. AUTHORED 2026-10-08; APPLIED TO PROD 2026-10-09 (20261009024112; sim harness pass).
-- Requires 0225, 0226 and 0227. Apply in sim and run scripts/test-ezcater-customizations.sql first.
begin;

create table public.ezcater_customization_map (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  customization_id text not null check (btrim(customization_id) <> ''),
  status text not null check (status in ('confirmed','ignored')),
  effects jsonb not null default '[]'::jsonb check (jsonb_typeof(effects) = 'array'),
  pick_menu_item_id uuid references public.menu_items(id),
  updated_at timestamptz not null default clock_timestamp(),
  unique(location_id, customization_id),
  check (
    (status = 'confirmed' and ((jsonb_array_length(effects) > 0) <> (pick_menu_item_id is not null)))
    or (status = 'ignored' and jsonb_array_length(effects) = 0 and pick_menu_item_id is null)
  )
);
alter table public.ezcater_customization_map enable row level security;
create policy ezcater_customization_map_no_user_select on public.ezcater_customization_map for select using(false);
create policy ezcater_customization_map_no_user_insert on public.ezcater_customization_map for insert with check(false);
create policy ezcater_customization_map_no_user_update on public.ezcater_customization_map for update using(false) with check(false);
create policy ezcater_customization_map_no_user_delete on public.ezcater_customization_map for delete using(false);
revoke all on public.ezcater_customization_map from public,anon,authenticated,service_role;
grant select on public.ezcater_customization_map to service_role;

-- The publisher reaches this table only through ezcater_review_queue. Serialize
-- its upsert with a human decision and suppress a review for a decided identity.
create function public.guard_ezcater_customization_review() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.source <> 'ezcater' or new.code <> 'customization_unmapped' then return new; end if;
  if tg_op='UPDATE' and new.resolved_at is not null and new.resolved_at is distinct from old.resolved_at then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.location_id::text || ':' || new.identity_key, 236));
  if exists(select 1 from public.ezcater_customization_map
    where location_id=new.location_id and customization_id=new.identity_key) then return null; end if;
  new.resolved_at := null;
  return new;
end $$;
revoke all on function public.guard_ezcater_customization_review() from public,anon,authenticated,service_role;
create trigger ezcater_customization_review_guard before insert or update on public.ezcater_review_queue
  for each row execute function public.guard_ezcater_customization_review();

create function public.decide_ezcater_customization(
  p_review_id uuid, p_decision text, p_effects jsonb, p_pick_menu_item_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  q public.ezcater_review_queue%rowtype; o public.ezcater_orders%rowtype;
  v_role text; v_effects jsonb := coalesce(p_effects,'[]'::jsonb); e jsonb; v_map_id uuid;
  v_kind text; v_target uuid; v_qty numeric; v_unit text; v_before jsonb; v_after jsonb;
  v_par_unit text;
  v_package_id uuid; v_package_seen boolean := false;
begin
  select role into v_role from public.users where id=p_actor_id and active for share;
  if v_role is null or v_role not in ('catering_mgr','moo','owner','cgs') then raise exception 'ezcater_mapping_forbidden'; end if;
  if p_decision is null or p_decision not in ('approve','ignore') or jsonb_typeof(v_effects) <> 'array' then
    raise exception 'ezcater_customization_invalid_decision';
  end if;
  if jsonb_array_length(v_effects)>8 then raise exception 'ezcater_customization_effect_invalid'; end if;
  if (p_decision='approve' and ((jsonb_array_length(v_effects)>0) = (p_pick_menu_item_id is not null)))
    or (p_decision='ignore' and (jsonb_array_length(v_effects)>0 or p_pick_menu_item_id is not null)) then
    raise exception 'ezcater_customization_invalid_decision';
  end if;

  select * into q from public.ezcater_review_queue where id=p_review_id;
  if not found or q.source<>'ezcater' or q.code<>'customization_unmapped' or q.resolved_at is not null then
    raise exception 'ezcater_mapping_review_not_found';
  end if;
  select * into o from public.ezcater_orders where id=q.order_id;
  if not found then raise exception 'ezcater_mapping_source_changed'; end if;
  perform pg_advisory_xact_lock(hashtext(o.provider_uuid));
  perform pg_advisory_xact_lock(hashtextextended(q.location_id::text || ':' || q.identity_key,236));
  select * into o from public.ezcater_orders where id=q.order_id for update;
  select * into q from public.ezcater_review_queue where id=p_review_id for update;
  if not found or q.source<>'ezcater' or q.code<>'customization_unmapped' or q.resolved_at is not null
    or o.snapshot_id is distinct from q.snapshot_id or o.location_id is distinct from q.location_id
    or not exists (
      select 1 from public.ezcater_order_items i cross join lateral jsonb_array_elements(i.options) x
      where i.order_id=o.id and i.snapshot_id=o.snapshot_id and i.is_current
        and x->>'customizationId'=q.identity_key
    ) then raise exception 'ezcater_mapping_source_changed'; end if;

  if p_pick_menu_item_id is not null then
    perform 1 from public.menu_items mi where mi.id=p_pick_menu_item_id and mi.active for share;
    if not found then raise exception 'ezcater_customization_pick_invalid'; end if;
    -- A decision applies shop-wide. Every affected current package line must
    -- bind the pick, including lines belonging to other orders at this shop.
    for v_package_id in select m.package_id from public.ezcater_order_items i
      join public.ezcater_orders current_order on current_order.id=i.order_id and current_order.snapshot_id=i.snapshot_id
      left join public.catering_pipeline lead on lead.id=current_order.lead_id
      join public.ezcater_item_map m on m.location_id=q.location_id and m.status='confirmed' and m.package_id is not null
        and jsonb_typeof(m.identity_key::jsonb)='array' and jsonb_array_length(m.identity_key::jsonb)=2
        and m.identity_key::jsonb->>0=i.menu_item_size_id
        and jsonb_typeof(m.identity_key::jsonb->1)='array'
        and jsonb_array_length(m.identity_key::jsonb->1)=jsonb_array_length(i.options)
        and not exists(select 1 from (
          select pair,sum(delta) total from (
            select jsonb_build_array(z->>'customizationId',case when jsonb_typeof(z->'quantity')='number'
              then z->'quantity' else 'null'::jsonb end) pair,1 delta from jsonb_array_elements(i.options) z
            union all select z,-1 from jsonb_array_elements(m.identity_key::jsonb->1) z
          ) pairs group by pair having sum(delta)<>0
        ) mismatch)
      where coalesce(lead.location_id,current_order.location_id)=q.location_id and i.is_current
        and exists(select 1 from jsonb_array_elements(i.options) x where x->>'customizationId'=q.identity_key)
      for share of i,m
    loop
      v_package_seen := true;
      perform 1 from public.catering_packages p
        join public.catering_package_items pi on pi.package_id=p.id and pi.active and pi.slot_type='choice'
        join public.catering_package_slot_options so on so.package_item_id=pi.id and so.active and so.menu_item_id=p_pick_menu_item_id
        where p.id=v_package_id and p.active and (p.location_id is null or p.location_id=q.location_id)
        for share of p,pi,so;
      if not found then raise exception 'ezcater_customization_pick_invalid'; end if;
    end loop;
    if not v_package_seen then raise exception 'ezcater_customization_pick_invalid'; end if;
  end if;

  for e in select value from jsonb_array_elements(v_effects) loop
    if jsonb_typeof(e)<>'object'
      or exists(select 1 from jsonb_object_keys(e) k where k not in ('targetKind','targetId','disposition','portionQty','portionUnit','parentOnly'))
      or not (e ?& array['targetKind','targetId','disposition','portionQty','portionUnit','parentOnly'])
      or jsonb_typeof(e->'targetKind')<>'string' or jsonb_typeof(e->'disposition')<>'string'
      or e->>'targetKind' not in ('item','sku','menu_item') or e->>'disposition' not in ('deplete','remove')
      or jsonb_typeof(e->'parentOnly')<>'boolean'
      or jsonb_typeof(e->'targetId')<>'string'
      or (e->'portionQty' <> 'null'::jsonb and jsonb_typeof(e->'portionQty')<>'number')
      or (e->'portionUnit' <> 'null'::jsonb and jsonb_typeof(e->'portionUnit')<>'string') then
      raise exception 'ezcater_customization_effect_invalid';
    end if;
    begin v_target := (e->>'targetId')::uuid; v_qty := nullif(e->>'portionQty','')::numeric;
    exception when invalid_text_representation then raise exception 'ezcater_customization_effect_invalid'; end;
    v_kind:=e->>'targetKind'; v_unit:=nullif(btrim(e->>'portionUnit'),'');
    if (v_qty is not null and (v_qty<=0 or v_qty>10000)) or ((v_qty is null)<>(v_unit is null))
      or length(coalesce(v_unit,''))>32
      or (v_unit is not null and e->>'portionUnit'<>v_unit) then
      raise exception 'ezcater_customization_effect_invalid'; end if;
    if (e->>'disposition'='deplete' and v_qty is null)
      or (e->>'disposition'='remove' and v_qty is null and (e->>'parentOnly')::boolean is not true) then
      raise exception 'ezcater_customization_effect_invalid'; end if;
    if v_kind='item' then
      select default_par_unit into v_par_unit from public.items where id=v_target and active for share;
      if not found then raise exception 'ezcater_mapping_target_invalid'; end if;
      -- Match itemRefParUnits: an active measure takes precedence over the
      -- item's own par label. Count/weight measures are supported, volume is
      -- not; an unknown label is valid only when it names this item's par unit.
      if v_unit is not null and not coalesce(
        (select dimension in ('count','weight') from public.measure_units where active and label=v_unit),
        lower(btrim(v_par_unit))=lower(v_unit), false
      ) then raise exception 'ezcater_customization_effect_invalid'; end if;
    elsif v_kind='menu_item' then
      if v_unit is not null and v_unit<>'whole_sub' then raise exception 'ezcater_customization_effect_invalid'; end if;
      perform 1 from public.menu_items where id=v_target and active for share;
    else
      if v_unit is not null and v_unit not in ('oz','each') then raise exception 'ezcater_customization_effect_invalid'; end if;
      perform 1 from public.vendor_items where id=v_target and active for share;
    end if;
    if not found then raise exception 'ezcater_mapping_target_invalid'; end if;
  end loop;

  select to_jsonb(m) into v_before from public.ezcater_customization_map m
    where location_id=q.location_id and customization_id=q.identity_key for update;
  insert into public.ezcater_customization_map(location_id,customization_id,status,effects,pick_menu_item_id,updated_at)
  values(q.location_id,q.identity_key,case when p_decision='approve' then 'confirmed' else 'ignored' end,
    case when p_decision='approve' then v_effects else '[]'::jsonb end,p_pick_menu_item_id,clock_timestamp())
  on conflict(location_id,customization_id) do update set status=excluded.status,effects=excluded.effects,
    pick_menu_item_id=excluded.pick_menu_item_id,updated_at=excluded.updated_at
    returning id,to_jsonb(ezcater_customization_map.*) into v_map_id,v_after;
  update public.ezcater_review_queue set resolved_at=clock_timestamp()
    where location_id=q.location_id and source='ezcater' and code='customization_unmapped'
      and identity_key=q.identity_key and resolved_at is null;
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
  values(p_actor_id,v_role,case when p_decision='approve' then 'ezcater.customization_map.approve'
    else 'ezcater.customization_map.ignore' end,'ezcater_customization_map',v_map_id,
    jsonb_build_object('review_id',q.id,'location_id',q.location_id,'customization_id',q.identity_key,
      'effects',v_effects,'pick_menu_item_id',p_pick_menu_item_id,
      'previous_mapping',v_before,'resulting_mapping',v_after),true);
  return jsonb_build_object('map_id',v_map_id,'status',case when p_decision='approve' then 'confirmed' else 'ignored' end);
end $$;
revoke all on function public.decide_ezcater_customization(uuid,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.decide_ezcater_customization(uuid,text,jsonb,uuid,uuid) to service_role;

do $$ declare f regprocedure:='public.decide_ezcater_customization(uuid,text,jsonb,uuid,uuid)'::regprocedure;
 g regprocedure:='public.guard_ezcater_customization_review()'::regprocedure;
 t regclass:='public.ezcater_customization_map'::regclass; r text; begin
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
    or not has_function_privilege('service_role',f,'EXECUTE')
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=f and a.grantee=0)
    then raise exception '0236: unexpected effective function grant'; end if;
  if has_function_privilege('anon',g,'EXECUTE') or has_function_privilege('authenticated',g,'EXECUTE')
    or has_function_privilege('service_role',g,'EXECUTE')
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=g and a.grantee=0)
    then raise exception '0236: trigger function callable'; end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(r,t,'INSERT,UPDATE,REFERENCES')
      or (r<>'service_role' and has_any_column_privilege(r,t,'SELECT')) then raise exception '0236: unexpected map grant'; end if;
  end loop;
  if not has_table_privilege('service_role',t,'SELECT')
    or exists(select 1 from pg_class c,lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and a.grantee=0)
    or exists(select 1 from pg_attribute c,lateral aclexplode(c.attacl) a where c.attrelid=t and a.grantee=0)
    then raise exception '0236: missing service read or PUBLIC grant'; end if;
end $$;
commit;
