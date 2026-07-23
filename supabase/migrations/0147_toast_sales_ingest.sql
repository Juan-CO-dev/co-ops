-- Migration 0147_toast_sales_ingest
-- STAGED in PR (Toast read-track 2); prod apply deferred to Juan's explicit go.
-- Canonical reference: docs/superpowers/specs/2026-07-23-toast-sales-ingest-design.md
--
-- Append-only Toast sales ledger (snapshot-versioned per selection; voids are
-- new versions, never updates) + admin-curated ingest exclusions (the catering
-- double-count rule for CO's MIXED catering reality). Deny-all RLS on both —
-- lib/catering/toast-sales.ts is the sole authority (0143/0146 pattern).

create table public.toast_sales_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  business_date date not null,
  check_guid text not null,
  selection_guid text not null,
  parent_selection_guid text,
  toast_item_guid text not null,
  item_name text not null,
  quantity numeric not null,
  price_cents integer,
  voided boolean not null default false,
  dining_option text,
  menu_group text,
  snapshot_version integer not null,
  pulled_at timestamptz not null default now(),
  created_by uuid,
  unique (location_id, check_guid, selection_guid, snapshot_version)
);
alter table public.toast_sales_events enable row level security;
create policy toast_sales_events_no_user_insert on public.toast_sales_events for insert with check (false);
create policy toast_sales_events_no_user_update on public.toast_sales_events for update using (false);
create policy toast_sales_events_no_user_delete on public.toast_sales_events for delete using (false);
create index tse_loc_date_idx on public.toast_sales_events(location_id, business_date);

create table public.toast_ingest_exclusions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id),
  kind text not null check (kind in ('dining_option','menu_group','toast_item_guid','item_name_contains')),
  value text not null,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.toast_ingest_exclusions enable row level security;
create policy toast_ingest_exclusions_no_user_insert on public.toast_ingest_exclusions for insert with check (false);
create policy toast_ingest_exclusions_no_user_update on public.toast_ingest_exclusions for update using (false);
create policy toast_ingest_exclusions_no_user_delete on public.toast_ingest_exclusions for delete using (false);
