-- 0172: delivery-intake P3 — par-pass ordering tables
-- Spec: docs/superpowers/specs/2026-08-02-delivery-intake-ordering-design.md (D5/D6)
-- Plan: docs/superpowers/plans/2026-08-04-delivery-intake-p3-par-pass.md (Task 1)
--
-- Append-only: rows are never deleted or mutated post-insert (RLS enforced;
-- status 'draft'→'submitted' is the only permitted state transition and is
-- handled at the application layer via service-role).
--
-- Unit semantics: par_qty and order_qty are in the SKU's ORDER UNIT — the chain
-- root pack label when the SKU is part of a pack chain, else pack_format. This
-- matches the implicit unit of the seeded weekday_par / weekend_par guide values.
-- implied_on_hand_oz is advisory and null when the order-unit→oz conversion is
-- unconvertible (never fabricate).

-- ── (1) PAR-PASS EVENTS ───────────────────────────────────────────────────────

create table if not exists public.par_pass_events (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  walked_by   uuid not null references public.users(id),
  walked_at   timestamptz not null default now(),
  status      text not null default 'submitted'
                check (status in ('draft', 'submitted')),
  note        text null,
  created_at  timestamptz not null default now()
);

create index if not exists par_pass_events_location_ix
  on public.par_pass_events (location_id, walked_at desc);

alter table public.par_pass_events enable row level security;
revoke all on public.par_pass_events from anon, authenticated;
revoke all on public.par_pass_events from public;

-- ── (2) PAR-PASS LINES ────────────────────────────────────────────────────────

create table if not exists public.par_pass_lines (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.par_pass_events(id),
  sku_id              uuid not null references public.vendor_items(id),
  vendor_id           uuid null references public.vendors(id),
  par_qty             numeric null,             -- snapshot of par at walk time (order units)
  order_qty           numeric not null check (order_qty >= 0),  -- zero = explicit "we're full"
  order_unit_label    text null,                -- chain root label else pack_format
  implied_on_hand_oz  numeric null,             -- advisory; null when unconvertible
  note                text null,
  created_at          timestamptz not null default now()
);

create index if not exists par_pass_lines_event_ix
  on public.par_pass_lines (event_id);

create index if not exists par_pass_lines_sku_ix
  on public.par_pass_lines (sku_id, created_at desc);

alter table public.par_pass_lines enable row level security;
revoke all on public.par_pass_lines from anon, authenticated;
revoke all on public.par_pass_lines from public;
