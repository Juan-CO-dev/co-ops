-- Included verbatim in 0225. Derived SHADOW rows never feed operational depletion.
create table public.ezcater_toast_links (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.ezcater_orders(id),
 snapshot_id uuid not null, location_id uuid not null references public.locations(id),
 toast_snapshot_id uuid not null references public.toast_orders(id), order_guid text not null,
 check_guid text not null, selection_guid text not null, business_date date not null,
 evidence text not null check(evidence='normalized_code'), is_current boolean not null default true,
 created_at timestamptz not null default now(),
 foreign key(order_id,snapshot_id) references public.ezcater_order_snapshots(order_id,id)
);
create unique index ezcater_toast_links_selection on public.ezcater_toast_links(location_id,check_guid,selection_guid) where is_current;
create index ezcater_toast_links_order on public.ezcater_toast_links(order_id) where is_current;
create table public.ezcater_item_map (
 location_id uuid not null references public.locations(id), identity_key text not null,
 provider_item_uuid text not null, menu_item_size_id text, pos_item_id text,
 toast_item_guid text, item_id uuid references public.items(id), menu_item_id uuid references public.menu_items(id),
 status text not null check(status in ('confirmed','review')), evidence text check(evidence='pos_guid'),
 candidates jsonb not null default '[]'::jsonb check(jsonb_typeof(candidates)='array'),
 updated_at timestamptz not null default now(), primary key(location_id,identity_key),
 check(status <> 'confirmed' or (evidence='pos_guid' and toast_item_guid is not null and
   (item_id is not null)::int+(menu_item_id is not null)::int=1))
);
create table public.ezcater_review_queue (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.ezcater_orders(id),
 snapshot_id uuid not null, location_id uuid not null references public.locations(id),
 source text not null check(source in ('ezcater','toast')), code text not null, identity_key text not null,
 candidates jsonb not null default '[]'::jsonb check(jsonb_typeof(candidates)='array'),
 created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), resolved_at timestamptz,
 unique(order_id,source,code,identity_key),
 foreign key(order_id,snapshot_id) references public.ezcater_order_snapshots(order_id,id)
);
create table public.ezcater_shadow_depletion (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.ezcater_orders(id),
 snapshot_id uuid not null, location_id uuid not null references public.locations(id), event_date date not null,
 ordinal integer not null, sku_id uuid not null references public.vendor_items(id),
 sales_oz numeric not null check(sales_oz>=0), suppressed_oz numeric not null check(suppressed_oz>=0),
 shadow_oz numeric not null check(shadow_oz>=0), current_day_sales_oz numeric, is_current boolean not null default true,
 computed_at timestamptz not null default now(), check(abs(sales_oz-suppressed_oz-shadow_oz)<0.000001),
 foreign key(order_id,snapshot_id) references public.ezcater_order_snapshots(order_id,id)
);
create index ezcater_shadow_order on public.ezcater_shadow_depletion(order_id) where is_current;
do $$ declare t text; begin
 foreach t in array array['ezcater_toast_links','ezcater_item_map','ezcater_review_queue','ezcater_shadow_depletion'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for select using(false)',t||'_no_user_select',t);
  execute format('create policy %I on public.%I for insert with check(false)',t||'_no_user_insert',t);
  execute format('create policy %I on public.%I for update using(false)',t||'_no_user_update',t);
  execute format('create policy %I on public.%I for delete using(false)',t||'_no_user_delete',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;

create function public.publish_ezcater_shadow(p_order_id uuid,p_snapshot_id uuid,p_location_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.ezcater_orders%rowtype; l public.catering_pipeline%rowtype; r jsonb;
begin
 -- Share apply/transfer's provider lock before any row locks; snapshot/shop fence stale work.
 select * into o from public.ezcater_orders where id=p_order_id;
 if o.id is null then raise exception 'ezcater_shadow_source_changed'; end if;
 perform pg_advisory_xact_lock(hashtext(o.provider_uuid));
 select * into l from public.catering_pipeline where id=o.lead_id for update;
 select * into o from public.ezcater_orders where id=p_order_id for update;
 if o.id is null or o.snapshot_id is distinct from p_snapshot_id or l.location_id is distinct from p_location_id then
  raise exception 'ezcater_shadow_source_changed';
 end if;
 update public.ezcater_toast_links set is_current=false where order_id=o.id and is_current;
 update public.ezcater_shadow_depletion set is_current=false where order_id=o.id and is_current;
 update public.ezcater_review_queue set resolved_at=clock_timestamp() where order_id=o.id and resolved_at is null;
 for r in select value from jsonb_array_elements(p_payload->'links') loop
  if not exists(select 1 from public.toast_order_latest_pointers p join public.toast_orders t on t.id=p.snapshot_id
   where p.snapshot_id=(r->>'toast_snapshot_id')::uuid and p.location_id=p_location_id
    and t.order_guid=r->>'order_guid' and abs(t.business_date-o.event_date)<=1
    and not t.voided and not t.deleted and not t.excess_food
    and exists(select 1 from jsonb_array_elements(t.selection_units) s
      where s->>'check_guid'=r->>'check_guid' and s->>'selection_guid'=r->>'selection_guid'
       and not (s->>'voided')::boolean and not (s->>'deleted')::boolean)) then
   raise exception 'ezcater_shadow_toast_changed';
  end if;
  insert into public.ezcater_toast_links(order_id,snapshot_id,location_id,toast_snapshot_id,order_guid,check_guid,selection_guid,business_date,evidence)
  values(o.id,o.snapshot_id,p_location_id,(r->>'toast_snapshot_id')::uuid,r->>'order_guid',r->>'check_guid',r->>'selection_guid',(r->>'business_date')::date,'normalized_code');
 end loop;
 for r in select value from jsonb_array_elements(p_payload->'maps') loop
  insert into public.ezcater_item_map(location_id,identity_key,provider_item_uuid,menu_item_size_id,pos_item_id,toast_item_guid,item_id,menu_item_id,status,evidence,candidates)
  values(p_location_id,r->>'identity_key',r->>'provider_item_uuid',r->>'menu_item_size_id',r->>'pos_item_id',r->>'toast_item_guid',(r->>'item_id')::uuid,(r->>'menu_item_id')::uuid,r->>'status',r->>'evidence',r->'candidates')
  on conflict(location_id,identity_key) do update set pos_item_id=excluded.pos_item_id,toast_item_guid=excluded.toast_item_guid,
   item_id=excluded.item_id,menu_item_id=excluded.menu_item_id,status=excluded.status,evidence=excluded.evidence,candidates=excluded.candidates,updated_at=clock_timestamp();
 end loop;
 for r in select value from jsonb_array_elements(p_payload->'reviews') loop
  insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key,candidates)
  values(o.id,o.snapshot_id,p_location_id,r->>'source',r->>'code',r->>'identity_key',r->'candidates')
  on conflict(order_id,source,code,identity_key) do update set snapshot_id=excluded.snapshot_id,location_id=excluded.location_id,
   candidates=excluded.candidates,last_seen_at=clock_timestamp(),resolved_at=null;
 end loop;
 for r in select value from jsonb_array_elements(p_payload->'shadow') loop
  insert into public.ezcater_shadow_depletion(order_id,snapshot_id,location_id,event_date,ordinal,sku_id,sales_oz,suppressed_oz,shadow_oz,current_day_sales_oz)
  values(o.id,o.snapshot_id,p_location_id,o.event_date,(r->>'ordinal')::int,(r->>'sku_id')::uuid,
   (r->>'sales_oz')::numeric,(r->>'suppressed_oz')::numeric,(r->>'shadow_oz')::numeric,(r->>'current_day_sales_oz')::numeric);
 end loop;
end $$;
revoke all on function public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb) to service_role;
do $$ declare t text; r text; begin
 foreach t in array array['ezcater_toast_links','ezcater_item_map','ezcater_review_queue','ezcater_shadow_depletion'] loop
  foreach r in array array['anon','authenticated'] loop
   if has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'ezcater_pass2_acl'; end if;
  end loop;
  if not has_table_privilege('service_role','public.'||t,'SELECT') or has_table_privilege('service_role','public.'||t,'INSERT,UPDATE,DELETE') then raise exception 'ezcater_pass2_service_acl'; end if;
 end loop;
 if has_function_privilege('anon','public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb)','EXECUTE') or
 has_function_privilege('authenticated','public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb)','EXECUTE') or
 not has_function_privilege('service_role','public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb)','EXECUTE') then raise exception 'ezcater_pass2_function_acl'; end if;
end $$;
