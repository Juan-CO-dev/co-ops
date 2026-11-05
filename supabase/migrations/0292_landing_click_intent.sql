-- Migration 0292_landing_click_intent
-- AUTHORED 2026-11-05. FILE ONLY, NOT APPLIED.
-- APPLIED TO SIM 2026-11-05 (schema_migrations version 20261105192733, name '0292_landing_click_intent').
-- APPLIED TO PROD 2026-11-05 (schema_migrations version 20261105194036, name '0292_landing_click_intent').
-- Provenance: Juan's landing pickup/delivery/visit measurement ruling.
-- ROLLOUT: SQL before app, after 0289. Named two-argument calls retain legacy
-- behavior during deployment drain. DROP/CREATE avoids PGRST203 overloads.
-- VERIFY: scripts/sql-harness-0292.mjs (offline); CC owns sim/prod activation.
-- ROLLBACK: revert app first; retain intent history and compatible RPC defaults.
begin;

-- Preserve the registry -> counter lock order used by the increment.
lock table public.landing_ad_codes in access exclusive mode;
lock table public.landing_order_click_counts in access exclusive mode;
alter table public.landing_order_click_counts
  add column intent text not null default 'legacy',
  add constraint landing_order_click_counts_intent_check check(intent in ('legacy','pickup','delivery','visit')),
  drop constraint landing_order_click_counts_store_key_check,
  add constraint landing_order_click_counts_store_intent_check check(
    (intent = 'delivery' and store_key = 'any') or
    (intent <> 'delivery' and store_key in ('capitol-hill','dupont'))),
  drop constraint landing_order_click_counts_pkey,
  add primary key(day_et, store_key, ad_slot, intent);

drop function public.increment_landing_order_click(text,text);
create function public.increment_landing_order_click(p_store_key text, p_ad_code text, p_intent text default 'legacy')
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ad text; v_slot smallint;
begin
  if p_intent is null or p_intent not in ('legacy','pickup','delivery','visit') then
    raise exception 'invalid_intent' using errcode = '22023';
  end if;
  if p_store_key is null or not (
    (p_intent = 'delivery' and p_store_key = 'any') or
    (p_intent <> 'delivery' and p_store_key in ('capitol-hill','dupont'))) then
    raise exception 'invalid_store' using errcode = '22023';
  end if;
  if p_ad_code is null or length(p_ad_code) > 64 then
    raise exception 'invalid_ad' using errcode = '22023';
  end if;
  select code, slot into v_ad, v_slot from public.landing_ad_codes
    where code = p_ad_code and active for share;
  if not found then
    select code, slot into v_ad, v_slot from public.landing_ad_codes where code = 'unattributed';
  end if;
  insert into public.landing_order_click_counts(day_utc, day_et, store_key, ad_code, ad_slot, click_count, intent)
  values ((clock_timestamp() at time zone 'UTC')::date, (now() at time zone 'America/New_York')::date,
    p_store_key, v_ad, v_slot, 1, p_intent)
  on conflict(day_et, store_key, ad_slot, intent) do update
    set click_count = public.landing_order_click_counts.click_count + 1;
end $$;
revoke all on function public.increment_landing_order_click(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.increment_landing_order_click(text,text,text) to service_role;

-- Preserve the original order-only read shape for older deployments; visits are separate.
create or replace function public.marketing_order_taps(p_from date, p_to date)
returns table(day date, store_key text, ad_code text, active boolean, click_count bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then raise exception 'taps_window_invalid'; end if;
  return query select c.day_et, c.store_key, c.ad_code, a.active, sum(c.click_count)::bigint
    from public.landing_order_click_counts c join public.landing_ad_codes a on a.slot = c.ad_slot
    where c.day_et between p_from and p_to and c.intent <> 'visit'
    group by c.day_et,c.store_key,c.ad_code,a.active,c.ad_slot order by c.day_et,c.store_key,c.ad_slot;
end $$;

create function public.marketing_order_tap_intents(p_from date, p_to date)
returns table(day date, store_key text, ad_code text, active boolean, click_count bigint, intent text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then raise exception 'taps_window_invalid'; end if;
  return query select c.day_et, c.store_key, c.ad_code, a.active, c.click_count, c.intent
    from public.landing_order_click_counts c join public.landing_ad_codes a on a.slot = c.ad_slot
    where c.day_et between p_from and p_to order by c.day_et,c.store_key,c.ad_slot,c.intent;
end $$;
revoke all on function public.marketing_order_taps(date,date), public.marketing_order_tap_intents(date,date) from public, anon, authenticated, service_role;
grant execute on function public.marketing_order_taps(date,date), public.marketing_order_tap_intents(date,date) to service_role;

do $$ declare f regprocedure; owner_oid oid; begin
  select relowner into owner_oid from pg_class where oid = 'public.landing_order_click_counts'::regclass;
  if (select relowner from pg_class where oid = 'public.landing_ad_codes'::regclass) <> owner_oid then
    raise exception '0292: landing table owner mismatch';
  end if;
  foreach f in array array['public.increment_landing_order_click(text,text,text)'::regprocedure,
    'public.marketing_order_taps(date,date)'::regprocedure,'public.marketing_order_tap_intents(date,date)'::regprocedure] loop
    if (select proowner from pg_proc where oid = f) <> owner_oid then
      raise exception '0292: function owner must own both landing tables';
    end if;
  end loop;
end $$;
commit;
