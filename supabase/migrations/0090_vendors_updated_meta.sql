-- Migration 0090_vendors_updated_meta
-- Applied via Supabase MCP apply_migration on 2026-06-25.
-- Canonical reference: lib/admin/vendors.ts (updateVendor) +
--   docs/superpowers/specs/2026-06-25-vendor-directory-admin-design.md

-- Vendor directory admin (inventory phase, step 3). vendors had created_at/by
-- but no updated_at/updated_by — add them so admin edits record who/when on the
-- row, consistent with users/items/sections. Nullable, no backfill (edits set
-- them going forward). The audit log still records full before/after.
alter table public.vendors add column updated_at timestamptz;
alter table public.vendors add column updated_by uuid references public.users(id);
