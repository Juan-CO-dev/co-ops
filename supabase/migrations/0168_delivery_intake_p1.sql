-- 0168: delivery-intake P1 (spec 2026-08-02-delivery-intake-ordering-design.md D1/D3)
-- match_state added now so P2 (email channel) needs no schema change.
-- NOTE: `created_by` references public.users(id) — this codebase uses `users`, not `profiles`.
-- Every prior `created_by` FK (0067/0070/0108/0111/0115/0116/0117/0118/0120/0160 etc.)
-- references public.users(id). The approved spec said `profiles`; corrected here.

alter table public.vendor_deliveries
  add column if not exists match_state text not null default 'counted_only'
    check (match_state in ('counted_only','matched','discrepant','override')),
  add column if not exists delivery_status text not null default 'complete'
    check (delivery_status in ('in_progress','complete'));

alter table public.vendor_delivery_items
  add column if not exists expected_qty numeric null,          -- qty pre-filled at the door (level units); null = unexpected/added line
  add column if not exists discrepancy_type text null
    check (discrepancy_type in ('short','over','damaged','substitution'));

create table if not exists public.vendor_credits (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  vendor_id uuid not null references public.vendors(id),
  delivery_id uuid null references public.vendor_deliveries(id),
  delivery_item_id uuid null references public.vendor_delivery_items(id),
  reason text not null check (reason in ('short','over','damaged','substitution','price_discrepancy')),
  sku_id uuid null references public.vendor_items(id),
  qty numeric null,
  amount_cents integer null,               -- server-derived estimate: qty * intake unit_price
  status text not null default 'open'
    check (status in ('open','in_progress','resolved_credit','resolved_refund','written_off')),
  memo_url text null,
  notes text null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null
);

-- Idempotency: one credit per (line, reason) — retry-safe if intake write is re-run.
create unique index if not exists vendor_credits_line_reason_uq
  on public.vendor_credits (delivery_item_id, reason) where delivery_item_id is not null;
create index if not exists vendor_credits_vendor_open_ix
  on public.vendor_credits (vendor_id, status);
create index if not exists vendor_credits_location_ix
  on public.vendor_credits (location_id);

-- House pattern: deny-by-default; service-role only.
alter table public.vendor_credits enable row level security;
revoke all on public.vendor_credits from anon, authenticated;
revoke all on public.vendor_credits from public;
