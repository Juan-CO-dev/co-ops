-- Migration 0192_toast_catering_orders
-- AUTHORED 2026-09-04. NOT YET APPLIED — GATE (JUAN).
--
-- 0192: toast_catering_orders — the Toast catering scan's per-order ledger (catering inbox A1.2).
--
-- One row per Toast order the scan CLASSIFIED (catering · ezcater ring · third-party ring ·
-- voided later), keyed on the Toast order guid. Ledger-first: the row lands before any lead
-- write. Idempotency is app-level: the scan compares Toast's modifiedDate as an INSTANT against
-- toast_modified_at (no constraint on the pair) — unchanged orders are no-ops. System-only
-- (service role): no user reads/writes — mirrors ezcater_events (0149).

create table public.toast_catering_orders (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations(id),
  order_guid         text not null unique,
  business_date      date not null,
  source             text,
  dining_option      text,
  classification     text not null check (classification in ('catering','ezcater','third_party')),
  voided             boolean not null default false,
  promised_at        timestamptz,
  toast_modified_at  timestamptz,
  customer_name      text,
  customer_phone     text,
  headcount          integer,
  total_cents        integer not null default 0,
  items              jsonb not null default '[]'::jsonb,
  lead_id            uuid references public.catering_pipeline(id) on delete set null,
  -- processing_result vocabulary: pending_lead · created_lead · created_lead_no_trail ·
  -- duplicate_external_ref · adopted_lead · error:lead_insert · voided_before_seen · refreshed ·
  -- refreshed_no_lead · voided_lead_lost · voided_<outcome> · voided_illegal_transition ·
  -- voided_after_out_needs_review · attributed_to_ezcater · attributed_to_third_party.
  -- (An order with no parseable businessDate is never ledgered — the scan counts it as
  -- `skipped` in the run heartbeat instead.)
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
--   select relrowsecurity from pg_class where oid = 'public.toast_catering_orders'::regclass;  -- true
