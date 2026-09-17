-- 0205_order_guides.sql — Vendor Ordering V3-A (spec docs/superpowers/specs/2026-09-16-vendor-ordering-v3a-order-guides-design.md §3)
-- The vendor's physical order guide as a first-class entity: guide → sections → lines → SKU.
-- Every surface a manager reads while keying an order follows it; the shelf walk does not.
begin;

create table if not exists public.vendor_order_guides (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id),
  name        text not null,
  source_note text null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (vendor_id)
);
comment on table public.vendor_order_guides is
  'One order guide per vendor (V3-A). The order every PO surface follows when keying/reading an order. '
  'updated_at is the admin editor''s optimistic-concurrency token. Service-role only; deny-all RLS.';

create table if not exists public.order_guide_sections (
  id        uuid primary key default gen_random_uuid(),
  guide_id  uuid not null references public.vendor_order_guides(id) on delete cascade,
  name      text not null,
  position  integer not null,
  unique (guide_id, position) deferrable initially deferred,
  unique (guide_id, name)
);

create table if not exists public.order_guide_lines (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references public.order_guide_sections(id) on delete cascade,
  position    integer not null,
  sku_id      uuid null references public.vendor_items(id),
  label       text not null,
  item_number text null,
  note        text null,
  unique (section_id, position) deferrable initially deferred,
  unique (sku_id)
);
comment on column public.order_guide_lines.sku_id is
  'null = a sheet row not yet matched to a SKU (kept in place, shown as "needs a SKU" in admin). '
  'unique: a SKU has one vendor and therefore one guide; a repeated sheet item keeps its first occurrence.';

create index if not exists order_guide_sections_guide_ix on public.order_guide_sections (guide_id, position);
create index if not exists order_guide_lines_section_ix  on public.order_guide_lines (section_id, position);

alter table public.vendor_order_guides  enable row level security;
alter table public.order_guide_sections enable row level security;
alter table public.order_guide_lines    enable row level security;
revoke all on public.vendor_order_guides, public.order_guide_sections, public.order_guide_lines from anon, authenticated;
revoke all on public.vendor_order_guides, public.order_guide_sections, public.order_guide_lines from public;

alter table public.po_lines add column if not exists guide_section_snapshot text null;
comment on column public.po_lines.guide_section_snapshot is
  'Section name at draft time (V3-A). guide_position_snapshot = section.position*1000 + line.position from the same read.';

-- Never written since 0174; every reader is migrated in the V3-A PR.
alter table public.vendor_items drop column if exists guide_position;

commit;
