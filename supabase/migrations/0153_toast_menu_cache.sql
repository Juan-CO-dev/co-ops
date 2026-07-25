-- Migration 0153_toast_menu_cache
-- STAGED in PR; prod apply deferred to Juan's go.
--
-- Toast's menus/v2 endpoint is aggressively rate-limited (burned a whole
-- window on 2026-07-24 first-light day). Toast's recommended pattern: probe
-- /menus/v2/metadata (cheap) and re-pull the full payload only when
-- lastUpdated changed. Cache keyed by restaurant guid; deny-all RLS
-- (lib/toast/menus.ts is the sole authority).

create table public.toast_menu_cache (
  restaurant_guid text primary key,
  payload jsonb not null,
  last_updated text,
  fetched_at timestamptz not null default now()
);
alter table public.toast_menu_cache enable row level security;
create policy toast_menu_cache_no_user_insert on public.toast_menu_cache for insert with check (false);
create policy toast_menu_cache_no_user_update on public.toast_menu_cache for update using (false);
create policy toast_menu_cache_no_user_delete on public.toast_menu_cache for delete using (false);
