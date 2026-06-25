-- Migration 0090_vendors_updated_meta
-- Applied via Supabase MCP apply_migration on 2026-06-25.
-- Canonical reference: lib/admin/vendors.ts (updateVendor*) +
--   docs/superpowers/specs/2026-06-25-vendor-directory-admin-design.md
-- (Re-captured: the file was lost when the superseded #94 branch was deleted;
--  the migration itself remained applied to prod.)

-- Vendor directory admin: vendors had created_at/by but no updated_at/updated_by
-- — add them so admin edits record who/when on the row. Nullable, no backfill.
alter table public.vendors add column updated_at timestamptz;
alter table public.vendors add column updated_by uuid references public.users(id);
