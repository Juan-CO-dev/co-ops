-- 0210_vendor_items_price_basis.sql — Vendor Ordering V3-C-1, seed 38
-- CC rulings 2026-09-20: docs/seed/source/vendor-exports/review/seed38-rulings.md.
-- AUTHORED 2026-09-20. CC applies to sim; production on Juan's word. No data moves here.
-- Nullable purchase denomination metadata only; no default, grants or RLS changes.
ALTER TABLE public.vendor_items
  ADD COLUMN price_basis text
  CONSTRAINT vendor_items_price_basis_check
  CHECK (price_basis IN
    ('per_case', 'per_each', 'per_lb', 'per_dozen', 'per_bundle'));
COMMENT ON COLUMN public.vendor_items.price_basis IS
  'Reviewed vendor purchase denomination. Nullable until adjudicated; no default. '
  'Does not reinterpret vendor_price_history.unit_price, which remains dollars '
  'per internal purchase root. Pack conversion is required when bases differ.';
