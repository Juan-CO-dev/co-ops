-- 0206_sku_barcodes.sql — Vendor Ordering V3-B (spec docs/superpowers/specs/2026-09-16-vendor-ordering-v3b-barcode-door-design.md §3)
-- Codes taught at the receiving door. code = the manufacturer's GTIN (GS1 application identifiers stripped in TS),
-- so twins at two vendors legitimately share it; level = what ONE scan means (case | inner), and the same code may
-- carry both. forgotten_at is a soft delete: lookups ignore it, history stays.
begin;
create table if not exists public.sku_barcodes (
  id           uuid primary key default gen_random_uuid(),
  sku_id       uuid not null references public.vendor_items(id),
  code         text not null,
  symbology    text not null default 'unknown',
  level        text not null default 'case',
  taught_by    uuid null references public.users(id),
  taught_at    timestamptz not null default now(),
  note         text null,
  forgotten_at timestamptz null,
  check (level in ('case','inner')),
  check (symbology in ('ean_13','upc_a','code_128','gs1_128','itf_14','qr','unknown'))
);
comment on table public.sku_barcodes is
  'Codes taught at the receiving door (V3-B). code = the manufacturer''s GTIN (GS1 application identifiers stripped in TS), '
  'so twins at two vendors legitimately share it; level = what ONE scan means (case | inner) and the same code may carry both. '
  'forgotten_at is a soft delete: lookups ignore it, history stays. Service-role only; deny-all RLS.';
create unique index if not exists sku_barcodes_live_key on public.sku_barcodes (code, sku_id, level) where forgotten_at is null;
create index if not exists sku_barcodes_code_ix on public.sku_barcodes (code) where forgotten_at is null;
create index if not exists sku_barcodes_sku_ix  on public.sku_barcodes (sku_id) where forgotten_at is null;
alter table public.sku_barcodes enable row level security;
revoke all on public.sku_barcodes from anon, authenticated;
revoke all on public.sku_barcodes from public;
commit;
