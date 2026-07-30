-- Migration 0166_toast_daily_depletion
-- Toast depletion into drift (read-track #3; spec
-- docs/superpowers/specs/2026-07-31-toast-depletion-into-drift-design.md).
--
-- Materialized daily rollup of the sales-consumption derivation, one row per
-- (location, business_date, sku). Two lanes per the DOUBLE-COUNT LAW:
--   direct_oz    — at-sale consumption (menu_item direct SKU inputs + SKU
--                  modifiers, clamped >= 0). THE ONLY lane counts' drift reads:
--                  raw stock leaves the shelf at direct sale OR at production
--                  (production_inputs), never both.
--   flattened_oz — raw SKUs reached by flattening item par-units through the
--                  recipe graph. Production-covered; display/forecast truth
--                  only, NEVER summed into drift.
-- The ledger is a CACHE of a pure derivation (deriveSalesConsumption):
-- re-materialization deletes the (location, date) day and re-inserts —
-- idempotent, safe on re-pulls/void revisions. Written by the nightly
-- sales-pull cron + the one-shot backfill script.
--
-- RLS deny-all mirror of toast_sales_events (service-role writes only; reads
-- go through app loaders).

create table public.toast_daily_depletion (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  business_date date not null,
  sku_id uuid not null references public.vendor_items(id),
  direct_oz numeric not null check (direct_oz >= 0),
  flattened_oz numeric not null check (flattened_oz >= 0),
  computed_at timestamptz not null default now(),
  unique (location_id, business_date, sku_id)
);

-- Drift reads sum direct_oz per SKU over a date window at one location.
create index tdd_loc_sku_date_idx on public.toast_daily_depletion(location_id, sku_id, business_date);

alter table public.toast_daily_depletion enable row level security;
create policy toast_daily_depletion_no_user_select on public.toast_daily_depletion for select using (false);
create policy toast_daily_depletion_no_user_insert on public.toast_daily_depletion for insert with check (false);
create policy toast_daily_depletion_no_user_update on public.toast_daily_depletion for update using (false);
create policy toast_daily_depletion_no_user_delete on public.toast_daily_depletion for delete using (false);
