-- Migration 0249_customer_list_v2
-- AUTHORED 2026-10-12, NOT YET APPLIED -- GATE CC: sim first, then prod.
-- APPLIED TO PROD 2026-10-12 (schema_migrations version 20261012072932, name '0249_customer_list_v2'); sim applied first; prod dry run first.
-- Contact-free list projections and advisory marketplace links; no historical cleanup.
begin;

create or replace function public.customer_email_is_relay(p_email text) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select split_part(p_email,'@',2) = any(array['doordash.com','ubereats.com','uber.com','grubhub.com','seamless.com','postmates.com',
      'caviar.com','ezcater.com','marketplace.amazon.com','relay.toasttab.com','toasttab.com']::text[])
    or exists(select 1 from unnest(array['doordash.com','ubereats.com','uber.com','grubhub.com','seamless.com','postmates.com',
      'caviar.com','ezcater.com','marketplace.amazon.com','relay.toasttab.com','toasttab.com']::text[]) d
      where split_part(p_email,'@',2) like '%.' || d)
    or split_part(p_email,'@',2) ~ '(^|\.)(relay|masked|anonymi[sz]ed|proxy)\.'
    or split_part(p_email,'@',1) ~ '^(relay|masked)[+.-]'
    or split_part(p_email,'@',1) ~ '^(no-?e?mail|none|na|n/a|noreply|no-reply|test|null|x+)$'
    or regexp_replace(split_part(p_email,'@',1),'\+.*$','') = any(array['dd.toast.orders'])
$$;

create function public.customer_marketplace_guest(
  p_full_name text, p_first text, p_last text, p_location_id uuid,
  p_seen_at timestamptz, p_source text, p_masked_channel text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_name text := nullif(regexp_replace(btrim(coalesce(p_full_name,'')),'\s+',' ','g'),''); v_id uuid;
begin
  perform public.customer_identity_lock();
  if v_name is null then raise exception 'customer_guest_invalid'; end if;
  insert into public.customers(full_name, first_name, last_name, name_key, primary_location_id, first_seen_at, last_seen_at, sources, masked_channels)
  values (v_name, nullif(btrim(coalesce(p_first,'')),''), nullif(btrim(coalesce(p_last,'')),''), lower(v_name), p_location_id,
    coalesce(p_seen_at, now()), coalesce(p_seen_at, now()), array[p_source],
    case when p_masked_channel is null then '{}'::text[] else array[p_masked_channel] end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.customer_ingest_orders(p_location_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_row jsonb; v_res record; v_linked int := 0; v_skipped int := 0; v_suppressed int := 0; v_created int := 0;
  v_existing uuid; v_conflicts int := 0; v_customers uuid[] := '{}'; v_card jsonb; v_seen timestamptz;
begin
  if p_location_id is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'customer_ingest_invalid';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if not exists(select 1 from public.toast_order_latest_pointers p where p.location_id=p_location_id and p.order_guid=v_row->>'order_guid') then
      v_skipped := v_skipped + 1; continue;
    end if;
    perform public.customer_identity_lock();
    select public.customer_root(o.customer_id) into v_existing from public.customer_orders o
    where o.location_id = p_location_id and o.toast_order_guid = v_row->>'order_guid';
    -- An erased order cannot recreate a profile, even if a later payload carries fresh contact.
    if v_existing is not null and exists(select 1 from public.customers where id = v_existing and erased_at is not null) then
      v_skipped := v_skipped + 1; continue;
    end if;
    v_seen := coalesce((v_row->>'seen_at')::timestamptz, ((v_row->>'business_date')::date)::timestamptz);
    select * into v_res from public.customer_resolve(v_row->>'email', v_row->>'phone', v_row->>'full_name', v_row->>'first_name', v_row->>'last_name',
      p_location_id, v_seen, v_row->>'source', v_row->>'masked_channel');
    if v_res.suppressed then v_suppressed := v_suppressed + 1; end if;
    if v_res.customer_id is null and not v_res.suppressed
      and coalesce((v_row->>'contact_masked')::boolean, false)
      and nullif(btrim(v_row->>'full_name'),'') is not null then
      if v_existing is not null then
        v_res.customer_id := v_existing;
      else
        v_res.customer_id := public.customer_marketplace_guest(v_row->>'full_name', v_row->>'first_name',
          v_row->>'last_name', p_location_id, v_seen, v_row->>'source', v_row->>'masked_channel');
        v_res.created := true;
      end if;
    end if;
    if v_res.customer_id is null then v_skipped := v_skipped + 1; continue; end if;
    -- A recaptured order whose contact now resolves to someone else (an edited email, a split check) keeps
    -- its owner: refresh the order's facts, attach no cards to either person, count it. Never raise: the
    -- pinger re-feeds the whole day every tick, so one edited order would stall the shop-day's capture.
    if v_existing is not null and v_existing is distinct from v_res.customer_id then
      v_conflicts := v_conflicts + 1;
      update public.customer_orders set business_date = (v_row->>'business_date')::date, channel = v_row->>'channel',
        total_cents = (v_row->>'total_cents')::bigint, items = coalesce(v_row->'items','[]'::jsonb),
        contact_masked = coalesce((v_row->>'contact_masked')::boolean, false)
      where location_id = p_location_id and toast_order_guid = v_row->>'order_guid';
      continue;
    end if;
    if v_res.created then v_created := v_created + 1; end if;
    insert into public.customer_orders(customer_id, location_id, source_kind, toast_order_guid, business_date, channel, total_cents, items, contact_masked)
    values (v_res.customer_id, p_location_id, 'toast', v_row->>'order_guid', (v_row->>'business_date')::date, v_row->>'channel',
      (v_row->>'total_cents')::bigint, coalesce(v_row->'items','[]'::jsonb), coalesce((v_row->>'contact_masked')::boolean, false))
    on conflict (location_id, toast_order_guid) do update set
      business_date = excluded.business_date, channel = excluded.channel, total_cents = excluded.total_cents,
      items = excluded.items, contact_masked = excluded.contact_masked;
    for v_card in select value from jsonb_array_elements(coalesce(v_row->'cards','[]'::jsonb)) loop
      insert into public.customer_cards(customer_id, brand, last4, first_seen_at, last_seen_at)
      values (v_res.customer_id, v_card->>'brand', v_card->>'last4', v_seen, v_seen)
      on conflict (customer_id, brand, last4) do update set
        first_seen_at = least(customer_cards.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(customer_cards.last_seen_at, excluded.last_seen_at);
    end loop;
    v_linked := v_linked + 1;
    if not v_res.customer_id = any(v_customers) then v_customers := v_customers || v_res.customer_id; end if;
  end loop;
  return jsonb_build_object('linked', v_linked, 'skipped', v_skipped, 'suppressed', v_suppressed, 'created', v_created,
    'owner_conflicts', v_conflicts, 'customer_ids', to_jsonb(v_customers));
end $$;

create table public.customer_probable_links (
  guest_id uuid not null references public.customers(id),
  customer_id uuid not null references public.customers(id),
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  reasons text[] not null check (cardinality(reasons) > 0 and reasons <@ array['same_name','same_initial','same_shop','shared_items']::text[]),
  decided_by text not null check (decided_by in ('rule','review')),
  created_at timestamptz not null default now(), revoked_at timestamptz,
  revoked_by uuid references public.users(id),
  id uuid primary key default gen_random_uuid(), check (guest_id <> customer_id)
);
create unique index customer_probable_links_active on public.customer_probable_links(guest_id) where revoked_at is null;
alter table public.customer_probable_links enable row level security;
create policy customer_probable_links_no_user_delete on public.customer_probable_links for delete using (false);
revoke all on public.customer_probable_links from public, anon, authenticated, service_role;
grant select on public.customer_probable_links to service_role;

-- Private common projection: one order aggregate, no per-person consent lookup or join fanout.
-- Identity and consent are profile-wide, while all order metrics are shop-scoped.
create function public.customer_list_rows(p_location_ids uuid[])
returns table(customer_id uuid, full_name text, visits bigint, spend_cents numeric, avg_order_cents numeric,
  first_order date, last_order date, shops uuid[], catering_orders bigint, cards bigint,
  channels text[], is_guest boolean, has_email boolean, has_phone boolean, opted_in boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with orders as (
    select o.customer_id, count(*) visits,
      case when count(o.total_cents) = count(*) then sum(o.total_cents) end spend_cents,
      case when count(o.total_cents) = count(*) then round(avg(o.total_cents)) end avg_order_cents,
      min(o.business_date) first_order, max(o.business_date) last_order,
      array_agg(distinct o.location_id order by o.location_id) shops,
      count(*) filter (where o.source_kind <> 'toast' or o.channel = 'catering') catering_orders,
      array_agg(distinct o.channel order by o.channel) channels, bool_and(o.contact_masked) all_masked
    from public.customer_orders o
    where p_location_ids is null or o.location_id = any(p_location_ids)
    group by o.customer_id
  ), identifiers as (
    -- A relay address stored before 0249 (cleanup seed 53) is not contact and does not make a person.
    select i.customer_id, bool_or(i.kind = 'email' and not public.customer_email_is_relay(i.value)) has_email,
      bool_or(i.kind = 'phone') has_phone
    from public.customer_identifiers i group by i.customer_id
  ), cards as (
    select k.customer_id, count(*) cards from public.customer_cards k group by k.customer_id
  ), consent as (
    select k.customer_id, bool_or(k.status = 'opted_in') opted_in
    from public.customer_consent_current k group by k.customer_id
  )
  select c.id, c.full_name, o.visits, o.spend_cents, o.avg_order_cents, o.first_order, o.last_order,
    o.shops, o.catering_orders, coalesce(k.cards,0), o.channels,
    not coalesce(i.has_email or i.has_phone, false) and o.all_masked, coalesce(i.has_email,false), coalesce(i.has_phone,false), coalesce(s.opted_in,false)
  from orders o join public.customers c on c.id = o.customer_id and c.merged_into is null and c.erased_at is null
  left join identifiers i on i.customer_id = c.id
  left join cards k on k.customer_id = c.id
  left join consent s on s.customer_id = c.id
$$;

create function public.customer_list_page(p_location_ids uuid[], p_search text, p_sort text, p_filters jsonb,
  p_limit integer, p_offset integer)
returns table(customer_id uuid, full_name text, visits bigint, spend_cents numeric, avg_order_cents numeric,
  first_order date, last_order date, shops uuid[], catering_orders bigint, cards bigint,
  channels text[], is_guest boolean, has_email boolean, has_phone boolean, opted_in boolean, total_rows bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_filters jsonb := coalesce(p_filters,'{}'::jsonb); v_key text; v_sort text := coalesce(p_sort,'recent');
begin
  if v_sort not in ('recent','visits','spend','avg_order','cards','catering','newest','quiet') then raise exception 'customer_list_sort_invalid'; end if;
  if jsonb_typeof(v_filters) <> 'object' then raise exception 'customer_list_filters_invalid'; end if;
  for v_key in select jsonb_object_keys(v_filters) loop
    if v_key not in ('segment','channel','min_visits','min_spend_cents','guests','only_guests','reachable','opted_in') then raise exception 'customer_list_filters_invalid'; end if;
    if v_key in ('guests','only_guests','reachable','opted_in') and jsonb_typeof(v_filters->v_key) <> 'boolean' then raise exception 'customer_list_filters_invalid'; end if;
    if v_key in ('segment','channel') and jsonb_typeof(v_filters->v_key) <> 'string' then raise exception 'customer_list_filters_invalid'; end if;
    if v_key in ('min_visits','min_spend_cents') then
      if jsonb_typeof(v_filters->v_key) <> 'number' or (v_filters->>v_key) !~ '^[0-9]+$' then raise exception 'customer_list_filters_invalid'; end if;
      if v_key = 'min_visits' and (v_filters->>v_key)::numeric not between 1 and 1000 then raise exception 'customer_list_filters_invalid'; end if;
    end if;
  end loop;
  if v_filters ? 'segment' and v_filters->>'segment' not in ('regulars','lapsed','one_time','new','both_shops','catering') then raise exception 'customer_list_filters_invalid'; end if;
  if v_filters ? 'channel' and v_filters->>'channel' not in ('in_store','online','app','delivery','catering') then raise exception 'customer_list_filters_invalid'; end if;
  return query
  select r.*, count(*) over () from public.customer_list_rows(p_location_ids) r
  where (p_search is null or lower(r.full_name) like '%' || lower(replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')) || '%')
    and (coalesce((v_filters->>'guests')::boolean,false) or coalesce((v_filters->>'only_guests')::boolean,false) or not r.is_guest)
    and (not coalesce((v_filters->>'only_guests')::boolean,false) or r.is_guest)
    and (not (v_filters ? 'reachable') or (r.has_email or r.has_phone) = (v_filters->>'reachable')::boolean)
    and (not (v_filters ? 'opted_in') or r.opted_in = (v_filters->>'opted_in')::boolean)
    and (not (v_filters ? 'min_visits') or r.visits >= (v_filters->>'min_visits')::numeric)
    and (not (v_filters ? 'min_spend_cents') or r.spend_cents >= (v_filters->>'min_spend_cents')::numeric)
    and (v_sort <> 'quiet' or r.visits >= 2)
    and (not (v_filters ? 'segment') or case v_filters->>'segment'
      when 'regulars' then r.visits >= 5 when 'lapsed' then r.visits >= 5 and r.last_order < (now() at time zone 'America/New_York')::date - 60
      when 'one_time' then r.visits = 1 when 'new' then r.first_order >= (now() at time zone 'America/New_York')::date - 30
      when 'both_shops' then cardinality(r.shops) >= 2 when 'catering' then r.catering_orders >= 1 else false end)
    and (not (v_filters ? 'channel') or case v_filters->>'channel'
      when 'in_store' then r.channels && array['dine_in','takeout']
      when 'catering' then r.catering_orders >= 1 else (v_filters->>'channel') = any(r.channels) end)
  order by case when v_sort = 'recent' then r.last_order end desc,
    case when v_sort = 'visits' then r.visits end desc,
    case when v_sort = 'spend' then r.spend_cents end desc nulls last,
    case when v_sort = 'avg_order' then r.avg_order_cents end desc nulls last,
    case when v_sort = 'cards' then r.cards end desc,
    case when v_sort = 'catering' then r.catering_orders end desc,
    case when v_sort = 'newest' then r.first_order end desc,
    case when v_sort = 'quiet' then r.last_order end asc, r.customer_id
  limit least(greatest(coalesce(p_limit,50),1),200) offset greatest(coalesce(p_offset,0),0);
end $$;

create function public.customer_list_summary(p_location_ids uuid[])
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  with rows as materialized (select * from public.customer_list_rows(p_location_ids)), linked as (
    select l.guest_id from public.customer_probable_links l
    join public.customers c on c.id = l.customer_id and c.erased_at is null and c.merged_into is null
    where l.revoked_at is null
  )
  select jsonb_build_object('people', count(*) filter (where not r.is_guest),
    'reachable', count(*) filter (where not r.is_guest and (r.has_email or r.has_phone)),
    'regulars', count(*) filter (where not r.is_guest and r.visits >= 5),
    'lapsed', count(*) filter (where not r.is_guest and r.visits >= 5 and r.last_order < (now() at time zone 'America/New_York')::date - 60),
    'both_shops', count(*) filter (where not r.is_guest and cardinality(r.shops) >= 2),
    'catering', count(*) filter (where not r.is_guest and r.catering_orders >= 1),
    'guests', count(*) filter (where r.is_guest),
    'guests_linked', count(*) filter (where r.is_guest and l.guest_id is not null))
  from rows r left join linked l on l.guest_id = r.customer_id
$$;

-- Return every compatible candidate for each selected guest. Never LIMIT candidate pairs:
-- a truncated second match would turn an ambiguous name into a false unique match.
create function public.customer_marketplace_candidate_rows(p_location_id uuid, p_after uuid, p_limit integer, p_guest_id uuid)
returns table(guest_id uuid, guest_name_key text, location_id uuid, guest_items text[], guest_dates date[], candidates jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
  with profiles as materialized (
    select c.id, btrim(regexp_replace(regexp_replace(lower(c.name_key),'[.]','','g'),'\s+',' ','g')) name_key,
      string_to_array(btrim(regexp_replace(regexp_replace(lower(c.name_key),'[.]','','g'),'\s+',' ','g')),' ') tokens,
      not exists(select 1 from public.customer_identifiers i where i.customer_id = c.id
        and not (i.kind = 'email' and public.customer_email_is_relay(i.value)))
        and bool_and(o.contact_masked) is_guest,
      array_agg(distinct o.business_date order by o.business_date) dates
    from public.customers c join public.customer_orders o on o.customer_id = c.id
    where c.merged_into is null and c.erased_at is null and o.location_id = p_location_id and c.name_key is not null
    group by c.id
  ), guests as materialized (
    select * from profiles p where p.is_guest and cardinality(p.tokens) >= 2 and length(p.tokens[1]) > 1
      and (p_after is null or p.id > p_after) and (p_guest_id is null or p.id = p_guest_id)
    order by p.id limit least(greatest(coalesce(p_limit,100),1),100)
  ), pairs as materialized (
    select g.id guest_id, c.id customer_id from guests g join profiles c
      on not c.is_guest and cardinality(c.tokens) >= 2 and c.tokens[1] = g.tokens[1]
      and (c.tokens[cardinality(c.tokens)] = g.tokens[cardinality(g.tokens)]
        or ((length(c.tokens[cardinality(c.tokens)]) = 1 or length(g.tokens[cardinality(g.tokens)]) = 1)
          and left(c.tokens[cardinality(c.tokens)],1) = left(g.tokens[cardinality(g.tokens)],1)))
  ), needed as (
    select id from guests union select customer_id from pairs
  ), quantities as (
    select o.customer_id, lower(btrim(item->>'name')) name, sum((item->>'qty')::numeric) qty
    from public.customer_orders o join needed n on n.id = o.customer_id
    cross join lateral jsonb_array_elements(o.items) item
    where o.location_id = p_location_id and nullif(btrim(item->>'name'),'') is not null
    group by o.customer_id, lower(btrim(item->>'name'))
  ), ranked as (
    select q.*, row_number() over (partition by q.customer_id order by q.qty desc, q.name) rank from quantities q
  ), items as (
    select r.customer_id, array_agg(r.name order by r.qty desc,r.name) all_items,
      array_agg(r.name order by r.qty desc,r.name) filter (where r.rank <= 5) top_items
    from ranked r group by r.customer_id
  ), candidate_sets as (
    select p.guest_id, jsonb_agg(jsonb_build_object('customer_id', c.id, 'name_key', c.name_key,
      'items', coalesce(i.top_items,'{}'::text[]), 'dates', c.dates) order by c.id) candidates
    from pairs p join profiles c on c.id = p.customer_id left join items i on i.customer_id = c.id group by p.guest_id
  )
  select g.id, g.name_key, p_location_id, coalesce(i.all_items,'{}'::text[]), g.dates, coalesce(s.candidates,'[]'::jsonb)
  from guests g left join items i on i.customer_id = g.id left join candidate_sets s on s.guest_id = g.id order by g.id
$$;

create function public.customer_marketplace_candidates(p_location_id uuid, p_after uuid default null, p_limit integer default 100)
returns table(guest_id uuid, guest_name_key text, location_id uuid, guest_items text[], guest_dates date[], candidates jsonb)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_location_id is null then raise exception 'customer_marketplace_scope_invalid'; end if;
  return query select * from public.customer_marketplace_candidate_rows(p_location_id,p_after,p_limit,null);
end $$;

create function public.customer_probable_link_upsert(p_guest_id uuid, p_customer_id uuid, p_confidence numeric,
  p_reasons text[], p_decided_by text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_existing public.customer_probable_links%rowtype; v_evidence record; v_candidate jsonb;
  v_location uuid; v_same boolean; v_shared boolean; v_valid boolean := false; v_expected text[]; v_confidence numeric;
begin
  perform public.customer_identity_lock();
  if p_guest_id is null or p_customer_id is null or p_guest_id = p_customer_id or p_confidence is null
    or p_decided_by is null or p_decided_by not in ('rule','review') or p_reasons is null then
    raise exception 'customer_probable_link_invalid';
  end if;
  -- Recompute eligibility/evidence under the same lock used by merge, erase and capture.
  -- A saved plan cannot silently attach an erased, merged, newly ambiguous or changed profile.
  for v_location in select distinct o.location_id from public.customer_orders o where o.customer_id = p_guest_id loop
    select * into v_evidence from public.customer_marketplace_candidate_rows(v_location,null,1,p_guest_id);
    if not found or jsonb_array_length(v_evidence.candidates) <> 1 then continue; end if;
    v_candidate := v_evidence.candidates->0;
    if (v_candidate->>'customer_id')::uuid <> p_customer_id then continue; end if;
    v_same := v_evidence.guest_name_key = v_candidate->>'name_key'
      and length(regexp_replace(regexp_replace(v_evidence.guest_name_key,'^.*\s',''),'[.]','','g')) > 1;
    -- Initial-only names need two shared top items: one shared sub is near-certain at a sandwich shop.
    select count(*) >= case when v_same then 1 else 2 end from jsonb_array_elements_text(v_candidate->'items') x
      where x = any(v_evidence.guest_items) into v_shared;
    if not v_same and not v_shared then continue; end if;
    v_confidence := case when v_same and v_shared then 0.90 when v_same then 0.80 else 0.70 end;
    v_expected := array[case when v_same then 'same_name' else 'same_initial' end,'same_shop'];
    if v_shared then v_expected := v_expected || 'shared_items'::text; end if;
    if p_confidence = v_confidence and p_reasons @> v_expected and p_reasons <@ v_expected
      and cardinality(p_reasons) = cardinality(v_expected) then v_valid := true; exit; end if;
  end loop;
  if not v_valid then raise exception 'customer_probable_link_stale'; end if;
  select * into v_existing from public.customer_probable_links where guest_id = p_guest_id and revoked_at is null for update;
  if found then
    if v_existing.customer_id = p_customer_id and v_existing.confidence = p_confidence and v_existing.decided_by = p_decided_by
      and v_existing.reasons @> p_reasons and v_existing.reasons <@ p_reasons then return false; end if;
    raise exception 'customer_probable_link_conflict';
  end if;
  insert into public.customer_probable_links(guest_id,customer_id,confidence,reasons,decided_by)
  values (p_guest_id,p_customer_id,p_confidence,p_reasons,p_decided_by);
  return true;
end $$;

-- Same private/public grant boundary as 0234; CREATE OR REPLACE never implies a safe ACL.
revoke all on function public.customer_email_is_relay(text),
  public.customer_marketplace_guest(text,text,text,uuid,timestamptz,text,text), public.customer_list_rows(uuid[]),
  public.customer_marketplace_candidate_rows(uuid,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.customer_ingest_orders(uuid,jsonb), public.customer_list_page(uuid[],text,text,jsonb,integer,integer),
  public.customer_list_summary(uuid[]), public.customer_marketplace_candidates(uuid,uuid,integer),
  public.customer_probable_link_upsert(uuid,uuid,numeric,text[],text) from public, anon, authenticated;
grant execute on function public.customer_ingest_orders(uuid,jsonb), public.customer_list_page(uuid[],text,text,jsonb,integer,integer),
  public.customer_list_summary(uuid[]), public.customer_marketplace_candidates(uuid,uuid,integer),
  public.customer_probable_link_upsert(uuid,uuid,numeric,text[],text) to service_role;

do $$ begin
  if exists(select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'customer_probable_links'
    and (grantee in ('PUBLIC','anon','authenticated') or (grantee = 'service_role' and privilege_type <> 'SELECT'))) then
    raise exception '0249: table grant escaped';
  end if;
  if exists(select 1 from information_schema.routine_privileges where routine_schema = 'public'
    and routine_name in ('customer_email_is_relay','customer_marketplace_guest','customer_list_rows','customer_marketplace_candidate_rows',
      'customer_ingest_orders','customer_list_page','customer_list_summary','customer_marketplace_candidates','customer_probable_link_upsert')
    and grantee in ('PUBLIC','anon','authenticated')) then raise exception '0249: RPC grant escaped'; end if;
  if exists(select 1 from information_schema.routine_privileges where routine_schema = 'public'
    and routine_name in ('customer_email_is_relay','customer_marketplace_guest','customer_list_rows','customer_marketplace_candidate_rows')
    and grantee = 'service_role') then raise exception '0249: private helper granted'; end if;
end $$;
commit;
