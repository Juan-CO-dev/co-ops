-- Migration 0192_toast_catering_orders
-- AUTHORED 2026-09-04. NOT YET APPLIED — GATE (JUAN).
--
-- 0192: toast_catering_orders — the Toast catering scan's per-order ledger (catering inbox A1.2).
--
-- One row per Toast order the scan CLASSIFIED (catering · ezcater ring · voided later), keyed
-- on the Toast order guid. Ledger-first: the row lands before any lead write. The scan is
-- idempotent on (order_guid, toast_modified_at): unchanged orders are no-ops. System-only
-- (service role): no user reads/writes — mirrors ezcater_events (0149).

create table public.toast_catering_orders (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations(id),
  order_guid         text not null unique,
  business_date      date not null,
  source             text,
  dining_option      text,
  classification     text not null check (classification in ('catering','ezcater')),
  voided             boolean not null default false,
  promised_at        timestamptz,
  toast_modified_at  timestamptz,
  customer_name      text,
  customer_phone     text,
  headcount          integer,
  total_cents        integer not null default 0,
  items              jsonb not null default '[]'::jsonb,
  lead_id            uuid references public.catering_pipeline(id),
  processing_result  text not null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);
create index toast_catering_orders_loc_date_ix on public.toast_catering_orders (location_id, business_date desc);
create index toast_catering_orders_lead_ix on public.toast_catering_orders (lead_id) where lead_id is not null;

alter table public.toast_catering_orders enable row level security;
create policy toast_catering_orders_no_user_select on public.toast_catering_orders for select using (false);
create policy toast_catering_orders_no_user_insert on public.toast_catering_orders for insert with check (false);
create policy toast_catering_orders_no_user_update on public.toast_catering_orders for update using (false);
create policy toast_catering_orders_no_user_delete on public.toast_catering_orders for delete using (false);

-- Verify after apply:
--   select count(*) from pg_policies where tablename = 'toast_catering_orders';  -- 4
