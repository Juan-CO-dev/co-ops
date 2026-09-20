-- 0211_vendor_import.sql — Vendor Ordering V3-C-2 v1, plan 2026-09-20, R1–R7.
-- AUTHORED 2026-09-20. Migration file only; CC applies to sim and rehearses.
-- Pack operations version the WHOLE chain and derive the mirror transactionally,
-- following admin/pack-chain.ts and deriveFlatFieldsFromChain (not ordinal order).
begin;

create table public.vendor_import_batches (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  location_id uuid null references public.locations(id) check (location_id is null),
  account_id text null,
  adapter text not null, adapter_version text not null,
  source_name text not null, source_sha256 text not null,
  exported_at date null, row_count int not null check (row_count >= 0),
  report jsonb not null,
  status text not null default 'staged' check (status in ('staged','applied','superseded')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
-- One STAGED batch per (vendor, file, adapter version). A superseded batch (its
-- before-state went stale under it) or an applied one never blocks re-staging the
-- same file: the fresh batch re-reads the catalog and reports what is left to do.
create unique index vendor_import_batches_staged_source_uidx
  on public.vendor_import_batches(vendor_id, source_sha256, adapter_version) where status = 'staged';
create table public.vendor_import_observations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.vendor_import_batches(id),
  source_row int not null, kind text not null, reason text not null,
  match_rule text not null, sku_id uuid null references public.vendor_items(id),
  candidates jsonb not null default '[]', payload jsonb not null,
  proposed jsonb null, decision text null check (decision in ('accept','skip')),
  unique (batch_id, source_row, kind)
);
create table public.vendor_import_applies (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.vendor_import_batches(id),
  plan_digest text not null, applied_by uuid not null references public.users(id),
  applied_at timestamptz not null default clock_timestamp(),
  result jsonb not null, unique (batch_id, plan_digest)
);

alter table public.vendor_import_batches enable row level security;
alter table public.vendor_import_observations enable row level security;
alter table public.vendor_import_applies enable row level security;
create policy vendor_import_batches_no_user_select on public.vendor_import_batches for select using (false);
create policy vendor_import_batches_no_user_insert on public.vendor_import_batches for insert with check (false);
create policy vendor_import_batches_no_user_update on public.vendor_import_batches for update using (false) with check (false);
create policy vendor_import_batches_no_user_delete on public.vendor_import_batches for delete using (false);
create policy vendor_import_observations_no_user_select on public.vendor_import_observations for select using (false);
create policy vendor_import_observations_no_user_insert on public.vendor_import_observations for insert with check (false);
create policy vendor_import_observations_no_user_update on public.vendor_import_observations for update using (false) with check (false);
create policy vendor_import_observations_no_user_delete on public.vendor_import_observations for delete using (false);
create policy vendor_import_applies_no_user_select on public.vendor_import_applies for select using (false);
create policy vendor_import_applies_no_user_insert on public.vendor_import_applies for insert with check (false);
create policy vendor_import_applies_no_user_update on public.vendor_import_applies for update using (false) with check (false);
create policy vendor_import_applies_no_user_delete on public.vendor_import_applies for delete using (false);
revoke all on public.vendor_import_batches, public.vendor_import_observations, public.vendor_import_applies from public, anon, authenticated;
grant select, insert, update on public.vendor_import_batches, public.vendor_import_observations, public.vendor_import_applies to service_role;

-- [ASSUMPTION] Stage the ledger and its observations in one transaction too:
-- a failed second HTTP request must not permanently publish an incomplete batch.
create or replace function public.stage_vendor_import(p_batch jsonb, p_observations jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid;
begin
  insert into public.vendor_import_batches
    (vendor_id, account_id, adapter, adapter_version, source_name, source_sha256,
     exported_at, row_count, report, created_by)
  values ((p_batch->>'vendor_id')::uuid, p_batch->>'account_id', p_batch->>'adapter',
    p_batch->>'adapter_version', p_batch->>'source_name', p_batch->>'source_sha256',
    (p_batch->>'exported_at')::date, (p_batch->>'row_count')::int,
    p_batch->'report', (p_batch->>'created_by')::uuid)
  on conflict (vendor_id, source_sha256, adapter_version) where status = 'staged' do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.vendor_import_batches
    where vendor_id = (p_batch->>'vendor_id')::uuid
      and source_sha256 = p_batch->>'source_sha256' and adapter_version = p_batch->>'adapter_version'
      and status = 'staged';
    return jsonb_build_object('batch_id',v_id,'created',false);
  end if;
  insert into public.vendor_import_observations
    (batch_id, source_row, kind, reason, match_rule, sku_id, candidates, payload, proposed)
  select v_id, (o->>'source_row')::int, o->>'kind', o->>'reason', o#>>'{match,rule}',
    (o#>>'{match,sku_id}')::uuid, o#>'{match,candidates}', o->'row', o->'proposed'
  from jsonb_array_elements(p_observations) o;
  return jsonb_build_object('batch_id',v_id,'created',true);
end $$;

create or replace function public.apply_vendor_import(p_batch_id uuid, p_plan_digest text, p_actor uuid, p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_batch public.vendor_import_batches%rowtype;
  v_sku public.vendor_items%rowtype;
  v_observation public.vendor_import_observations%rowtype;
  v_claim uuid; v_price_id uuid; v_sku_id uuid; v_actor_role text;
  v_op jsonb; v_before jsonb; v_price jsonb; v_chain jsonb; v_node jsonb; v_root jsonb; v_measures jsonb;
  v_result jsonb; v_outcomes jsonb := '[]'; v_ids jsonb; v_id_map jsonb;
  v_key text; v_kind text; v_next uuid; v_old_root uuid;
  v_seen uuid[]; v_units numeric; v_leaf_size numeric; v_leaf_measure text;
  v_ratio numeric; v_written int; v_count int; v_now timestamptz;
begin
  if p_plan_digest is null or p_plan_digest !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'invalid_payload';
  end if;
  -- A unique claim arbitrates concurrent retries before any catalog mutation.
  insert into public.vendor_import_applies(batch_id, plan_digest, applied_by, result)
    values(p_batch_id, p_plan_digest, p_actor, '{}')
    on conflict (batch_id, plan_digest) do nothing returning id into v_claim;
  if v_claim is null then
    select result into v_result from public.vendor_import_applies
      where batch_id = p_batch_id and plan_digest = p_plan_digest;
    return v_result;
  end if;
  select * into v_batch from public.vendor_import_batches where id = p_batch_id for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status <> 'staged' then raise exception 'batch_already_applied'; end if;
  perform 1 from public.vendors where id = v_batch.vendor_id and active for update;
  if not found then raise exception 'vendor_not_found'; end if;
  select role into v_actor_role from public.users where id = p_actor and active;
  if not found then raise exception 'forbidden'; end if;
  if exists (select 1 from jsonb_array_elements(p_ops) o
    group by o->>'sku_id', o->>'action' having count(*) > 1) then
    raise exception 'conflicting_operations';
  end if;
  if exists(select 1 from jsonb_array_elements(p_ops) o where o->>'action' = 'sku.item_number_set'
    group by o#>>'{after,item_number}' having count(*) > 1) then raise exception 'conflicting_operations'; end if;
  for v_sku_id in select distinct (o->>'sku_id')::uuid from jsonb_array_elements(p_ops) o order by 1 loop
    perform 1 from public.vendor_items where id = v_sku_id and vendor_id = v_batch.vendor_id and active for update;
    if not found then raise exception 'foreign_sku'; end if;
  end loop;
  -- Check ALL snapshots before the first write; pack and price may share a SKU.
  for v_op in select o from jsonb_array_elements(p_ops) o order by o->>'sku_id', o->>'action' loop
    v_sku_id := (v_op->>'sku_id')::uuid;
    v_kind := case v_op->>'action' when 'sku.price_supersede' then 'price'
      when 'sku.item_number_set' then 'item_number' when 'sku.pack_level_supersede' then 'pack' end;
    if v_kind is null then raise exception 'unsupported_op'; end if;
    v_key := (v_op->>'source_row') || ':' || v_kind;
    v_before := v_op->'before';
    if v_before is distinct from v_batch.report#>array['before_state',v_key] then raise exception 'plan_changed'; end if;
    select * into v_observation from public.vendor_import_observations
      where batch_id = p_batch_id and source_row = (v_op->>'source_row')::int and kind = v_kind and sku_id = v_sku_id;
    if not found then raise exception 'plan_changed'; end if;
    -- Older evidence must not undo a newer accepted pack when no price was supplied.
    if v_kind in ('price','pack') and exists(
      select 1 from public.vendor_import_observations prior
      join public.vendor_import_batches b on b.id = prior.batch_id
      where b.vendor_id = v_batch.vendor_id and b.status = 'applied' and prior.decision = 'accept'
        and prior.sku_id = v_sku_id and prior.kind in ('price','pack')
        and (case when prior.payload ? 'receipt_doc' then prior.payload->>'last_purchase_date'
          else prior.payload->>'exported_at' end)::date >
          (case when v_observation.payload ? 'receipt_doc' then v_observation.payload->>'last_purchase_date'
          else v_observation.payload->>'exported_at' end)::date
    ) then raise exception 'stale_before_state:%',v_sku_id; end if;
    if v_kind = 'price' and exists(select 1 from jsonb_array_elements(p_ops) x
      where x->>'sku_id' = v_op->>'sku_id' and x->>'action' = 'sku.pack_level_supersede') then
      if v_before->'price_with_pack' is null or v_op->'after' is distinct from v_before->'price_with_pack' then raise exception 'plan_changed'; end if;
    elsif v_op->'after' is distinct from v_observation.proposed then raise exception 'plan_changed'; end if;
    select * into v_sku from public.vendor_items where id = v_sku_id;
    -- An originally unique identity can acquire a conflicting sibling after stage.
    if v_sku.item_number is not null and exists(select 1 from public.vendor_items
      where vendor_id = v_batch.vendor_id and item_number = v_sku.item_number and id <> v_sku_id) then
      raise exception 'stale_before_state:%',v_sku_id;
    end if;
    if v_observation.match_rule = 'name_exact' and exists(select 1 from public.vendor_items
      where vendor_id = v_batch.vendor_id and id <> v_sku_id
        and btrim(regexp_replace(lower(name),'[^[:alnum:]]+',' ','g')) =
          btrim(regexp_replace(lower(v_observation.payload->>'description'),'[^[:alnum:]]+',' ','g'))) then
      raise exception 'stale_before_state:%',v_sku_id;
    end if;
    perform 1 from public.sku_pack_levels where sku_id = v_sku_id and active order by id for update;
    select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]') into v_chain from
      (select id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal
       from public.sku_pack_levels where sku_id = v_sku_id and active) l;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.label), '[]') into v_measures from
      (select label,dimension,to_base_factor from public.measure_units where active and label in
        (select x->>'contains_measure_unit' from jsonb_array_elements(v_chain) x)) m;
    if v_chain is distinct from v_before->'pack_levels'
      or v_measures is distinct from v_before->'measures'
      or v_sku.name is distinct from v_before->>'name'
      or to_jsonb(v_sku.price_basis) is distinct from nullif(v_before->'price_basis','null'::jsonb)
      or to_jsonb(v_sku.item_number) is distinct from nullif(v_before->'item_number','null'::jsonb) then
      raise exception 'stale_before_state:%', v_sku_id;
    end if;
    if v_kind in ('price','pack') then
      select jsonb_build_object('id',id,'unit_price',unit_price,'effective_date',effective_date)
        into v_price from public.vendor_price_history where vendor_item_id = v_sku_id
        order by effective_date desc, recorded_at desc, id desc limit 1;
    end if;
    if v_kind = 'pack' and nullif(v_before->'latest_price','null'::jsonb) is distinct from v_price then
      raise exception 'stale_before_state:%',v_sku_id;
    end if;
    if v_kind = 'price' then
      if (v_price->>'id') is distinct from (v_before->>'id')
        or (v_price->>'unit_price')::numeric is distinct from (v_before->>'unit_price')::numeric
        or (v_price->>'effective_date') is distinct from (v_before->>'effective_date') then
        raise exception 'stale_before_state:%', v_sku_id;
      end if;
      if (v_op#>>'{after,unit_price}')::numeric <= 0
        or v_op#>>'{after,unit_price}' is null
        or v_op#>>'{after,unit_price}' in ('NaN','Infinity','-Infinity')
        or v_op#>>'{after,effective_date}' is null
        or (v_op#>>'{after,effective_date}')::date < (v_price->>'effective_date')::date then
        raise exception 'invalid_price';
      end if;
    elsif v_kind = 'item_number' then
      if v_sku.item_number is not null or nullif(btrim(v_op#>>'{after,item_number}'),'') is null
        or exists(select 1 from public.vendor_items where vendor_id = v_batch.vendor_id
          and item_number = v_op#>>'{after,item_number}' and id <> v_sku_id) then
        raise exception 'stale_before_state:%', v_sku_id;
      end if;
    end if;
  end loop;

  for v_op in select o from jsonb_array_elements(p_ops) o order by o->>'sku_id', o->>'action' loop
    v_sku_id := (v_op->>'sku_id')::uuid; v_before := v_op->'before';
    v_now := clock_timestamp(); v_ids := '[]';
    if v_op->>'action' = 'sku.price_supersede' then
      insert into public.vendor_price_history(vendor_item_id,unit_price,effective_date,recorded_at,recorded_by,source,source_note)
      values(v_sku_id,(v_op#>>'{after,unit_price}')::numeric,(v_op#>>'{after,effective_date}')::date,
        v_now,p_actor,'vendor_import',p_batch_id::text || ':row:' || (v_op->>'source_row')) returning id into v_price_id;
      perform 1 from public.vendor_price_history where id = v_price_id
        and unit_price = (v_op#>>'{after,unit_price}')::numeric
        and effective_date = (v_op#>>'{after,effective_date}')::date;
      if not found then raise exception 'apply_readback_failed'; end if;
      v_ids := jsonb_build_array(v_price_id);
    elsif v_op->>'action' = 'sku.item_number_set' then
      update public.vendor_items set item_number = v_op#>>'{after,item_number}' where id = v_sku_id and item_number is null;
      get diagnostics v_written = row_count;
      if v_written <> 1 then raise exception 'stale_before_state:%',v_sku_id; end if;
    else
      v_chain := v_before->'pack_levels'; v_count := jsonb_array_length(v_chain);
      v_old_root := (v_before->>'level_id')::uuid;
      if v_count = 0 or (select count(*) from jsonb_array_elements(v_chain) x where not exists
        (select 1 from jsonb_array_elements(v_chain) y where y->>'contains_level_id' = x->>'id')) <> 1 then
        raise exception 'invalid_chain';
      end if;
      select x into v_root from jsonb_array_elements(v_chain) x where not exists
        (select 1 from jsonb_array_elements(v_chain) y where y->>'contains_level_id' = x->>'id');
      if (v_root->>'id')::uuid is distinct from v_old_root
        or (v_before->>'quantity')::numeric <= 0 or (v_op#>>'{after,root,quantity}')::numeric <= 0
        or v_op#>>'{after,root,unit}' is distinct from v_before->>'unit' then raise exception 'invalid_chain'; end if;
      v_ratio := (v_op#>>'{after,root,quantity}')::numeric / (v_before->>'quantity')::numeric;
      if v_ratio is null or v_ratio::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid_chain'; end if;
      -- Preserve all descendants; only the root's immediate quantity changes.
      select jsonb_agg(case when (x->>'id')::uuid = v_old_root then
        x || jsonb_build_object('contains_qty',(x->>'contains_qty')::numeric * v_ratio) else x end order by x->>'id')
        into v_chain from jsonb_array_elements(v_chain) x;
      select x into v_node from jsonb_array_elements(v_chain) x where (x->>'id')::uuid = v_old_root;
      v_units := 1; v_seen := '{}'; v_id_map := '{}';
      loop
        if v_node is null or (v_node->>'id')::uuid = any(v_seen)
          or (v_node->>'contains_qty')::numeric <= 0
          or exists(select 1 from public.measure_units where active and label = v_node->>'label') then raise exception 'invalid_chain'; end if;
        v_seen := array_append(v_seen,(v_node->>'id')::uuid);
        v_id_map := v_id_map || jsonb_build_object(v_node->>'id',gen_random_uuid());
        v_next := (v_node->>'contains_level_id')::uuid;
        if v_next is null then
          v_leaf_size := (v_node->>'contains_qty')::numeric; v_leaf_measure := v_node->>'contains_measure_unit';
          if cardinality(v_seen) <> v_count or not exists(select 1 from public.measure_units where active and label = v_leaf_measure)
            then raise exception 'invalid_chain'; end if;
          select * into v_sku from public.vendor_items where id = v_sku_id;
          if coalesce(v_sku.sku_class,'raw') = 'raw' and exists(select 1 from public.measure_units
            where label = v_leaf_measure and dimension <> 'weight') and coalesce(v_sku.avg_oz_per_each,0) <= 0 then
            raise exception 'invalid_chain';
          end if;
          exit;
        end if;
        v_units := v_units * (v_node->>'contains_qty')::numeric;
        select x into v_node from jsonb_array_elements(v_chain) x where (x->>'id')::uuid = v_next;
      end loop;
      if v_units <> trunc(v_units) or v_units > 2147483647 then raise exception 'invalid_chain'; end if;
      update public.sku_pack_levels set active = false where sku_id = v_sku_id and active;
      get diagnostics v_written = row_count;
      if v_written <> v_count then raise exception 'stale_before_state:%',v_sku_id; end if;
      insert into public.sku_pack_levels(id,sku_id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal,effective_from,active,created_by)
      select (v_id_map->>(x->>'id'))::uuid,v_sku_id,x->>'label',(x->>'contains_qty')::numeric,
        (v_id_map->>(x->>'contains_level_id'))::uuid,x->>'contains_measure_unit',(x->>'display_ordinal')::int,v_now,true,p_actor
        from jsonb_array_elements(v_chain) x;
      get diagnostics v_written = row_count;
      if v_written <> v_count then raise exception 'apply_readback_failed'; end if;
      update public.vendor_items set pack_format = btrim(v_root->>'label'), units_per_pack = v_units::int,
        each_size = v_leaf_size, each_measure = v_leaf_measure where id = v_sku_id;
      get diagnostics v_written = row_count;
      if v_written <> 1 then raise exception 'stale_before_state:%',v_sku_id; end if;
      perform 1 from public.vendor_items where id = v_sku_id and pack_format = btrim(v_root->>'label')
        and units_per_pack = v_units and each_size = v_leaf_size and each_measure = v_leaf_measure;
      if not found then raise exception 'apply_readback_failed'; end if;
      select jsonb_agg(value order by key) into v_ids from jsonb_each(v_id_map);
    end if;
    v_result := jsonb_build_object('action',v_op->>'action','sku_id',v_sku_id,'source_row',v_op->'source_row','new_ids',v_ids);
    v_outcomes := v_outcomes || jsonb_build_array(v_result);
  end loop;
  update public.vendor_import_observations set decision = 'skip' where batch_id = p_batch_id;
  for v_op in select o from jsonb_array_elements(p_ops) o loop
    update public.vendor_import_observations set decision = 'accept' where batch_id = p_batch_id
      and source_row = (v_op->>'source_row')::int and kind = case v_op->>'action'
        when 'sku.price_supersede' then 'price' when 'sku.item_number_set' then 'item_number' else 'pack' end;
    get diagnostics v_written = row_count;
    if v_written <> 1 then raise exception 'plan_changed'; end if;
  end loop;
  update public.vendor_import_batches set status = 'applied' where id = p_batch_id and status = 'staged';
  get diagnostics v_written = row_count;
  if v_written <> 1 then raise exception 'batch_already_applied'; end if;
  v_result := jsonb_build_object('batch_id',p_batch_id,'plan_digest',p_plan_digest,'ops',v_outcomes,'non_atomic','[]'::jsonb);
  update public.vendor_import_applies set result = v_result where id = v_claim;
  get diagnostics v_written = row_count;
  if v_written <> 1 then raise exception 'apply_not_found'; end if;
  -- Transport-only flag: exactly the claim winner invokes the fail-open audit
  -- helper. Never persist/expose it as part of the application result.
  return v_result || jsonb_build_object('_audit',true);
end $$;

revoke all on function public.stage_vendor_import(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.apply_vendor_import(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.stage_vendor_import(jsonb,jsonb) to service_role;
grant execute on function public.apply_vendor_import(uuid,text,uuid,jsonb) to service_role;
do $$ begin
  if exists(select 1 from information_schema.routine_privileges where routine_schema = 'public'
    and routine_name in ('stage_vendor_import','apply_vendor_import')
    and grantee in ('PUBLIC','anon','authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0211: unexpected vendor import execute grant';
  end if;
end $$;
commit;
