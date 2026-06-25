-- Migration 0092_vendor_multiprofile
-- Applied via Supabase MCP apply_migration on 2026-06-25.
-- Canonical reference: lib/admin/vendors.ts +
--   docs/superpowers/specs/2026-06-25-vendor-directory-admin-design.md

-- Vendor Directory v2: category_id FK + multi-contact + multi-ordering-detail.
-- A vendor has N contacts + N ordering details (AGM+ append / GM+ edit-remove /
-- >=1 each enforced app-layer). The legacy single contact_*/ordering_*/category
-- (text) columns on vendors go VESTIGIAL (left in place; these tables +
-- category_id are the truth).
alter table public.vendors add column category_id uuid null references public.categories(id);

-- Backfill the lone placeholder (Baldor, category 'other') -> the Other category.
update public.vendors v set category_id = c.id
  from public.categories c where c.slug = 'Other' and v.category = 'other';

create table public.vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  name text not null,
  email text null,
  phone text null,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index vendor_contacts_vendor on public.vendor_contacts (vendor_id, active, display_order);

create table public.vendor_ordering_details (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  method text not null check (method in ('email','url','phone','portal','other')),
  value text not null,
  label text null,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index vendor_ordering_vendor on public.vendor_ordering_details (vendor_id, active, display_order);

alter table public.vendor_contacts enable row level security;
create policy vendor_contacts_no_user_select on public.vendor_contacts for select using (false);
create policy vendor_contacts_no_user_insert on public.vendor_contacts for insert with check (false);
create policy vendor_contacts_no_user_update on public.vendor_contacts for update using (false) with check (false);
create policy vendor_contacts_no_user_delete on public.vendor_contacts for delete using (false);

alter table public.vendor_ordering_details enable row level security;
create policy vendor_ordering_no_user_select on public.vendor_ordering_details for select using (false);
create policy vendor_ordering_no_user_insert on public.vendor_ordering_details for insert with check (false);
create policy vendor_ordering_no_user_update on public.vendor_ordering_details for update using (false) with check (false);
create policy vendor_ordering_no_user_delete on public.vendor_ordering_details for delete using (false);
