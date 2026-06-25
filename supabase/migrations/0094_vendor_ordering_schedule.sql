-- Migration 0094_vendor_ordering_schedule
-- Applied via Supabase MCP apply_migration on 2026-06-25.
-- Canonical reference: lib/admin/vendors.ts (setVendorSchedule) +
--   docs/superpowers/specs/2026-06-25-vendor-ordering-schedule-slice-b1-design.md

-- Vendor ordering schedule (Slice B1): per-vendor weekly order-days +
-- delivery-days + a calendar color. Weekday convention 0=Sun..6=Sat (JS getDay,
-- matches item_par_levels.day_of_week + lib/items.ts operationalDayOfWeek).
-- Feeds the B2 aggregated landing-page calendar (each vendor a distinct color;
-- order/delivery shown as two shades). Single weekly set per vendor → arrays.
alter table public.vendors add column order_days smallint[] not null default '{}';
alter table public.vendors add column delivery_days smallint[] not null default '{}';
alter table public.vendors add column color text null;
